import type Database from 'better-sqlite3';
import { getPlannedStories, updateStory, getStoryPointsByTeam, type StoryRow } from '../db/queries/stories.js';
import { getAgentsByTeam, createAgent, updateAgent, type AgentRow } from '../db/queries/agents.js';
import { getTeamById, getAllTeams } from '../db/queries/teams.js';
import { createLog } from '../db/queries/logs.js';
import { spawnTmuxSession, generateSessionName, isTmuxSessionRunning } from '../tmux/manager.js';
import type { ScalingConfig } from '../config/schema.js';

export interface SchedulerConfig {
  scaling: ScalingConfig;
  rootDir: string;
}

export class Scheduler {
  private db: Database.Database;
  private config: SchedulerConfig;

  constructor(db: Database.Database, config: SchedulerConfig) {
    this.db = db;
    this.config = config;
  }

  /**
   * Assign planned stories to available agents
   */
  async assignStories(): Promise<{ assigned: number; errors: string[] }> {
    const plannedStories = getPlannedStories(this.db);
    const errors: string[] = [];
    let assigned = 0;

    // Group stories by team
    const storiesByTeam = new Map<string, StoryRow[]>();
    for (const story of plannedStories) {
      if (!story.team_id) continue;
      const existing = storiesByTeam.get(story.team_id) || [];
      existing.push(story);
      storiesByTeam.set(story.team_id, existing);
    }

    // Process each team
    for (const [teamId, stories] of storiesByTeam) {
      const team = getTeamById(this.db, teamId);
      if (!team) continue;

      // Get available agents for this team
      const agents = getAgentsByTeam(this.db, teamId)
        .filter(a => a.status === 'idle' && a.type !== 'qa');

      // Find or create a Senior for delegation
      let senior = agents.find(a => a.type === 'senior');
      if (!senior) {
        try {
          senior = await this.spawnSenior(teamId, team.name, team.repo_path);
        } catch (err) {
          errors.push(`Failed to spawn Senior for team ${team.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          continue;
        }
      }

      // Assign stories based on complexity
      for (const story of stories) {
        const complexity = story.complexity_score || 5;
        let targetAgent: AgentRow | undefined;

        if (complexity <= this.config.scaling.junior_max_complexity) {
          // Assign to Junior
          targetAgent = agents.find(a => a.type === 'junior' && a.status === 'idle');
          if (!targetAgent) {
            try {
              targetAgent = await this.spawnJunior(teamId, team.name, team.repo_path);
            } catch (err) {
              // Fall back to Intermediate or Senior
              targetAgent = agents.find(a => a.type === 'intermediate' && a.status === 'idle') || senior;
            }
          }
        } else if (complexity <= this.config.scaling.intermediate_max_complexity) {
          // Assign to Intermediate
          targetAgent = agents.find(a => a.type === 'intermediate' && a.status === 'idle');
          if (!targetAgent) {
            try {
              targetAgent = await this.spawnIntermediate(teamId, team.name, team.repo_path);
            } catch (err) {
              // Fall back to Senior
              targetAgent = senior;
            }
          }
        } else {
          // Senior handles directly
          targetAgent = senior;
        }

        if (!targetAgent) {
          errors.push(`No available agent for story ${story.id}`);
          continue;
        }

        // Assign the story
        updateStory(this.db, story.id, {
          assignedAgentId: targetAgent.id,
          status: 'in_progress',
        });

        updateAgent(this.db, targetAgent.id, {
          status: 'working',
          currentStoryId: story.id,
        });

        createLog(this.db, {
          agentId: targetAgent.id,
          storyId: story.id,
          eventType: 'STORY_ASSIGNED',
          message: `Assigned to ${targetAgent.type}`,
        });

        assigned++;
      }
    }

    return { assigned, errors };
  }

  /**
   * Get the next story to work on for a specific agent
   */
  getNextStoryForAgent(agentId: string): StoryRow | null {
    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
    if (!agent || !agent.team_id) return null;

    // Find an unassigned planned story for this team
    const story = this.db.prepare(`
      SELECT * FROM stories
      WHERE team_id = ?
        AND status = 'planned'
        AND assigned_agent_id IS NULL
      ORDER BY story_points DESC, created_at
      LIMIT 1
    `).get(agent.team_id) as StoryRow | undefined;

    return story || null;
  }

  /**
   * Check if scaling is needed based on workload
   */
  async checkScaling(): Promise<void> {
    const teams = getAllTeams(this.db);

    for (const team of teams) {
      const storyPoints = getStoryPointsByTeam(this.db, team.id);
      const seniors = getAgentsByTeam(this.db, team.id).filter(a => a.type === 'senior' && a.status !== 'terminated');

      // Calculate needed seniors
      const seniorCapacity = this.config.scaling.senior_capacity;
      const neededSeniors = Math.ceil(storyPoints / seniorCapacity);
      const currentSeniors = seniors.length;

      if (neededSeniors > currentSeniors) {
        // Scale up
        const toSpawn = neededSeniors - currentSeniors;
        for (let i = 0; i < toSpawn; i++) {
          try {
            await this.spawnSenior(team.id, team.name, team.repo_path, currentSeniors + i + 1);
            createLog(this.db, {
              agentId: 'scheduler',
              eventType: 'TEAM_SCALED_UP',
              message: `Spawned additional Senior for team ${team.name}`,
              metadata: { teamId: team.id, totalSeniors: currentSeniors + i + 1 },
            });
          } catch (err) {
            // Log error but continue
          }
        }
      }
    }
  }

  private async spawnSenior(teamId: string, teamName: string, repoPath: string, index?: number): Promise<AgentRow> {
    const agent = createAgent(this.db, {
      type: 'senior',
      teamId,
    });

    const sessionName = generateSessionName('senior', teamName, index);
    const workDir = `${this.config.rootDir}/${repoPath}`;

    if (!await isTmuxSessionRunning(sessionName)) {
      await spawnTmuxSession({
        sessionName,
        workDir,
        command: `claude --resume ${sessionName}`,
      });
    }

    updateAgent(this.db, agent.id, {
      tmuxSession: sessionName,
      status: 'idle',
    });

    return agent;
  }

  private async spawnIntermediate(teamId: string, teamName: string, repoPath: string): Promise<AgentRow> {
    const existing = getAgentsByTeam(this.db, teamId).filter(a => a.type === 'intermediate');
    const index = existing.length + 1;

    const agent = createAgent(this.db, {
      type: 'intermediate',
      teamId,
    });

    const sessionName = generateSessionName('intermediate', teamName, index);
    const workDir = `${this.config.rootDir}/${repoPath}`;

    if (!await isTmuxSessionRunning(sessionName)) {
      await spawnTmuxSession({
        sessionName,
        workDir,
        command: `claude --resume ${sessionName}`,
      });
    }

    updateAgent(this.db, agent.id, {
      tmuxSession: sessionName,
      status: 'idle',
    });

    return agent;
  }

  private async spawnJunior(teamId: string, teamName: string, repoPath: string): Promise<AgentRow> {
    const existing = getAgentsByTeam(this.db, teamId).filter(a => a.type === 'junior');
    const index = existing.length + 1;

    const agent = createAgent(this.db, {
      type: 'junior',
      teamId,
    });

    const sessionName = generateSessionName('junior', teamName, index);
    const workDir = `${this.config.rootDir}/${repoPath}`;

    if (!await isTmuxSessionRunning(sessionName)) {
      await spawnTmuxSession({
        sessionName,
        workDir,
        command: `claude --resume ${sessionName}`,
      });
    }

    updateAgent(this.db, agent.id, {
      tmuxSession: sessionName,
      status: 'idle',
    });

    return agent;
  }
}
