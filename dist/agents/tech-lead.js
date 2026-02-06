import { BaseAgent } from './base-agent.js';
import { getAllTeams } from '../db/queries/teams.js';
import { getRequirementById, updateRequirement } from '../db/queries/requirements.js';
import { createStory, updateStory, getStoryById } from '../db/queries/stories.js';
import { createAgent, getAgentsByType, updateAgent } from '../db/queries/agents.js';
import { createEscalation } from '../db/queries/escalations.js';
import { spawnTmuxSession, generateSessionName } from '../tmux/manager.js';
import { queryAll } from '../db/client.js';
import { addStoryDependency } from '../db/queries/stories.js';
import { loadConfig } from '../config/index.js';
import { getCliRuntimeBuilder } from '../cli-runtimes/index.js';
import { findHiveRoot, getHivePaths } from '../utils/paths.js';
export class TechLeadAgent extends BaseAgent {
    teams = [];
    requirementId;
    requirement;
    constructor(context) {
        super(context);
        this.requirementId = context.requirementId;
        this.teams = getAllTeams(this.db);
        if (this.requirementId) {
            this.requirement = getRequirementById(this.db, this.requirementId);
        }
    }
    getSystemPrompt() {
        const teamList = this.teams
            .map(t => `- ${t.name} (${t.repo_path}): ${t.repo_url}`)
            .join('\n');
        return `You are the Tech Lead of Hive, an AI development team orchestrator.

## Your Role
You coordinate multiple autonomous teams, each responsible for a specific service/repository. You are the strategic decision maker who:
1. Analyzes requirements and breaks them into implementable stories
2. Identifies affected teams and cross-repo dependencies
3. Coordinates with Senior developers for estimation and planning
4. Manages escalations from teams
5. Ensures consistent progress across all teams

## Teams Under Your Coordination
${teamList || 'No teams configured yet.'}

## Current Context
${this.memoryState.conversationSummary || 'Starting fresh.'}

## Guidelines
- Break down requirements into atomic, testable stories
- Each story should have clear acceptance criteria
- Identify dependencies between stories across repos
- Estimate complexity using Fibonacci scale (1, 2, 3, 5, 8, 13)
- Delegate appropriately:
  - 1-3 points: Junior can handle
  - 4-5 points: Intermediate level
  - 6+ points: Senior should handle directly

## Communication
You communicate via this conversation. Log important decisions and progress updates.
When you need to spawn Senior agents for team-specific work, describe what you need and I'll help coordinate.

## Escalation Protocol
Escalate to human (me) only for:
- Ambiguous requirements that need clarification
- Architectural decisions with significant trade-offs
- Security concerns
- External dependency blockers`;
    }
    async execute() {
        if (!this.requirement) {
            this.log('PLANNING_STARTED', 'Tech Lead ready, waiting for requirement');
            return;
        }
        this.log('PLANNING_STARTED', `Analyzing requirement: ${this.requirement.title}`);
        // Analyze the requirement
        const analysis = await this.analyzeRequirement();
        // If we need human input, escalate
        if (analysis.needsHumanInput) {
            await this.escalateToHuman(analysis.escalationReason || 'Clarification needed');
            return;
        }
        // Create stories based on analysis
        const stories = await this.createStories(analysis);
        // Spawn Seniors to estimate and potentially begin work
        await this.coordinateWithSeniors(stories);
        // Update requirement status
        updateRequirement(this.db, this.requirement.id, { status: 'planned' });
        this.log('PLANNING_COMPLETED', `Created ${stories.length} stories`);
    }
    async analyzeRequirement() {
        const prompt = `Analyze this requirement and create a plan:

## Requirement
Title: ${this.requirement.title}

Description:
${this.requirement.description}

## Available Teams
${this.teams.map(t => `- ${t.name}: ${t.repo_path}`).join('\n')}

## Instructions
1. Identify which teams are affected
2. Break down into atomic stories (each completable in a single session)
3. For each story provide:
   - Title (concise, action-oriented)
   - Description (what needs to be done)
   - Acceptance criteria (testable conditions)
   - Team assignment
   - Estimated complexity (1-13 Fibonacci)
   - Dependencies on other stories (if any)
4. If anything is unclear, indicate that human input is needed

Respond in JSON format:
{
  "affectedTeams": ["team-name"],
  "stories": [
    {
      "title": "...",
      "description": "...",
      "acceptanceCriteria": ["..."],
      "teamName": "...",
      "estimatedComplexity": 3,
      "dependencies": []
    }
  ],
  "needsHumanInput": false,
  "escalationReason": null
}`;
        const response = await this.chat(prompt);
        // Parse the JSON response
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        }
        catch {
            // If parsing fails, request clarification
        }
        return {
            affectedTeams: [],
            stories: [],
            needsHumanInput: true,
            escalationReason: 'Could not parse requirement analysis. Please review and clarify.',
        };
    }
    async createStories(analysis) {
        const storyIds = [];
        const storyIdMap = {};
        for (const story of analysis.stories) {
            const team = this.teams.find(t => t.name === story.teamName);
            const storyRow = createStory(this.db, {
                requirementId: this.requirement.id,
                teamId: team?.id,
                title: story.title,
                description: story.description,
                acceptanceCriteria: story.acceptanceCriteria,
            });
            // Update with complexity
            updateStory(this.db, storyRow.id, {
                complexityScore: story.estimatedComplexity,
                storyPoints: story.estimatedComplexity,
                status: 'estimated',
            });
            storyIds.push(storyRow.id);
            storyIdMap[story.title] = storyRow.id;
            this.log('STORY_CREATED', story.title, {
                storyId: storyRow.id,
                teamId: team?.id,
                complexity: story.estimatedComplexity,
            });
        }
        // Set up dependencies
        for (const story of analysis.stories) {
            if (story.dependencies && story.dependencies.length > 0) {
                const storyId = storyIdMap[story.title];
                for (const depTitle of story.dependencies) {
                    const depId = storyIdMap[depTitle];
                    if (depId) {
                        addStoryDependency(this.db, storyId, depId);
                    }
                }
            }
        }
        return storyIds;
    }
    async coordinateWithSeniors(storyIds) {
        // Get unique teams from stories
        const teamIds = new Set();
        for (const storyId of storyIds) {
            const story = getStoryById(this.db, storyId);
            if (story?.team_id) {
                teamIds.add(story.team_id);
            }
        }
        // Spawn or assign Senior for each team
        for (const teamId of teamIds) {
            const team = this.teams.find(t => t.id === teamId);
            if (!team)
                continue;
            // Check if Senior already exists for this team
            let seniors = getAgentsByType(this.db, 'senior').filter(s => s.team_id === teamId);
            if (seniors.length === 0) {
                // Create a new Senior agent
                const senior = createAgent(this.db, {
                    type: 'senior',
                    teamId,
                });
                seniors = [senior];
                // Spawn tmux session for the Senior
                const sessionName = generateSessionName('senior', team.name);
                try {
                    // Load config and get CLI runtime settings for the senior agent type
                    const hiveRoot = findHiveRoot(this.workDir);
                    if (!hiveRoot) {
                        throw new Error('Hive root not found');
                    }
                    const paths = getHivePaths(hiveRoot);
                    const config = loadConfig(paths.hiveDir);
                    const agentConfig = config.models.senior;
                    const cliTool = agentConfig.cli_tool;
                    const model = agentConfig.model;
                    // Build spawn command using CLI runtime builder (spawn fresh session, will be resumed later)
                    const runtimeBuilder = getCliRuntimeBuilder(cliTool);
                    const commandArray = runtimeBuilder.buildSpawnCommand(model);
                    const command = commandArray.join(' ');
                    await spawnTmuxSession({
                        sessionName,
                        workDir: `${this.workDir}/${team.repo_path}`,
                        command,
                    });
                    updateAgent(this.db, senior.id, {
                        tmuxSession: sessionName,
                        status: 'working',
                    });
                    this.log('AGENT_SPAWNED', `Senior spawned for team ${team.name}`, {
                        agentId: senior.id,
                        teamId,
                        tmuxSession: sessionName,
                    });
                }
                catch (err) {
                    this.log('AGENT_SPAWNED', `Failed to spawn Senior tmux session: ${err instanceof Error ? err.message : 'Unknown error'}`, {
                        agentId: senior.id,
                        teamId,
                    });
                }
            }
            // Assign stories to the Senior
            const teamStories = queryAll(this.db, `
        SELECT id FROM stories WHERE team_id = ? AND status = 'estimated'
      `, [teamId]);
            for (const story of teamStories) {
                updateStory(this.db, story.id, { status: 'planned' });
                this.log('STORY_ASSIGNED', `Story ${story.id} assigned to team ${team.name}`, {
                    storyId: story.id,
                    teamId,
                });
            }
        }
    }
    async escalateToHuman(reason) {
        const escalation = createEscalation(this.db, {
            storyId: null,
            fromAgentId: this.agentId,
            toAgentId: null, // null = human
            reason,
        });
        this.log('ESCALATION_CREATED', reason, {
            escalationId: escalation.id,
        });
        this.updateStatus('blocked');
        this.addBlocker(`Waiting for human input: ${reason}`);
    }
}
//# sourceMappingURL=tech-lead.js.map