// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { syncStatusForStory } from '../../../connectors/project-management/operations.js';
import { withTransaction } from '../../../db/client.js';
import { createLog } from '../../../db/queries/logs.js';
import {
  getMergeQueue,
  getPullRequestsByStatus,
  updatePullRequest,
} from '../../../db/queries/pull-requests.js';
import { updateStory } from '../../../db/queries/stories.js';
import { getPullRequestComments, getPullRequestReviews } from '../../../git/github.js';
import { AgentState } from '../../../state-detectors/types.js';
import { agentStates } from './agent-monitoring.js';
import { sendManagerNudge, verboseLogCtx } from './manager-utils.js';
import type { ManagerCheckContext } from './types.js';

export async function notifyQAOfQueuedPRs(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read PR queue and assign reviews (brief lock)
  const { queuedPRs, dispatched } = await ctx.withDb(async db => {
    const openPRs = getMergeQueue(db.db);
    verboseLogCtx(ctx, `notifyQAOfQueuedPRs: open=${openPRs.length}`);

    const queued = openPRs.filter(pr => pr.status === 'queued');
    const reviewing = openPRs.filter(pr => pr.status === 'reviewing');
    ctx.counters.queuedPRCount = queued.length;
    ctx.counters.reviewingPRCount = reviewing.length;
    verboseLogCtx(ctx, `notifyQAOfQueuedPRs: queued=${queued.length}`);
    if (queued.length === 0) {
      return {
        queuedPRs: [] as typeof queued,
        dispatched: [] as Array<{
          prId: string;
          qaName: string;
          storyId: string | null;
          githubPrUrl: string | null;
        }>,
      };
    }

    const reviewingSessions = new Set(
      openPRs
        .filter(pr => pr.status === 'reviewing' && pr.reviewed_by)
        .map(pr => pr.reviewed_by as string)
    );

    const idleQASessions = ctx.hiveSessions.filter(session => {
      if (!session.name.includes('-qa-')) return false;
      if (reviewingSessions.has(session.name)) return false;
      const agent = ctx.agentsBySessionName.get(session.name);
      return Boolean(agent && agent.status === 'idle');
    });
    verboseLogCtx(ctx, `notifyQAOfQueuedPRs: idleQA=${idleQASessions.length}`);

    const dispatchedList: Array<{
      prId: string;
      qaName: string;
      storyId: string | null;
      githubPrUrl: string | null;
    }> = [];
    let dispatchCount = 0;
    for (const qa of idleQASessions) {
      const nextPR = queued[dispatchCount];
      if (!nextPR) break;

      await withTransaction(
        db.db,
        () => {
          updatePullRequest(db.db, nextPR.id, {
            status: 'reviewing',
            reviewedBy: qa.name,
          });
          createLog(db.db, {
            agentId: qa.name,
            storyId: nextPR.story_id || undefined,
            eventType: 'PR_REVIEW_STARTED',
            message: `Manager assigned PR review: ${nextPR.id}`,
            metadata: { pr_id: nextPR.id, branch: nextPR.branch_name },
          });
        },
        () => db.save()
      );
      dispatchedList.push({
        prId: nextPR.id,
        qaName: qa.name,
        storyId: nextPR.story_id,
        githubPrUrl: nextPR.github_pr_url,
      });
      dispatchCount++;
      verboseLogCtx(ctx, `notifyQAOfQueuedPRs: assigned pr=${nextPR.id} -> ${qa.name}`);
    }
    return { queuedPRs: queued, dispatched: dispatchedList };
  });

  if (queuedPRs.length === 0) return;

  // Phase 2: Send tmux nudges (no lock needed)
  for (const d of dispatched) {
    const githubLine = d.githubPrUrl ? `\n# GitHub: ${d.githubPrUrl}` : '';
    await sendManagerNudge(
      ctx,
      d.qaName,
      `# You are assigned PR review ${d.prId} (${d.storyId || 'no-story'}).${githubLine}
# Execute now:
#   hive pr show ${d.prId}
#   hive pr approve ${d.prId}
# (If manual merge is required in this repo, use --no-merge.)
# or reject:
#   hive pr reject ${d.prId} -r "reason"`
    );
  }

  // Fallback nudge if PRs are still queued but all QA sessions are busy/unavailable.
  if (dispatched.length === 0) {
    verboseLogCtx(ctx, 'notifyQAOfQueuedPRs: no idle QA, sent queue nudge fallback');
    const qaSessions = ctx.hiveSessions.filter(s => s.name.includes('-qa-'));
    for (const qa of qaSessions) {
      await sendManagerNudge(
        ctx,
        qa.name,
        `# ${queuedPRs.length} PR(s) waiting in queue. Run: hive pr queue`
      );
    }
  }
}

