// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { generateTechLeadJiraInstructions } from '../../orchestrator/prompt-templates.js';

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
});
