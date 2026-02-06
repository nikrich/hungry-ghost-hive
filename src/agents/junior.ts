import { getAgentsByTeam } from '../db/queries/agents.js';
import { createEscalation } from '../db/queries/escalations.js';
import { getStoryById, updateStory, type StoryRow } from '../db/queries/stories.js';
import { getTeamById, type TeamRow } from '../db/queries/teams.js';
import { BaseAgent, type AgentContext } from './base-agent.js';

export interface JuniorContext extends AgentContext {
  storyId?: string;
}

export class JuniorAgent extends BaseAgent {
  private team: TeamRow | null = null;
  private story: StoryRow | null = null;
  private retryCount = 0;

  constructor(context: JuniorContext) {
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

    return `You are a Junior Developer working on simple, well-defined stories.

## Your Team
${teamInfo}

## Assignment
${storyInfo}

## Your Responsibilities
1. Implement simple stories (1-3 complexity points)
2. Follow coding patterns exactly as shown in the codebase
3. Write basic tests
4. Ask questions when unsure
5. Escalate to Senior quickly if stuck

## Development Guidelines
- Always read existing code before making changes
- Match the coding style exactly
- Keep changes minimal and focused
- Commit small, atomic changes
- Ask for help early rather than struggling

## Important
- You should NOT make architectural decisions
- You should NOT refactor unrelated code
- You should ask for clarification rather than guessing
- Escalate any blockers to Senior immediately
- If you spot a useful fix outside this story, create a separate refactor follow-up story from your current analysis context

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
      // Juniors escalate after just 1 retry
      if (this.retryCount >= 1) {
        await this.escalateToSenior(
          `Encountered error: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      } else {
        this.log(
          'STORY_PROGRESS_UPDATE',
          `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          {
            storyId: this.story.id,
          }
        );
        await this.execute();
      }
    }
  }

  private async implementStory(): Promise<void> {
    if (!this.story) return;

    const branchName =
      this.story.branch_name ||
      `feature/${this.story.id.toLowerCase()}-${this.story.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .substring(0, 30)}`;

    if (!this.story.branch_name) {
      updateStory(this.db, this.story.id, { branchName });
    }

    const prompt = `I need to implement this simple story:

## Story: ${this.story.id}
**Title:** ${this.story.title}

**Description:**
${this.story.description}

**Acceptance Criteria:**
${this.story.acceptance_criteria ? JSON.parse(this.story.acceptance_criteria).join('\n- ') : 'None specified'}

**Branch:** ${branchName}

This is a simple task (complexity ${this.story.complexity_score || 1}-3).

## My Approach
1. First, I'll read the relevant files
2. Make the minimal required changes
3. Follow the existing patterns exactly
4. Write a simple test if applicable
5. If I find useful out-of-scope fixes, I'll create a separate refactor story from this same analysis
6. Commit the changes

Please help me identify which files I need to read and modify.`;

    await this.chat(prompt);
    this.updateTaskProgress('Analyzing task', []);
    this.log('STORY_PROGRESS_UPDATE', 'Analyzing requirements', { storyId: this.story.id });

    // Get guidance and implement
    const implementPrompt = `Based on the analysis, show me the exact code changes to make. Keep it simple and minimal.`;
    await this.chat(implementPrompt);
    this.log('STORY_PROGRESS_UPDATE', 'Making code changes', { storyId: this.story.id });

    // Complete
    updateStory(this.db, this.story.id, { status: 'review' });
    this.log('STORY_COMPLETED', 'Implementation complete, ready for review', {
      storyId: this.story.id,
      branchName,
    });
  }

  private async escalateToSenior(reason: string): Promise<void> {
    const seniors = getAgentsByTeam(this.db, this.teamId!).filter(
      a => a.type === 'senior' && a.status !== 'terminated'
    );

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
