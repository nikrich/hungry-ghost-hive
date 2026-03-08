// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import type { StoryRow } from '../db/client.js';
import {
  formatSeniorSessionName,
  generateAuditorPrompt,
  generateFeatureTestPrompt,
  generateIntermediatePrompt,
  generateJuniorPrompt,
  generateQAPrompt,
  generateSeniorPrompt,
} from './prompt-templates.js';

describe('formatSeniorSessionName', () => {
  it('should format a simple team name', () => {
    expect(formatSeniorSessionName('TestTeam')).toBe('hive-senior-testteam');
  });

  it('should replace non-alphanumeric characters with hyphens', () => {
    expect(formatSeniorSessionName('Test_Team-123!@#')).toBe('hive-senior-test-team-123---');
  });

  it('should lowercase the team name', () => {
    expect(formatSeniorSessionName('MY-TEAM')).toBe('hive-senior-my-team');
  });
});

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

    it('should use provided senior session override', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(
        teamName,
        repoUrl,
        repoPath,
        stories,
        'main',
        undefined,
        'hive-senior-testteam-3'
      );

      expect(prompt).toContain('Your tmux session: hive-senior-testteam-3');
      expect(prompt).toContain('hive my-stories hive-senior-testteam-3');
      expect(prompt).toContain('--from hive-senior-testteam-3');
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
          jira_issue_key: null,
          jira_issue_id: null,
          jira_project_key: null,
          jira_subtask_key: null,
          jira_subtask_id: null,
          external_issue_key: null,
          external_issue_id: null,
          external_project_key: null,
          external_subtask_key: null,
          external_subtask_id: null,
          external_provider: null,
          in_sprint: 0,
          markdown_path: null,
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
          jira_issue_key: null,
          jira_issue_id: null,
          jira_project_key: null,
          jira_subtask_key: null,
          jira_subtask_id: null,
          external_issue_key: null,
          external_issue_id: null,
          external_project_key: null,
          external_subtask_key: null,
          external_subtask_id: null,
          external_provider: null,
          in_sprint: 0,
          markdown_path: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('complexity: ?');
    });

    it('should include markdown_path in prompt when set on a story', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-003',
          title: 'Story With Markdown',
          description: 'DB description',
          complexity_score: 3,
          status: 'planned',
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          story_points: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          jira_issue_key: null,
          jira_issue_id: null,
          jira_project_key: null,
          jira_subtask_key: null,
          jira_subtask_id: null,
          external_issue_key: null,
          external_issue_id: null,
          external_project_key: null,
          external_subtask_key: null,
          external_subtask_id: null,
          external_provider: null,
          in_sprint: 0,
          markdown_path: '/stories/STORY-003.md',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('/stories/STORY-003.md');
      expect(prompt).toContain('read the story markdown file');
    });

    it('should fall back to DB description when markdown_path is null', () => {
      const stories: StoryRow[] = [
        {
          id: 'STORY-004',
          title: 'Story Without Markdown',
          description: 'DB only description',
          complexity_score: 2,
          status: 'planned',
          team_id: 'team-1',
          requirement_id: null,
          acceptance_criteria: null,
          story_points: null,
          assigned_agent_id: null,
          branch_name: null,
          pr_url: null,
          jira_issue_key: null,
          jira_issue_id: null,
          jira_project_key: null,
          jira_subtask_key: null,
          jira_subtask_id: null,
          external_issue_key: null,
          external_issue_id: null,
          external_project_key: null,
          external_subtask_key: null,
          external_subtask_id: null,
          external_provider: null,
          in_sprint: 0,
          markdown_path: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('DB only description');
      expect(prompt).not.toContain('read the story markdown file');
    });

    it('should handle empty stories list', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('No stories assigned yet.');
    });

    it('should include instructions to check for merge conflicts before submission', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('merge conflict');
    });

    it('should include instructions to check CI checks before submission', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('CI');
    });

    it('should include Jira progress update instructions', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

      expect(prompt).toContain('hive progress');
      expect(prompt).toContain('Jira Progress Updates');
      expect(prompt).toContain('--done');
    });

    it('should skip progress command instructions when progress updates are disabled', () => {
      const stories: StoryRow[] = [];
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories, 'main', {
        includeProgressUpdates: false,
      });

      expect(prompt).toContain('Do NOT run `hive progress`');
      expect(prompt).not.toContain('## Jira Progress Updates');
      expect(prompt).not.toContain('hive progress <story-id>');
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
          jira_issue_key: null,
          jira_issue_id: null,
          jira_project_key: null,
          jira_subtask_key: null,
          jira_subtask_id: null,
          external_issue_key: null,
          external_issue_id: null,
          external_project_key: null,
          external_subtask_key: null,
          external_subtask_id: null,
          external_provider: null,
          in_sprint: 0,
          markdown_path: null,
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
          jira_issue_key: null,
          jira_issue_id: null,
          jira_project_key: null,
          jira_subtask_key: null,
          jira_subtask_id: null,
          external_issue_key: null,
          external_issue_id: null,
          external_project_key: null,
          external_subtask_key: null,
          external_subtask_id: null,
          external_provider: null,
          in_sprint: 0,
          markdown_path: null,
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
      expect(prompt).toContain('A story is not done until these commands run successfully');
      expect(prompt).toContain('hive pr submit -b $(git rev-parse --abbrev-ref HEAD)');
    });

    it('should include instructions to check for merge conflicts before submission', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('merge conflict');
    });

    it('should include instructions to check CI checks before submission', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('CI');
    });

    it('should include Jira progress update instructions', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('hive progress');
      expect(prompt).toContain('Jira Progress Updates');
      expect(prompt).toContain('--done');
    });

    it('should skip progress command instructions when progress updates are disabled', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        includeProgressUpdates: false,
      });

      expect(prompt).toContain('Do NOT run `hive progress`');
      expect(prompt).not.toContain('## Jira Progress Updates');
      expect(prompt).not.toContain('hive progress <story-id>');
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

    it('should include instructions to check for merge conflicts before submission', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('merge conflict');
    });

    it('should include instructions to check CI checks before submission', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('CI');
    });

    it('should include Jira progress update instructions', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

      expect(prompt).toContain('hive progress');
      expect(prompt).toContain('Jira Progress Updates');
      expect(prompt).toContain('--done');
    });

    it('should skip progress command instructions when progress updates are disabled', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        includeProgressUpdates: false,
      });

      expect(prompt).toContain('Do NOT run `hive progress`');
      expect(prompt).not.toContain('## Jira Progress Updates');
      expect(prompt).not.toContain('hive progress <story-id>');
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
      expect(prompt).toContain('--no-merge');
      expect(prompt).toContain('hive pr reject');
      expect(prompt).toContain('closed/missing/inaccessible');
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

  describe('generateFeatureTestPrompt', () => {
    const sessionName = 'hive-feature_test-testteam';
    const featureBranch = 'feature/REQ-ABC123';
    const requirementId = 'REQ-ABC123';
    const e2eTestsPath = './e2e';

    it('should generate prompt with correct agent role', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain(`You are a Feature Test Agent on Team ${teamName}`);
    });

    it('should include session name', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain(`Your tmux session: ${sessionName}`);
    });

    it('should include repository information', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain(`Local path: ${repoPath}`);
      expect(prompt).toContain(`Remote: ${repoUrl}`);
    });

    it('should include feature branch and requirement info', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain(featureBranch);
      expect(prompt).toContain(requirementId);
    });

    it('should include E2E test path', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain(e2eTestsPath);
    });

    it('should include instructions to read TESTING.md', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain('TESTING.md');
      expect(prompt).toContain(`${e2eTestsPath}/TESTING.md`);
    });

    it('should include checkout instructions for the feature branch', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain(`git checkout ${featureBranch}`);
      expect(prompt).toContain(`git fetch origin ${featureBranch}`);
    });

    it('should include result reporting instructions', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain('E2E tests PASSED');
      expect(prompt).toContain('E2E tests FAILED');
      expect(prompt).toContain('hive progress');
    });

    it('should report to tech lead instead of hive progress when progress updates are disabled', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath,
        { includeProgressUpdates: false }
      );

      expect(prompt).toContain('do NOT run `hive progress`');
      expect(prompt).toContain('hive msg send hive-tech-lead "E2E tests PASSED');
      expect(prompt).toContain('hive msg send hive-tech-lead "E2E tests FAILED');
      expect(prompt).not.toContain(`hive progress ${requirementId}`);
    });

    it('should include instructions not to modify code', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain('Do NOT modify the test code or application code');
    });

    it('should include communication instructions for tech lead', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        featureBranch,
        requirementId,
        e2eTestsPath
      );

      expect(prompt).toContain('hive msg send hive-tech-lead');
      expect(prompt).toContain(`hive msg outbox ${sessionName}`);
    });
  });

  describe('generateAuditorPrompt', () => {
    const sessionName = 'hive-auditor-1234567890';

    it('should generate prompt with correct agent role', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain('You are a Hive Auditor Agent');
    });

    it('should include session name', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain(`Your tmux session: ${sessionName}`);
    });

    it('should include repository information', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain(`Local path: ${repoPath}`);
      expect(prompt).toContain(`Remote: ${repoUrl}`);
    });

    it('should include hive CLI commands reference', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain('hive status');
      expect(prompt).toContain('hive agents list --active');
      expect(prompt).toContain('hive agents inspect');
      expect(prompt).toContain('hive stories list');
      expect(prompt).toContain('hive pr queue');
      expect(prompt).toContain('hive msg send');
      expect(prompt).toContain('hive agent self-terminate');
    });

    it('should include orphaned story detection instructions', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain('Orphaned stories');
      expect(prompt).toContain('hive stories update');
      expect(prompt).toContain('--status planned');
    });

    it('should include stuck agent detection instructions', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain('Plan mode');
      expect(prompt).toContain('Permission prompts');
      expect(prompt).toContain('BTab');
    });

    it('should include escalation instructions', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain('hive msg send hive-tech-lead');
      expect(prompt).toContain(`--from ${sessionName}`);
    });

    it('should include self-terminate instruction', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain('hive agent self-terminate');
    });

    it('should prohibit nudging agents via arbitrary tmux send-keys', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain('Do NOT nudge or interrupt agents');
    });

    it('should include tmux capture-pane instructions', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);

      expect(prompt).toContain('tmux capture-pane');
    });
  });

  describe('Target Branch Propagation', () => {
    describe('generateSeniorPrompt with custom target branch', () => {
      it('should include custom target_branch in merge conflict check instructions', () => {
        const stories: StoryRow[] = [];
        const targetBranch = 'develop';
        const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories, targetBranch);

        expect(prompt).toContain(`origin/${targetBranch}`);
        expect(prompt).not.toContain('origin/main');
      });

      it('should default to main branch when target_branch not provided', () => {
        const stories: StoryRow[] = [];
        const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories);

        expect(prompt).toContain('origin/main');
      });

      it('should use target_branch for feature branch creation instructions', () => {
        const stories: StoryRow[] = [];
        const targetBranch = 'release/v2.0';
        const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, stories, targetBranch);

        expect(prompt).toContain(`origin/${targetBranch}`);
      });
    });

    describe('generateIntermediatePrompt with custom target branch', () => {
      it('should include custom target_branch in merge conflict check instructions', () => {
        const targetBranch = 'staging';
        const sessionName = 'hive-intermediate-testteam-1';
        const prompt = generateIntermediatePrompt(
          teamName,
          repoUrl,
          repoPath,
          sessionName,
          targetBranch
        );

        expect(prompt).toContain(`origin/${targetBranch}`);
        expect(prompt).not.toContain('origin/main');
      });

      it('should default to main branch when target_branch not provided', () => {
        const sessionName = 'hive-intermediate-testteam-1';
        const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);

        expect(prompt).toContain('origin/main');
      });
    });

    describe('generateJuniorPrompt with custom target branch', () => {
      it('should include custom target_branch in merge conflict check instructions', () => {
        const targetBranch = 'hotfix/critical';
        const sessionName = 'hive-junior-testteam-1';
        const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName, targetBranch);

        expect(prompt).toContain(`origin/${targetBranch}`);
        expect(prompt).not.toContain('origin/main');
      });

      it('should default to main branch when target_branch not provided', () => {
        const sessionName = 'hive-junior-testteam-1';
        const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);

        expect(prompt).toContain('origin/main');
      });
    });

    describe('generateQAPrompt with custom target branch', () => {
      it('should include custom target_branch in merge conflict check instructions', () => {
        const targetBranch = 'production';
        const sessionName = 'hive-qa-testteam';
        const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName, targetBranch);

        expect(prompt).toContain(`origin/${targetBranch}`);
        expect(prompt).not.toContain('origin/main');
      });

      it('should default to main branch when target_branch not provided', () => {
        const sessionName = 'hive-qa-testteam';
        const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName);

        expect(prompt).toContain('origin/main');
      });
    });
  });
});

