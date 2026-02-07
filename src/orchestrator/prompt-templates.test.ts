import { describe, expect, it } from 'vitest';
import type { StoryRow } from '../db/client.js';
import {
  generateIntermediatePrompt,
  generateJuniorPrompt,
  generateQAPrompt,
  generateSeniorPrompt,
} from './prompt-templates.js';

describe('Prompt Templates', () => {
  const teamName = 'TestTeam';
  const repoUrl = 'https://github.com/test/repo.git';
  const repoPath = 'repos/test-repo';

  describe('generateSeniorPrompt', () => {
    it('should generate prompt with correct team name', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain(`You are a Senior Developer on Team ${teamName}`);
    });

    it('should include correct session name', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('hive-senior-testteam');
    });

    it('should sanitize team name for session name', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt('Test_Team-123!@#', repoUrl, repoPath, stories);

      expect(prompt).toContain('hive-senior-test-team-123');
    });

    it('should include repository information', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain(`Local path: ${repoPath}`);
      expect(prompt).toContain(`Remote: ${repoUrl}`);
    });

    it('should include senior responsibilities', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('Implement assigned stories');
      expect(prompt).toContain('Review code quality');
      expect(prompt).toContain('Ensure tests pass and code meets standards');
    });

    it('should list stories with complexity and description', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-001',
          title: 'Test Story',
          description: 'Test description',
          complexity_score: 5,
          status: 'planned',
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          story_points: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('STORY-001');
      expect(prompt).toContain('Test Story');
      expect(prompt).toContain('complexity: 5');
      expect(prompt).toContain('Test description');
    });

    it('should handle missing complexity score', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-002',
          title: 'No Complexity',
          description: 'Test',
          complexity_score: null,
          status: 'planned',
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          story_points: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('complexity: ?');
    });

    it('should handle empty stories list', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('No stories assigned yet.');
    });

    it('should include multiple stories', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-001',
          title: 'First Story',
          description: 'First',
          complexity_score: 3,
          status: 'planned',
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          story_points: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'STORY-002',
          title: 'Second Story',
          description: 'Second',
          complexity_score: 7,
          status: 'planned',
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          story_points: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('STORY-001');
      expect(prompt).toContain('STORY-002');
      expect(prompt).toContain('First Story');
      expect(prompt).toContain('Second Story');
    });
  });

  describe('generateIntermediatePrompt', () => {
    const sessionName = 'hive-intermediate-testteam-1';

    it('should generate prompt with correct team name', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`You are an Intermediate Developer on Team ${teamName}`);
    });

    it('should include provided session name', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`Your tmux session: ${sessionName}`);
    });

    it('should include repository information', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`Local path: ${repoPath}`);
      expect(prompt).toContain(`Remote: ${repoUrl}`);
    });

    it('should include intermediate responsibilities', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('Implement assigned stories (moderate complexity)');
      expect(prompt).toContain('Write clean, tested code');
      expect(prompt).toContain('Ask Senior for help if stuck');
    });

    it('should reference senior session for escalation', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('hive-senior-testteam');
    });

    it('should include autonomous workflow instructions', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('DO NOT ask "Is there anything else?"');
      expect(prompt).toContain('autonomous agent');
    });
  });

  describe('generateJuniorPrompt', () => {
    const sessionName = 'hive-junior-testteam-1';

    it('should generate prompt with correct team name', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`You are a Junior Developer on Team ${teamName}`);
    });

    it('should include provided session name', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`Your tmux session: ${sessionName}`);
    });

    it('should include repository information', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`Local path: ${repoPath}`);
      expect(prompt).toContain(`Remote: ${repoUrl}`);
    });

    it('should include junior responsibilities', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('Implement simple, well-defined stories');
      expect(prompt).toContain('Learn the codebase patterns');
      expect(prompt).toContain('Ask for help when needed');
    });

    it('should reference senior session for escalation', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('hive-senior-testteam');
    });

    it('should emphasize following patterns exactly', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('Follow existing patterns exactly');
      expect(prompt).toContain('Ask questions if requirements are unclear');
    });
  });

  describe('generateQAPrompt', () => {
    const sessionName = 'hive-qa-testteam';

    it('should generate prompt with correct team name', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`You are a QA Engineer on Team ${teamName}`);
    });

    it('should include provided session name', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`Your tmux session: ${sessionName}`);
    });

    it('should include repository information', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain(`Local path: ${repoPath}`);
      expect(prompt).toContain(`Remote: ${repoUrl}`);
    });

    it('should include QA responsibilities', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('Review PRs in the merge queue');
      expect(prompt).toContain('Run tests and verify functionality');
      expect(prompt).toContain('Approve and merge good PRs');
      expect(prompt).toContain('Reject PRs that need fixes');
    });

    it('should include merge queue workflow commands', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('hive pr queue');
      expect(prompt).toContain('hive pr review');
      expect(prompt).toContain('hive pr approve');
      expect(prompt).toContain('hive pr reject');
    });

    it('should include review checklist', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('No merge conflicts');
      expect(prompt).toContain('Tests pass');
      expect(prompt).toContain('Code quality');
      expect(prompt).toContain('Functionality');
      expect(prompt).toContain('Story requirements');
    });
  });
});
