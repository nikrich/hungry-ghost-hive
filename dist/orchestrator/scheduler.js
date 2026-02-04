import { getPlannedStories, updateStory, getStoryPointsByTeam } from '../db/queries/stories.js';
import { getAgentsByTeam, getAgentById, createAgent, updateAgent } from '../db/queries/agents.js';
import { getTeamById, getAllTeams } from '../db/queries/teams.js';
import { queryOne } from '../db/client.js';
import { createLog } from '../db/queries/logs.js';
import { spawnTmuxSession, generateSessionName, isTmuxSessionRunning } from '../tmux/manager.js';
export class Scheduler {
    db;
    config;
    constructor(db, config) {
        this.db = db;
        this.config = config;
    }
    /**
     * Assign planned stories to available agents
     */
    async assignStories() {
        const plannedStories = getPlannedStories(this.db);
        const errors = [];
        let assigned = 0;
        // Group stories by team
        const storiesByTeam = new Map();
        for (const story of plannedStories) {
            if (!story.team_id)
                continue;
            const existing = storiesByTeam.get(story.team_id) || [];
            existing.push(story);
            storiesByTeam.set(story.team_id, existing);
        }
        // Process each team
        for (const [teamId, stories] of storiesByTeam) {
            const team = getTeamById(this.db, teamId);
            if (!team)
                continue;
            // Get available agents for this team
            const agents = getAgentsByTeam(this.db, teamId)
                .filter(a => a.status === 'idle' && a.type !== 'qa');
            // Find or create a Senior for delegation
            let senior = agents.find(a => a.type === 'senior');
            if (!senior) {
                try {
                    senior = await this.spawnSenior(teamId, team.name, team.repo_path);
                }
                catch (err) {
                    errors.push(`Failed to spawn Senior for team ${team.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    continue;
                }
            }
            // Assign stories based on complexity
            for (const story of stories) {
                const complexity = story.complexity_score || 5;
                let targetAgent;
                if (complexity <= this.config.scaling.junior_max_complexity) {
                    // Assign to Junior
                    targetAgent = agents.find(a => a.type === 'junior' && a.status === 'idle');
                    if (!targetAgent) {
                        try {
                            targetAgent = await this.spawnJunior(teamId, team.name, team.repo_path);
                        }
                        catch {
                            // Fall back to Intermediate or Senior
                            targetAgent = agents.find(a => a.type === 'intermediate' && a.status === 'idle') || senior;
                        }
                    }
                }
                else if (complexity <= this.config.scaling.intermediate_max_complexity) {
                    // Assign to Intermediate
                    targetAgent = agents.find(a => a.type === 'intermediate' && a.status === 'idle');
                    if (!targetAgent) {
                        try {
                            targetAgent = await this.spawnIntermediate(teamId, team.name, team.repo_path);
                        }
                        catch {
                            // Fall back to Senior
                            targetAgent = senior;
                        }
                    }
                }
                else {
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
    getNextStoryForAgent(agentId) {
        const agent = getAgentById(this.db, agentId);
        if (!agent || !agent.team_id)
            return null;
        // Find an unassigned planned story for this team
        const story = queryOne(this.db, `
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
    async checkScaling() {
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
                    }
                    catch {
                        // Log error but continue
                    }
                }
            }
        }
    }
    async spawnSenior(teamId, teamName, repoPath, index) {
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
    async spawnIntermediate(teamId, teamName, repoPath) {
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
    async spawnJunior(teamId, teamName, repoPath) {
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
//# sourceMappingURL=scheduler.js.map