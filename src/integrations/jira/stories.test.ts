// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import { createStory } from '../../db/queries/stories.js';
import { createTestDatabase } from '../../db/queries/test-helpers.js';
import { AnthropicProvider } from '../../llm/anthropic.js';
import { generateTechLeadJiraInstructions } from '../../orchestrator/prompt-templates.js';
import * as logger from '../../utils/logger.js';
import { JiraClient } from './client.js';
import { createIssue } from './issues.js';
import { generateEpicTitle, safelyParseAcceptanceCriteria, syncStoryToJira } from './stories.js';

// Mock Jira client and issues
vi.mock('./client.js');
vi.mock('./issues.js');
vi.mock('../../llm/anthropic.js');
vi.mock('./sprints.js', () => ({
  getActiveSprintForProject: vi.fn().mockResolvedValue(null),
  moveIssuesToSprint: vi.fn().mockResolvedValue(undefined),
}));

describe('Jira Story Creation', () => {
  describe('generateTechLeadJiraInstructions', () => {
    it('should include project key in instructions', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('Project Key: HIVE');
    });

    it('should include site URL in instructions', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('Site: https://mycompany.atlassian.net');
    });

    it('should include hive stories create command', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('hive stories create');
    });

    it('should mention Jira Epic creation', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('Jira Epic');
    });

    it('should mention ADF format', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('ADF format');
    });

    it('should mention hive-managed label', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('hive-managed');
    });

    it('should mention issue links for dependencies', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('is blocked by');
    });

    it('should mention external_issue_key', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('external_issue_key');
    });

    it('should include example key with project prefix', () => {
      const result = generateTechLeadJiraInstructions('PROJ', 'https://example.atlassian.net');
      expect(result).toContain('PROJ-123');
    });

    it('should note sync failures do not block pipeline', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('do NOT block the pipeline');
    });
  });

  describe('generateEpicTitle', () => {
    beforeEach(() => {
      vi.mocked(AnthropicProvider).mockClear();
    });

    it('should return AI-generated title when LLM call succeeds', async () => {
      const mockComplete = vi.fn().mockResolvedValue({
        content: 'User Authentication with OAuth2 Integration',
        stopReason: 'end_turn',
        usage: { inputTokens: 50, outputTokens: 10 },
      });
      vi.mocked(AnthropicProvider).mockImplementation(
        () => ({ complete: mockComplete, name: 'anthropic' }) as any
      );

      const result = await generateEpicTitle(
        'Build auth system with OAuth2',
        'Allow users to log in with Google and GitHub accounts'
      );

      expect(result).toBe('User Authentication with OAuth2 Integration');
      expect(mockComplete).toHaveBeenCalledOnce();
    });

    it('should fall back to original title when LLM call throws', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      vi.mocked(AnthropicProvider).mockImplementation(
        () =>
          ({
            complete: vi.fn().mockRejectedValue(new Error('API key missing')),
            name: 'anthropic',
          }) as any
      );

      const result = await generateEpicTitle('Raw prompt title', 'Some description');

      expect(result).toBe('Raw prompt title');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to generate epic title via AI')
      );
      warnSpy.mockRestore();
    });

    it('should fall back to original title when LLM returns empty content', async () => {
      vi.mocked(AnthropicProvider).mockImplementation(
        () =>
          ({
            complete: vi.fn().mockResolvedValue({
              content: '   ',
              stopReason: 'end_turn',
              usage: { inputTokens: 50, outputTokens: 1 },
            }),
            name: 'anthropic',
          }) as any
      );

      const result = await generateEpicTitle('Original Title', 'Description');

      expect(result).toBe('Original Title');
    });

    it('should strip surrounding quotes from generated title', async () => {
      vi.mocked(AnthropicProvider).mockImplementation(
        () =>
          ({
            complete: vi.fn().mockResolvedValue({
              content: '"User Management System"',
              stopReason: 'end_turn',
              usage: { inputTokens: 50, outputTokens: 8 },
            }),
            name: 'anthropic',
          }) as any
      );

      const result = await generateEpicTitle('user management', 'Manage users');

      expect(result).toBe('User Management System');
    });

    it('should truncate generated title to 255 characters', async () => {
      const longTitle = 'A'.repeat(300);
      vi.mocked(AnthropicProvider).mockImplementation(
        () =>
          ({
            complete: vi.fn().mockResolvedValue({
              content: longTitle,
              stopReason: 'end_turn',
              usage: { inputTokens: 50, outputTokens: 300 },
            }),
            name: 'anthropic',
          }) as any
      );

      const result = await generateEpicTitle('title', 'desc');

      expect(result.length).toBe(255);
    });

    it('should handle empty description gracefully', async () => {
      const mockComplete = vi.fn().mockResolvedValue({
        content: 'Generated Title',
        stopReason: 'end_turn',
        usage: { inputTokens: 20, outputTokens: 5 },
      });
      vi.mocked(AnthropicProvider).mockImplementation(
        () => ({ complete: mockComplete, name: 'anthropic' }) as any
      );

      const result = await generateEpicTitle('title hint', '');

      expect(result).toBe('Generated Title');
      expect(mockComplete).toHaveBeenCalledOnce();
    });
  });

  describe('safelyParseAcceptanceCriteria', () => {
    it('should return empty array for null input', () => {
      const result = safelyParseAcceptanceCriteria(null, 'story-123');
      expect(result).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      const result = safelyParseAcceptanceCriteria('', 'story-123');
      expect(result).toEqual([]);
    });

    it('should parse valid JSON array', () => {
      const validJson = JSON.stringify(['criterion 1', 'criterion 2']);
      const result = safelyParseAcceptanceCriteria(validJson, 'story-123');
      expect(result).toEqual(['criterion 1', 'criterion 2']);
    });

    it('should parse malformed JSON as plain text', () => {
      const malformedJson = '{"invalid json';
      const result = safelyParseAcceptanceCriteria(malformedJson, 'story-123');
      expect(result).toEqual(['{"invalid json']);
    });

    it('should parse plain text markdown bullet list', () => {
      const plainText = '- criterion 1\n- criterion 2\n- criterion 3';
      const result = safelyParseAcceptanceCriteria(plainText, 'story-123');
      expect(result).toEqual(['criterion 1', 'criterion 2', 'criterion 3']);
    });

    it('should parse plain text with asterisk bullets', () => {
      const plainText = '* criterion A\n* criterion B';
      const result = safelyParseAcceptanceCriteria(plainText, 'story-123');
      expect(result).toEqual(['criterion A', 'criterion B']);
    });

    it('should parse plain text without bullet prefixes', () => {
      const plainText = 'criterion 1\ncriterion 2';
      const result = safelyParseAcceptanceCriteria(plainText, 'story-123');
      expect(result).toEqual(['criterion 1', 'criterion 2']);
    });

    it('should filter empty lines when parsing plain text', () => {
      const plainText = '- criterion 1\n\n- criterion 2\n\n';
      const result = safelyParseAcceptanceCriteria(plainText, 'story-123');
      expect(result).toEqual(['criterion 1', 'criterion 2']);
    });

    it('should return empty array for non-array JSON and log warning', () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const nonArrayJson = '{"key": "value"}';
      const result = safelyParseAcceptanceCriteria(nonArrayJson, 'story-456');

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('acceptance_criteria for story story-456 is not an array')
      );
      warnSpy.mockRestore();
    });

    it('should handle valid empty array', () => {
      const emptyArrayJson = JSON.stringify([]);
      const result = safelyParseAcceptanceCriteria(emptyArrayJson, 'story-789');
      expect(result).toEqual([]);
    });
  });

  describe('Story Points Fallback', () => {
    let db: Database;
    let envDir: string;
    let tokenStore: TokenStore;

    const mockConfig: JiraConfig = {
      project_key: 'TEST',
      site_url: 'https://test.atlassian.net',
      story_type: 'Story',
      subtask_type: 'Subtask',
      story_points_field: 'customfield_10016',
      status_mapping: {},
    };

    beforeEach(async () => {
      db = await createTestDatabase();
      envDir = mkdtempSync(join(tmpdir(), 'hive-test-'));
      tokenStore = new TokenStore(envDir);

      // Mock JiraClient constructor
      vi.mocked(JiraClient).mockImplementation(() => ({}) as any);

      // Mock createIssue to return a fake Jira issue
      vi.mocked(createIssue).mockResolvedValue({
        id: 'jira-id-123',
        key: 'TEST-123',
        self: 'https://test.atlassian.net/rest/api/3/issue/123',
      });
    });

    afterEach(() => {
      rmSync(envDir, { recursive: true, force: true });
      vi.clearAllMocks();
    });

    it('should use complexity_score when story_points is null', async () => {
      const { updateStory } = await import('../../db/queries/stories.js');
      const story = createStory(db, {
        title: 'Test Story',
        description: 'Test description',
        requirementId: null,
        teamId: null,
        acceptanceCriteria: null,
      });

      // Update with complexity_score but leave story_points null
      updateStory(db, story.id, {
        complexityScore: 5,
        storyPoints: null,
      });

      const updatedStory = (await import('../../db/queries/stories.js')).getStoryById(
        db,
        story.id
      )!;

      await syncStoryToJira(db, tokenStore, mockConfig, updatedStory);

      expect(createIssue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fields: expect.objectContaining({
            customfield_10016: 5,
          }),
        })
      );
    });

    it('should use story_points when both story_points and complexity_score are set', async () => {
      const { updateStory } = await import('../../db/queries/stories.js');
      const story = createStory(db, {
        title: 'Test Story',
        description: 'Test description',
        requirementId: null,
        teamId: null,
        acceptanceCriteria: null,
      });

      // Update with both complexity_score and story_points
      updateStory(db, story.id, {
        complexityScore: 5,
        storyPoints: 8,
      });

      const updatedStory = (await import('../../db/queries/stories.js')).getStoryById(
        db,
        story.id
      )!;

      await syncStoryToJira(db, tokenStore, mockConfig, updatedStory);

      expect(createIssue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fields: expect.objectContaining({
            customfield_10016: 8,
          }),
        })
      );
    });

    it('should not include story points field when both are null', async () => {
      const story = createStory(db, {
        title: 'Test Story',
        description: 'Test description',
        requirementId: null,
        teamId: null,
        acceptanceCriteria: null,
      });

      // Story defaults to null for both fields
      await syncStoryToJira(db, tokenStore, mockConfig, story);

      expect(createIssue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fields: expect.not.objectContaining({
            customfield_10016: expect.anything(),
          }),
        })
      );
    });
  });
});
