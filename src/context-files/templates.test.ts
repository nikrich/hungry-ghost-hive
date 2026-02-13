// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import type { StoryRow } from '../db/queries/stories.js';
import { claudeCodeTemplate, codexTemplate, geminiTemplate } from './templates.js';
import type { ContextFileOptions } from './index.js';

describe('templates module', () => {
  const mockStory: StoryRow = {
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
  };

  const baseOptions: ContextFileOptions = {
    team: {
      id: 'team-1',
      name: 'Test Team',
      repo_path: '/path/to/repo',
      repo_url: 'https://github.com/test/repo',
      created_at: '2024-01-01',
    },
    stories: [mockStory],
    agentType: 'senior',
    agentId: 'agent-123',
    config: {
      models: {} as any,
      integrations: {} as any,
      qa: {
        quality_checks: ['npm run lint', 'npm run type-check'],
        build_command: 'npm run build',
        test_command: 'npm test',
      },
      paths: {} as any,
    },
    cliTool: 'claude-code',
  };

  describe('claudeCodeTemplate', () => {
    it('should include HIVE markers', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('<!-- HIVE:START -->');
      expect(result).toContain('<!-- HIVE:END -->');
    });

    it('should include Claude Code title', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('Hive Workflow Context - Claude Code');
    });

    it('should include team information', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('**Team**: Test Team');
      expect(result).toContain('**Repository**: /path/to/repo');
    });

    it('should include agent role', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('**Role**:');
      expect(result).toContain('Senior Developer');
    });

    it('should include agent ID', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('agent-123');
    });

    it('should include stories', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('STORY-1');
      expect(result).toContain('Test Story');
    });

    it('should include quality checks', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('npm run lint');
      expect(result).toContain('npm run type-check');
    });

    it('should include build command', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('npm run build');
    });

    it('should include test command when provided', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('npm test');
    });

    it('should omit test command when not provided', () => {
      const optionsWithoutTest = {
        ...baseOptions,
        config: {
          ...baseOptions.config,
          qa: {
            quality_checks: ['npm run lint'],
            build_command: 'npm run build',
          },
        },
      };
      const result = claudeCodeTemplate(optionsWithoutTest);
      expect(result).not.toContain('Test Command');
    });

    it('should include git workflow', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('git checkout');
      expect(result).toContain('feature/');
    });

    it('should include hive msg commands', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('hive msg send');
      expect(result).toContain('hive msg inbox');
    });

    it('should include story implementation process', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('Story Implementation Process');
      expect(result).toContain('Select a story');
    });

    it('should include escalation instructions', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('Escalation');
      expect(result).toContain('blockers');
    });

    it('should include refactor story guidance', () => {
      const result = claudeCodeTemplate(baseOptions);
      expect(result).toContain('do not expand the current branch');
      expect(result).toContain('create a separate refactor story');
    });
  });

  describe('codexTemplate', () => {
    it('should include HIVE markers', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('<!-- HIVE:START -->');
      expect(result).toContain('<!-- HIVE:END -->');
    });

    it('should include Codex title', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('Hive Team Context - Codex Agent');
    });

    it('should include team information', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('**Team**: Test Team');
      expect(result).toContain('**Repository Path**: /path/to/repo');
    });

    it('should include agent role', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('**Agent Role**:');
      expect(result).toContain('Senior Developer');
    });

    it('should include agent identifier', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('agent-123');
      expect(result).toContain('Agent Identifier');
    });

    it('should include work items section', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('Current Work Items');
      expect(result).toContain('STORY-1');
    });

    it('should include quality assurance checks', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('Quality Assurance Checks');
      expect(result).toContain('npm run lint');
    });

    it('should include build process', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('Build Process');
      expect(result).toContain('npm run build');
    });

    it('should include test suite when provided', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('Test Suite');
      expect(result).toContain('npm test');
    });

    it('should include story delivery pipeline', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('Story Delivery Pipeline');
      expect(result).toContain('Story Assignment');
    });

    it('should include best practices', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('Best Practices');
      expect(result).toContain('quality checks');
    });

    it('should include getting help section', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('Getting Help');
      expect(result).toContain('hive msg send');
    });

    it('should include refactor story guidance', () => {
      const result = codexTemplate(baseOptions);
      expect(result).toContain('do not expand the current branch');
      expect(result).toContain('create a separate refactor story');
    });
  });

  describe('geminiTemplate', () => {
    it('should include HIVE markers', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('<!-- HIVE:START -->');
      expect(result).toContain('<!-- HIVE:END -->');
    });

    it('should include Gemini title', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('Hive Development Context - Gemini');
    });

    it('should include team assignment', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('**Team Assignment**: Test Team');
      expect(result).toContain('**Repository**: /path/to/repo');
    });

    it('should include position', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('**Position**:');
      expect(result).toContain('Senior Developer');
    });

    it('should include agent ID', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('agent-123');
      expect(result).toContain('Agent ID');
    });

    it('should include assigned stories', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('Assigned Stories');
      expect(result).toContain('STORY-1');
    });

    it('should include validation checks', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('Validation Checks');
      expect(result).toContain('npm run lint');
    });

    it('should include build verification', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('Build Verification');
      expect(result).toContain('npm run build');
    });

    it('should include testing when provided', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('Testing');
      expect(result).toContain('npm test');
    });

    it('should include workflow for story completion', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('Workflow for Story Completion');
      expect(result).toContain('Receive Assignment');
    });

    it('should include quality standards', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('Quality Standards');
      expect(result).toContain('quality checks locally');
    });

    it('should include support and escalation', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('Support and Escalation');
      expect(result).toContain('team lead');
    });

    it('should include team name in escalation example', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('hive-senior-Test Team');
    });

    it('should include refactor story guidance', () => {
      const result = geminiTemplate(baseOptions);
      expect(result).toContain('do not expand the current branch');
      expect(result).toContain('create a separate refactor story');
    });
  });

  describe('template consistency', () => {
    it('all templates should include team information', () => {
      const claude = claudeCodeTemplate(baseOptions);
      const codex = codexTemplate(baseOptions);
      const gemini = geminiTemplate(baseOptions);

      expect(claude).toContain('Test Team');
      expect(codex).toContain('Test Team');
      expect(gemini).toContain('Test Team');
    });

    it('all templates should include stories', () => {
      const claude = claudeCodeTemplate(baseOptions);
      const codex = codexTemplate(baseOptions);
      const gemini = geminiTemplate(baseOptions);

      expect(claude).toContain('STORY-1');
      expect(codex).toContain('STORY-1');
      expect(gemini).toContain('STORY-1');
    });

    it('all templates should include quality checks', () => {
      const claude = claudeCodeTemplate(baseOptions);
      const codex = codexTemplate(baseOptions);
      const gemini = geminiTemplate(baseOptions);

      expect(claude).toContain('npm run lint');
      expect(codex).toContain('npm run lint');
      expect(gemini).toContain('npm run lint');
    });

    it('all templates should include git workflow', () => {
      const claude = claudeCodeTemplate(baseOptions);
      const codex = codexTemplate(baseOptions);
      const gemini = geminiTemplate(baseOptions);

      expect(claude).toContain('git');
      expect(codex).toContain('git');
      expect(gemini).toContain('git');
    });

    it('all templates should include hive msg commands', () => {
      const claude = claudeCodeTemplate(baseOptions);
      const codex = codexTemplate(baseOptions);
      const gemini = geminiTemplate(baseOptions);

      expect(claude).toContain('hive msg');
      expect(codex).toContain('hive msg');
      expect(gemini).toContain('hive msg');
    });
  });
});
