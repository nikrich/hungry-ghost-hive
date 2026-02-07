import { getTechLead, updateAgent } from '../db/queries/agents.js';
import { createEscalation } from '../db/queries/escalations.js';
import { getStoriesByTeam, updateStory, type StoryRow } from '../db/queries/stories.js';
import { getTeamById, type TeamRow } from '../db/queries/teams.js';
import { BaseAgent, type AgentContext } from './base-agent.js';

export interface SeniorContext extends AgentContext {
  teamId: string;
}

export class SeniorAgent extends BaseAgent {
  private team: TeamRow | null = null;
  private assignedStories: StoryRow[] = [];

  constructor(context: SeniorContext) {
    super(context);
    if (context.teamId) {
      this.team = getTeamById(this.db, context.teamId) || null;
      this.assignedStories = getStoriesByTeam(this.db, context.teamId).filter(s =>
        ['planned', 'in_progress', 'review'].includes(s.status)
      );
    }
  }

  getSystemPrompt(): string {
    const teamInfo = this.team
      ? `Team: ${this.team.name}\nRepository: ${this.team.repo_url}\nPath: ${this.team.repo_path}`
      : 'No team assigned';

    const storiesInfo =
      this.assignedStories.length > 0
        ? this.assignedStories
            .map(s => `- ${s.id}: ${s.title} (${s.status}, complexity: ${s.complexity_score})`)
            .join('\n')
        : 'No stories assigned';

    return `You are a Senior Developer responsible for a specific team and repository.

## Your Team
${teamInfo}

## Assigned Stories
${storiesInfo}

## Your Responsibilities
1. Conduct codebase analysis when requested
2. Estimate story complexity accurately
3. Implement assigned stories directly
4. Handle complex implementations
5. Escalate blockers to Tech Lead

## Development Guidelines
- Create feature branches: feature/{story-id}-{slug}
- Write clean, tested code following existing patterns
- Update story status as you progress
- Commit frequently with clear messages
- If stuck after 2 attempts, escalate
- If you discover an out-of-scope fix while implementing, create a refactor follow-up story using the context you already gathered, then continue the assigned story

## Current Context
${this.memoryState.conversationSummary || 'Starting fresh.'}`;
  }

  async execute(): Promise<void> {
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
      } else if (story.status === 'review') {
        await this.reviewStory(story);
      }
    }
  }

  private async analyzeCodebase(): Promise<void> {
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

  private async processStory(story: StoryRow): Promise<void> {
    this.setCurrentTask(story.id, 'processing');
    this.log('STORY_STARTED', `Processing story: ${story.title}`, { storyId: story.id });

    // Implement all stories directly - the Scheduler handles routing to appropriate agents
    await this.implementStory(story);
  }

  private async implementStory(story: StoryRow): Promise<void> {
    // Update assignment
    updateStory(this.db, story.id, {
      assignedAgentId: this.agentId,
      status: 'in_progress',
    });
    updateAgent(this.db, this.agentId, { currentStoryId: story.id });

    // Create feature branch
    const branchName = `feature/${story.id.toLowerCase()}-${story.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .substring(0, 30)}`;

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
6. If you discover useful but out-of-scope fixes, create a separate refactor story from this analysis context instead of widening this story
7. Report when complete

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

  private async reviewStory(story: StoryRow): Promise<void> {
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
    const hasIssues =
      review.toLowerCase().includes('issue') ||
      review.toLowerCase().includes('problem') ||
      review.toLowerCase().includes('fix');

    if (hasIssues) {
      // Send back for fixes
      updateStory(this.db, story.id, { status: 'in_progress' });
      this.log('STORY_PROGRESS_UPDATE', 'Review issues found, sent back for fixes', {
        storyId: story.id,
        review: review.substring(0, 200),
      });
    } else {
      // Approve and move to QA
      updateStory(this.db, story.id, { status: 'qa' });
      this.log('STORY_REVIEW_REQUESTED', 'Review passed, moving to QA', { storyId: story.id });
    }
  }

  async escalateToTechLead(reason: string): Promise<void> {
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
