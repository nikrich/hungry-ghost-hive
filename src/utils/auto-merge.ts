// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import { loadConfig } from '../config/loader.js';
import type { DatabaseClient } from '../db/client.js';
import { queryOne, withTransaction } from '../db/client.js';
import { getAgentById, updateAgent } from '../db/queries/agents.js';
import { createLog } from '../db/queries/logs.js';
import { getApprovedPullRequests, updatePullRequest } from '../db/queries/pull-requests.js';
import { getStoryById, updateStory } from '../db/queries/stories.js';
import { getAllTeams } from '../db/queries/teams.js';
import { postJiraLifecycleComment } from '../integrations/jira/comments.js';
import { getHivePaths } from './paths.js';
import { ghRepoSlug } from './pr-sync.js';

/** Timeout in ms for checking PR state via GitHub API */
const PR_STATE_CHECK_TIMEOUT_MS = 30000;
/** Timeout in ms for GitHub merge operations */
const PR_MERGE_TIMEOUT_MS = 60000;

interface GitHubPRState {
  state: string;
  mergeable: string;
}

/**
 * Auto-merge all approved PRs that are ready to merge
 * Can be called immediately after PR approval or from manager daemon
 *
 * @param root - Hive root directory
 * @param db - Database client
 * @returns Number of PRs successfully merged
 */