describe('Chrome Tab Isolation', () => {
  const teamName = 'TestTeam';
  const repoUrl = 'https://github.com/test/repo.git';
  const repoPath = 'repos/test-repo';
  const sessionName = 'hive-test-session';

  const CHROME_TAB_MARKER = 'Chrome Browser Tab Isolation';
  const CHROME_TAB_CREATE = 'tabs_create_mcp';

  describe('generateSeniorPrompt', () => {
    it('should include chrome tab isolation section when chromeEnabled is true', () => {
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, [], 'main', {
        chromeEnabled: true,
      });
      expect(prompt).toContain(CHROME_TAB_MARKER);
      expect(prompt).toContain(CHROME_TAB_CREATE);
    });

    it('should not include chrome tab isolation section when chromeEnabled is false', () => {
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, [], 'main', {
        chromeEnabled: false,
      });
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });

    it('should not include chrome tab isolation section when chromeEnabled is not set', () => {
      const prompt = generateSeniorPrompt(teamName, repoUrl, repoPath, []);
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });
  });

  describe('generateIntermediatePrompt', () => {
    it('should include chrome tab isolation section when chromeEnabled is true', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: true,
      });
      expect(prompt).toContain(CHROME_TAB_MARKER);
      expect(prompt).toContain(CHROME_TAB_CREATE);
    });

    it('should not include chrome tab isolation section when chromeEnabled is false', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: false,
      });
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });

    it('should not include chrome tab isolation section when options not provided', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName);
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });
  });

  describe('generateJuniorPrompt', () => {
    it('should include chrome tab isolation section when chromeEnabled is true', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: true,
      });
      expect(prompt).toContain(CHROME_TAB_MARKER);
      expect(prompt).toContain(CHROME_TAB_CREATE);
    });

    it('should not include chrome tab isolation section when chromeEnabled is false', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: false,
      });
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });

    it('should not include chrome tab isolation section when options not provided', () => {
      const prompt = generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName);
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });
  });

  describe('generateQAPrompt', () => {
    it('should include chrome tab isolation section when chromeEnabled is true', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: true,
      });
      expect(prompt).toContain(CHROME_TAB_MARKER);
      expect(prompt).toContain(CHROME_TAB_CREATE);
    });

    it('should not include chrome tab isolation section when chromeEnabled is false', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: false,
      });
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });

    it('should not include chrome tab isolation section when options not provided', () => {
      const prompt = generateQAPrompt(teamName, repoUrl, repoPath, sessionName);
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });
  });

  describe('generateFeatureTestPrompt', () => {
    it('should include chrome tab isolation section when chromeEnabled is true', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        'feature/test',
        'REQ-001',
        'e2e/tests',
        { chromeEnabled: true }
      );
      expect(prompt).toContain(CHROME_TAB_MARKER);
      expect(prompt).toContain(CHROME_TAB_CREATE);
    });

    it('should not include chrome tab isolation section when chromeEnabled is false', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        'feature/test',
        'REQ-001',
        'e2e/tests',
        { chromeEnabled: false }
      );
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });

    it('should not include chrome tab isolation section when options not provided', () => {
      const prompt = generateFeatureTestPrompt(
        teamName,
        repoUrl,
        repoPath,
        sessionName,
        'feature/test',
        'REQ-001',
        'e2e/tests'
      );
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });
  });

  describe('generateAuditorPrompt', () => {
    it('should include chrome tab isolation section when chromeEnabled is true', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl, {
        chromeEnabled: true,
      });
      expect(prompt).toContain(CHROME_TAB_MARKER);
      expect(prompt).toContain(CHROME_TAB_CREATE);
    });

    it('should not include chrome tab isolation section when chromeEnabled is false', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl, {
        chromeEnabled: false,
      });
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });

    it('should not include chrome tab isolation section when options not provided', () => {
      const prompt = generateAuditorPrompt(sessionName, repoPath, repoUrl);
      expect(prompt).not.toContain(CHROME_TAB_MARKER);
    });
  });

  describe('tab isolation instructions content', () => {
    it('should instruct agents to store and reuse tab ID', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: true,
      });
      expect(prompt).toContain('tab ID');
    });

    it('should instruct agents to recreate tab when closed externally', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: true,
      });
      expect(prompt).toContain('closed externally');
    });

    it('should warn agents not to use other agents tabs', () => {
      const prompt = generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName, 'main', {
        chromeEnabled: true,
      });
      expect(prompt).toContain('Never interact with tabs you did not create');
    });
  });
});
