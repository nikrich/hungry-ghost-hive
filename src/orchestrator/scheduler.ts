// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import {
  getCliRuntimeBuilder,
  resolveRuntimeModelForCli,
  validateModelCliCompatibility,
} from '../cli-runtimes/index.js';
import type { HiveConfig, ModelsConfig, QAConfig, ScalingConfig } from '../config/schema.js';
import { PMOperationQueue } from '../connectors/project-management/operation-queue.js';
import {
  createSubtaskForStory,
  postCommentOnIssue,
  syncStatusForStory,
} from '../connectors/project-management/operations.js';
import { queryAll, withTransaction } from '../db/client.js';
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
import { getRequirementById, type RequirementRow } from '../db/queries/requirements.js';
import {
  getPlannedStories,
  getStoriesDependingOn,
  getStoryById,
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
import * as logger from '../utils/logger.js';
import { selectAgentWithLeastWorkload } from './agent-selector.js';
import { getCapacityPoints, selectStoriesForCapacity } from './capacity-planner.js';
import { areDependenciesSatisfied, topologicalSort } from './dependency-resolver.js';
import {
  createRequirementFeatureBranch,
  getRequirementsNeedingFeatureBranch,
} from './feature-branch.js';
import { detectAndRecoverOrphanedStories } from './orphan-recovery.js';
import {
  generateFeatureTestPrompt,
  generateIntermediatePrompt,
  generateJuniorPrompt,
  generateQAPrompt,
  generateSeniorPrompt,
} from './prompt-templates.js';

// --- Named constants (extracted from inline magic numbers) ---

/** Timeout in ms for best-effort fetch before creating an agent worktree */
const GIT_FETCH_TIMEOUT_MS = 5000;
/** Timeout in ms for creating/attaching agent worktrees */
const GIT_WORKTREE_ADD_TIMEOUT_MS = 30000;
/** Timeout in ms for removing stale worktrees during cleanup paths */
const GIT_WORKTREE_REMOVE_TIMEOUT_MS = 5000;
/** Max tokens for Opus 4.6 in godmode */
const GODMODE_MAX_TOKENS = 16000;
/** Temperature for Opus 4.6 in godmode */
const GODMODE_TEMPERATURE = 0.7;
/** Default number of pending PRs per QA agent for scaling */
const DEFAULT_PENDING_PER_QA_AGENT = 2.5;
/** Default maximum number of QA agents per team */
const DEFAULT_MAX_QA_AGENTS = 5;
/** Default manager check interval in seconds */
const DEFAULT_MANAGER_INTERVAL_SECONDS = 60;

export interface SchedulerConfig {
  scaling: ScalingConfig;
  models: ModelsConfig;
  qa?: QAConfig;
  rootDir: string;
  saveFn?: () => void;
  hiveConfig?: HiveConfig;
}

export class Scheduler {
  private db: Database;
  private config: SchedulerConfig;
  private saveFn?: () => void;
  private pmQueue: PMOperationQueue;

  constructor(db: Database, config: SchedulerConfig) {
    this.db = db;
    this.config = config;
    this.saveFn = config.saveFn;
    this.pmQueue = new PMOperationQueue();
  }

  /**
   * Wait for all pending Jira operations to complete.
   * Call this before closing the database to prevent "Database closed" errors.
   */
  async flushJiraQueue(): Promise<void> {
    await this.pmQueue.waitForCompletion();
  }

  /**
   * Create a git worktree for an agent
   * Returns the worktree path
   */
  private async createWorktree(
    agentId: string,
    teamId: string,
    repoPath: string,
    baseBranch: string = 'main'
  ): Promise<string> {
    const { execSync } = await import('child_process');

    // Construct worktree path: repos/<team-id>-<agent-id>/
    const worktreePath = `repos/${teamId}-${agentId}`;
    const fullWorktreePath = `${this.config.rootDir}/${worktreePath}`;
    const fullRepoPath = `${this.config.rootDir}/${repoPath}`;

    // Branch name: agent/<agent-id>
    const branchName = `agent/${agentId}`;

    // Fetch the base branch so worktree starts from the correct point
    try {
      execSync(`git fetch origin ${baseBranch}`, {
        cwd: fullRepoPath,
        stdio: 'pipe',
        timeout: GIT_FETCH_TIMEOUT_MS,
      });
    } catch (_err) {
      // Fetch failure is non-fatal; proceed with whatever is available locally
    }

    try {
      // Create worktree from the specified base branch (30s timeout for git operations)
      execSync(`git worktree add "${fullWorktreePath}" -b "${branchName}" "origin/${baseBranch}"`, {
        cwd: fullRepoPath,
        stdio: 'pipe',
        timeout: GIT_WORKTREE_ADD_TIMEOUT_MS,
      });
    } catch (err) {
      // If worktree or branch already exists, try to add without creating branch
      try {
        execSync(`git worktree add "${fullWorktreePath}" "${branchName}"`, {
          cwd: fullRepoPath,
          stdio: 'pipe',
          timeout: GIT_WORKTREE_ADD_TIMEOUT_MS,
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

    const result = removeWorktree(this.config.rootDir, worktreePath, {
      timeout: GIT_WORKTREE_REMOVE_TIMEOUT_MS,
    });
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

  // Dependency resolution, capacity planning, agent selection, and orphan recovery
  // are extracted to standalone modules for direct testability.
  // See: dependency-resolver.ts, capacity-planner.ts, agent-selector.ts, orphan-recovery.ts

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
    const sortedStories = topologicalSort(this.db, plannedStories);
    if (sortedStories === null) {
      errors.push('Circular dependency detected in planned stories');
      return { assigned, errors, preventedDuplicates };
    }

    // Before assigning stories, create feature branches for requirements
    // that have e2e_tests configured. This ensures the target_branch is set
    // correctly before agents are spawned and worktrees are created.
    await this.createFeatureBranchesForPlannedStories(sortedStories, errors);

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
      const activeSeniors = getAgentsByTeam(this.db, teamId).filter(
        a => a.type === 'senior' && a.status !== 'terminated'
      );
      const seniorSessionPrefix = generateSessionName('senior', team.name);
      const indexedSeniorSessions = activeSeniors
        .map(senior => {
          if (!senior.tmux_session) return null;
          if (senior.tmux_session === seniorSessionPrefix) return 1;
          const indexedPrefix = `${seniorSessionPrefix}-`;
          if (!senior.tmux_session.startsWith(indexedPrefix)) return null;
          const parsed = Number.parseInt(senior.tmux_session.slice(indexedPrefix.length), 10);
          if (!Number.isFinite(parsed) || parsed <= 1) return null;
          return parsed;
        })
        .filter((index): index is number => index !== null);
      const maxSeniorIndex =
        indexedSeniorSessions.length > 0
          ? Math.max(...indexedSeniorSessions)
          : Math.max(activeSeniors.length, 0);
      let nextSeniorIndex = maxSeniorIndex + 1;

      const getOrSpawnSenior = async (): Promise<AgentRow | undefined> => {
        const idleSenior = agents.find(a => a.type === 'senior' && a.status === 'idle');
        if (idleSenior) return idleSenior;

        try {
          const spawnIndex = nextSeniorIndex;
          nextSeniorIndex += 1;
          const spawnedSenior = await this.spawnSenior(
            teamId,
            team.name,
            team.repo_path,
            spawnIndex > 1 ? spawnIndex : undefined
          );
          agents.push(spawnedSenior);
          return spawnedSenior;
        } catch (err) {
          errors.push(
            `Failed to spawn Senior for team ${team.name}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
          return undefined;
        }
      };

      // Ensure at least one Senior is available for delegation/fallback.
      if (!(await getOrSpawnSenior())) {
        continue;
      }

      // Assign stories based on complexity and capacity policy
      const storiesToAssign = selectStoriesForCapacity(stories, this.config.scaling);

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
        if (!areDependenciesSatisfied(this.db, story.id)) {
          continue;
        }

        // Check if this story is a blocker (has dependents)
        const dependents = getStoriesDependingOn(this.db, story.id);
        const isBlocker = dependents.length > 0;

        const complexity = story.complexity_score || 5;
        let targetAgent: AgentRow | undefined;

        if (isBlocker) {
          // Blocker stories always go to Senior regardless of complexity
          targetAgent = await getOrSpawnSenior();
        } else if (complexity <= this.config.scaling.junior_max_complexity) {
          // Assign to Junior with least workload
          const juniors = agents.filter(a => a.type === 'junior' && a.status === 'idle');
          targetAgent =
            juniors.length > 0 ? selectAgentWithLeastWorkload(this.db, juniors) : undefined;
          if (!targetAgent) {
            try {
              targetAgent = await this.spawnJunior(teamId, team.name, team.repo_path);
              agents.push(targetAgent);
            } catch (_error) {
              // Fall back to Intermediate or Senior
              const intermediates = agents.filter(
                a => a.type === 'intermediate' && a.status === 'idle'
              );
              targetAgent =
                intermediates.length > 0
                  ? selectAgentWithLeastWorkload(this.db, intermediates)
                  : await getOrSpawnSenior();
            }
          }
        } else if (complexity <= this.config.scaling.intermediate_max_complexity) {
          // Assign to Intermediate with least workload
          const intermediates = agents.filter(
            a => a.type === 'intermediate' && a.status === 'idle'
          );
          targetAgent =
            intermediates.length > 0
              ? selectAgentWithLeastWorkload(this.db, intermediates)
              : undefined;
          if (!targetAgent) {
            try {
              targetAgent = await this.spawnIntermediate(teamId, team.name, team.repo_path);
              agents.push(targetAgent);
            } catch (_error) {
              // Fall back to Senior
              targetAgent = await getOrSpawnSenior();
            }
          }
        } else {
          // Senior handles directly
          targetAgent = await getOrSpawnSenior();
        }

        if (!targetAgent) {
          errors.push(`No available agent for story ${story.id}`);
          continue;
        }

        // Assign the story (atomic transaction)
        try {
          await withTransaction(
            this.db,
            () => {
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
            },
            this.saveFn
          );
          assigned++;

          // Keep local availability snapshot in sync so we don't reassign
          // additional stories to an agent already marked busy this cycle.
          const localIndex = agents.findIndex(a => a.id === targetAgent!.id);
          if (localIndex >= 0) {
            agents[localIndex] = {
              ...agents[localIndex],
              status: 'working',
              current_story_id: story.id,
            };
          }

          // Enqueue Jira operations to prevent race conditions
          // Operations are processed sequentially to avoid:
          // - TokenStore file lock contention
          // - Jira API rate limiting
          // - Concurrent token refresh issues
          this.pmQueue.enqueue(`story-${story.id}-assignment`, async () => {
            await this.handleJiraAfterAssignment(story, targetAgent, team);
          });

          this.pmQueue.enqueue(`story-${story.id}-status-transition`, async () => {
            await syncStatusForStory(this.config.rootDir, this.db, story.id, 'in_progress');
          });
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
   * Handle Jira integration after story assignment:
   * - Create a subtask for the agent
   * - Post an "assigned" comment
   * Failures are logged but do not block the assignment pipeline.
   */
  private async handleJiraAfterAssignment(
    story: StoryRow,
    agent: AgentRow,
    _team: { id: string; name: string }
  ): Promise<void> {
    // Check if PM is configured
    if (!this.config.hiveConfig) return;
    const pmConfig = this.config.hiveConfig.integrations?.project_management;
    if (!pmConfig || pmConfig.provider === 'none') return;

    // Re-fetch the story from DB to get the latest PM data (the passed-in
    // story object may be stale — external_issue_key is set during sync
    // which may have completed after this object was fetched).
    const freshStory = getStoryById(this.db, story.id);
    if (!freshStory?.external_issue_key) {
      logger.debug(`Story ${story.id} has no external issue key, skipping subtask creation`);
      return;
    }

    // Idempotency guard: skip if subtask was already created (prevents duplicates
    // if both the original hook and the repair loop fire for the same story)
    if (freshStory.external_subtask_key) {
      logger.debug(
        `Story ${story.id} already has external subtask ${freshStory.external_subtask_key}, skipping`
      );
      return;
    }

    try {
      const agentName = agent.tmux_session || agent.id;
      const subtask = await createSubtaskForStory(
        this.config.rootDir,
        freshStory.external_issue_key,
        {
          parentIssueKey: freshStory.external_issue_key,
          projectKey: freshStory.external_project_key || '',
          agentName,
          storyTitle: freshStory.title,
        }
      );

      if (subtask) {
        // Persist subtask reference back to the story
        updateStory(this.db, freshStory.id, {
          externalSubtaskKey: subtask.key,
          externalSubtaskId: subtask.id,
        });
        if (this.saveFn) this.saveFn();

        logger.info(`Created subtask ${subtask.key} for story ${freshStory.id}`);

        // Post "assigned" comment
        await postCommentOnIssue(this.config.rootDir, freshStory.external_issue_key, 'assigned', {
          agentName,
          subtaskKey: subtask.key,
        });
      }
    } catch (err) {
      logger.warn(
        `PM integration failed for story ${story.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
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
      if (areDependenciesSatisfied(this.db, story.id)) {
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
      const assignableStories = selectStoriesForCapacity(
        plannedStories,
        this.config.scaling
      ).filter(story => areDependenciesSatisfied(this.db, story.id));

      // Count story points only from assignable work
      const assignableStoryPoints = assignableStories.reduce(
        (sum, story) => sum + getCapacityPoints(story),
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

          // Sync status change to Jira (fire and forget)
          syncStatusForStory(this.config.rootDir, this.db, agent.current_story_id, 'planned');
        }
      }
    }

    // Detect and recover orphaned stories (assigned to terminated agents)
    const orphanedRecovered = detectAndRecoverOrphanedStories(this.db, this.config.rootDir);

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
   * - Count stories in explicit QA statuses ('pr_submitted', 'qa', 'qa_failed')
   * - Also count non-merged stories that have queued/reviewing PRs
   * - Calculate needed QA agents: 1 QA per 2-3 pending PRs, max 5
   * - Spawn QA agents in parallel with unique session names
   * - Scale down excess QA agents when queue shrinks
   *
   * Note: Unlike checkScaling(), this method does not need to filter by dependencies
   * because it only counts stories already in QA phases or stories with open PRs.
   * Open PR status is treated as source-of-truth for review demand, which allows
   * recovery from stale story statuses (for example, story still marked in_progress).
   */
  private async scaleQAAgents(teamId: string, teamName: string, repoPath: string): Promise<void> {
    // Count pending QA work: explicit QA statuses OR any non-merged story with an open PR.
    const qaStories = queryAll<StoryRow>(
      this.db,
      `
      SELECT DISTINCT s.* FROM stories s
      LEFT JOIN pull_requests pr ON pr.story_id = s.id
      WHERE s.team_id = ? AND (
        s.status IN ('qa', 'pr_submitted', 'qa_failed')
        OR (s.status != 'merged' AND pr.status IN ('queued', 'reviewing'))
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
    type: 'senior' | 'intermediate' | 'junior' | 'qa' | 'feature_test',
    teamId: string,
    teamName: string,
    repoPath: string,
    index?: number,
    featureTestContext?: {
      featureBranch: string;
      requirementId: string;
      e2eTestsPath: string;
    }
  ): Promise<AgentRow> {
    const sessionName = generateSessionName(type, teamName, index);

    // Prevent creating duplicate agents on same tmux session (for senior agents)
    if (type === 'senior') {
      const existingSeniors = getAgentsByTeam(this.db, teamId).filter(a => a.type === 'senior');
      const existingOnSession = existingSeniors.find(
        a => a.tmux_session === sessionName && a.status !== 'terminated'
      );
      if (existingOnSession && (await isTmuxSessionRunning(sessionName))) {
        const sessionSeniorAvailable =
          existingOnSession.status === 'idle' ||
          (existingOnSession.status === 'working' && existingOnSession.current_story_id === null);
        if (sessionSeniorAvailable) {
          return existingOnSession;
        }
        throw new OperationalError(
          `Cannot spawn senior on busy session ${sessionName} (agent ${existingOnSession.id})`
        );
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

    // Determine the target branch for this team's stories
    const targetBranch = this.getTargetBranchForTeam(teamId);

    // Create git worktree for this agent from the correct base branch
    const worktreePath = await this.createWorktree(agent.id, teamId, repoPath, targetBranch);
    const workDir = `${this.config.rootDir}/${worktreePath}`;

    if (!(await isTmuxSessionRunning(sessionName))) {
      // Build the initial prompt for this agent type
      const team = getTeamById(this.db, teamId);
      const includeProgressUpdates = this.shouldIncludeProgressUpdates();
      let prompt: string;

      if (type === 'senior') {
        const stories = this.getTeamStories(teamId);
        prompt = generateSeniorPrompt(
          teamName,
          team?.repo_url || '',
          worktreePath,
          stories,
          targetBranch,
          { includeProgressUpdates },
          sessionName
        );
      } else if (type === 'intermediate') {
        prompt = generateIntermediatePrompt(
          teamName,
          team?.repo_url || '',
          worktreePath,
          sessionName,
          targetBranch,
          { includeProgressUpdates }
        );
      } else if (type === 'junior') {
        prompt = generateJuniorPrompt(
          teamName,
          team?.repo_url || '',
          worktreePath,
          sessionName,
          targetBranch,
          { includeProgressUpdates }
        );
      } else if (type === 'feature_test' && featureTestContext) {
        prompt = generateFeatureTestPrompt(
          teamName,
          team?.repo_url || '',
          worktreePath,
          sessionName,
          featureTestContext.featureBranch,
          featureTestContext.requirementId,
          featureTestContext.e2eTestsPath,
          { includeProgressUpdates }
        );
      } else {
        prompt = generateQAPrompt(
          teamName,
          team?.repo_url || '',
          worktreePath,
          sessionName,
          targetBranch
        );
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

  private shouldIncludeProgressUpdates(): boolean {
    const provider = this.config.hiveConfig?.integrations?.project_management?.provider;
    // Default to enabled when running with older config/test setups that do not
    // pass full hiveConfig into Scheduler.
    return provider !== 'none';
  }

  private async spawnQA(
    teamId: string,
    teamName: string,
    repoPath: string,
    index: number = 1
  ): Promise<AgentRow> {
    return this.spawnAgent('qa', teamId, teamName, repoPath, index);
  }

  /**
   * Spawn a feature_test agent for running E2E tests against a feature branch.
   * This method is public because it is called from external orchestration logic
   * (e.g., the manager daemon when all stories are merged).
   */
  async spawnFeatureTest(
    teamId: string,
    teamName: string,
    repoPath: string,
    featureTestContext: {
      featureBranch: string;
      requirementId: string;
      e2eTestsPath: string;
    }
  ): Promise<AgentRow> {
    return this.spawnAgent(
      'feature_test',
      teamId,
      teamName,
      repoPath,
      undefined,
      featureTestContext
    );
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

  /**
   * Determine the target branch for a team by looking at the stories
   * assigned to the team and their parent requirement's target_branch.
   * If stories come from multiple requirements with different target branches,
   * use the most common one. Defaults to 'main' if no requirement or target_branch is set.
   */
  private getTargetBranchForTeam(teamId: string): string {
    const stories = this.getTeamStories(teamId);

    const branchCounts = new Map<string, number>();
    for (const story of stories) {
      if (!story.requirement_id) continue;
      const requirement = getRequirementById(this.db, story.requirement_id);
      if (!requirement?.target_branch) continue;
      const count = branchCounts.get(requirement.target_branch) || 0;
      branchCounts.set(requirement.target_branch, count + 1);
    }

    if (branchCounts.size === 0) return 'main';

    // Return the most common target_branch
    let maxBranch = 'main';
    let maxCount = 0;
    for (const [branch, count] of branchCounts) {
      if (count > maxCount) {
        maxBranch = branch;
        maxCount = count;
      }
    }
    return maxBranch;
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

  /**
   * Create feature branches for requirements that have e2e_tests configured.
   * This is called before story assignment to ensure feature branches exist
   * and target_branch is set correctly for agent worktree creation.
   *
   * For each unique requirement referenced by planned stories:
   * - If e2e_tests is configured and no feature branch exists yet
   * - Create feature/REQ-xxx branch from main
   * - Update requirement target_branch and feature_branch
   * - Transition requirement to in_progress
   */
  private async createFeatureBranchesForPlannedStories(
    stories: StoryRow[],
    errors: string[]
  ): Promise<void> {
    const storyIds = stories.map(s => s.id);
    const requirementIds = getRequirementsNeedingFeatureBranch(
      this.db,
      storyIds,
      this.config.hiveConfig
    );

    if (requirementIds.length === 0) return;

    // Find the repo path from the first team that has stories
    // (all stories for a requirement typically belong to the same repo)
    const teams = getAllTeams(this.db);
    const repoPath = teams.length > 0 ? `${this.config.rootDir}/${teams[0].repo_path}` : null;

    if (!repoPath) return;

    for (const reqId of requirementIds) {
      const branch = await createRequirementFeatureBranch(this.db, repoPath, reqId, this.saveFn);

      if (!branch) {
        errors.push(`Failed to create feature branch for requirement ${reqId}`);
      }
    }
  }
}
