// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { execa } from 'execa';
import { syncStatusForStory } from '../../../connectors/project-management/operations.js';
import { queryAll, queryOne, withTransaction } from '../../../db/client.js';
import { createLog } from '../../../db/queries/logs.js';
import {
  createPullRequest,
  getPullRequestsByStatus,
  updatePullRequest,
} from '../../../db/queries/pull-requests.js';
import { updateStory } from '../../../db/queries/stories.js';
import { GH_CLI_TIMEOUT_MS } from '../../../utils/github-cli.js';
import {
  fetchOpenGitHubPRs,
  getExistingPRIdentifiers,
  ghRepoSlug,
} from '../../../utils/pr-sync.js';
import { extractStoryIdFromBranch } from '../../../utils/story-id.js';
import { sendManagerNudge, verboseLogCtx } from './manager-utils.js';
import { cleanupAgentsReferencingMergedStory } from './merged-story-cleanup.js';
import type { ManagerCheckContext } from './types.js';

const GH_PR_VIEW_TIMEOUT_MS = 30_000;
const REVIEWING_PR_VALIDATION_MIN_AGE_MS = 5 * 60 * 1000;

interface ReviewingPRValidationCandidate {
  id: string;
  storyId: string | null;
  teamId: string;
  branchName: string;
  githubPrNumber: number;
  reviewedBy: string | null;
  repoDir: string;
  repoSlug: string | null;
}

interface ReviewingPRValidationResult {
  candidate: ReviewingPRValidationCandidate;
  githubState: string;
  githubUrl: string | null;
}

export async function syncMergedPRs(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read teams (brief lock)
  const teamInfos = await ctx.withDb(async db => {
    const { getAllTeams } = await import('../../../db/queries/teams.js');
    return getAllTeams(db.db)
      .filter(t => t.repo_path)
      .map(t => ({
        repoDir: `${ctx.root}/${t.repo_path}`,
        slug: ghRepoSlug(t.repo_url),
      }));
  });
  if (teamInfos.length === 0) return;

  // Phase 2: GitHub CLI calls (no lock)
  const GITHUB_PR_LIST_LIMIT = 20;
  const ghResults: Array<{
    mergedPRs: Array<{ number: number; headRefName: string; mergedAt: string }>;
  }> = [];
  for (const team of teamInfos) {
    try {
      const args = [
        'pr',
        'list',
        '--json',
        'number,headRefName,mergedAt',
        '--state',
        'merged',
        '--limit',
        String(GITHUB_PR_LIST_LIMIT),
      ];
      if (team.slug) args.push('-R', team.slug);
      const result = await execa('gh', args, { cwd: team.repoDir, timeout: GH_CLI_TIMEOUT_MS });
      ghResults.push({ mergedPRs: JSON.parse(result.stdout) });
    } catch {
      ghResults.push({ mergedPRs: [] });
    }
  }

  // Phase 3: DB reads + writes (brief lock)
  const mergedSynced = await ctx.withDb(async db => {
    let storiesUpdated = 0;
    for (const ghResult of ghResults) {
      const candidateStoryIds = Array.from(
        new Set(
          ghResult.mergedPRs
            .map(pr => extractStoryIdFromBranch(pr.headRefName))
            .filter((id): id is string => Boolean(id))
        )
      );
      if (candidateStoryIds.length === 0) continue;

      const placeholders = candidateStoryIds.map(() => '?').join(',');
      const updatableStories = queryAll<{ id: string }>(
        db.db,
        `SELECT id FROM stories WHERE status != 'merged' AND id IN (${placeholders})`,
        candidateStoryIds
      );
      const updatableStoryIds = new Set(updatableStories.map(s => s.id));
      const toUpdate: Array<{ storyId: string; prNumber: number }> = [];

      for (const pr of ghResult.mergedPRs) {
        const storyId = extractStoryIdFromBranch(pr.headRefName);
        if (!storyId || !updatableStoryIds.has(storyId)) continue;
        updatableStoryIds.delete(storyId);
        toUpdate.push({ storyId, prNumber: pr.number });
      }

      if (toUpdate.length > 0) {
        await withTransaction(db.db, () => {
          for (const update of toUpdate) {
            updateStory(db.db, update.storyId, { status: 'merged', assignedAgentId: null });
            const cleanup = cleanupAgentsReferencingMergedStory(db.db, update.storyId);
            createLog(db.db, {
              agentId: 'manager',
              storyId: update.storyId,
              eventType: 'STORY_MERGED',
              message: `Story synced to merged from GitHub PR #${update.prNumber}`,
              metadata: {
                merged_agent_cleanup_cleared: cleanup.cleared,
                merged_agent_cleanup_reassigned: cleanup.reassigned,
              },
            });
          }
        });
        for (const update of toUpdate) {
          syncStatusForStory(ctx.root, db.db, update.storyId, 'merged');
        }
        storiesUpdated += toUpdate.length;
      }
    }
    if (storiesUpdated > 0) db.save();
    return storiesUpdated;
  });

  verboseLogCtx(ctx, `syncMergedPRs: synced=${mergedSynced}`);
  if (mergedSynced > 0) {
    console.log(chalk.green(`  Synced ${mergedSynced} merged story(ies) from GitHub`));
  }
}

