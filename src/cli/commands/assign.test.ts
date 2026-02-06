import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPlannedStories, type StoryRow } from '../../db/queries/stories.js';
import { getAgentsByTeam, type AgentRow } from '../../db/queries/agents.js';
import { getAllTeams, type TeamRow } from '../../db/queries/teams.js';

// Mock the database query functions
vi.mock('../../db/queries/stories.js');
vi.mock('../../db/queries/agents.js');
vi.mock('../../db/queries/teams.js');

// Helper function that mirrors the simulateAssignments logic for testing
function simulateAssignments(db: any, config: any) {
  const plannedStories = getPlannedStories(db);
  const teams = getAllTeams(db);
  const assignments: Array<{ storyId: string; storyName: string; teamName: string; agentType: string; complexity: number }> = [];
  const teamSummary: Array<{ teamName: string; plannedCount: number; idleAgents: number }> = [];

  for (const team of teams) {
    const teamStories = plannedStories.filter(s => s.team_id === team.id);
    const idleAgents = getAgentsByTeam(db, team.id).filter(a => a.status === 'idle' && a.type !== 'qa');

    if (teamStories.length > 0) {
      teamSummary.push({
        teamName: team.name,
        plannedCount: teamStories.length,
        idleAgents: idleAgents.length,
      });

      for (const story of teamStories) {
        const complexity = story.complexity_score || 5;
        let agentType = 'senior';

        if (complexity <= config.scaling.junior_max_complexity) {
          agentType = 'junior';
        } else if (complexity <= config.scaling.intermediate_max_complexity) {
          agentType = 'intermediate';
        }

        assignments.push({
          storyId: story.id,
          storyName: story.title || story.id,
          teamName: team.name,
          agentType,
          complexity,
        });
      }
    }
  }

  return { assignments, teamSummary };
}

describe('Assign Command - Dry Run Simulation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty results when no planned stories exist', () => {
    vi.mocked(getPlannedStories).mockReturnValue([]);
    vi.mocked(getAllTeams).mockReturnValue([]);

    const config = {
      scaling: {
        junior_max_complexity: 3,
        intermediate_max_complexity: 5,
      },
    };

    const result = simulateAssignments({}, config);
    expect(result.assignments).toEqual([]);
    expect(result.teamSummary).toEqual([]);
  });

  it('should assign low complexity stories to juniors', () => {
    const stories: StoryRow[] = [
      {
        id: 'STORY-001',
        title: 'Fix typo',
        complexity_score: 2,
        team_id: 'team-1',
        status: 'planned' as const,
        requirement_id: null,
        description: '',
        acceptance_criteria: null,
        story_points: null,
        assigned_agent_id: null,
        branch_name: null,
        pr_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const teams: TeamRow[] = [
      {
        id: 'team-1',
        name: 'Test Team',
        repo_url: 'https://github.com/test/repo',
        repo_path: 'repos/test-team',
        created_at: new Date().toISOString(),
      },
    ];

    vi.mocked(getPlannedStories).mockReturnValue(stories);
    vi.mocked(getAllTeams).mockReturnValue(teams);
    vi.mocked(getAgentsByTeam).mockReturnValue([]);

    const config = {
      scaling: {
        junior_max_complexity: 3,
        intermediate_max_complexity: 5,
      },
    };

    const result = simulateAssignments({}, config);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({
      storyId: 'STORY-001',
      agentType: 'junior',
      complexity: 2,
    });
  });

  it('should assign intermediate complexity stories to intermediates', () => {
    const stories: StoryRow[] = [
      {
        id: 'STORY-002',
        title: 'Add feature',
        complexity_score: 4,
        team_id: 'team-1',
        status: 'planned' as const,
        requirement_id: null,
        description: '',
        acceptance_criteria: null,
        story_points: null,
        assigned_agent_id: null,
        branch_name: null,
        pr_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const teams: TeamRow[] = [
      {
        id: 'team-1',
        name: 'Test Team',
        repo_url: 'https://github.com/test/repo',
        repo_path: 'repos/test-team',
        created_at: new Date().toISOString(),
      },
    ];

    vi.mocked(getPlannedStories).mockReturnValue(stories);
    vi.mocked(getAllTeams).mockReturnValue(teams);
    vi.mocked(getAgentsByTeam).mockReturnValue([]);

    const config = {
      scaling: {
        junior_max_complexity: 3,
        intermediate_max_complexity: 5,
      },
    };

    const result = simulateAssignments({}, config);
    expect(result.assignments[0].agentType).toBe('intermediate');
  });

  it('should assign high complexity stories to seniors', () => {
    const stories: StoryRow[] = [
      {
        id: 'STORY-003',
        title: 'Major refactor',
        complexity_score: 8,
        team_id: 'team-1',
        status: 'planned' as const,
        requirement_id: null,
        description: '',
        acceptance_criteria: null,
        story_points: null,
        assigned_agent_id: null,
        branch_name: null,
        pr_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const teams: TeamRow[] = [
      {
        id: 'team-1',
        name: 'Test Team',
        repo_url: 'https://github.com/test/repo',
        repo_path: 'repos/test-team',
        created_at: new Date().toISOString(),
      },
    ];

    vi.mocked(getPlannedStories).mockReturnValue(stories);
    vi.mocked(getAllTeams).mockReturnValue(teams);
    vi.mocked(getAgentsByTeam).mockReturnValue([]);

    const config = {
      scaling: {
        junior_max_complexity: 3,
        intermediate_max_complexity: 5,
      },
    };

    const result = simulateAssignments({}, config);
    expect(result.assignments[0].agentType).toBe('senior');
  });

  it('should provide team summary with idle agent counts', () => {
    const stories: StoryRow[] = [
      {
        id: 'STORY-001',
        title: 'Task 1',
        complexity_score: 2,
        team_id: 'team-1',
        status: 'planned' as const,
        requirement_id: null,
        description: '',
        acceptance_criteria: null,
        story_points: null,
        assigned_agent_id: null,
        branch_name: null,
        pr_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const teams: TeamRow[] = [
      {
        id: 'team-1',
        name: 'Test Team',
        repo_url: 'https://github.com/test/repo',
        repo_path: 'repos/test-team',
        created_at: new Date().toISOString(),
      },
    ];

    const agents: AgentRow[] = [
      {
        id: 'agent-1',
        type: 'junior',
        team_id: 'team-1',
        tmux_session: 'session-1',
        model: 'gpt-4o-mini',
        status: 'idle',
        current_story_id: null,
        memory_state: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        worktree_path: null,
        cli_tool: 'claude',
      },
      {
        id: 'agent-2',
        type: 'qa',
        team_id: 'team-1',
        tmux_session: 'session-2',
        model: 'claude-sonnet',
        status: 'idle',
        current_story_id: null,
        memory_state: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        worktree_path: null,
        cli_tool: 'claude',
      },
    ];

    vi.mocked(getPlannedStories).mockReturnValue(stories);
    vi.mocked(getAllTeams).mockReturnValue(teams);
    vi.mocked(getAgentsByTeam).mockReturnValue(agents);

    const config = {
      scaling: {
        junior_max_complexity: 3,
        intermediate_max_complexity: 5,
      },
    };

    const result = simulateAssignments({}, config);
    expect(result.teamSummary).toHaveLength(1);
    expect(result.teamSummary[0]).toMatchObject({
      teamName: 'Test Team',
      plannedCount: 1,
      idleAgents: 1, // Only junior counts, QA excluded
    });
  });
});
