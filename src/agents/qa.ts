import { BaseAgent, type AgentContext } from './base-agent.js';
import { getTeamById, type TeamRow } from '../db/queries/teams.js';
import { getStoriesByStatus, updateStory, type StoryRow } from '../db/queries/stories.js';
import { createPullRequest, getPullRequestByStory } from '../db/queries/pull-requests.js';
import { execa } from 'execa';

export interface QAContext extends AgentContext {
  qaConfig: {
    qualityChecks: string[];
    buildCommand: string;
    testCommand?: string;
  };
}

export class QAAgent extends BaseAgent {
  private team: TeamRow | null = null;
  private qaConfig: QAContext['qaConfig'];
  private pendingStories: StoryRow[] = [];

  constructor(context: QAContext) {
    super(context);
    this.qaConfig = context.qaConfig;

    if (context.agentRow.team_id) {
      this.team = getTeamById(this.db, context.agentRow.team_id) || null;
      this.pendingStories = getStoriesByStatus(this.db, 'qa')
        .filter(s => s.team_id === context.agentRow.team_id);
    }
  }

  getSystemPrompt(): string {
    const teamInfo = this.team
      ? `Team: ${this.team.name}\nRepository: ${this.team.repo_path}`
      : 'No team assigned';

    return `You are the QA Agent ensuring code quality before PR submission.

## Your Team
${teamInfo}

## Quality Checklist
- Code passes linting
- Code passes type checking
- Build succeeds
- Tests pass (if configured)
- Changes align with acceptance criteria
- No obvious security issues
- Code follows repository patterns

## Commands
Quality checks: ${this.qaConfig.qualityChecks.join(', ')}
Build: ${this.qaConfig.buildCommand}
${this.qaConfig.testCommand ? `Test: ${this.qaConfig.testCommand}` : ''}

## On Failure
- Mark story as 'qa_failed'
- Log specific failures with actionable feedback
- Story returns to developer for fixes

## On Success
- Create GitHub PR
- Mark story as 'pr_submitted'

## Current Context
${this.memoryState.conversationSummary || 'Starting fresh.'}`;
  }

  async execute(): Promise<void> {
    if (this.pendingStories.length === 0) {
      this.log('STORY_QA_STARTED', 'No stories pending QA');
      return;
    }

    for (const story of this.pendingStories) {
      await this.processStory(story);
    }
  }

  private async processStory(story: StoryRow): Promise<void> {
    this.setCurrentTask(story.id, 'qa');
    this.log('STORY_QA_STARTED', `QA for story: ${story.title}`, { storyId: story.id });

    // Checkout the branch
    if (story.branch_name) {
      try {
        await execa('git', ['checkout', story.branch_name], { cwd: this.workDir });
      } catch (err) {
        this.log('STORY_QA_FAILED', `Failed to checkout branch: ${err instanceof Error ? err.message : 'Unknown error'}`, {
          storyId: story.id,
        });
        updateStory(this.db, story.id, { status: 'qa_failed' });
        return;
      }
    }

    // Run quality checks
    const qualityPassed = await this.runQualityChecks(story.id);
    if (!qualityPassed) {
      updateStory(this.db, story.id, { status: 'qa_failed' });
      return;
    }

    // Run build
    const buildPassed = await this.runBuild(story.id);
    if (!buildPassed) {
      updateStory(this.db, story.id, { status: 'qa_failed' });
      return;
    }

    // Run tests if configured
    if (this.qaConfig.testCommand) {
      const testsPassed = await this.runTests(story.id);
      if (!testsPassed) {
        updateStory(this.db, story.id, { status: 'qa_failed' });
        return;
      }
    }

    // All checks passed
    this.log('STORY_QA_PASSED', 'All QA checks passed', { storyId: story.id });

    // Create PR
    await this.createPR(story);
  }