export async function reconcileAgentsOnMergedStories(ctx: ManagerCheckContext): Promise<void> {
  const result = await ctx.withDb(async db => {
    const mergedStoryIds = queryAll<{ id: string }>(
      db.db,
      `
      SELECT DISTINCT s.id
      FROM stories s
      JOIN agents a ON a.current_story_id = s.id
      WHERE s.status = 'merged'
        AND a.status != 'terminated'
      `
    ).map(row => row.id);

    if (mergedStoryIds.length === 0) {
      return { storyCount: 0, cleared: 0, reassigned: 0 };
    }

    let cleared = 0;
    let reassigned = 0;
    for (const storyId of mergedStoryIds) {
      const cleanup = cleanupAgentsReferencingMergedStory(db.db, storyId);
      if (cleanup.cleared > 0) {
        createLog(db.db, {
          agentId: 'manager',
          storyId,
          eventType: 'STORY_PROGRESS_UPDATE',
          message: `Reconciled stale merged-story agent assignments`,
          metadata: {
            story_id: storyId,
            cleared_agents: cleanup.cleared,
            reassigned_agents: cleanup.reassigned,
            recovery: 'merged_story_agent_reconcile',
          },
        });
      }
      cleared += cleanup.cleared;
      reassigned += cleanup.reassigned;
    }

    if (cleared > 0) {
      db.save();
    }

    return { storyCount: mergedStoryIds.length, cleared, reassigned };
  });

  verboseLogCtx(
    ctx,
    `reconcileAgentsOnMergedStories: stories=${result.storyCount}, cleared=${result.cleared}, reassigned=${result.reassigned}`
  );
  if (result.cleared > 0) {
    console.log(
      chalk.yellow(
        `  Reconciled ${result.cleared} stale merged-story agent assignment(s) (${result.reassigned} reassigned, ${result.cleared - result.reassigned} idled)`
      )
    );
  }
}

