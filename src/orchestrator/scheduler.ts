// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import {
  getCliRuntimeBuilder,
  resolveRuntimeModelForCli,
  validateModelCliCompatibility,
} from '../cli-runtimes/index.js';
import type { ModelsConfig, QAConfig, ScalingConfig } from '../config/schema.js';
import { queryAll, queryOne, withTransaction } from '../db/client.js';
import {
  createAgent,
  getAgentById,
  getAgentsByTeam,
  updateAgent,
  type AgentRow,
} from '../db/queries/agents.js';
import { createEscalation } from '../db/queries/escalations.js';
import { createLog } from '../db/queries/logs.js';
import { isAgentReviewingPR } from '../db/queries/pull-requests.js';
import { type RequirementRow } from '../db/queries/requirements.js';
import {
  getBatchStoryDependencies,
  getPlannedStories,
  getStoriesDependingOn,
  getStoriesWithOrphanedAssignments,
  getStoryById,
  getStoryDependencies,
  updateStory,
  type StoryRow,
} from '../db/queries/stories.js';
import { getAllTeams, getTeamById } from '../db/queries/teams.js';
import { FileSystemError, OperationalError } from '../errors/index.js';
import { removeWorktree } from '../git/worktree.js';
import {
  generateSessionName,
  getHiveSessions,
  isManagerRunning,
  isTmuxSessionRunning,
  killTmuxSession,
  spawnTmuxSession,
  startManager,
} from '../tmux/manager.js';
import {
  generateIntermediatePrompt,
  generateJuniorPrompt,
  generateQAPrompt,
  generateSeniorPrompt,
} from './prompt-templates.js';

// --- Named constants (extracted from inline magic numbers) ---

/** Timeout in ms for git worktree operations */
const GIT_WORKTREE_TIMEOUT_MS = 30000;
/** Max tokens for Opus 4.6 in godmode */
const GODMODE_MAX_TOKENS = 16000;
/** Temperature for Opus 4.6 in godmode */
const GODMODE_TEMPERATURE = 0.7;
/** Default number of pending PRs per QA agent for scaling */
const DEFAULT_PENDING_PER_QA_AGENT = 2.5;
/** Default maximum number of QA agents per team */
const DEFAULT_MAX_QA_AGENTS = 5;
/** Minimum refactor budget points when capacity is low */
const MIN_REFACTOR_BUDGET_POINTS = 1;
/** Default manager check interval in seconds */
const DEFAULT_MANAGER_INTERVAL_SECONDS = 60;

export interface SchedulerConfig {
  scaling: ScalingConfig;
  models: ModelsConfig;
  qa?: QAConfig;
  rootDir: string;
  saveFn?: () => void;
}

export class Scheduler {
  private db: Database;
  private config: SchedulerConfig;
  private saveFn?: () => void;

  constructor(db: Database, config: SchedulerConfig) {
    this.db = db;
    this.config = config;
    this.saveFn = config.saveFn;
  }

