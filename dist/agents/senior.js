import { BaseAgent } from './base-agent.js';
import { getTeamById } from '../db/queries/teams.js';
import { getStoriesByTeam, updateStory } from '../db/queries/stories.js';
import { createAgent, updateAgent, getTechLead } from '../db/queries/agents.js';
import { createEscalation } from '../db/queries/escalations.js';
import { spawnTmuxSession, generateSessionName } from '../tmux/manager.js';
export class SeniorAgent extends BaseAgent {
    team = null;
    assignedStories = [];
    constructor(context) {
        super(context);
        if (context.teamId) {
            this.team = getTeamById(this.db, context.teamId) || null;
            this.assignedStories = getStoriesByTeam(this.db, context.teamId)
                .filter(s => ['planned', 'in_progress', 'review'].includes(s.status));
        }
    }
    getSystemPrompt() {
        const teamInfo = this.team
            ? `Team: ${this.team.name}\nRepository: ${this.team.repo_url}\nPath: ${this.team.repo_path}`
            : 'No team assigned';
        const storiesInfo = this.assignedStories.length > 0
            ? this.assignedStories.map(s => `- ${s.id}: ${s.title} (${s.status}, complexity: ${s.complexity_score})`).join('\n')
            : 'No stories assigned';
        return `You are a Senior Developer responsible for a specific team and repository.

## Your Team
${teamInfo}

## Assigned Stories
${storiesInfo}

## Your Responsibilities
1. Conduct codebase analysis when requested
2. Estimate story complexity accurately
3. Delegate work based on complexity:
   - 1-3 points → Delegate to Junior
   - 4-5 points → Delegate to Intermediate
   - 6+ points → Handle directly
4. Review code from delegated work
5. Handle complex implementations
6. Escalate blockers to Tech Lead

## Development Guidelines
- Create feature branches: feature/{story-id}-{slug}
- Write clean, tested code following existing patterns
- Update story status as you progress
- Commit frequently with clear messages
- If stuck after 2 attempts, escalate

## Current Context
${this.memoryState.conversationSummary || 'Starting fresh.'}`;
    }
    async execute() {
        if (!this.team) {
            this.log('CODEBASE_SWEEP_STARTED', 'No team assigned, waiting for assignment');
            return;
        }
        this.log('CODEBASE_SWEEP_STARTED', `Analyzing codebase for ${this.team.name}`);
        // Perform codebase sweep
        await this.analyzeCodebase();
        // Process assigned stories
        for (const story of this.assignedStories) {
            if (story.status === 'planned') {
                await this.processStory(story);
            }
            else if (story.status === 'review') {
                await this.reviewStory(story);
            }
        }
    }
    async analyzeCodebase() {
        const prompt = `Analyze the codebase structure for this repository.

Working directory: ${this.workDir}

Please identify:
1. Main technology stack
2. Key directories and their purposes
3. Coding patterns and conventions used
4. Testing setup
5. Build/deployment configuration

This will help with story estimation and implementation.`;
        const analysis = await this.chat(prompt);
        this.memoryState.context.codebaseNotes = analysis;
        this.saveMemoryState();
        this.log('CODEBASE_SWEEP_COMPLETED', 'Codebase analysis complete', {
            summary: analysis.substring(0, 200),
        });
    }
    async processStory(story) {
        const complexity = story.complexity_score || 5;
        this.setCurrentTask(story.id, 'processing');
        this.log('STORY_STARTED', `Processing story: ${story.title}`, { storyId: story.id });
        if (complexity <= 3) {
            // Delegate to Junior
            await this.delegateStory(story, 'junior');
        }
        else if (complexity <= 5) {
            // Delegate to Intermediate
            await this.delegateStory(story, 'intermediate');
        }
        else {
            // Handle directly
            await this.implementStory(story);
        }
    }
    async delegateStory(story, agentType) {
        this.log('STORY_ASSIGNED', `Delegating to ${agentType}`, {
            storyId: story.id,
            agentType,
        });
        // Create subordinate agent
        const subordinate = createAgent(this.db, {
            type: agentType,
            teamId: this.teamId,
        });
        // Spawn tmux session
        const sessionName = generateSessionName(agentType, this.team?.name);
        try {
            await spawnTmuxSession({
                sessionName,
                workDir: this.workDir,
                command: `claude --resume ${sessionName}`,
            });
            updateAgent(this.db, subordinate.id, {
                tmuxSession: sessionName,
                status: 'working',
                currentStoryId: story.id,
            });
            // Update story assignment
            updateStory(this.db, story.id, {
                assignedAgentId: subordinate.id,
                status: 'in_progress',
            });
            this.log('AGENT_SPAWNED', `${agentType} spawned for story ${story.id}`, {
                agentId: subordinate.id,
                storyId: story.id,
            });
        }
        catch (err) {
            // If delegation fails, handle it ourselves
            this.log('STORY_PROGRESS_UPDATE', `Failed to delegate, handling directly: ${err instanceof Error ? err.message : 'Unknown error'}`, {
                storyId: story.id,
            });
            await this.implementStory(story);
        }
    }
    async implementStory(story) {
        // Update assignment
        updateStory(this.db, story.id, {
            assignedAgentId: this.agentId,
            status: 'in_progress',
        });
        updateAgent(this.db, this.agentId, { currentStoryId: story.id });
        // Create feature branch
        const branchName = `feature/${story.id.toLowerCase()}-${story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30)}`;
        this.log('STORY_STARTED', `Implementing: ${story.title}`, { branchName });
        const prompt = `Implement this story:

## Story: ${story.id}
**Title:** ${story.title}

**Description:**
${story.description}

**Acceptance Criteria:**
${story.acceptance_criteria ? JSON.parse(story.acceptance_criteria).join('\n- ') : 'None specified'}

## Instructions
1. First, create a feature branch: ${branchName}
2. Analyze the codebase to understand where changes need to be made
3. Implement the changes following existing patterns
4. Write/update tests as needed
5. Commit your changes with clear messages
6. Report when complete

Let me know when you're ready to proceed or if you have questions.`;
        const response = await this.chat(prompt);
        this.updateTaskProgress('Implementation started', []);
        // Continue the conversation to complete implementation
        // In a real scenario, this would be an iterative process
        this.log('STORY_PROGRESS_UPDATE', response.substring(0, 200), { storyId: story.id });
        // Mark for review when done (simplified)
        updateStory(this.db, story.id, {
            branchName,
            status: 'review',
        });
        this.log('STORY_COMPLETED', `Implementation complete, ready for review`, {
            storyId: story.id,
            branchName,
        });
    }
    async reviewStory(story) {
        if (story.assigned_agent_id === this.agentId) {
            // Self-review, move to QA
            updateStory(this.db, story.id, { status: 'qa' });
            this.log('STORY_REVIEW_REQUESTED', 'Self-implemented, moving to QA', { storyId: story.id });
            return;
        }
        this.log('STORY_REVIEW_REQUESTED', `Reviewing story: ${story.title}`, { storyId: story.id });
        const prompt = `Review the code for this story:

## Story: ${story.id}
**Title:** ${story.title}
**Branch:** ${story.branch_name}

Please review:
1. Code quality and adherence to patterns
2. Test coverage
3. Potential bugs or issues
4. Performance considerations

If issues found, describe them. If approved, confirm.`;
        const review = await this.chat(prompt);
        // Parse review result (simplified)
        const hasIssues = review.toLowerCase().includes('issue') ||
            review.toLowerCase().includes('problem') ||
            review.toLowerCase().includes('fix');
        if (hasIssues) {
            // Send back for fixes
            updateStory(this.db, story.id, { status: 'in_progress' });
            this.log('STORY_PROGRESS_UPDATE', 'Review issues found, sent back for fixes', {
                storyId: story.id,
                review: review.substring(0, 200),
            });
        }
        else {
            // Approve and move to QA
            updateStory(this.db, story.id, { status: 'qa' });
            this.log('STORY_REVIEW_REQUESTED', 'Review passed, moving to QA', { storyId: story.id });
        }
    }
    async escalateToTechLead(reason) {
        const techLead = getTechLead(this.db);
        const escalation = createEscalation(this.db, {
            storyId: this.memoryState.currentTask?.storyId,
            fromAgentId: this.agentId,
            toAgentId: techLead?.id,
            reason,
        });
        this.log('ESCALATION_CREATED', reason, {
            escalationId: escalation.id,
        });
        this.updateStatus('blocked');
        this.addBlocker(`Escalated to Tech Lead: ${reason}`);
    }
}
//# sourceMappingURL=senior.js.map