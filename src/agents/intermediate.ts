import { BaseAgent, type AgentContext } from './base-agent.js';
import { getTeamById, type TeamRow } from '../db/queries/teams.js';
import { updateStory, getStoryById, type StoryRow } from '../db/queries/stories.js';
import { getAgentsByTeam } from '../db/queries/agents.js';
import { createEscalation } from '../db/queries/escalations.js';

export interface IntermediateContext extends AgentContext {
  storyId?: string;
}

export class IntermediateAgent extends BaseAgent {
  private team: TeamRow | null = null;
  private story: StoryRow | null = null;
  private retryCount = 0;

  constructor(context: IntermediateContext) {
    super(context);
    if (context.agentRow.team_id) {
      this.team = getTeamById(this.db, context.agentRow.team_id) || null;
    }
    if (context.storyId) {
      this.story = getStoryById(this.db, context.storyId) || null;
    } else if (context.agentRow.current_story_id) {
      this.story = getStoryById(this.db, context.agentRow.current_story_id) || null;
    }
  }

  getSystemPrompt(): string {
    const teamInfo = this.team
      ? `Team: ${this.team.name}\nRepository: ${this.team.repo_path}`
      : 'No team assigned';

    const storyInfo = this.story
      ? `Current Story: ${this.story.id}\nTitle: ${this.story.title}\nStatus: ${this.story.status}`
      : 'No story assigned';

    return `You are an Intermediate Developer working on assigned stories.

## Your Team
${teamInfo}

## Assignment
${storyInfo}

## Your Responsibilities
1. Implement assigned stories with moderate complexity (4-5 points)
2. Follow existing code patterns and conventions
3. Write tests for your code
4. Create clear commit messages
5. Request help from Senior when stuck

## Development Guidelines
- Work on the feature branch assigned to the story
- Follow TDD when possible
- Commit frequently with descriptive messages
- Update progress regularly
- Escalate after 2 failed attempts
- If you discover out-of-scope fixes, create a refactor follow-up story from your current analysis context and continue this story

## Current Context
${this.memoryState.conversationSummary || 'Starting fresh.'}`;
  }

  async execute(): Promise<void> {
    if (!this.story) {
      this.log('STORY_PROGRESS_UPDATE', 'No story assigned, waiting');
      return;
    }

    this.setCurrentTask(this.story.id, 'implementation');
    this.log('STORY_STARTED', `Working on: ${this.story.title}`, { storyId: this.story.id });

    try {
      await this.implementStory();
    } catch (err) {
      this.retryCount++;
      if (this.retryCount >= this.config.maxRetries) {
        await this.escalateToSenior(`Failed after ${this.retryCount} attempts: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } else {
        this.log('STORY_PROGRESS_UPDATE', `Retry ${this.retryCount}: ${err instanceof Error ? err.message : 'Unknown error'}`, {
          storyId: this.story.id,
        });
        // Retry
        await this.execute();
      }
    }
  }

  private async implementStory(): Promise<void> {
    if (!this.story) return;

    const branchName = this.story.branch_name ||
      `feature/${this.story.id.toLowerCase()}-${this.story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30)}`;

    // Update story with branch name if not set
    if (!this.story.branch_name) {
      updateStory(this.db, this.story.id, { branchName });
    }

    const prompt = `Implement this story:

## Story: ${this.story.id}
**Title:** ${this.story.title}

**Description:**
${this.story.description}

**Acceptance Criteria:**
${this.story.acceptance_criteria ? JSON.parse(this.story.acceptance_criteria).join('\n- ') : 'None specified'}

**Branch:** ${branchName}

## Instructions
1. Checkout or create the feature branch
2. Read the relevant files to understand the context
3. Implement the required changes
4. Write tests
5. Commit with clear messages
6. For useful fixes outside this story, create a separate refactor story using this same code-reading context
7. Update me on progress

Begin implementation.`;

    const response = await this.chat(prompt);
    this.updateTaskProgress('Implementation in progress', []);
    this.log('STORY_PROGRESS_UPDATE', response.substring(0, 200), { storyId: this.story.id });

    // Continue implementation (simplified - in reality this would be iterative)
    const continuePrompt = 'Continue with the implementation. Show me the code changes you would make.';
    await this.chat(continuePrompt);
    this.log('STORY_PROGRESS_UPDATE', 'Code changes proposed', { storyId: this.story.id });

    // Mark as complete
    updateStory(this.db, this.story.id, { status: 'review' });
    this.log('STORY_COMPLETED', 'Implementation complete, ready for review', {
      storyId: this.story.id,
      branchName,
    });
  }

  private async escalateToSenior(reason: string): Promise<void> {
    // Find Senior for this team
    const seniors = getAgentsByTeam(this.db, this.teamId!)
      .filter(a => a.type === 'senior' && a.status !== 'terminated');

    const seniorId = seniors[0]?.id;

    const escalation = createEscalation(this.db, {
      storyId: this.story?.id,
      fromAgentId: this.agentId,
      toAgentId: seniorId,
      reason,
    });

    this.log('ESCALATION_CREATED', reason, {
      escalationId: escalation.id,
      toAgent: seniorId,
    });

    this.updateStatus('blocked');
    this.addBlocker(`Escalated to Senior: ${reason}`);
  }
}