  /**
   * Create a git worktree for an agent
   * Returns the worktree path
   */
  private async createWorktree(agentId: string, teamId: string, repoPath: string): Promise<string> {
    const { execSync } = await import('child_process');

    // Construct worktree path: repos/<team-id>-<agent-id>/
    const worktreePath = `repos/${teamId}-${agentId}`;
    const fullWorktreePath = `${this.config.rootDir}/${worktreePath}`;
    const fullRepoPath = `${this.config.rootDir}/${repoPath}`;

    // Branch name: agent/<agent-id>
    const branchName = `agent/${agentId}`;

    try {
      // Create worktree from main branch (30s timeout for git operations)
      execSync(`git worktree add "${fullWorktreePath}" -b "${branchName}"`, {
        cwd: fullRepoPath,
        stdio: 'pipe',
        timeout: GIT_WORKTREE_TIMEOUT_MS,
      });
    } catch (err) {
      // If worktree or branch already exists, try to add without creating branch
      try {
        execSync(`git worktree add "${fullWorktreePath}" "${branchName}"`, {
          cwd: fullRepoPath,
          stdio: 'pipe',
          timeout: GIT_WORKTREE_TIMEOUT_MS,
        });
      } catch (_error) {
        // If that fails too, log and throw
        throw new FileSystemError(
          `Failed to create worktree at ${fullWorktreePath}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    return worktreePath;
  }

  /**
   * Remove a git worktree for an agent
   */
  private removeAgentWorktree(worktreePath: string, agentId: string): void {
    if (!worktreePath) return;

    const result = removeWorktree(this.config.rootDir, worktreePath);
    if (!result.success) {
      createLog(this.db, {
        agentId,
        eventType: 'WORKTREE_REMOVAL_FAILED',
        status: 'error',
        message: `Failed to remove worktree at ${result.fullWorktreePath}: ${result.error}`,
        metadata: { worktreePath, fullWorktreePath: result.fullWorktreePath },
      });
    }
  }

  /**
   * Build a dependency graph for stories
   * Returns a map of story ID to its direct dependencies
   */
  private buildDependencyGraph(stories: StoryRow[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    const storyIds = new Set(stories.map(s => s.id));

    // Initialize all stories in the graph
    for (const story of stories) {
      if (!graph.has(story.id)) {
        graph.set(story.id, new Set());
      }
    }

    // Fetch all dependencies in a single query to avoid N+1 pattern
    const allDepsMap = getBatchStoryDependencies(this.db, Array.from(storyIds));

    // Add dependencies (only within the planned set; external deps handled by areDependenciesSatisfied)
    for (const [storyId, depIds] of allDepsMap) {
      for (const depId of depIds) {
        if (storyIds.has(depId)) {
          graph.get(storyId)!.add(depId);
        }
      }
    }

    return graph;
  }

  /**
   * Topological sort of stories based on dependencies
   * Returns stories in order where dependencies come before dependents
   * Returns null if circular dependency is detected
   */
  private topologicalSort(stories: StoryRow[]): StoryRow[] | null {
    const graph = this.buildDependencyGraph(stories);
    const storyMap = new Map(stories.map(s => [s.id, s]));

    // Kahn's algorithm for topological sort
    const inDegree = new Map<string, number>();
    const result: StoryRow[] = [];

    // Calculate in-degrees: count how many dependencies each story has
    for (const [storyId, dependencies] of graph.entries()) {
      inDegree.set(storyId, dependencies.size);
    }

    // Find all nodes with in-degree 0 (no dependencies)
    const queue: string[] = [];
    for (const [storyId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(storyId);
      }
    }

    // Process queue using Kahn's algorithm
    while (queue.length > 0) {
      const storyId = queue.shift()!;
      const story = storyMap.get(storyId);
      if (story) {
        result.push(story);
      }

      // For each story that depends on this one, reduce in-degree
      for (const [otherStoryId, dependencies] of graph.entries()) {
        if (dependencies.has(storyId)) {
          const newDegree = (inDegree.get(otherStoryId) || 0) - 1;
          inDegree.set(otherStoryId, newDegree);
          if (newDegree === 0) {
            queue.push(otherStoryId);
          }
        }
      }
    }

    // Check for circular dependencies
    if (result.length !== stories.length) {
      return null;
    }

    return result;
  }

  /**
   * Check if a story's dependencies are satisfied
   * A dependency is satisfied only if it's merged (completed)
   */
  private areDependenciesSatisfied(storyId: string): boolean {
    const dependencies = getStoryDependencies(this.db, storyId);

    for (const dep of dependencies) {
      // Check if dependency is in a terminal state (merged)
      if (dep.status !== 'merged') {
        return false;
      }
    }

    return true;
  }

  /**
   * Select the agent with the least workload (queue-depth aware)
   * Returns the agent with fewest active stories; breaks ties by creation order
   */
  private selectAgentWithLeastWorkload(agents: AgentRow[]): AgentRow {
    let selectedAgent = agents[0];
    let minWorkload = this.getAgentWorkload(selectedAgent.id);

    for (let i = 1; i < agents.length; i++) {
      const workload = this.getAgentWorkload(agents[i].id);
      if (workload < minWorkload) {
        minWorkload = workload;
        selectedAgent = agents[i];
      }
    }

    return selectedAgent;
  }

  /**
   * Calculate queue depth for an agent (number of active stories)
   */
  private getAgentWorkload(agentId: string): number {
    const result = queryOne<{ count: number }>(
      this.db,
      `
      SELECT COUNT(*) as count FROM stories
      WHERE assigned_agent_id = ?
        AND status IN ('in_progress', 'review', 'qa', 'qa_failed')
    `,
      [agentId]
    );
    return result?.count || 0;
  }

  /**
   * Convention-based story typing: refactor stories start with "Refactor:".
   */
  private isRefactorStory(story: StoryRow): boolean {
    return /^refactor\s*:/i.test(story.title.trim());
  }

  /**
   * Capacity computations prefer story points, then complexity score, then 1.
   */
  private getCapacityPoints(story: StoryRow): number {
    return story.story_points || story.complexity_score || 1;
  }

  /**
   * Apply configurable refactor-capacity policy before assignment.
   */
  private selectStoriesForCapacity(stories: StoryRow[]): StoryRow[] {
    const refactorConfig = this.config.scaling.refactor || {
      enabled: false,
      capacity_percent: 0,
      allow_without_feature_work: false,
    };

    if (!refactorConfig.enabled) {
      return stories.filter(story => !this.isRefactorStory(story));
    }

    const featureStories = stories.filter(story => !this.isRefactorStory(story));
    const featurePoints = featureStories.reduce(
      (sum, story) => sum + this.getCapacityPoints(story),
      0
    );
    const hasFeatureWork = featureStories.length > 0;

    if (!hasFeatureWork && !refactorConfig.allow_without_feature_work) {
      return [];
    }

    let refactorBudgetPoints = hasFeatureWork
      ? Math.floor((featurePoints * refactorConfig.capacity_percent) / 100)
      : Number.POSITIVE_INFINITY;

    if (hasFeatureWork && refactorConfig.capacity_percent > 0 && refactorBudgetPoints === 0) {
      refactorBudgetPoints = MIN_REFACTOR_BUDGET_POINTS;
    }

    let usedRefactorPoints = 0;
    const selected: StoryRow[] = [];

    for (const story of stories) {
      if (!this.isRefactorStory(story)) {
        selected.push(story);
        continue;
      }

      const points = this.getCapacityPoints(story);
      if (usedRefactorPoints + points > refactorBudgetPoints) {
        continue;
      }

      selected.push(story);
      usedRefactorPoints += points;
    }

    return selected;
  }

  /**
   * Assign planned stories to available agents
   */
  async assignStories(): Promise<{
    assigned: number;
    errors: string[];
    preventedDuplicates: number;
  }> {
    const plannedStories = getPlannedStories(this.db);
    const errors: string[] = [];
    let assigned = 0;
    let preventedDuplicates = 0;

    // Topological sort stories to respect dependencies
    const sortedStories = this.topologicalSort(plannedStories);
    if (sortedStories === null) {
      errors.push('Circular dependency detected in planned stories');
      return { assigned, errors, preventedDuplicates };
    }

    // Group stories by team
    const storiesByTeam = new Map<string, StoryRow[]>();
    for (const story of sortedStories) {
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
      // Include agents that are working but have no current story (effectively idle)
      const agents = getAgentsByTeam(this.db, teamId).filter(
        a =>
          a.type !== 'qa' &&
          (a.status === 'idle' || (a.status === 'working' && a.current_story_id === null))
      );

      // Find or create a Senior for delegation
      let senior = agents.find(a => a.type === 'senior');
      if (!senior) {
        try {
          senior = await this.spawnSenior(teamId, team.name, team.repo_path);
        } catch (err) {
          errors.push(
            `Failed to spawn Senior for team ${team.name}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
          continue;
        }
      }

      // Assign stories based on complexity and capacity policy
      const storiesToAssign = this.selectStoriesForCapacity(stories);

      // Separate blocker stories from regular stories
      const blockerStories: StoryRow[] = [];
      const regularStories: StoryRow[] = [];
      for (const story of storiesToAssign) {
        const dependents = getStoriesDependingOn(this.db, story.id);
        if (dependents.length > 0) {
          blockerStories.push(story);
        } else {
          regularStories.push(story);
        }
      }

      // Process blocker stories first
      const orderedStoriesToAssign = [...blockerStories, ...regularStories];

      for (const story of orderedStoriesToAssign) {
        // Check if story is already assigned (prevent duplicate assignment)
        const currentStory = getStoryById(this.db, story.id);
        if (currentStory && currentStory.assigned_agent_id !== null) {
          preventedDuplicates++;
          createLog(this.db, {
            agentId: 'scheduler',
            storyId: story.id,
            eventType: 'DUPLICATE_ASSIGNMENT_PREVENTED',
            message: `Story already assigned to ${currentStory.assigned_agent_id}`,
          });
          continue;
        }

        // Check if dependencies are satisfied before assigning
        if (!this.areDependenciesSatisfied(story.id)) {
          continue;
        }

        // Check if this story is a blocker (has dependents)
        const dependents = getStoriesDependingOn(this.db, story.id);
        const isBlocker = dependents.length > 0;

        const complexity = story.complexity_score || 5;
        let targetAgent: AgentRow | undefined;

        if (isBlocker) {
          // Blocker stories always go to Senior regardless of complexity
          targetAgent = senior;
        } else if (complexity <= this.config.scaling.junior_max_complexity) {
          // Assign to Junior with least workload
          const juniors = agents.filter(a => a.type === 'junior' && a.status === 'idle');
          targetAgent = juniors.length > 0 ? this.selectAgentWithLeastWorkload(juniors) : undefined;
          if (!targetAgent) {
            try {
              targetAgent = await this.spawnJunior(teamId, team.name, team.repo_path);
            } catch (_error) {
              // Fall back to Intermediate or Senior
              const intermediates = agents.filter(
                a => a.type === 'intermediate' && a.status === 'idle'
              );
              targetAgent =
                intermediates.length > 0
                  ? this.selectAgentWithLeastWorkload(intermediates)
                  : senior;
            }
          }
        } else if (complexity <= this.config.scaling.intermediate_max_complexity) {
          // Assign to Intermediate with least workload
          const intermediates = agents.filter(
            a => a.type === 'intermediate' && a.status === 'idle'
          );
          targetAgent =
            intermediates.length > 0 ? this.selectAgentWithLeastWorkload(intermediates) : undefined;
          if (!targetAgent) {
            try {
              targetAgent = await this.spawnIntermediate(teamId, team.name, team.repo_path);
            } catch (_error) {
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

        // Assign the story (atomic transaction)
        try {
          await withTransaction(this.db, () => {
            updateStory(this.db, story.id, {
              assignedAgentId: targetAgent.id,
              status: 'in_progress',
            });

            updateAgent(this.db, targetAgent.id, {
              status: 'working',
              currentStoryId: story.id,
            });

            const message = isBlocker
              ? `Assigned to ${targetAgent.type} (escalated due to being a dependency blocker)`
              : `Assigned to ${targetAgent.type}`;

            createLog(this.db, {
              agentId: targetAgent.id,
              storyId: story.id,
              eventType: 'STORY_ASSIGNED',
              message,
            });
          });
          assigned++;
        } catch (err) {
          errors.push(
            `Failed to assign story ${story.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
      }
    }

    return { assigned, errors, preventedDuplicates };
  }

  /**
   * Get the next story to work on for a specific agent
   */
  getNextStoryForAgent(agentId: string): StoryRow | null {
    const agent = getAgentById(this.db, agentId);
    if (!agent || !agent.team_id) return null;

    // Find unassigned planned stories for this team
    const stories = queryAll<StoryRow>(
      this.db,
      `
      SELECT * FROM stories
      WHERE team_id = ?
        AND status = 'planned'
        AND assigned_agent_id IS NULL
      ORDER BY story_points DESC, created_at
    `,
      [agent.team_id]
    );

    // Filter out stories with unresolved dependencies
    for (const story of stories) {
      if (this.areDependenciesSatisfied(story.id)) {
        return story;
      }
    }

    return null;
  }

  /**
   * Check if scaling is needed based on workload
   * Only spawns agents when there is assignable work (stories with satisfied dependencies)
   */
  async checkScaling(): Promise<void> {
    const teams = getAllTeams(this.db);

    for (const team of teams) {
      // Get planned stories for this team
      const plannedStories = getPlannedStories(this.db).filter(s => s.team_id === team.id);

      // Filter to only assignable stories (dependencies satisfied, within refactor capacity)
      const assignableStories = this.selectStoriesForCapacity(plannedStories).filter(story =>
        this.areDependenciesSatisfied(story.id)
      );

      // Count story points only from assignable work
      const assignableStoryPoints = assignableStories.reduce(
        (sum, story) => sum + this.getCapacityPoints(story),
        0
      );

      const seniors = getAgentsByTeam(this.db, team.id).filter(
        a => a.type === 'senior' && a.status !== 'terminated'
      );

      // Calculate needed seniors based on assignable work only
      const seniorCapacity = this.config.scaling.senior_capacity;
      const neededSeniors = Math.ceil(assignableStoryPoints / seniorCapacity);
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
          } catch (error) {
            // Log error but continue
            createLog(this.db, {
              agentId: 'scheduler',
              eventType: 'TEAM_SCALED_UP',
              status: 'error',
              message: `Failed to spawn Senior for team ${team.name}: ${error instanceof Error ? error.message : String(error)}`,
              metadata: { teamId: team.id },
            });
          }
        }
      }
    }
  }

  /**
   * Detect and recover orphaned stories (assigned to terminated agents)
   * Returns the story IDs that were recovered
   */
  private detectAndRecoverOrphanedStories(): string[] {
    const orphanedAssignments = getStoriesWithOrphanedAssignments(this.db);
    const recovered: string[] = [];

    for (const assignment of orphanedAssignments) {
      try {
        // Update story in single atomic operation
        updateStory(this.db, assignment.id, {
          assignedAgentId: null,
          status: 'planned',
        });
        createLog(this.db, {
          agentId: 'scheduler',
          storyId: assignment.id,
          eventType: 'ORPHANED_STORY_RECOVERED',
          message: `Recovered from terminated agent ${assignment.agent_id}`,
        });
        recovered.push(assignment.id);
      } catch (err) {
        console.error(
          `Failed to recover orphaned story ${assignment.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    return recovered;
  }

  /**
   * Health check: sync agent status with actual tmux sessions
   * Returns number of agents whose status was corrected
   */
  async healthCheck(): Promise<{
    terminated: number;
    revived: string[];
    orphanedRecovered: string[];
  }> {
    const allAgents = queryAll<AgentRow>(
      this.db,
      `
      SELECT * FROM agents WHERE status != 'terminated'
    `
    );

    const liveSessions = await getHiveSessions();
    const liveSessionNames = new Set(liveSessions.map(s => s.name));

    let terminated = 0;
    const revived: string[] = [];

    for (const agent of allAgents) {
      if (!agent.tmux_session) continue;

      const sessionAlive = liveSessionNames.has(agent.tmux_session);

      // Only terminate if tmux session is actually dead
      // Heartbeat staleness alone is not sufficient since Claude Code sessions
      // don't have a mechanism to send heartbeats
      if (!sessionAlive && agent.status !== 'terminated') {
        // Remove worktree if exists
        if (agent.worktree_path) {
          this.removeAgentWorktree(agent.worktree_path, agent.id);
        }

        updateAgent(this.db, agent.id, {
          status: 'terminated',
          currentStoryId: null,
          worktreePath: null,
        });
        createLog(this.db, {
          agentId: agent.id,
          eventType: 'AGENT_TERMINATED',
          message: `Session ${agent.tmux_session} no longer running`,
        });
        terminated++;

        // If agent was working on a story, mark it for reassignment
        if (agent.current_story_id) {
          updateStory(this.db, agent.current_story_id, {
            status: 'planned',
            assignedAgentId: null,
          });
          revived.push(agent.current_story_id);
        }
      }
    }

    // Detect and recover orphaned stories (assigned to terminated agents)
    const orphanedRecovered = this.detectAndRecoverOrphanedStories();

    return { terminated, revived, orphanedRecovered };
  }

  /**
   * Check merge queue and spawn QA agents if needed
   * Scales QA agents based on pending work: 1 QA per 2-3 pending PRs, max 5
   */
  async checkMergeQueue(): Promise<void> {
    const teams = getAllTeams(this.db);

    for (const team of teams) {
      await this.scaleQAAgents(team.id, team.name, team.repo_path);
    }
  }

  /**
   * Scale QA agents based on pending work
   * - Count stories with status 'pr_submitted' or 'qa'
   * - Calculate needed QA agents: 1 QA per 2-3 pending PRs, max 5
   * - Spawn QA agents in parallel with unique session names
   * - Scale down excess QA agents when queue shrinks
   *
   * Note: Unlike checkScaling(), this method does not need to filter by dependencies
   * because it only counts stories with PRs already created ('pr_submitted', 'qa', etc).
   * By the time a story reaches these statuses, its work is complete and dependencies
   * are no longer a blocking concern for QA review.
   */
  private async scaleQAAgents(teamId: string, teamName: string, repoPath: string): Promise<void> {
    // Count pending QA work: stories in QA-related statuses OR stories in review with queued PRs
    const qaStories = queryAll<StoryRow>(
      this.db,
      `
      SELECT DISTINCT s.* FROM stories s
      LEFT JOIN pull_requests pr ON pr.story_id = s.id
      WHERE s.team_id = ? AND (
        s.status IN ('qa', 'pr_submitted', 'qa_failed')
        OR (s.status = 'review' AND pr.status IN ('queued', 'reviewing'))
      )
    `,
      [teamId]
    );

    const pendingCount = qaStories.length;

    // Calculate needed QA agents using configurable values
    const qaScaling = this.config.qa?.scaling || {
      pending_per_agent: DEFAULT_PENDING_PER_QA_AGENT,
      max_agents: DEFAULT_MAX_QA_AGENTS,
    };
    const pendingPerAgent = qaScaling.pending_per_agent || DEFAULT_PENDING_PER_QA_AGENT;
    const maxAgents = qaScaling.max_agents || DEFAULT_MAX_QA_AGENTS;

    // If no pending work, scale down to 0 agents
    const neededQAs =
      pendingCount > 0 ? Math.min(Math.ceil(pendingCount / pendingPerAgent), maxAgents) : 0;

    // Get currently active QA agents for this team
    const activeQAs = getAgentsByTeam(this.db, teamId).filter(
      a => a.type === 'qa' && a.status !== 'terminated'
    );

    const currentQACount = activeQAs.length;

    if (neededQAs > currentQACount) {
      // Scale up: spawn additional QA agents in parallel
      const toSpawn = neededQAs - currentQACount;
      const spawnPromises: Promise<AgentRow>[] = [];

      for (let i = 0; i < toSpawn; i++) {
        const index = currentQACount + i + 1;
        spawnPromises.push(this.spawnQA(teamId, teamName, repoPath, index));
      }

      try {
        await Promise.all(spawnPromises);
        createLog(this.db, {
          agentId: 'scheduler',
          eventType: 'TEAM_SCALED_UP',
          message: `Scaled QA agents for team ${teamName}: ${currentQACount} → ${neededQAs} (${pendingCount} pending stories)`,
          metadata: {
            teamId,
            agentType: 'qa',
            previousCount: currentQACount,
            newCount: neededQAs,
            pendingCount,
          },
        });
      } catch (err) {
        createLog(this.db, {
          agentId: 'scheduler',
          eventType: 'AGENT_SPAWNED',
          status: 'error',
          message: `Failed to scale QA agents for team ${teamName}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          metadata: { teamId, agentType: 'qa', error: String(err) },
        });
      }
    } else if (neededQAs < currentQACount) {
      // Scale down: terminate excess QA agents
      const toTerminate = currentQACount - neededQAs;

      // Identify QA agents to terminate (remove the ones with highest indices first)
      // But skip agents that are actively reviewing a PR
      const sortedAgents = activeQAs.sort((a, b) => {
        const aIndex = parseInt(a.id.split('-').pop() || '0', 10);
        const bIndex = parseInt(b.id.split('-').pop() || '0', 10);
        return bIndex - aIndex; // Descending order to remove highest indices first
      });

      // Filter out agents that are actively reviewing
      const terminableAgents = sortedAgents.filter(agent => !isAgentReviewingPR(this.db, agent.id));
      const qaAgentsToTerminate = terminableAgents.slice(0, toTerminate);

      try {
        for (const agent of qaAgentsToTerminate) {
          // Kill tmux session
          if (agent.tmux_session) {
            await killTmuxSession(agent.tmux_session);
          }

          // Remove worktree
          if (agent.worktree_path) {
            this.removeAgentWorktree(agent.worktree_path, agent.id);
          }

          // Update database
          updateAgent(this.db, agent.id, {
            status: 'terminated',
            currentStoryId: null,
            worktreePath: null,
          });

          // Log the event
          createLog(this.db, {
            agentId: agent.id,
            eventType: 'AGENT_TERMINATED',
            message: 'QA agent scaled down due to reduced PR queue',
            metadata: { teamId, agentType: 'qa', reason: 'queue_shrink', pendingCount },
          });
        }

        createLog(this.db, {
          agentId: 'scheduler',
          eventType: 'TEAM_SCALED_DOWN',
          message: `Scaled down QA agents for team ${teamName}: ${currentQACount} → ${neededQAs} (${pendingCount} pending stories)`,
          metadata: {
            teamId,
            agentType: 'qa',
            previousCount: currentQACount,
            newCount: neededQAs,
            pendingCount,
          },
        });
      } catch (err) {
        createLog(this.db, {
          agentId: 'scheduler',
          eventType: 'AGENT_TERMINATED',
          status: 'error',
          message: `Failed to scale down QA agents for team ${teamName}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          metadata: { teamId, agentType: 'qa', error: String(err) },
        });
      }
    }
  }

  private async ensureManagerRunning(): Promise<void> {
    if (!(await isManagerRunning())) {
      await startManager(DEFAULT_MANAGER_INTERVAL_SECONDS);
    }
  }

  /**
   * Generic agent spawn method
   * Handles spawning of all agent types (senior, intermediate, junior, qa)
   */
  private async spawnAgent(
    type: 'senior' | 'intermediate' | 'junior' | 'qa',
    teamId: string,
    teamName: string,
    repoPath: string,
    index?: number
  ): Promise<AgentRow> {
    const sessionName = generateSessionName(type, teamName, index);

    // Prevent creating duplicate agents on same tmux session (for senior agents)
    if (type === 'senior') {
      const existingSeniors = getAgentsByTeam(this.db, teamId).filter(a => a.type === 'senior');
      const existingOnSession = existingSeniors.find(
        a => a.tmux_session === sessionName && a.status !== 'terminated'
      );
      if (existingOnSession && (await isTmuxSessionRunning(sessionName))) {
        return existingOnSession;
      }
    }

    // Get model info from config
    let modelConfig = this.config.models[type as keyof typeof this.config.models];

    // Override Claude runtime models to Opus 4.6 when godmode is active
    const configuredCliTool = modelConfig.cli_tool || 'claude';
    if (this.isGodmodeActive() && configuredCliTool === 'claude') {
      modelConfig = {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        max_tokens: GODMODE_MAX_TOKENS,
        temperature: GODMODE_TEMPERATURE,
        cli_tool: 'claude',
        safety_mode: modelConfig.safety_mode,
      };
    }

    const cliTool = modelConfig.cli_tool || 'claude';
    const safetyMode = modelConfig.safety_mode;
    const runtimeModel = this.getRuntimeModel(modelConfig.model, cliTool);

    // Validate that the model is compatible with the CLI tool
    try {
      validateModelCliCompatibility(modelConfig.model, cliTool);
    } catch (err) {
      // Create an escalation for human review instead of spawning a broken agent
      const errorMessage = err instanceof Error ? err.message : 'Unknown compatibility error';
      createEscalation(this.db, {
        reason: `Configuration mismatch: Cannot spawn ${type} agent for team ${teamName}. ${errorMessage}`,
      });

      createLog(this.db, {
        agentId: 'scheduler',
        eventType: 'AGENT_SPAWN_FAILED',
        status: 'error',
        message: `Failed to spawn ${type} agent for team ${teamName}: ${errorMessage}. Created escalation for human review.`,
        metadata: {
          teamId,
          agentType: type,
          model: modelConfig.model,
          cliTool,
          error: errorMessage,
        },
      });

      // Throw the error to prevent agent creation
      throw new OperationalError(`Cannot spawn ${type} agent: ${errorMessage}`);
    }

    const agent = createAgent(this.db, {
      type,
      teamId,
      model: runtimeModel,
    });

    // Create git worktree for this agent
    const worktreePath = await this.createWorktree(agent.id, teamId, repoPath);
    const workDir = `${this.config.rootDir}/${worktreePath}`;

    if (!(await isTmuxSessionRunning(sessionName))) {
      // Build the initial prompt for this agent type
      const team = getTeamById(this.db, teamId);
      let prompt: string;

      if (type === 'senior') {
        const stories = this.getTeamStories(teamId);
        prompt = generateSeniorPrompt(teamName, team?.repo_url || '', worktreePath, stories);
      } else if (type === 'intermediate') {
        prompt = generateIntermediatePrompt(
          teamName,
          team?.repo_url || '',
          worktreePath,
          sessionName
        );
      } else if (type === 'junior') {
        prompt = generateJuniorPrompt(teamName, team?.repo_url || '', worktreePath, sessionName);
      } else {
        prompt = generateQAPrompt(teamName, team?.repo_url || '', worktreePath, sessionName);
      }

      // Build CLI command using the configured runtime
      const commandArgs = getCliRuntimeBuilder(cliTool).buildSpawnCommand(runtimeModel, safetyMode);

      // Pass the prompt as initialPrompt so it's included as a CLI positional
      // argument via $(cat ...). This delivers the full multi-line prompt
      // reliably without tmux send-keys newline issues.
      await spawnTmuxSession({
        sessionName,
        workDir,
        commandArgs,
        initialPrompt: prompt,
      });

      // Auto-start manager when spawning agents
      await this.ensureManagerRunning();
    }

    updateAgent(this.db, agent.id, {
      tmuxSession: sessionName,
      status: 'idle',
      worktreePath,
    });

    // Save database immediately so spawned agent can see itself when querying
    if (this.saveFn) {
      this.saveFn();
    }

    return agent;
  }

  /**
   * Check if godmode is active (any active requirement with godmode enabled)
   * Checks requirements directly rather than through stories, so godmode stays
   * active even after stories move from planned to in_progress/review/qa.
   */
  private isGodmodeActive(): boolean {
    const activeRequirements = queryAll<RequirementRow>(
      this.db,
      `SELECT * FROM requirements WHERE status IN ('planning', 'planned', 'in_progress') AND godmode = 1`
    );
    return activeRequirements.length > 0;
  }

  /**
   * Resolve the model value passed to the configured CLI runtime.
   */
  private getRuntimeModel(modelId: string, cliTool: 'claude' | 'codex' | 'gemini'): string {
    return resolveRuntimeModelForCli(modelId, cliTool);
  }

  private async spawnQA(
    teamId: string,
    teamName: string,
    repoPath: string,
    index: number = 1
  ): Promise<AgentRow> {
    return this.spawnAgent('qa', teamId, teamName, repoPath, index);
  }

  private async spawnSenior(
    teamId: string,
    teamName: string,
    repoPath: string,
    index?: number
  ): Promise<AgentRow> {
    return this.spawnAgent('senior', teamId, teamName, repoPath, index);
  }

  private async spawnIntermediate(
    teamId: string,
    teamName: string,
    repoPath: string
  ): Promise<AgentRow> {
    const existing = getAgentsByTeam(this.db, teamId).filter(a => a.type === 'intermediate');
    const index = existing.length + 1;
    return this.spawnAgent('intermediate', teamId, teamName, repoPath, index);
  }

  private async spawnJunior(teamId: string, teamName: string, repoPath: string): Promise<AgentRow> {
    const existing = getAgentsByTeam(this.db, teamId).filter(a => a.type === 'junior');
    const index = existing.length + 1;
    return this.spawnAgent('junior', teamId, teamName, repoPath, index);
  }

  private getTeamStories(teamId: string): StoryRow[] {
    return queryAll<StoryRow>(
      this.db,
      `
      SELECT * FROM stories
      WHERE team_id = ? AND status IN ('planned', 'estimated')
      ORDER BY complexity_score DESC
    `,
      [teamId]
    );
  }
}