export async function syncOpenPRs(ctx: ManagerCheckContext): Promise<void> {
  const maxAgeHours = ctx.config.merge_queue?.max_age_hours;

  // Phase 1: Read teams + existing identifiers (brief lock)
  const setupData = await ctx.withDb(async db => {
    const { getAllTeams } = await import('../../../db/queries/teams.js');
    const teams = getAllTeams(db.db);
    const { existingBranches, existingPrNumbers } = getExistingPRIdentifiers(db.db, true);
    return {
      teams: teams
        .filter(t => t.repo_path)
        .map(t => ({
          id: t.id,
          repoDir: `${ctx.root}/${t.repo_path}`,
          slug: ghRepoSlug(t.repo_url),
        })),
      existingBranches,
      existingPrNumbers,
    };
  });
  if (setupData.teams.length === 0) return;

  // Phase 2: GitHub CLI calls (no lock)
  const teamPRs = new Map<string, import('../../../utils/pr-sync.js').GitHubPR[]>();
  for (const team of setupData.teams) {
    try {
      const prs = await fetchOpenGitHubPRs(team.repoDir, team.slug);
      teamPRs.set(team.id, prs);
    } catch {
      // gh CLI might not be authenticated
    }
  }

  // Phase 3: Import into DB (brief lock)
  const syncedPRs = await ctx.withDb(async (db, scheduler) => {
    // Re-read identifiers in case another process synced in the meantime
    const { existingBranches, existingPrNumbers } = getExistingPRIdentifiers(db.db, true);
    let totalSynced = 0;

    for (const team of setupData.teams) {
      const prs = teamPRs.get(team.id);
      if (!prs) continue;

      for (const ghPR of prs) {
        if (existingBranches.has(ghPR.headRefName) || existingPrNumbers.has(ghPR.number)) continue;

        // Age filtering
        if (maxAgeHours !== undefined) {
          const ageHours = (Date.now() - new Date(ghPR.createdAt).getTime()) / (1000 * 60 * 60);
          if (ageHours > maxAgeHours) {
            createLog(db.db, {
              agentId: 'manager',
              eventType: 'PR_SYNC_SKIPPED',
              status: 'info',
              message: `Skipped syncing old PR #${ghPR.number} (${ghPR.headRefName}): created ${ageHours.toFixed(1)}h ago (max: ${maxAgeHours}h)`,
              metadata: {
                pr_number: ghPR.number,
                branch: ghPR.headRefName,
                age_hours: ageHours,
                max_age_hours: maxAgeHours,
                reason: 'too_old',
              },
            });
            continue;
          }
        }

        const storyId = extractStoryIdFromBranch(ghPR.headRefName);
        if (storyId) {
          const storyRows = queryAll<{ id: string; status: string }>(
            db.db,
            `SELECT id, status FROM stories WHERE id = ? AND status != 'merged'`,
            [storyId]
          );
          if (storyRows.length === 0) {
            createLog(db.db, {
              agentId: 'manager',
              eventType: 'PR_SYNC_SKIPPED',
              status: 'info',
              message: `Skipped syncing PR #${ghPR.number} (${ghPR.headRefName}): story ${storyId} not found or already merged`,
              metadata: {
                pr_number: ghPR.number,
                branch: ghPR.headRefName,
                story_id: storyId,
                reason: 'inactive_story',
              },
            });
            continue;
          }
        }

        createPullRequest(db.db, {
          storyId,
          teamId: team.id,
          branchName: ghPR.headRefName,
          githubPrNumber: ghPR.number,
          githubPrUrl: ghPR.url,
          submittedBy: null,
        });
        existingBranches.add(ghPR.headRefName);
        existingPrNumbers.add(ghPR.number);
        totalSynced++;
      }
    }

    if (totalSynced > 0) {
      db.save();
      await scheduler.checkMergeQueue();
      db.save();
    }
    return totalSynced;
  });

  verboseLogCtx(ctx, `syncOpenPRs: synced=${syncedPRs}`);
  if (syncedPRs > 0) {
    console.log(chalk.yellow(`  Synced ${syncedPRs} GitHub PR(s) into merge queue`));
  }
}