/**
 * Auto-reject PRs where the QA agent posted review comments/feedback on GitHub
 * but never formally approved or rejected via `hive pr approve/reject`.
 *
 * Detection: PR is in 'reviewing' status, the assigned QA agent is idle,
 * and there are GitHub comments or CHANGES_REQUESTED reviews on the PR.
 *
 * Action: Auto-reject the PR with the QA's feedback as the rejection reason,
 * which triggers the standard qa_failed flow back to the developer agent.
 */
export async function autoRejectCommentOnlyReviews(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Identify reviewing PRs with idle QA agents (brief lock)
  const candidates = await ctx.withDb(async db => {
    const reviewingPRs = getPullRequestsByStatus(db.db, 'reviewing').filter(
      pr => pr.github_pr_number && pr.team_id && pr.reviewed_by
    );

    verboseLogCtx(ctx, `autoRejectCommentOnlyReviews: reviewingWithQA=${reviewingPRs.length}`);
    if (reviewingPRs.length === 0) return [];

    // Only consider PRs whose QA agent is idle (finished reviewing but didn't approve/reject)
    const idlePRs = reviewingPRs.filter(pr => {
      const qaAgent = ctx.agentsBySessionName.get(pr.reviewed_by!);
      if (!qaAgent) return false;
      // Check if the QA agent is idle or if their session shows idle state
      const qaState = agentStates.get(pr.reviewed_by!);
      return qaAgent.status === 'idle' || qaState?.lastState === AgentState.IDLE_AT_PROMPT;
    });

    verboseLogCtx(ctx, `autoRejectCommentOnlyReviews: idleQACandidates=${idlePRs.length}`);
    if (idlePRs.length === 0) return [];

    const { getAllTeams } = await import('../../../db/queries/teams.js');
    const teams = getAllTeams(db.db);
    const teamsById = new Map(teams.map(team => [team.id, team]));

    return idlePRs
      .map(pr => {
        const team = teamsById.get(pr.team_id!);
        if (!team?.repo_path) return null;
        return {
          id: pr.id,
          storyId: pr.story_id,
          teamId: pr.team_id!,
          branchName: pr.branch_name,
          githubPrNumber: pr.github_pr_number!,
          reviewedBy: pr.reviewed_by!,
          submittedBy: pr.submitted_by,
          repoDir: `${ctx.root}/${team.repo_path}`,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      storyId: string | null;
      branchName: string;
      githubPrNumber: number;
      reviewedBy: string;
      submittedBy: string | null;
      teamId: string;
      repoDir: string;
    }>;
  });

  if (candidates.length === 0) return;

  // Phase 2: Check GitHub for comments/reviews on each candidate (no lock)
  const toReject: Array<{
    candidate: (typeof candidates)[number];
    reason: string;
  }> = [];

  for (const candidate of candidates) {
    try {
      // Fetch both reviews and comments from GitHub
      const [reviews, comments] = await Promise.all([
        getPullRequestReviews(candidate.repoDir, candidate.githubPrNumber).catch(
          (): Array<{ author: string; state: string; body: string }> => []
        ),
        getPullRequestComments(candidate.repoDir, candidate.githubPrNumber).catch(
          (): Array<{ author: string; body: string; createdAt: string }> => []
        ),
      ]);

      // If there's a formal APPROVED review, skip (QA approved via GitHub directly)
      const hasApproval = reviews.some(r => r.state === 'APPROVED');
      if (hasApproval) {
        verboseLogCtx(
          ctx,
          `autoRejectCommentOnlyReviews: pr=${candidate.id} has GitHub approval, skipping`
        );
        continue;
      }

      // Check for CHANGES_REQUESTED reviews
      const changesRequested = reviews.filter(r => r.state === 'CHANGES_REQUESTED');

      // Check for substantive issue comments (filter out bot noise and very short comments)
      const substantiveComments = comments.filter(c => {
        if (c.body.length < 20) return false;
        // Skip known bot comments (Ellipsis, etc.)
        if (c.body.includes('Looks good to me') && c.body.length < 100) return false;
        return true;
      });

      // If there are review feedback items, auto-reject
      if (changesRequested.length > 0 || substantiveComments.length > 0) {
        // Build rejection reason from the feedback
        const feedbackParts: string[] = [];
        for (const review of changesRequested) {
          if (review.body) feedbackParts.push(review.body);
        }
        for (const comment of substantiveComments) {
          feedbackParts.push(comment.body);
        }
        const reason =
          feedbackParts.length > 0
            ? feedbackParts.join('\n---\n').slice(0, 2000)
            : 'QA posted review feedback on GitHub without formal approval. See PR comments.';

        toReject.push({ candidate, reason });
        verboseLogCtx(
          ctx,
          `autoRejectCommentOnlyReviews: pr=${candidate.id} has ${changesRequested.length} changes_requested + ${substantiveComments.length} comments, will auto-reject`
        );
      }
    } catch (err) {
      verboseLogCtx(
        ctx,
        `autoRejectCommentOnlyReviews: skip pr=${candidate.id} github_check_failed=${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (toReject.length === 0) return;

  // Phase 3: Reject PRs in DB (brief lock)
  await ctx.withDb(async db => {
    for (const { candidate, reason } of toReject) {
      await withTransaction(
        db.db,
        () => {
          updatePullRequest(db.db, candidate.id, {
            status: 'rejected',
            reviewNotes: reason,
          });
          if (candidate.storyId) {
            updateStory(db.db, candidate.storyId, { status: 'qa_failed' });
          }
          createLog(db.db, {
            agentId: 'manager',
            eventType: 'PR_REJECTED',
            message: `Auto-rejected PR ${candidate.id}: QA posted review comments without formal approve/reject`,
            storyId: candidate.storyId || undefined,
            metadata: { pr_id: candidate.id, auto_rejected: true },
          });
        },
        () => db.save()
      );
      console.log(
        chalk.yellow(
          `  Auto-rejected PR ${candidate.id} (story: ${candidate.storyId || '-'}): QA left review comments without approving`
        )
      );
    }
  });

  // Phase 4: Notify developer agents via tmux (no lock)
  for (const { candidate, reason } of toReject) {
    if (candidate.submittedBy) {
      const devSession = ctx.hiveSessions.find(s => s.name === candidate.submittedBy);
      if (devSession) {
        await sendManagerNudge(
          ctx,
          devSession.name,
          `# ⚠️ PR AUTO-REJECTED - QA REVIEW FEEDBACK ⚠️
# Story: ${candidate.storyId || 'Unknown'}
# QA agent (${candidate.reviewedBy}) posted review feedback without formally approving.
# Feedback:
# ${reason.split('\n').slice(0, 10).join('\n# ')}
#
# Fix the issues and resubmit: hive pr submit -b ${candidate.branchName} -s ${candidate.storyId || 'STORY-ID'} --from ${devSession.name}`
        );
      }
    }
  }
}

export async function handleRejectedPRs(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read rejected PRs and update DB (brief lock)
  const rejectedPRData = await ctx.withDb(async db => {
    const rejectedPRs = getPullRequestsByStatus(db.db, 'rejected');
    verboseLogCtx(ctx, `handleRejectedPRs: rejected=${rejectedPRs.length}`);
    if (rejectedPRs.length === 0) return [];

    const prData: Array<{
      id: string;
      storyId: string | null;
      branchName: string;
      reviewNotes: string | null;
      submittedBy: string | null;
    }> = [];

    for (const pr of rejectedPRs) {
      if (pr.story_id) {
        const storyId = pr.story_id;
        await withTransaction(
          db.db,
          () => {
            updateStory(db.db, storyId, { status: 'qa_failed' });
            createLog(db.db, {
              agentId: 'manager',
              eventType: 'STORY_QA_FAILED',
              message: `Story ${storyId} QA failed: ${pr.review_notes || 'See review comments'}`,
              storyId: storyId,
            });
          },
          () => db.save()
        );

        // Sync status change to Jira
        await syncStatusForStory(ctx.root, db.db, storyId, 'qa_failed');
      }

      // Mark as closed to prevent re-notification spam
      await withTransaction(
        db.db,
        () => {
          updatePullRequest(db.db, pr.id, { status: 'closed' });
        },
        () => db.save()
      );

      prData.push({
        id: pr.id,
        storyId: pr.story_id,
        branchName: pr.branch_name,
        reviewNotes: pr.review_notes,
        submittedBy: pr.submitted_by,
      });
    }
    return prData;
  });

  if (rejectedPRData.length === 0) return;

  // Phase 2: Send tmux notifications (no lock needed)
  let rejectionNotified = 0;
  for (const pr of rejectedPRData) {
    if (pr.submittedBy) {
      const devSession = ctx.hiveSessions.find(s => s.name === pr.submittedBy);
      if (devSession) {
        verboseLogCtx(
          ctx,
          `handleRejectedPRs: notifying ${devSession.name} for pr=${pr.id}, story=${pr.storyId || '-'}`
        );
        await sendManagerNudge(
          ctx,
          devSession.name,
          `# ⚠️ PR REJECTED - ACTION REQUIRED ⚠️
# Story: ${pr.storyId || 'Unknown'}
# Reason: ${pr.reviewNotes || 'See review comments'}
#
# You MUST fix this issue before doing anything else.
# Fix the issues and resubmit: hive pr submit -b ${pr.branchName} -s ${pr.storyId || 'STORY-ID'} --from ${devSession.name}`
        );
        rejectionNotified++;
      }
    }
  }

  console.log(chalk.yellow(`  Notified ${rejectionNotified} developer(s) of PR rejection(s)`));
}