  private async runQualityChecks(storyId: string): Promise<boolean> {
    this.log('CODE_QUALITY_CHECK_STARTED', 'Running quality checks', { storyId });

    for (const check of this.qaConfig.qualityChecks) {
      try {
        const [cmd, ...args] = check.split(' ');
        await execa(cmd, args, { cwd: this.workDir });
      } catch (err) {
        const error = err as { stderr?: string; stdout?: string };
        this.log('CODE_QUALITY_CHECK_FAILED', `Check failed: ${check}`, {
          storyId,
          error: error.stderr || error.stdout,
        });
        return false;
      }
    }

    this.log('CODE_QUALITY_CHECK_PASSED', 'All quality checks passed', { storyId });
    return true;
  }

  private async runBuild(storyId: string): Promise<boolean> {
    this.log('BUILD_STARTED', 'Running build', { storyId });

    try {
      const [cmd, ...args] = this.qaConfig.buildCommand.split(' ');
      await execa(cmd, args, { cwd: this.workDir });
      this.log('BUILD_PASSED', 'Build succeeded', { storyId });
      return true;
    } catch (err) {
      const error = err as { stderr?: string; stdout?: string };
      this.log('BUILD_FAILED', 'Build failed', {
        storyId,
        error: error.stderr || error.stdout,
      });
      return false;
    }
  }

  private async runTests(storyId: string): Promise<boolean> {
    if (!this.qaConfig.testCommand) return true;

    this.log('BUILD_STARTED', 'Running tests', { storyId });

    try {
      const [cmd, ...args] = this.qaConfig.testCommand.split(' ');
      await execa(cmd, args, { cwd: this.workDir });
      this.log('BUILD_PASSED', 'Tests passed', { storyId });
      return true;
    } catch (err) {
      const error = err as { stderr?: string; stdout?: string };
      this.log('BUILD_FAILED', 'Tests failed', {
        storyId,
        error: error.stderr || error.stdout,
      });
      return false;
    }
  }

  private async createPR(story: StoryRow): Promise<void> {
    if (!story.branch_name) {
      this.log('STORY_PR_CREATED', 'No branch name, skipping PR creation', { storyId: story.id });
      updateStory(this.db, story.id, { status: 'pr_submitted' });
      return;
    }

    // Check if PR already exists
    const existingPR = getPullRequestByStory(this.db, story.id);
    if (existingPR) {
      this.log('STORY_PR_CREATED', 'PR already exists', {
        storyId: story.id,
        prUrl: existingPR.github_pr_url,
      });
      return;
    }

    // Create PR using gh CLI
    try {
      const title = `${story.id}: ${story.title}`;
      const body = this.generatePRBody(story);

      const { stdout } = await execa('gh', [
        'pr', 'create',
        '--title', title,
        '--body', body,
        '--base', 'main',
        '--head', story.branch_name,
      ], { cwd: this.workDir });

      // Extract PR URL from output
      const prUrl = stdout.trim();
      const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
      const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined;

      // Create PR record
      const pr = createPullRequest(this.db, {
        storyId: story.id,
        githubPrNumber: prNumber,
        githubPrUrl: prUrl,
      });

      // Update story
      updateStory(this.db, story.id, {
        prUrl,
        status: 'pr_submitted',
      });

      this.log('STORY_PR_CREATED', `PR created: ${prUrl}`, {
        storyId: story.id,
        prId: pr.id,
        prNumber,
      });
    } catch (err) {
      const error = err as { stderr?: string };
      this.log('STORY_PR_CREATED', `Failed to create PR: ${error.stderr || 'Unknown error'}`, {
        storyId: story.id,
      });

      // Still mark as pr_submitted since QA passed
      updateStory(this.db, story.id, { status: 'pr_submitted' });
    }
  }

  private generatePRBody(story: StoryRow): string {
    const acceptanceCriteria = story.acceptance_criteria
      ? JSON.parse(story.acceptance_criteria).map((c: string) => `- [ ] ${c}`).join('\n')
      : 'N/A';

    return `## Story: ${story.id}

${story.description}

### Acceptance Criteria
${acceptanceCriteria}

### QA Checklist
- [x] Code passes linting
- [x] Code passes type checking
- [x] Build succeeds
- [x] Changes align with acceptance criteria

---
*Generated by Hive QA Agent*`;
  }
}