export async function closeStalePRs(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read teams + PR data (brief lock)
  const { teamInfos, prsByStory } = await ctx.withDb(async db => {
    const { getAllTeams } = await import('../../../db/queries/teams.js');
    const teams = getAllTeams(db.db).filter(t => t.repo_path);
    // Pre-fetch all non-closed PR data grouped by story
    const allPRs = queryAll<{
      story_id: string | null;
      id: string;
      github_pr_number: number | null;
    }>(
      db.db,
      `SELECT story_id, id, github_pr_number FROM pull_requests WHERE status NOT IN ('closed') ORDER BY created_at DESC`
    );
    const prsByStory = new Map<string, Array<{ id: string; github_pr_number: number | null }>>();
    for (const pr of allPRs) {
      if (!pr.story_id) continue;
      const key = pr.story_id.toUpperCase();
      const existing = prsByStory.get(key) || [];
      existing.push({ id: pr.id, github_pr_number: pr.github_pr_number });
      prsByStory.set(key, existing);
    }
    return {
      teamInfos: teams.map(t => ({
        repoDir: `${ctx.root}/${t.repo_path}`,
      })),
      prsByStory,
    };
  });

  if (teamInfos.length === 0) return;

  // Phase 2: GitHub CLI calls (no lock)
  const baseBranch = ctx.config.github?.base_branch ?? 'main';
  const closed: import('../../../utils/pr-sync.js').ClosedPRInfo[] = [];

  for (const team of teamInfos) {
    try {
      const openGHPRs = await fetchOpenGitHubPRs(team.repoDir);
      for (const ghPR of openGHPRs) {
        // Skip PRs that don't target the configured base branch
        if (ghPR.baseRefName !== baseBranch) continue;

        const storyId = extractStoryIdFromBranch(ghPR.headRefName);
        if (!storyId) continue;
        const prsForStory = prsByStory.get(storyId);
        if (!prsForStory || prsForStory.length === 0) continue;
        const hasUnsyncedEntry = prsForStory.some(pr => pr.github_pr_number == null);
        if (hasUnsyncedEntry) continue;
        const isInQueue = prsForStory.some(pr => pr.github_pr_number === ghPR.number);
        if (!isInQueue) {
          const supersededByPrNumber =
            prsForStory.find(pr => pr.github_pr_number !== null)?.github_pr_number ?? null;
          try {
            await execa('gh', ['pr', 'close', String(ghPR.number)], {
              cwd: team.repoDir,
              timeout: GH_CLI_TIMEOUT_MS,
            });
            closed.push({
              storyId,
              closedPrNumber: ghPR.number,
              branch: ghPR.headRefName,
              supersededByPrNumber,
            });
          } catch {
            // Non-fatal
          }
        }
      }
    } catch {
      continue;
    }
  }

  // Phase 3: Write logs (brief lock)
  if (closed.length > 0) {
    await ctx.withDb(async db => {
      for (const info of closed) {
        const supersededDesc =
          info.supersededByPrNumber !== null ? ` by PR #${info.supersededByPrNumber}` : '';
        createLog(db.db, {
          agentId: 'manager',
          storyId: info.storyId,
          eventType: 'PR_CLOSED',
          message: `Auto-closed stale GitHub PR #${info.closedPrNumber} (${info.branch}) - superseded${supersededDesc}`,
          metadata: {
            github_pr_number: info.closedPrNumber,
            branch: info.branch,
            reason: 'stale',
            superseded_by_pr_number: info.supersededByPrNumber,
          },
        });
      }
      db.save();
    });
    console.log(chalk.yellow(`  Closed ${closed.length} stale GitHub PR(s):`));
    for (const info of closed) {
      const supersededDesc =
        info.supersededByPrNumber !== null
          ? ` (superseded by PR #${info.supersededByPrNumber})`
          : '';
      console.log(
        chalk.gray(
          `    PR #${info.closedPrNumber} [${info.storyId}] ${info.branch}${supersededDesc}`
        )
      );
    }
  }
  verboseLogCtx(ctx, `closeStalePRs: closed=${closed.length}`);
}

