// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import type { StoryRow } from '../db/queries/stories.js';
import { UnsupportedFeatureError } from '../errors/index.js';
import {
  formatGitWorkflow,
  formatHiveMsgCommands,
  formatQualityChecks,
  formatStoriesForContext,
  generateContextFileContent,
  getAgentRoleDescription,
} from './generator.js';
import type { ContextFileOptions } from './index.js';

describe('generator module', () => {
  describe('generateContextFileContent', () => {
    const baseOptions: ContextFileOptions = {
      team: {
        id: 'team-1',
        name: 'Test Team',
        repo_path: '/path/to/repo',
        repo_url: 'https://github.com/test/repo',
        created_at: '2024-01-01',
      },
      stories: [],
      agentType: 'senior',
      config: {
        models: {} as any,
        integrations: {} as any,
        qa: { quality_checks: ['npm run lint'], build_command: 'npm run build' },
      } as any,
      cliTool: 'claude-code',
    };

    it('should generate content for claude-code', () => {
      const content = generateContextFileContent({ ...baseOptions, cliTool: 'claude-code' });
      expect(content).toContain('Claude Code');
      expect(content).toContain('Test Team');
    });

    it('should generate content for codex', () => {
      const content = generateContextFileContent({ ...baseOptions, cliTool: 'codex' });
      expect(content).toContain('Codex');
      expect(content).toContain('Test Team');
    });

    it('should generate content for gemini', () => {
      const content = generateContextFileContent({ ...baseOptions, cliTool: 'gemini' });
      expect(content).toContain('Gemini');
      expect(content).toContain('Test Team');
    });

    it('should throw error for unsupported CLI tool', () => {
      expect(() =>
        generateContextFileContent({ ...baseOptions, cliTool: 'unknown' as any })
      ).toThrow(UnsupportedFeatureError);
      expect(() =>
        generateContextFileContent({ ...baseOptions, cliTool: 'unknown' as any })
      ).toThrow('Unsupported CLI tool: unknown');
    });
  });

  describe('formatStoriesForContext', () => {
    it('should return "No active stories" for empty array', () => {
      const result = formatStoriesForContext([]);
      expect(result).toBe('No active stories');
    });

    it('should format single story correctly', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-1',
          title: 'Test Story',
          description: 'Test description',
          status: 'in_progress',
          complexity_score: 5,
          story_points: 5,
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: '["Criterion 1", "Criterion 2"]',
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          jira_issue_key: null,
          jira_issue_id: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        } as StoryRow,
      ];

      const result = formatStoriesForContext(stories);
      expect(result).toContain('STORY-1');
      expect(result).toContain('Test Story');
      expect(result).toContain('in_progress');
      expect(result).toContain('**Complexity**: 5');
      expect(result).toContain('**Story Points**: 5');
      expect(result).toContain('Criterion 1');
      expect(result).toContain('Criterion 2');
    });

    it('should format multiple stories', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-1',
          title: 'First Story',
          description: 'First description',
          status: 'planned',
          complexity_score: 3,
          story_points: 3,
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          jira_issue_key: null,
          jira_issue_id: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        } as StoryRow,
        {
          id: 'STORY-2',
          title: 'Second Story',
          description: 'Second description',
          status: 'review',
          complexity_score: 8,
          story_points: 8,
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          jira_issue_key: null,
          jira_issue_id: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        } as StoryRow,
      ];

      const result = formatStoriesForContext(stories);
      expect(result).toContain('STORY-1');
      expect(result).toContain('First Story');
      expect(result).toContain('STORY-2');
      expect(result).toContain('Second Story');
    });

    it('should handle stories without complexity scores', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-1',
          title: 'Test Story',
          description: 'Test description',
          status: 'draft',
          complexity_score: null,
          story_points: null,
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          jira_issue_key: null,
          jira_issue_id: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        } as StoryRow,
      ];

      const result = formatStoriesForContext(stories);
      expect(result).toContain('Not estimated');
    });

    it('should handle stories without acceptance criteria', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-1',
          title: 'Test Story',
          description: 'Test description',
          status: 'planned',
          complexity_score: 5,
          story_points: 5,
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          jira_issue_key: null,
          jira_issue_id: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        } as StoryRow,
      ];

      const result = formatStoriesForContext(stories);
      expect(result).not.toContain('Acceptance Criteria');
    });
  });

  describe('formatQualityChecks', () => {
    it('should format single command', () => {
      const result = formatQualityChecks(['npm run lint']);
      expect(result).toBe('`npm run lint`');
    });

    it('should format multiple commands with newlines', () => {
      const result = formatQualityChecks(['npm run lint', 'npm run type-check', 'npm test']);
      expect(result).toContain('`npm run lint`');
      expect(result).toContain('`npm run type-check`');
      expect(result).toContain('`npm test`');
      expect(result).toMatch(/\n/);
    });

    it('should handle empty array', () => {
      const result = formatQualityChecks([]);
      expect(result).toBe('');
    });
  });

  describe('getAgentRoleDescription', () => {
    it('should return description for tech_lead', () => {
      const result = getAgentRoleDescription('tech_lead');
      expect(result).toContain('Tech Lead');
      expect(result).toContain('multiple teams');
    });

    it('should return description for senior', () => {
      const result = getAgentRoleDescription('senior');
      expect(result).toContain('Senior Developer');
      expect(result).toContain('estimates complexity');
    });

    it('should return description for intermediate', () => {
      const result = getAgentRoleDescription('intermediate');
      expect(result).toContain('Intermediate Developer');
      expect(result).toContain('moderate complexity');
    });

    it('should return description for junior', () => {
      const result = getAgentRoleDescription('junior');
      expect(result).toContain('Junior Developer');
      expect(result).toContain('simple tasks');
    });

    it('should return description for qa', () => {
      const result = getAgentRoleDescription('qa');
      expect(result).toContain('QA Agent');
      expect(result).toContain('quality checks');
    });

    it('should return generic description for unknown type', () => {
      const result = getAgentRoleDescription('custom-agent');
      expect(result).toBe('custom-agent Agent');
    });
  });

  describe('formatHiveMsgCommands', () => {
    it('should generate hive msg command examples', () => {
      const result = formatHiveMsgCommands();
      expect(result).toContain('hive msg send');
      expect(result).toContain('hive msg inbox');
      expect(result).toContain('hive msg reply');
    });

    it('should include agent ID when provided', () => {
      const result = formatHiveMsgCommands('agent-123');
      expect(result).toContain('agent-123');
      expect(result).toContain('Your Agent ID');
    });

    it('should show placeholder when no agent ID', () => {
      const result = formatHiveMsgCommands();
      expect(result).toContain('your-agent-id');
    });

    it('should include senior communication examples', () => {
      const result = formatHiveMsgCommands();
      expect(result).toContain('hive-senior');
    });

    it('should include tech lead communication examples', () => {
      const result = formatHiveMsgCommands();
      expect(result).toContain('hive-tech-lead');
    });
  });

  describe('formatGitWorkflow', () => {
    it('should include git commands', () => {
      const result = formatGitWorkflow();
      expect(result).toContain('git checkout');
      expect(result).toContain('git commit');
      expect(result).toContain('git push');
    });

    it('should include branch naming convention', () => {
      const result = formatGitWorkflow();
      expect(result).toContain('feature/');
      expect(result).toContain('story-id');
    });

    it('should include commit message guidance', () => {
      const result = formatGitWorkflow();
      expect(result).toContain('STORY-123');
      expect(result).toContain('description');
    });

    it('should include PR title format', () => {
      const result = formatGitWorkflow();
      expect(result).toContain('PR Titles');
      expect(result).toContain('Story STORY-123');
    });

    it('should include workflow steps', () => {
      const result = formatGitWorkflow();
      expect(result).toContain('1.');
      expect(result).toContain('2.');
      expect(result).toContain('3.');
    });
  });
});
