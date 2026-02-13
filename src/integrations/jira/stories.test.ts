// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi } from 'vitest';
import { generateTechLeadJiraInstructions } from '../../orchestrator/prompt-templates.js';
import { safelyParseAcceptanceCriteria } from './stories.js';
import * as logger from '../../utils/logger.js';

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

    it('should mention jira_issue_key', () => {
      const result = generateTechLeadJiraInstructions('HIVE', 'https://mycompany.atlassian.net');
      expect(result).toContain('jira_issue_key');
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

    it('should return empty array for malformed JSON and log warning', () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const malformedJson = '{"invalid json';
      const result = safelyParseAcceptanceCriteria(malformedJson, 'story-123');

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse acceptance_criteria for story story-123')
      );
      warnSpy.mockRestore();
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
});