export async function recoverStaleReviewingPRs(ctx: ManagerCheckContext): Promise<void> {
  const now = Date.now();

  // Phase 1: Read stale reviewing PRs and resolve repo metadata (brief lock)
  const candidates = await ctx.withDb(async db => {
    const reviewingPRs = getPullRequestsByStatus(db.db, 'reviewing').filter(pr => {
      if (!pr.github_pr_number || !pr.team_id) return false;
      const updatedAtMs = Date.parse(pr.updated_at);
      if (Number.isNaN(updatedAtMs)) return true;
      return now - updatedAtMs >= REVIEWING_PR_VALIDATION_MIN_AGE_MS;
    });

    verboseLogCtx(ctx, `recoverStaleReviewingPRs: staleCandidates=${reviewingPRs.length}`);
    if (reviewingPRs.length === 0) {
      return [] as ReviewingPRValidationCandidate[];
    }

    const { getAllTeams } = await import('../../../db/queries/teams.js');
    const teams = getAllTeams(db.db);
    const teamsById = new Map(teams.map(team => [team.id, team]));

    const result: ReviewingPRValidationCandidate[] = [];
    for (const pr of reviewingPRs) {
      const team = teamsById.get(pr.team_id!);
      if (!team?.repo_path) continue;

      result.push({
        id: pr.id,
        storyId: pr.story_id,
        teamId: pr.team_id!,
        branchName: pr.branch_name,
        githubPrNumber: pr.github_pr_number!,
        reviewedBy: pr.reviewed_by,
        repoDir: `${ctx.root}/${team.repo_path}`,
        repoSlug: ghRepoSlug(team.repo_url),
      });
    }

    return result;
  });

  if (candidates.length === 0) return;

  // Phase 2: Check GitHub state for each stale reviewing PR (no lock)
  const mergedResults: ReviewingPRValidationResult[] = [];
  const rejectedResults: ReviewingPRValidationResult[] = [];

  for (const candidate of candidates) {
    try {
      const args = ['pr', 'view', String(candidate.githubPrNumber), '--json', 'state,url'];
      if (candidate.repoSlug) args.push('-R', candidate.repoSlug);
      const result = await execa('gh', args, {
        cwd: candidate.repoDir,
        timeout: GH_PR_VIEW_TIMEOUT_MS,
      });
      const parsed = JSON.parse(result.stdout) as { state?: string; url?: string };
      const state = parsed.state?.toUpperCase();
      const url = parsed.url || null;

      if (state === 'OPEN') {
        // PR is still open on GitHub but stale in 'reviewing' — the QA agent
        // may have missed the original nudge. Re-nudge if QA agent is idle.
        if (candidate.reviewedBy) {
          const qaAgent = ctx.agentsBySessionName.get(candidate.reviewedBy);
          if (qaAgent && qaAgent.status === 'idle') {
            const githubLine = candidate.repoSlug
              ? `\n# GitHub: https://github.com/${candidate.repoSlug}/pull/${candidate.githubPrNumber}`
              : '';
            await sendManagerNudge(
              ctx,
              candidate.reviewedBy,
              `# [REMINDER] You are assigned PR review ${candidate.id} (${candidate.storyId || 'no-story'}).${githubLine}
# This PR has been waiting for review. Execute now:
#   hive pr show ${candidate.id}
#   hive pr approve ${candidate.id}
# or reject:
#   hive pr reject ${candidate.id} -r "reason"`
            );
            verboseLogCtx(
              ctx,
              `recoverStaleReviewingPRs: re-nudged idle QA ${candidate.reviewedBy} for stale pr=${candidate.id}`
            );
          }
        }
        continue;
      }
      if (state === 'MERGED') {
        mergedResults.push({
          candidate,
          githubState: 'MERGED',
          githubUrl: url,
        });
        continue;
      }

      if (state) {
        rejectedResults.push({
          candidate,
          githubState: state,
          githubUrl: url,
        });
      }
    } catch (err) {
      verboseLogCtx(
        ctx,
        `recoverStaleReviewingPRs: skip pr=${candidate.id} github_check_failed=${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (mergedResults.length === 0 && rejectedResults.length === 0) return;

  const mergedStoryIds: string[] = [];

  // Phase 3: Apply DB updates (brief lock)
  await ctx.withDb(async db => {
    for (const result of mergedResults) {
      await withTransaction(
        db.db,
        () => {
          const currentPR = queryOne<{ status: string }>(
            db.db,
            `SELECT status FROM pull_requests WHERE id = ?`,
            [result.candidate.id]
          );
          if (!currentPR || currentPR.status !== 'reviewing') return;

          updatePullRequest(db.db, result.candidate.id, {
            status: 'merged',
            reviewedBy: result.candidate.reviewedBy || 'manager',
          });
          createLog(db.db, {
            agentId: 'manager',
            storyId: result.candidate.storyId || undefined,
            eventType: 'PR_MERGED',
            message: `Auto-closed reviewing PR ${result.candidate.id}: GitHub PR #${result.candidate.githubPrNumber} is already merged`,
            metadata: {
              pr_id: result.candidate.id,
              github_pr_number: result.candidate.githubPrNumber,
              github_state: result.githubState,
              github_url: result.githubUrl,
            },
          });

          if (!result.candidate.storyId) return;
          updateStory(db.db, result.candidate.storyId, { status: 'merged', assignedAgentId: null });
          const cleanup = cleanupAgentsReferencingMergedStory(db.db, result.candidate.storyId);
          createLog(db.db, {
            agentId: 'manager',
            storyId: result.candidate.storyId,
            eventType: 'STORY_MERGED',
            message: `Story auto-synced to merged (GitHub PR #${result.candidate.githubPrNumber} already merged)`,
            metadata: {
              pr_id: result.candidate.id,
              github_pr_number: result.candidate.githubPrNumber,
              github_url: result.githubUrl,
              merged_agent_cleanup_cleared: cleanup.cleared,
              merged_agent_cleanup_reassigned: cleanup.reassigned,
            },
          });
          mergedStoryIds.push(result.candidate.storyId);
        },
        () => db.save()
      );
    }

    for (const result of rejectedResults) {
      await withTransaction(
        db.db,
        () => {
          const currentPR = queryOne<{ status: string }>(
            db.db,
            `SELECT status FROM pull_requests WHERE id = ?`,
            [result.candidate.id]
          );
          if (!currentPR || currentPR.status !== 'reviewing') return;

          const reason = `GitHub PR #${result.candidate.githubPrNumber} is ${result.githubState.toLowerCase()} on GitHub${result.githubUrl ? ` (${result.githubUrl})` : ''}. Reopen/create a new PR and resubmit.`;
          updatePullRequest(db.db, result.candidate.id, {
            status: 'rejected',
            reviewedBy: result.candidate.reviewedBy || 'manager',
            reviewNotes: reason,
          });
          createLog(db.db, {
            agentId: 'manager',
            storyId: result.candidate.storyId || undefined,
            eventType: 'PR_REJECTED',
            status: 'warn',
            message: `Auto-rejected stale review ${result.candidate.id}: ${reason}`,
            metadata: {
              pr_id: result.candidate.id,
              github_pr_number: result.candidate.githubPrNumber,
              github_state: result.githubState,
              github_url: result.githubUrl,
              branch: result.candidate.branchName,
              team_id: result.candidate.teamId,
            },
          });
        },
        () => db.save()
      );
    }
  });

  // Sync merged stories to PM provider outside lock
  const uniqueMergedStoryIds = Array.from(new Set(mergedStoryIds));
  for (const storyId of uniqueMergedStoryIds) {
    await ctx.withDb(async db => {
      await syncStatusForStory(ctx.root, db.db, storyId, 'merged');
    });
  }

  if (mergedResults.length > 0) {
    console.log(
      chalk.green(
        `  Auto-synced ${mergedResults.length} reviewing PR(s) that were already merged on GitHub`
      )
    );
  }
  if (rejectedResults.length > 0) {
    console.log(
      chalk.yellow(
        `  Auto-rejected ${rejectedResults.length} stale reviewing PR(s) with non-open GitHub PR state`
      )
    );
  }
}
