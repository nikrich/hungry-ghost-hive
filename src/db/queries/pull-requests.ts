// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import { extractPRNumber } from '../../utils/github.js';
import { normalizeStoryId } from '../../utils/story-id.js';
import { type PullRequestRow, type StoryRow } from '../client.js';
import type { DatabaseProvider } from '../provider.js';

export type { PullRequestRow };

export type PullRequestStatus =
  | 'queued'
  | 'reviewing'
  | 'approved'
  | 'merged'
  | 'rejected'
  | 'closed';

export interface CreatePullRequestInput {
  storyId?: string | null;
  teamId?: string | null;
  branchName: string;
  githubPrNumber?: number | null;
  githubPrUrl?: string | null;
  submittedBy?: string | null;
}

export interface UpdatePullRequestInput {
  status?: PullRequestStatus;
  reviewedBy?: string | null;
  reviewNotes?: string | null;
  githubPrNumber?: number | null;
  githubPrUrl?: string | null;
}

export async function createPullRequest(
  provider: DatabaseProvider,
  input: CreatePullRequestInput
): Promise<PullRequestRow> {
  const id = `pr-${nanoid(8)}`;
  const now = new Date().toISOString();

  // Extract PR number from URL if not explicitly provided
  let prNumber = input.githubPrNumber || null;
  if (!prNumber && input.githubPrUrl) {
    prNumber = extractPRNumber(input.githubPrUrl) || null;
  }

  await provider.run(
    `
    INSERT INTO pull_requests (id, story_id, team_id, branch_name, github_pr_number, github_pr_url, submitted_by, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `,
    [
      id,
      input.storyId ? normalizeStoryId(input.storyId) : null,
      input.teamId || null,
      input.branchName,
      prNumber,
      input.githubPrUrl || null,
      input.submittedBy || null,
      now,
      now,
    ]
  );

  return (await getPullRequestById(provider, id))!;
}

export async function getPullRequestById(
  provider: DatabaseProvider,
  id: string
): Promise<PullRequestRow | undefined> {
  return await provider.queryOne<PullRequestRow>('SELECT * FROM pull_requests WHERE id = ?', [id]);
}

export async function getPullRequestByStory(
  provider: DatabaseProvider,
  storyId: string
): Promise<PullRequestRow | undefined> {
  return await provider.queryOne<PullRequestRow>('SELECT * FROM pull_requests WHERE story_id = ?', [
    storyId,
  ]);
}

export async function getPullRequestByGithubNumber(
  provider: DatabaseProvider,
  prNumber: number
): Promise<PullRequestRow | undefined> {
  return await provider.queryOne<PullRequestRow>(
    'SELECT * FROM pull_requests WHERE github_pr_number = ?',
    [prNumber]
  );
}

// Merge Queue functions

export async function getMergeQueue(
  provider: DatabaseProvider,
  teamId?: string
): Promise<PullRequestRow[]> {
  if (teamId) {
    return await provider.queryAll<PullRequestRow>(
      `
      SELECT * FROM pull_requests
      WHERE team_id = ? AND status IN ('queued', 'reviewing')
      ORDER BY created_at ASC
    `,
      [teamId]
    );
  }
  return await provider.queryAll<PullRequestRow>(`
    SELECT * FROM pull_requests
    WHERE status IN ('queued', 'reviewing')
    ORDER BY created_at ASC
  `);
}

export async function getNextInQueue(
  provider: DatabaseProvider,
  teamId?: string
): Promise<PullRequestRow | undefined> {
  // Get the prioritized queue and return the first PR with status = 'queued'
  const queue = await getPrioritizedMergeQueue(provider, teamId);
  return queue.find(pr => pr.status === 'queued');
}

export async function getQueuePosition(provider: DatabaseProvider, prId: string): Promise<number> {
  const pr = await getPullRequestById(provider, prId);
  if (!pr || !['queued', 'reviewing'].includes(pr.status)) return -1;

  const queue = await getPrioritizedMergeQueue(provider, pr.team_id || undefined);
  return queue.findIndex(p => p.id === prId) + 1;
}

/**
 * Check if a story's dependencies are satisfied (ready for QA review)
 * A dependency is satisfied if the story is merged or in active development
 */
