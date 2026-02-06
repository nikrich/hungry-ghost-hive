import type { Database } from 'sql.js';
import { getPlannedStories, updateStory, getStoryPointsByTeam, getStoryDependencies, getStoryById, type StoryRow } from '../db/queries/stories.js';
import { getAgentsByTeam, getAgentById, createAgent, updateAgent, type AgentRow } from '../db/queries/agents.js';
import { getTeamById, getAllTeams } from '../db/queries/teams.js';
import { queryOne, queryAll } from '../db/client.js';
import { createLog } from '../db/queries/logs.js';
import { spawnTmuxSession, generateSessionName, isTmuxSessionRunning, sendToTmuxSession, startManager, isManagerRunning, getHiveSessions, waitForTmuxSessionReady, forceBypassMode, killTmuxSession } from '../tmux/manager.js';
import type { ScalingConfig, ModelsConfig } from '../config/schema.js';
import { getCliRuntimeBuilder } from '../cli-runtimes/index.js';

export interface SchedulerConfig {
  scaling: ScalingConfig;
  models: ModelsConfig;
  rootDir: string;
}

export class Scheduler {
  private db: Database;
  private config: SchedulerConfig;

  constructor(db: Database, config: SchedulerConfig) {
    this.db = db;
    this.config = config;
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
      // Create worktree from main branch
      execSync(`git worktree add "${fullWorktreePath}" -b "${branchName}"`, {
        cwd: fullRepoPath,
        stdio: 'pipe',
      });
    } catch (err) {
      // If worktree or branch already exists, try to add without creating branch
      try {
        execSync(`git worktree add "${fullWorktreePath}" "${branchName}"`, {
          cwd: fullRepoPath,
          stdio: 'pipe',
        });
      } catch {
        // If that fails too, log and throw
        throw new Error(`Failed to create worktree at ${fullWorktreePath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return worktreePath;
  }

  /**
   * Remove a git worktree for an agent
   */
  private async removeWorktree(worktreePath: string): Promise<void> {
    if (!worktreePath) return;

    const { execSync } = await import('child_process');
    const fullWorktreePath = `${this.config.rootDir}/${worktreePath}`;

    try {
      execSync(`git worktree remove "${fullWorktreePath}" --force`, {
        cwd: this.config.rootDir,
        stdio: 'pipe',
      });
    } catch (err) {
      // Log error but don't throw - worktree might already be removed
      console.error(`Warning: Failed to remove worktree at ${fullWorktreePath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

    // Add dependencies (only within the planned set; external deps handled by areDependenciesSatisfied)
    for (const story of stories) {
      const dependencies = getStoryDependencies(this.db, story.id);
      for (const dep of dependencies) {
        if (graph.has(story.id) && storyIds.has(dep.id)) {
          graph.get(story.id)!.add(dep.id);
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
   * A dependency is satisfied if it's completed (merged) or in progress (being worked on)
   */
  private areDependenciesSatisfied(storyId: string): boolean {
    const dependencies = getStoryDependencies(this.db, storyId);

    for (const dep of dependencies) {
      // Check if dependency is in a terminal or in-progress state
      if (dep.status !== 'merged' && dep.status !== 'pr_submitted' && dep.status !== 'in_progress' && dep.status !== 'review' && dep.status !== 'qa' && dep.status !== 'qa_failed') {
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
    const activeStories = queryAll<StoryRow>(this.db, `
      SELECT * FROM stories
      WHERE assigned_agent_id = ?
        AND status IN ('in_progress', 'review', 'qa', 'qa_failed')
    `, [agentId]);
    return activeStories.length;
  }

  /**
   * Assign planned stories to available agents
   */
  async assignStories(): Promise<{ assigned: number; errors: string[]; preventedDuplicates: number }> {
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

        const complexity = story.complexity_score || 5;
        let targetAgent: AgentRow | undefined;

        if (complexity <= this.config.scaling.junior_max_complexity) {
          // Assign to Junior with least workload
          const juniors = agents.filter(a => a.type === 'junior' && a.status === 'idle');
          targetAgent = juniors.length > 0 ? this.selectAgentWithLeastWorkload(juniors) : undefined;
          if (!targetAgent) {
            try {
              targetAgent = await this.spawnJunior(teamId, team.name, team.repo_path);
            } catch {
              // Fall back to Intermediate or Senior
              const intermediates = agents.filter(a => a.type === 'intermediate' && a.status === 'idle');
              targetAgent = intermediates.length > 0 ? this.selectAgentWithLeastWorkload(intermediates) : senior;
            }
          }
        } else if (complexity <= this.config.scaling.intermediate_max_complexity) {
          // Assign to Intermediate with least workload
          const intermediates = agents.filter(a => a.type === 'intermediate' && a.status === 'idle');
          targetAgent = intermediates.length > 0 ? this.selectAgentWithLeastWorkload(intermediates) : undefined;
          if (!targetAgent) {
            try {
              targetAgent = await this.spawnIntermediate(teamId, team.name, team.repo_path);
            } catch {
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

    return { assigned, errors, preventedDuplicates };
  }

  /**
   * Get the next story to work on for a specific agent
   */
  getNextStoryForAgent(agentId: string): StoryRow | null {
    const agent = getAgentById(this.db, agentId);
    if (!agent || !agent.team_id) return null;

    // Find an unassigned planned story for this team
    const story = queryOne<StoryRow>(this.db, `
      SELECT * FROM stories
      WHERE team_id = ?
        AND status = 'planned'
        AND assigned_agent_id IS NULL
      ORDER BY story_points DESC, created_at
      LIMIT 1
    `, [agent.team_id]);

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
          } catch {
            // Log error but continue
          }
        }
      }
    }
  }

  /**
   * Health check: sync agent status with actual tmux sessions
   * Returns number of agents whose status was corrected
   */
  async healthCheck(): Promise<{ terminated: number; revived: string[] }> {
    const allAgents = queryAll<AgentRow>(this.db, `
      SELECT * FROM agents WHERE status != 'terminated'
    `);

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
          await this.removeWorktree(agent.worktree_path);
        }

        updateAgent(this.db, agent.id, { status: 'terminated', currentStoryId: null, worktreePath: null });
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

    return { terminated, revived };
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
   */
  private async scaleQAAgents(teamId: string, teamName: string, repoPath: string): Promise<void> {
    // Count pending QA work: stories in 'qa' or 'pr_submitted' status
    const qaStories = queryAll<StoryRow>(this.db, `
      SELECT * FROM stories
      WHERE team_id = ? AND status IN ('qa', 'pr_submitted')
    `, [teamId]);

    const pendingCount = qaStories.length;

    // Calculate needed QA agents: 1 per 2-3 pending PRs, max 5
    // If no pending work, scale down to 0 agents
    const neededQAs = pendingCount > 0 ? Math.min(Math.ceil(pendingCount / 2.5), 5) : 0;

    // Get currently active QA agents for this team
    const activeQAs = getAgentsByTeam(this.db, teamId)
      .filter(a => a.type === 'qa' && a.status !== 'terminated');

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
          metadata: { teamId, agentType: 'qa', previousCount: currentQACount, newCount: neededQAs, pendingCount },
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
      const sortedAgents = activeQAs.sort((a, b) => {
        const aIndex = parseInt(a.id.split('-').pop() || '0', 10);
        const bIndex = parseInt(b.id.split('-').pop() || '0', 10);
        return bIndex - aIndex; // Descending order to remove highest indices first
      });

      const qaAgentsToTerminate = sortedAgents.slice(0, toTerminate);

      try {
        for (const agent of qaAgentsToTerminate) {
          // Kill tmux session
          if (agent.tmux_session) {
            await killTmuxSession(agent.tmux_session);
          }

          // Remove worktree
          if (agent.worktree_path) {
            await this.removeWorktree(agent.worktree_path);
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
          metadata: { teamId, agentType: 'qa', previousCount: currentQACount, newCount: neededQAs, pendingCount },
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
    if (!await isManagerRunning()) {
      await startManager(60);
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
      const existingOnSession = existingSeniors.find(a => a.tmux_session === sessionName && a.status !== 'terminated');
      if (existingOnSession && await isTmuxSessionRunning(sessionName)) {
        return existingOnSession;
      }
    }

    // Get model info from config
    const modelConfig = this.config.models[type as keyof typeof this.config.models];
    const modelShorthand = this.getModelShorthand(modelConfig.model);

    const agent = createAgent(this.db, {
      type,
      teamId,
      model: modelShorthand,
    });

    // Create git worktree for this agent
    const worktreePath = await this.createWorktree(agent.id, teamId, repoPath);
    const workDir = `${this.config.rootDir}/${worktreePath}`;

    if (!await isTmuxSessionRunning(sessionName)) {
      // Build CLI command using the configured runtime
      const cliTool = modelConfig.cli_tool;
      const commandArgs = getCliRuntimeBuilder(cliTool).buildSpawnCommand(modelShorthand);
      const command = commandArgs.join(' ');

      await spawnTmuxSession({
        sessionName,
        workDir,
        command,
      });

      // Wait for Claude to be ready before sending prompt
      await waitForTmuxSessionReady(sessionName);

      // Force bypass permissions mode to enable autonomous work
      await forceBypassMode(sessionName, 'claude');

      const team = getTeamById(this.db, teamId);
      let prompt: string;

      if (type === 'senior') {
        const stories = this.getTeamStories(teamId);
        prompt = generateSeniorPrompt(teamName, team?.repo_url || '', worktreePath, stories);
      } else if (type === 'intermediate') {
        prompt = generateIntermediatePrompt(teamName, team?.repo_url || '', worktreePath, sessionName);
      } else if (type === 'junior') {
        prompt = generateJuniorPrompt(teamName, team?.repo_url || '', worktreePath, sessionName);
      } else {
        prompt = generateQAPrompt(teamName, team?.repo_url || '', worktreePath, sessionName);
      }

      await sendToTmuxSession(sessionName, prompt);

      // Auto-start manager when spawning agents
      await this.ensureManagerRunning();
    }

    updateAgent(this.db, agent.id, {
      tmuxSession: sessionName,
      status: 'working',
      worktreePath,
    });

    return agent;
  }

  /**
   * Extract model shorthand from full model ID
   * E.g., 'claude-sonnet-4-20250514' -> 'sonnet', 'claude-haiku-3-5-20241022' -> 'haiku'
   */
  private getModelShorthand(modelId: string): string {
    if (modelId.includes('sonnet')) return 'sonnet';
    if (modelId.includes('opus')) return 'opus';
    if (modelId.includes('haiku')) return 'haiku';
    if (modelId.includes('gpt-4o')) return 'gpt4o';
    return 'haiku'; // default fallback
  }

  private async spawnQA(teamId: string, teamName: string, repoPath: string, index: number = 1): Promise<AgentRow> {
    return this.spawnAgent('qa', teamId, teamName, repoPath, index);
  }

  private async spawnSenior(teamId: string, teamName: string, repoPath: string, index?: number): Promise<AgentRow> {
    return this.spawnAgent('senior', teamId, teamName, repoPath, index);
  }

  private async spawnIntermediate(teamId: string, teamName: string, repoPath: string): Promise<AgentRow> {
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
    return queryAll<StoryRow>(this.db, `
      SELECT * FROM stories
      WHERE team_id = ? AND status IN ('planned', 'estimated')
      ORDER BY complexity_score DESC
    `, [teamId]);
  }
}

// Prompt generation functions

function generateSeniorPrompt(teamName: string, repoUrl: string, repoPath: string, stories: StoryRow[]): string {
  const storyList = stories.map(s =>
    `- [${s.id}] ${s.title} (complexity: ${s.complexity_score || '?'})\n  ${s.description}`
  ).join('\n\n');

  const sessionName = `hive-senior-${teamName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  return `You are a Senior Developer on Team ${teamName}.
Your tmux session: ${sessionName}

## Your Repository
- Local path: ${repoPath}
- Remote: ${repoUrl}

## Your Responsibilities
1. Implement assigned stories
2. Review code quality
3. Delegate simpler tasks to Intermediate/Junior developers
4. Ensure tests pass and code meets standards

## Pending Stories for Your Team
${storyList || 'No stories assigned yet.'}

## Finding Your Stories
Check your assigned stories:
\`\`\`bash
hive my-stories ${sessionName}
\`\`\`

See all team stories:
\`\`\`bash
hive my-stories ${sessionName} --all
\`\`\`

Claim a story:
\`\`\`bash
hive my-stories claim <story-id> --session ${sessionName}
\`\`\`

Mark story complete:
\`\`\`bash
hive my-stories complete <story-id>
\`\`\`

## Workflow
1. Run \`hive my-stories ${sessionName}\` to see your assigned work
2. Create a feature branch: \`git checkout -b feature/<story-id>-<short-description>\`
3. Implement the changes
4. Run tests and linting
5. Commit with a clear message referencing the story ID
6. Create a PR using \`gh pr create\`
7. Submit to merge queue for QA review:
\`\`\`bash
hive pr submit -b feature/<story-id>-<description> -s <story-id> --from ${sessionName}
\`\`\`

## Submitting PRs
After creating your GitHub PR, submit it to the merge queue:
\`\`\`bash
gh pr create --title "Story <story-id>: <title>" --body "..."
hive pr submit -b <branch-name> -s <story-id> --pr-url <github-pr-url> --from ${sessionName}
\`\`\`

Check your PR status:
\`\`\`bash
hive pr queue
\`\`\`

## Communication with Tech Lead
If you have questions or need guidance, message the Tech Lead:
\`\`\`bash
hive msg send hive-tech-lead "Your question here" --from ${sessionName}
\`\`\`

Check for replies:
\`\`\`bash
hive msg outbox ${sessionName}
\`\`\`

## Guidelines
- Follow existing code patterns in the repository
- Write tests for new functionality
- Keep commits atomic and well-documented
- Message the Tech Lead if blocked or need clarification

## IMPORTANT: Autonomous Workflow
You are an autonomous agent. DO NOT ask "Is there anything else?" or wait for instructions.
After completing a story:
1. Run \`hive my-stories ${sessionName}\` to get your next assignment
2. If no stories assigned, run \`hive my-stories ${sessionName} --all\` to see available work
3. Claim available work with \`hive my-stories claim <story-id> --session ${sessionName}\`
4. ALWAYS submit PRs to hive after creating them on GitHub:
   \`hive pr submit -b <branch> -s <story-id> --pr-url <github-url> --from ${sessionName}\`

Start by exploring the codebase to understand its structure, then begin working on the highest priority story.`;
}

function generateIntermediatePrompt(teamName: string, repoUrl: string, repoPath: string, sessionName: string): string {
  const seniorSession = `hive-senior-${teamName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  return `You are an Intermediate Developer on Team ${teamName}.
Your tmux session: ${sessionName}

## Your Repository
- Local path: ${repoPath}
- Remote: ${repoUrl}

## Your Responsibilities
1. Implement assigned stories (moderate complexity)
2. Write clean, tested code
3. Follow team coding standards
4. Ask Senior for help if stuck

## Finding Your Stories
Check your assigned stories:
\`\`\`bash
hive my-stories ${sessionName}
\`\`\`

Claim a story:
\`\`\`bash
hive my-stories claim <story-id> --session ${sessionName}
\`\`\`

Mark story complete:
\`\`\`bash
hive my-stories complete <story-id>
\`\`\`

## Workflow
1. Run \`hive my-stories ${sessionName}\` to see your assigned work
2. Create a feature branch: \`git checkout -b feature/<story-id>-<description>\`
3. Implement the changes
4. Run tests and linting
5. Commit and create a PR using \`gh pr create\`
6. Submit to merge queue:
\`\`\`bash
hive pr submit -b <branch-name> -s <story-id> --from ${sessionName}
\`\`\`

## Submitting PRs
After creating your GitHub PR:
\`\`\`bash
gh pr create --title "Story <story-id>: <title>" --body "..."
hive pr submit -b <branch-name> -s <story-id> --pr-url <github-pr-url> --from ${sessionName}
\`\`\`

## Communication
If you have questions, message your Senior or the Tech Lead:
\`\`\`bash
hive msg send ${seniorSession} "Your question" --from ${sessionName}
hive msg send hive-tech-lead "Your question" --from ${sessionName}
\`\`\`

Check for replies:
\`\`\`bash
hive msg outbox ${sessionName}
\`\`\`

## Guidelines
- Follow existing code patterns
- Write tests for your changes
- Keep commits focused and clear
- Message Senior or Tech Lead if blocked

## IMPORTANT: Autonomous Workflow
You are an autonomous agent. DO NOT ask "Is there anything else?" or wait for instructions.
After completing a story:
1. Run \`hive my-stories ${sessionName}\` to get your next assignment
2. If no stories assigned, run \`hive my-stories ${sessionName} --all\` to see available work
3. Claim available work with \`hive my-stories claim <story-id> --session ${sessionName}\`
4. ALWAYS submit PRs to hive after creating them on GitHub:
   \`hive pr submit -b <branch> -s <story-id> --pr-url <github-url> --from ${sessionName}\`

Start by exploring the codebase, then run \`hive my-stories ${sessionName}\` to see your assignments.`;
}

function generateJuniorPrompt(teamName: string, repoUrl: string, repoPath: string, sessionName: string): string {
  const seniorSession = `hive-senior-${teamName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  return `You are a Junior Developer on Team ${teamName}.
Your tmux session: ${sessionName}

## Your Repository
- Local path: ${repoPath}
- Remote: ${repoUrl}

## Your Responsibilities
1. Implement simple, well-defined stories
2. Learn the codebase patterns
3. Write tests for your changes
4. Ask for help when needed

## Finding Your Stories
Check your assigned stories:
\`\`\`bash
hive my-stories ${sessionName}
\`\`\`

Claim a story:
\`\`\`bash
hive my-stories claim <story-id> --session ${sessionName}
\`\`\`

Mark story complete:
\`\`\`bash
hive my-stories complete <story-id>
\`\`\`

## Workflow
1. Run \`hive my-stories ${sessionName}\` to see your assigned work
2. Create a feature branch: \`git checkout -b feature/<story-id>-<description>\`
3. Implement the changes carefully
4. Run tests before committing
5. Commit and create a PR using \`gh pr create\`
6. Submit to merge queue:
\`\`\`bash
hive pr submit -b <branch-name> -s <story-id> --from ${sessionName}
\`\`\`

## Submitting PRs
After creating your GitHub PR:
\`\`\`bash
gh pr create --title "Story <story-id>: <title>" --body "..."
hive pr submit -b <branch-name> -s <story-id> --pr-url <github-pr-url> --from ${sessionName}
\`\`\`

## Communication
If you have questions, message your Senior or the Tech Lead:
\`\`\`bash
hive msg send ${seniorSession} "Your question" --from ${sessionName}
hive msg send hive-tech-lead "Your question" --from ${sessionName}
\`\`\`

Check for replies:
\`\`\`bash
hive msg outbox ${sessionName}
\`\`\`

## Guidelines
- Follow existing patterns exactly
- Ask questions if requirements are unclear
- Test thoroughly before submitting
- Keep changes small and focused

## IMPORTANT: Autonomous Workflow
You are an autonomous agent. DO NOT ask "Is there anything else?" or wait for instructions.
After completing a story:
1. Run \`hive my-stories ${sessionName}\` to get your next assignment
2. If no stories assigned, run \`hive my-stories ${sessionName} --all\` to see available work
3. Claim available work with \`hive my-stories claim <story-id> --session ${sessionName}\`
4. ALWAYS submit PRs to hive after creating them on GitHub:
   \`hive pr submit -b <branch> -s <story-id> --pr-url <github-url> --from ${sessionName}\`

Start by exploring the codebase to understand how things work, then run \`hive my-stories ${sessionName}\` to see your assignments.`;
}

function generateQAPrompt(teamName: string, repoUrl: string, repoPath: string, sessionName: string): string {
  return `You are a QA Engineer on Team ${teamName}.
Your tmux session: ${sessionName}

## Your Repository
- Local path: ${repoPath}
- Remote: ${repoUrl}

## Your Responsibilities
1. Review PRs in the merge queue
2. Check for merge conflicts
3. Run tests and verify functionality
4. Check code quality and standards
5. Approve and merge good PRs
6. Reject PRs that need fixes

## Merge Queue Workflow

### Check the merge queue:
\`\`\`bash
hive pr queue
\`\`\`

### Claim the next PR for review:
\`\`\`bash
hive pr review --from ${sessionName}
\`\`\`

### View PR details:
\`\`\`bash
hive pr show <pr-id>
\`\`\`

### After reviewing:

**If the PR is good - approve and merge:**
\`\`\`bash
# First, merge via GitHub CLI
gh pr merge <pr-number> --merge

# Then mark as merged in Hive
hive pr approve <pr-id> --from ${sessionName}
\`\`\`

**If the PR has issues - reject with feedback:**
\`\`\`bash
hive pr reject <pr-id> --reason "Description of issues" --from ${sessionName}

# Notify the developer
hive msg send <developer-session> "Your PR was rejected: <reason>" --from ${sessionName}
\`\`\`

## Review Checklist
For each PR, verify:
1. **No merge conflicts** - Check with \`git fetch && git merge --no-commit origin/main\`
2. **Tests pass** - Run the project's test suite
3. **Code quality** - Check for code standards, no obvious bugs
4. **Functionality** - Test that the changes work as expected
5. **Story requirements** - Verify acceptance criteria are met

## Communication
If you need clarification from a developer:
\`\`\`bash
hive msg send <developer-session> "Your question" --from ${sessionName}
\`\`\`

Check for replies:
\`\`\`bash
hive msg outbox ${sessionName}
\`\`\`

## Guidelines
- Review PRs in queue order (first in, first out)
- Be thorough but efficient
- Provide clear feedback when rejecting
- Ensure main branch stays stable

Start by running \`hive pr queue\` to see PRs waiting for review.`;
}
