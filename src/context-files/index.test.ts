import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import {
  getContextFileName,
  getContextFilePath,
  contextFileExists,
  generateContextFile,
  type ContextFileOptions,
  type CLITool,
} from './index.js';
import type { TeamRow } from '../db/queries/teams.js';
import type { StoryRow } from '../db/queries/stories.js';
import type { HiveConfig } from '../config/schema.js';

describe('context-files module', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `hive-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getContextFileName', () => {
    it('should return CLAUDE.md for claude-code', () => {
      expect(getContextFileName('claude-code')).toBe('CLAUDE.md');
    });

    it('should return AGENTS.md for codex', () => {
      expect(getContextFileName('codex')).toBe('AGENTS.md');
    });

    it('should return GEMINI.md for gemini', () => {
      expect(getContextFileName('gemini')).toBe('GEMINI.md');
    });
  });

  describe('getContextFilePath', () => {
    it('should construct correct file path', () => {
      const path = getContextFilePath('/repos/service-a', 'claude-code');
      expect(path).toBe('/repos/service-a/CLAUDE.md');
    });

    it('should work for different CLI tools', () => {
      const claudePath = getContextFilePath('/repo', 'claude-code');
      const codexPath = getContextFilePath('/repo', 'codex');
      const geminiPath = getContextFilePath('/repo', 'gemini');

      expect(claudePath).toContain('CLAUDE.md');
      expect(codexPath).toContain('AGENTS.md');
      expect(geminiPath).toContain('GEMINI.md');
    });
  });

  describe('contextFileExists', () => {
    it('should return false when file does not exist', () => {
      expect(contextFileExists(testDir, 'claude-code')).toBe(false);
    });

    it('should return true when file exists', () => {
      const filePath = getContextFilePath(testDir, 'claude-code');
      mkdirSync(testDir, { recursive: true });
      require('fs').writeFileSync(filePath, 'test content');

      expect(contextFileExists(testDir, 'claude-code')).toBe(true);
    });
  });

  describe('generateContextFile', () => {
    const mockTeam: TeamRow = {
      id: 'team-test',
      name: 'test-team',
      repo_path: '',
      repo_url: 'https://github.com/test/repo.git',
      created_at: new Date().toISOString(),
    };

    const mockStory: StoryRow = {
      id: 'STORY-001',
      requirement_id: 'REQ-001',
      team_id: 'team-test',
      title: 'Implement authentication',
      description: 'Add OAuth2 support',
      acceptance_criteria: JSON.stringify(['User can login', 'Token is valid']),
      complexity_score: 5,
      story_points: 5,
      status: 'in_progress',
      assigned_agent_id: 'agent-001',
      branch_name: 'feature/STORY-001-auth',
      pr_url: 'https://github.com/test/repo/pull/1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockConfig: HiveConfig = {
      version: '1.0',
      models: {
        tech_lead: { provider: 'anthropic', model: 'claude-opus', max_tokens: 16000, temperature: 0.7, cli_tool: 'claude' },
        senior: { provider: 'anthropic', model: 'claude-sonnet', max_tokens: 8000, temperature: 0.5, cli_tool: 'claude' },
        intermediate: { provider: 'anthropic', model: 'claude-haiku', max_tokens: 4000, temperature: 0.3, cli_tool: 'claude' },
        junior: { provider: 'openai', model: 'gpt-4o-mini', max_tokens: 4000, temperature: 0.2, cli_tool: 'claude' },
        qa: { provider: 'anthropic', model: 'claude-sonnet', max_tokens: 8000, temperature: 0.2, cli_tool: 'claude' },
      },
      scaling: { senior_capacity: 20, junior_max_complexity: 3, intermediate_max_complexity: 5 },
      github: { base_branch: 'main', pr_template: '' },
      qa: {
        quality_checks: ['npm run lint', 'npm run type-check'],
        build_command: 'npm run build',
      },
      agents: {
        poll_interval: 5000,
        max_retries: 2,
        checkpoint_threshold: 14000,
        llm_timeout_ms: 1800000,
        llm_max_retries: 2,
      },
      manager: { fast_poll_interval: 15000, slow_poll_interval: 60000 },
      logging: { level: 'info', retention_days: 30 },
    };

    it('should create a new context file if it does not exist', () => {
      const team = { ...mockTeam, repo_path: testDir };
      const options: ContextFileOptions = {
        cliTool: 'claude-code',
        team,
        stories: [mockStory],
        agentType: 'intermediate',
        config: mockConfig,
        agentId: 'agent-001',
      };

      generateContextFile(options);

      expect(contextFileExists(testDir, 'claude-code')).toBe(true);
      const content = readFileSync(getContextFilePath(testDir, 'claude-code'), 'utf-8');
      expect(content).toContain('<!-- HIVE:START -->');
      expect(content).toContain('<!-- HIVE:END -->');
      expect(content).toContain('STORY-001');
    });

    it('should include story information in generated file', () => {
      const team = { ...mockTeam, repo_path: testDir };
      const options: ContextFileOptions = {
        cliTool: 'claude-code',
        team,
        stories: [mockStory],
        agentType: 'senior',
        config: mockConfig,
      };

      generateContextFile(options);

      const content = readFileSync(getContextFilePath(testDir, 'claude-code'), 'utf-8');
      expect(content).toContain('STORY-001');
      expect(content).toContain('Implement authentication');
      expect(content).toContain('OAuth2');
    });

    it('should generate different content for different CLI tools', () => {
      const team = { ...mockTeam, repo_path: testDir };
      const baseOptions: ContextFileOptions = {
        cliTool: 'claude-code',
        team,
        stories: [mockStory],
        agentType: 'intermediate',
        config: mockConfig,
      };

      // Generate for Claude Code
      generateContextFile({ ...baseOptions, cliTool: 'claude-code' });
      const claudeContent = readFileSync(getContextFilePath(testDir, 'claude-code'), 'utf-8');

      // Clean up and generate for Codex
      rmSync(testDir, { recursive: true, force: true });
      mkdirSync(testDir, { recursive: true });

      generateContextFile({ ...baseOptions, cliTool: 'codex' });
      const codexContent = readFileSync(getContextFilePath(testDir, 'codex'), 'utf-8');

      // Both should have markers and story info, but different headers
      expect(claudeContent).toContain('Claude Code');
      expect(codexContent).toContain('Codex');
      expect(claudeContent).toContain('STORY-001');
      expect(codexContent).toContain('STORY-001');
    });

    it('should update existing file preserving content outside markers', () => {
      const team = { ...mockTeam, repo_path: testDir };
      const filePath = getContextFilePath(testDir, 'claude-code');

      // Write initial file with custom content
      mkdirSync(testDir, { recursive: true });
      const initialContent = `# My Custom Header

This is my custom content that should be preserved.

<!-- HIVE:START -->
Old Hive content
<!-- HIVE:END -->

## Footer

More custom content here.`;

      require('fs').writeFileSync(filePath, initialContent);

      // Generate new context
      const options: ContextFileOptions = {
        cliTool: 'claude-code',
        team,
        stories: [mockStory],
        agentType: 'junior',
        config: mockConfig,
      };

      generateContextFile(options);

      const updatedContent = readFileSync(filePath, 'utf-8');

      // Original content should be preserved
      expect(updatedContent).toContain('# My Custom Header');
      expect(updatedContent).toContain('This is my custom content');
      expect(updatedContent).toContain('## Footer');
      expect(updatedContent).toContain('More custom content here');

      // Hive content should be updated
      expect(updatedContent).toContain('STORY-001');
      expect(updatedContent).not.toContain('Old Hive content');
      expect(updatedContent).toContain('<!-- HIVE:START -->');
      expect(updatedContent).toContain('<!-- HIVE:END -->');
    });

    it('should append Hive section if markers do not exist', () => {
      const team = { ...mockTeam, repo_path: testDir };
      const filePath = getContextFilePath(testDir, 'claude-code');

      // Write initial file without markers
      mkdirSync(testDir, { recursive: true });
      const initialContent = '# Existing README\n\nSome content here.';
      require('fs').writeFileSync(filePath, initialContent);

      // Generate context
      const options: ContextFileOptions = {
        cliTool: 'claude-code',
        team,
        stories: [mockStory],
        agentType: 'qa',
        config: mockConfig,
      };

      generateContextFile(options);

      const updatedContent = readFileSync(filePath, 'utf-8');

      // Original content should be preserved
      expect(updatedContent).toContain('# Existing README');
      expect(updatedContent).toContain('Some content here');

      // Hive content should be appended
      expect(updatedContent).toContain('<!-- HIVE:START -->');
      expect(updatedContent).toContain('STORY-001');
    });

    it('should work with empty stories list', () => {
      const team = { ...mockTeam, repo_path: testDir };
      const options: ContextFileOptions = {
        cliTool: 'claude-code',
        team,
        stories: [],
        agentType: 'senior',
        config: mockConfig,
      };

      generateContextFile(options);

      const content = readFileSync(getContextFilePath(testDir, 'claude-code'), 'utf-8');
      expect(content).toContain('<!-- HIVE:START -->');
      expect(content).toContain('No active stories');
    });

    it('should include quality check commands from config', () => {
      const team = { ...mockTeam, repo_path: testDir };
      const options: ContextFileOptions = {
        cliTool: 'claude-code',
        team,
        stories: [mockStory],
        agentType: 'intermediate',
        config: mockConfig,
      };

      generateContextFile(options);

      const content = readFileSync(getContextFilePath(testDir, 'claude-code'), 'utf-8');
      expect(content).toContain('npm run lint');
      expect(content).toContain('npm run type-check');
      expect(content).toContain('npm run build');
    });

    it('should include agent ID when provided', () => {
      const team = { ...mockTeam, repo_path: testDir };
      const agentId = 'intermediate-abc123def456';
      const options: ContextFileOptions = {
        cliTool: 'claude-code',
        team,
        stories: [mockStory],
        agentType: 'intermediate',
        config: mockConfig,
        agentId,
      };

      generateContextFile(options);

      const content = readFileSync(getContextFilePath(testDir, 'claude-code'), 'utf-8');
      expect(content).toContain(agentId);
    });
  });
});