async function areDependenciesSatisfied(
  provider: DatabaseProvider,
  storyId: string
): Promise<boolean> {
  const dependencies = await provider.queryAll<StoryRow>(
    `
    SELECT s.* FROM stories s
    JOIN story_dependencies sd ON s.id = sd.depends_on_story_id
    WHERE sd.story_id = ?
  `,
    [storyId]
  );

  // All dependencies must be in a satisfied state
  for (const dep of dependencies) {
    // Satisfied if: merged, in active work (in_progress, review, qa, qa_failed), or awaiting merge (pr_submitted)
    if (
      !['merged', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted'].includes(dep.status)
    ) {
      return false;
    }
  }

  return true;
}

// Priority scoring for merge queue
export async function getPrioritizedMergeQueue(
  provider: DatabaseProvider,
  teamId?: string
): Promise<PullRequestRow[]> {
  const baseQueue = await getMergeQueue(provider, teamId);

  // Score by dependency satisfaction first, then by age
  const scored = await Promise.all(
    baseQueue.map(async pr => {
      // Get the story for this PR to check dependencies
      let dependenciesSatisfied = true;
      if (pr.story_id) {
        dependenciesSatisfied = await areDependenciesSatisfied(provider, pr.story_id);
      }

      // Scoring: dependencies satisfied = higher priority (larger score)
      // Within each tier, older PRs get higher priority
      const dependencyScore = dependenciesSatisfied ? 1 : 0;
      const createdTime = new Date(pr.created_at).getTime();
      const ageScore = -createdTime;

      // Combined score: (dependencyScore * large_multiplier) + ageScore
      // This ensures dependency satisfaction is the primary sort key
      const score = dependencyScore * 1e15 + ageScore;

      return { pr, score, dependenciesSatisfied };
    })
  );

  // Sort by score (descending) = dependencies satisfied first, then older first
  scored.sort((a, b) => b.score - a.score);

  return scored.map(item => item.pr);
}

export async function getPullRequestsByStatus(
  provider: DatabaseProvider,
  status: PullRequestStatus
): Promise<PullRequestRow[]> {
  return await provider.queryAll<PullRequestRow>(
    `
    SELECT * FROM pull_requests
    WHERE status = ?
    ORDER BY created_at DESC
  `,
    [status]
  );
}

export async function getApprovedPullRequests(
  provider: DatabaseProvider
): Promise<PullRequestRow[]> {
  return await provider.queryAll<PullRequestRow>(`
    SELECT * FROM pull_requests
    WHERE status = 'approved'
    ORDER BY created_at ASC
  `);
}

export async function getOpenPullRequestsByStory(
  provider: DatabaseProvider,
  storyId: string
): Promise<PullRequestRow[]> {
  return await provider.queryAll<PullRequestRow>(
    `
    SELECT * FROM pull_requests
    WHERE story_id = ? COLLATE NOCASE AND status IN ('queued', 'reviewing')
    ORDER BY created_at ASC
  `,
    [storyId]
  );
}

export async function getAllPullRequests(provider: DatabaseProvider): Promise<PullRequestRow[]> {
  return await provider.queryAll<PullRequestRow>(
    'SELECT * FROM pull_requests ORDER BY created_at DESC'
  );
}

export async function getPullRequestsByTeam(
  provider: DatabaseProvider,
  teamId: string
): Promise<PullRequestRow[]> {
  return await provider.queryAll<PullRequestRow>(
    `
    SELECT * FROM pull_requests
    WHERE team_id = ?
    ORDER BY created_at DESC
  `,
    [teamId]
  );
}

export async function updatePullRequest(
  provider: DatabaseProvider,
  id: string,
  input: UpdatePullRequestInput
): Promise<PullRequestRow | undefined> {
  const updates: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [new Date().toISOString()];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
    if (['reviewing', 'approved', 'rejected', 'merged'].includes(input.status)) {
      updates.push('reviewed_at = ?');
      values.push(new Date().toISOString());
    }
  }
  if (input.reviewedBy !== undefined) {
    updates.push('reviewed_by = ?');
    values.push(input.reviewedBy);
  }
  if (input.reviewNotes !== undefined) {
    updates.push('review_notes = ?');
    values.push(input.reviewNotes);
  }
  if (input.githubPrNumber !== undefined) {
    updates.push('github_pr_number = ?');
    values.push(input.githubPrNumber);
  }
  if (input.githubPrUrl !== undefined) {
    updates.push('github_pr_url = ?');
    values.push(input.githubPrUrl);
  }

  if (updates.length === 1) {
    return await getPullRequestById(provider, id);
  }

  values.push(id);
  await provider.run(`UPDATE pull_requests SET ${updates.join(', ')} WHERE id = ?`, values);
  return await getPullRequestById(provider, id);
}

export async function deletePullRequest(provider: DatabaseProvider, id: string): Promise<void> {
  await provider.run('DELETE FROM pull_requests WHERE id = ?', [id]);
}

/**
 * Check if an agent is actively reviewing a PR
 * Returns true if the agent has a PR with status 'reviewing'
 */
export async function isAgentReviewingPR(
  provider: DatabaseProvider,
  agentId: string
): Promise<boolean> {
  const result = await provider.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count FROM pull_requests
    WHERE reviewed_by = ? AND status = 'reviewing'
  `,
    [agentId]
  );
  return (result?.count || 0) > 0;
}

/**
 * Backfill github_pr_number for existing PRs that have github_pr_url but no number
 * This is an idempotent operation - it only updates PRs with NULL github_pr_number
 * @returns Number of PRs updated
 */
export async function backfillGithubPrNumbers(provider: DatabaseProvider): Promise<number> {
  const prsToBackfill = await provider.queryAll<PullRequestRow>(`
    SELECT * FROM pull_requests
    WHERE github_pr_number IS NULL AND github_pr_url IS NOT NULL
  `);

  let updated = 0;
  for (const pr of prsToBackfill) {
    const prNumber = extractPRNumber(pr.github_pr_url!);
    if (prNumber) {
      await provider.run('UPDATE pull_requests SET github_pr_number = ? WHERE id = ?', [
        prNumber,
        pr.id,
      ]);
      updated++;
    }
  }

  return updated;
}