export async function autoMergeApprovedPRs(root: string, db: DatabaseClient): Promise<number> {
  // Load config to check autonomy level
  const paths = getHivePaths(root);
  const config = loadConfig(paths.hiveDir);

  // Skip auto-merge in partial autonomy mode
  if (config.integrations.autonomy.level === 'partial') {
    return 0;
  }

  const approvedPRs = getApprovedPullRequests(db.db);
  if (approvedPRs.length === 0) return 0;

  let mergedCount = 0;

  for (const pr of approvedPRs) {
    // Skip PRs without GitHub PR numbers
    if (!pr.github_pr_number) continue;

    try {
      // Atomically claim this PR for merging using optimistic locking
      // This prevents race conditions when multiple managers run concurrently
      let claimed = false;
      await withTransaction(db.db, () => {
        // Re-fetch PR status to ensure it's still 'approved'
        const currentPR = queryOne<{ status: string }>(
          db.db,
          `SELECT status FROM pull_requests WHERE id = ?`,
          [pr.id]
        );

        if (currentPR?.status === 'approved') {
          // Update to 'queued' status (temporary merge-in-progress state)
          // Only this manager will proceed if status was 'approved'
          updatePullRequest(db.db, pr.id, { status: 'queued' });
          claimed = true;
        }
      });
      db.save();

      // If we didn't claim the PR, another manager is already merging it
      if (!claimed) continue;

      // Get team to find repo path and repo slug for gh -R flag
      let teamId = pr.team_id;
      let repoCwd = root;
      let repoSlug: string | null = null;

      if (teamId) {
        const team = getAllTeams(db.db).find(t => t.id === teamId);
        if (team?.repo_path) {
          repoCwd = join(root, team.repo_path);
        }
        if (team?.repo_url) {
          repoSlug = ghRepoSlug(team.repo_url);
        }
      } else if (pr.branch_name) {
        // Try to find team by matching branch name pattern
        const teams = getAllTeams(db.db);
        for (const team of teams) {
          if (team.repo_path) {
            repoCwd = join(root, team.repo_path);
            teamId = team.id;
            if (team.repo_url) {
              repoSlug = ghRepoSlug(team.repo_url);
            }
            break;
          }
        }
      }
      const repoFlag = repoSlug ? ` -R ${repoSlug}` : '';

      // Check if PR is still open and mergeable before attempting merge
      const { execSync } = await import('child_process');
      try {
        // Verify PR state and mergeable status
        let prState: GitHubPRState;
        let mergeableStatus: boolean;
        try {
          const prViewOutput = execSync(
            `gh pr view ${pr.github_pr_number} --json state,mergeable${repoFlag}`,
            {
              stdio: 'pipe',
              cwd: repoCwd,
              encoding: 'utf-8',
              timeout: PR_STATE_CHECK_TIMEOUT_MS,
            }
          );
          prState = JSON.parse(prViewOutput);
          mergeableStatus = prState.mergeable === 'MERGEABLE';
        } catch (_error) {
          // If we can't determine PR status, skip this PR
          createLog(db.db, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_SKIPPED',
            status: 'warn',
            message: `Skipped auto-merge of PR ${pr.id} (GitHub PR #${pr.github_pr_number}): Could not determine PR status`,
            metadata: { pr_id: pr.id },
          });
          continue;
        }

        // Check if PR is still open
        if (prState.state !== 'OPEN') {
          // PR is not open (closed, merged, or draft), skip merge attempt
          const newStatus = prState.state === 'MERGED' ? 'merged' : 'closed';
          await withTransaction(db.db, () => {
            updatePullRequest(db.db, pr.id, { status: newStatus });
            // Also update story status to stay in sync with GitHub
            if (pr.story_id && prState.state === 'MERGED') {
              // Clear the assigned agent's currentStoryId so it can be reassigned or spun down
              const story = getStoryById(db.db, pr.story_id);
              if (story?.assigned_agent_id) {
                const agent = getAgentById(db.db, story.assigned_agent_id);
                if (agent && agent.current_story_id === pr.story_id) {
                  updateAgent(db.db, agent.id, { currentStoryId: null, status: 'idle' });
                }
              }

              updateStory(db.db, pr.story_id, { status: 'merged', assignedAgentId: null });
              createLog(db.db, {
                agentId: 'manager',
                storyId: pr.story_id,
                eventType: 'STORY_MERGED',
                message: `Story merged (PR #${pr.github_pr_number} was already merged on GitHub)`,
                metadata: { pr_id: pr.id },
              });

              // Post Jira comment for merged event
              postJiraLifecycleComment(db.db, paths.hiveDir, config, pr.story_id, 'merged').catch(
                () => {
                  /* non-fatal */
                }
              );
            }
            createLog(db.db, {
              agentId: 'manager',
              storyId: pr.story_id || undefined,
              eventType: 'PR_MERGE_SKIPPED',
              message: `PR #${pr.github_pr_number} is already ${prState.state.toLowerCase()}, skipping merge`,
              metadata: { pr_id: pr.id, github_state: prState.state },
            });
          });
          db.save();
          continue;
        }

        // Check if PR has merge conflicts
        if (!mergeableStatus) {
          // PR has conflicts - skip merge
          createLog(db.db, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_SKIPPED',
            status: 'warn',
            message: `Skipped auto-merge of PR ${pr.id} (GitHub PR #${pr.github_pr_number}): PR has merge conflicts`,
            metadata: { pr_id: pr.id },
          });
          continue;
        }

        // Use --auto flag to enable GitHub's auto-merge feature (idempotent if already merged)
        // Add timeout to prevent blocking the manager daemon (60s for GitHub API operations)
        execSync(`gh pr merge ${pr.github_pr_number} --auto --squash --delete-branch${repoFlag}`, {
          stdio: 'pipe',
          cwd: repoCwd,
          timeout: PR_MERGE_TIMEOUT_MS,
        });

        // Update PR and story status, create logs (atomic transaction)
        const storyId = pr.story_id;
        await withTransaction(db.db, () => {
          updatePullRequest(db.db, pr.id, { status: 'merged' });

          if (storyId) {
            updateStory(db.db, storyId, { status: 'merged' });

            // Clear the assigned agent's currentStoryId so it can be reassigned or spun down
            const story = getStoryById(db.db, storyId);
            if (story?.assigned_agent_id) {
              const agent = getAgentById(db.db, story.assigned_agent_id);
              if (agent && agent.current_story_id === storyId) {
                updateAgent(db.db, agent.id, { currentStoryId: null, status: 'idle' });
              }
            }

            createLog(db.db, {
              agentId: 'manager',
              storyId: storyId,
              eventType: 'STORY_MERGED',
              message: `Story auto-merged from GitHub PR #${pr.github_pr_number}`,
            });
          } else {
            createLog(db.db, {
              agentId: 'manager',
              eventType: 'PR_MERGED',
              message: `PR ${pr.id} auto-merged (GitHub PR #${pr.github_pr_number})`,
              metadata: { pr_id: pr.id },
            });
          }
        });

        mergedCount++;
        db.save();

        // Post Jira comment for merged event
        if (storyId) {
          postJiraLifecycleComment(db.db, paths.hiveDir, config, storyId, 'merged').catch(() => {
            /* non-fatal */
          });
        }
      } catch (mergeErr) {
        // Merge failed - revert PR status back to approved for retry (atomic transaction)
        await withTransaction(db.db, () => {
          updatePullRequest(db.db, pr.id, { status: 'approved' });
          createLog(db.db, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_FAILED',
            status: 'error',
            message: `Failed to auto-merge PR ${pr.id} (GitHub PR #${pr.github_pr_number}): ${mergeErr instanceof Error ? mergeErr.message : 'Unknown error'}`,
            metadata: { pr_id: pr.id },
          });
        });
        db.save();
      }
    } catch (_error) {
      // Non-fatal - continue with other PRs
      continue;
    }
  }

  return mergedCount;
}
