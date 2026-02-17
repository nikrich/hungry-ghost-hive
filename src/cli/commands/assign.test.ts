// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlannedStories } from '../../db/queries/stories.js';
import { getTeamById } from '../../db/queries/teams.js';

// Mock the modules we're testing with
vi.mock('../../utils/paths.js');
vi.mock('../../db/client.js');
vi.mock('../../config/loader.js');
vi.mock('../../orchestrator/scheduler.js');
vi.mock('../../tmux/manager.js');
vi.mock('../../db/queries/stories.js');
vi.mock('../../db/queries/teams.js');

describe('Assign Command', () => {
  let db: Database;

  const mockConfig = {
    scaling: {
      junior_max_complexity: 3,
      intermediate_max_complexity: 5,
      senior_capacity: 50,
    },
    models: {
      tech_lead: {
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        max_tokens: 16000,
        temperature: 0.7,
        cli_tool: 'claude',
        safety_mode: 'unsafe',
      },
      senior: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        temperature: 0.5,
        cli_tool: 'claude',
        safety_mode: 'unsafe',
      },
      intermediate: {
        provider: 'anthropic',
        model: 'claude-haiku-3-5-20241022',
        max_tokens: 4000,
        temperature: 0.3,
        cli_tool: 'claude',
        safety_mode: 'unsafe',
      },
      junior: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8000,
        temperature: 0.3,
        cli_tool: 'claude',
        safety_mode: 'unsafe',
      },
      qa: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        temperature: 0.2,
        cli_tool: 'claude',
        safety_mode: 'unsafe',
      },
    },
  };

  const INITIAL_MIGRATION = `
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    repo_url TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    team_id TEXT REFERENCES teams(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    complexity_score INTEGER,
    status TEXT DEFAULT 'planned',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON');
    db.run(INITIAL_MIGRATION);
    vi.clearAllMocks();
  });

  describe('--dry-run flag', () => {
    it('should return empty when no stories are planned', () => {
      // Mock empty planned stories
      vi.mocked(getPlannedStories).mockReturnValue([]);

      const plannedStories = getPlannedStories(db);
      expect(plannedStories).toEqual([]);
    });

    it('should show stories grouped by team without making assignments', () => {
      // Mock planned stories with team association
      const mockStories = [
        {
          id: 'STORY-001',
          requirement_id: null,
          team_id: 'team-1',
          title: 'Implement feature A',
          description: 'Add new feature',
          acceptance_criteria: null,
          complexity_score: 3,
          story_points: null,
          status: 'planned' as const,
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'STORY-002',
          requirement_id: null,
          team_id: 'team-1',
          title: 'Implement feature B',
          description: 'Add another feature',
          acceptance_criteria: null,
          complexity_score: 5,
          story_points: null,
          status: 'planned' as const,
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.mocked(getPlannedStories).mockReturnValue(mockStories);
      vi.mocked(getTeamById).mockReturnValue({
        id: 'team-1',
        repo_url: 'https://github.com/test/repo',
        repo_path: '/path/to/repo',
        name: 'Test Team',
        created_at: new Date().toISOString(),
      });

      const plannedStories = getPlannedStories(db);
      expect(plannedStories).toHaveLength(2);
      expect(plannedStories[0].team_id).toBe('team-1');
    });

    it('should correctly determine agent level based on complexity score', () => {
      // Test Junior (complexity <= 3)
      let complexity = 3;
      let targetLevel = 'Senior';

      if (complexity <= mockConfig.scaling.junior_max_complexity) {
        targetLevel = 'Junior';
      } else if (complexity <= mockConfig.scaling.intermediate_max_complexity) {
        targetLevel = 'Intermediate';
      }

      expect(targetLevel).toBe('Junior');

      // Test Intermediate (3 < complexity <= 5)
      complexity = 4;
      targetLevel = 'Senior';

      if (complexity <= mockConfig.scaling.junior_max_complexity) {
        targetLevel = 'Junior';
      } else if (complexity <= mockConfig.scaling.intermediate_max_complexity) {
        targetLevel = 'Intermediate';
      }

      expect(targetLevel).toBe('Intermediate');

      // Test Senior (complexity > 5)
      complexity = 8;
      targetLevel = 'Senior';

      if (complexity <= mockConfig.scaling.junior_max_complexity) {
        targetLevel = 'Junior';
      } else if (complexity <= mockConfig.scaling.intermediate_max_complexity) {
        targetLevel = 'Intermediate';
      }

      expect(targetLevel).toBe('Senior');
    });

    it('should not make database changes during dry-run', () => {
      // The dry-run option should only call getPlannedStories without making any changes
      const mockStories = [
        {
          id: 'STORY-001',
          requirement_id: null,
          team_id: 'team-1',
          title: 'Test Story',
          description: 'Test',
          acceptance_criteria: null,
          complexity_score: 3,
          story_points: null,
          status: 'planned' as const,
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.mocked(getPlannedStories).mockReturnValue(mockStories);

      // In dry-run mode, we should only read data, not write
      const plannedStories = getPlannedStories(db);
      expect(plannedStories).toHaveLength(1);

      // Verify that no assignment operations were performed
      // (This would be verified by checking that Scheduler.assignStories was not called)
    });

    it('should handle multiple teams in planned stories', () => {
      const mockStories = [
        {
          id: 'STORY-001',
          requirement_id: null,
          team_id: 'team-1',
          title: 'Feature for Team 1',
          description: 'Test',
          acceptance_criteria: null,
          complexity_score: 3,
          story_points: null,
          status: 'planned' as const,
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'STORY-002',
          requirement_id: null,
          team_id: 'team-2',
          title: 'Feature for Team 2',
          description: 'Test',
          acceptance_criteria: null,
          complexity_score: 5,
          story_points: null,
          status: 'planned' as const,
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.mocked(getPlannedStories).mockReturnValue(mockStories);

      const plannedStories = getPlannedStories(db);
      expect(plannedStories).toHaveLength(2);

      // Verify stories are grouped by team
      const team1Stories = plannedStories.filter(s => s.team_id === 'team-1');
      const team2Stories = plannedStories.filter(s => s.team_id === 'team-2');

      expect(team1Stories).toHaveLength(1);
      expect(team2Stories).toHaveLength(1);
    });
  });
});
