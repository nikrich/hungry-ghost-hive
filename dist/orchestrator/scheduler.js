import { getPlannedStories, updateStory, getStoryPointsByTeam } from '../db/queries/stories.js';
import { getAgentsByTeam, getAgentById, createAgent, updateAgent } from '../db/queries/agents.js';
import { getTeamById, getAllTeams } from '../db/queries/teams.js';
import { queryOne, queryAll } from '../db/client.js';
import { createLog } from '../db/queries/logs.js';
import { spawnTmuxSession, generateSessionName, isTmuxSessionRunning, sendToTmuxSession } from '../tmux/manager.js';
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
            model: 'sonnet',
        });
        const sessionName = generateSessionName('senior', teamName, index);
        const workDir = `${this.config.rootDir}/${repoPath}`;
        if (!await isTmuxSessionRunning(sessionName)) {
            await spawnTmuxSession({
                sessionName,
                workDir,
                command: `claude --dangerously-skip-permissions --model sonnet`,
            });
            // Wait for Claude to start, then send prompt
            await new Promise(resolve => setTimeout(resolve, 5000));
            const team = getTeamById(this.db, teamId);
            const stories = this.getTeamStories(teamId);
            const prompt = generateSeniorPrompt(teamName, team?.repo_url || '', repoPath, stories);
            await sendToTmuxSession(sessionName, prompt);
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
            model: 'haiku',
        });
        const sessionName = generateSessionName('intermediate', teamName, index);
        const workDir = `${this.config.rootDir}/${repoPath}`;
        if (!await isTmuxSessionRunning(sessionName)) {
            await spawnTmuxSession({
                sessionName,
                workDir,
                command: `claude --dangerously-skip-permissions --model haiku`,
            });
            // Wait for Claude to start, then send prompt
            await new Promise(resolve => setTimeout(resolve, 5000));
            const team = getTeamById(this.db, teamId);
            const prompt = generateIntermediatePrompt(teamName, team?.repo_url || '', repoPath, sessionName);
            await sendToTmuxSession(sessionName, prompt);
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
            model: 'haiku',
        });
        const sessionName = generateSessionName('junior', teamName, index);
        const workDir = `${this.config.rootDir}/${repoPath}`;
        if (!await isTmuxSessionRunning(sessionName)) {
            // Note: Spec calls for gpt-4o-mini but using haiku until OpenAI integration is added
            await spawnTmuxSession({
                sessionName,
                workDir,
                command: `claude --dangerously-skip-permissions --model haiku`,
            });
            // Wait for Claude to start, then send prompt
            await new Promise(resolve => setTimeout(resolve, 5000));
            const team = getTeamById(this.db, teamId);
            const prompt = generateJuniorPrompt(teamName, team?.repo_url || '', repoPath, sessionName);
            await sendToTmuxSession(sessionName, prompt);
        }
        updateAgent(this.db, agent.id, {
            tmuxSession: sessionName,
            status: 'idle',
        });
        return agent;
    }
    getTeamStories(teamId) {
        return queryAll(this.db, `
      SELECT * FROM stories
      WHERE team_id = ? AND status IN ('planned', 'estimated')
      ORDER BY complexity_score DESC
    `, [teamId]);
    }
}
// Prompt generation functions
function generateSeniorPrompt(teamName, repoUrl, repoPath, stories) {
    const storyList = stories.map(s => `- [${s.id}] ${s.title} (complexity: ${s.complexity_score || '?'})\n  ${s.description}`).join('\n\n');
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
6. Run \`hive my-stories complete <story-id>\` to mark done
7. Create a PR using \`gh pr create\`

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

Start by exploring the codebase to understand its structure, then begin working on the highest priority story.`;
}
function generateIntermediatePrompt(teamName, repoUrl, repoPath, sessionName) {
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
2. Create a feature branch for your work
3. Implement the changes
4. Run tests and linting
5. Run \`hive my-stories complete <story-id>\` when done
6. Commit and create a PR

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

Start by exploring the codebase, then check the stories table for your assignments.`;
}
function generateJuniorPrompt(teamName, repoUrl, repoPath, sessionName) {
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
2. Create a feature branch for your work
3. Implement the changes carefully
4. Run tests before committing
5. Run \`hive my-stories complete <story-id>\` when done
6. Create a PR for review

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

Start by exploring the codebase to understand how things work, then run \`hive my-stories ${sessionName}\` to see your assignments.`;
}
//# sourceMappingURL=scheduler.js.map