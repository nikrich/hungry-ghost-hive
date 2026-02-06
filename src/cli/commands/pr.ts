import { Command } from 'commander';
import chalk from 'chalk';
import { execa } from 'execa';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase, queryAll } from '../../db/client.js';
import {
  createPullRequest,
  getMergeQueue,
  getNextInQueue,
  getPullRequestById,
  updatePullRequest,
  getQueuePosition,
  getOpenPullRequestsByStory,
  type PullRequestRow,
} from '../../db/queries/pull-requests.js';
import { getStoryById, updateStory } from '../../db/queries/stories.js';
import { getTeamById } from '../../db/queries/teams.js';
import { createLog } from '../../db/queries/logs.js';
import { join } from 'path';
import { loadConfig } from '../../config/loader.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { sendToTmuxSession, isTmuxSessionRunning } from '../../tmux/manager.js';

export const prCommand = new Command('pr')
  .description('Manage pull requests and merge queue');

// Submit a PR to the merge queue
prCommand
  .command('submit')
  .description('Submit a PR to the merge queue')
  .requiredOption('-b, --branch <branch>', 'Branch name')
  .option('-s, --story <story-id>', 'Associated story ID')
  .option('-t, --team <team-id>', 'Team ID')
  .option('--pr-number <number>', 'GitHub PR number')
  .option('--pr-url <url>', 'GitHub PR URL')
  .option('--from <session>', 'Submitting agent session')
  .action(async (options: {
    branch: string;
    story?: string;
    team?: string;
    prNumber?: string;
    prUrl?: string;
    from?: string;
  }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      // If story ID provided, get team from story
      let teamId = options.team || null;
      const storyId = options.story || null;

      if (storyId) {
        const story = getStoryById(db.db, storyId);
        if (story) {
          teamId = story.team_id;

          // Auto-close any existing open PRs for this story
          const existingPRs = getOpenPullRequestsByStory(db.db, storyId);
          for (const existingPR of existingPRs) {
            updatePullRequest(db.db, existingPR.id, { status: 'closed' });
            createLog(db.db, {
              agentId: options.from || 'system',
              storyId,
              eventType: 'PR_CLOSED',
              message: `Auto-closed duplicate PR ${existingPR.id}`,
              metadata: { pr_id: existingPR.id, reason: 'duplicate' },
            });
          }

          // Update story status
          updateStory(db.db, storyId, { status: 'pr_submitted' });
        }
      }

      const pr = createPullRequest(db.db, {
        storyId,
        teamId,
        branchName: options.branch,
        githubPrNumber: options.prNumber ? parseInt(options.prNumber, 10) : null,
        githubPrUrl: options.prUrl || null,
        submittedBy: options.from || null,
      });

      db.save();

      const position = getQueuePosition(db.db, pr.id);

      console.log(chalk.green(`PR submitted to merge queue`));
      console.log(chalk.gray(`  ID: ${pr.id}`));
      console.log(chalk.gray(`  Branch: ${pr.branch_name}`));
      console.log(chalk.gray(`  Queue position: ${position}`));
      if (pr.github_pr_url) {
        console.log(chalk.gray(`  GitHub: ${pr.github_pr_url}`));
      }

      if (options.from) {
        createLog(db.db, {
          agentId: options.from,
          storyId: storyId || undefined,
          eventType: 'PR_SUBMITTED',
          message: `Submitted PR for branch ${options.branch}`,
          metadata: { pr_id: pr.id, queue_position: position },
        });
        db.save();
      }

      // Check if QA agents need to be spawned for the merge queue
      try {
        const config = loadConfig(paths.hiveDir);
        const scheduler = new Scheduler(db.db, {
          scaling: config.scaling,
          models: config.models,
          rootDir: root,
        });
        await scheduler.checkMergeQueue();
        db.save();
        console.log(chalk.gray('  QA agents notified'));
      } catch {
        // Non-fatal - QA can be triggered manually
      }
    } finally {
      db.close();
    }
  });

// View merge queue
prCommand
  .command('queue')
  .description('View the merge queue')
  .option('-t, --team <team-id>', 'Filter by team')
  .option('--json', 'Output as JSON')
  .action(async (options: { team?: string; json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const queue = getMergeQueue(db.db, options.team);

      if (options.json) {
        console.log(JSON.stringify(queue, null, 2));
        return;
      }

      if (queue.length === 0) {
        console.log(chalk.yellow('Merge queue is empty.'));
        return;
      }

      console.log(chalk.bold('\nMerge Queue:\n'));
      console.log(chalk.gray(
        `${'#'.padEnd(4)} ${'ID'.padEnd(15)} ${'Branch'.padEnd(30)} ${'Status'.padEnd(12)} ${'Story'}`
      ));
      console.log(chalk.gray('─'.repeat(80)));

      queue.forEach((pr, index) => {
        const statusColor = pr.status === 'reviewing' ? chalk.yellow : chalk.blue;
        console.log(
          `${String(index + 1).padEnd(4)} ` +
          `${chalk.cyan(pr.id.padEnd(15))} ` +
          `${pr.branch_name.padEnd(30)} ` +
          `${statusColor(pr.status.toUpperCase().padEnd(12))} ` +
          `${pr.story_id || '-'}`
        );
      });
      console.log();
    } finally {
      db.close();
    }
  });

// Claim next PR for review (QA)
prCommand
  .command('review')
  .description('Claim the next PR in queue for review (QA)')
  .option('-t, --team <team-id>', 'Filter by team')
  .option('--from <session>', 'QA agent session')
  .action(async (options: { team?: string; from?: string }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const pr = getNextInQueue(db.db, options.team);

      if (!pr) {
        console.log(chalk.yellow('No PRs waiting for review.'));
        return;
      }

      updatePullRequest(db.db, pr.id, {
        status: 'reviewing',
        reviewedBy: options.from || null,
      });
      db.save();

      console.log(chalk.green(`Claimed PR for review: ${pr.id}`));
      console.log(chalk.gray(`  Branch: ${pr.branch_name}`));
      console.log(chalk.gray(`  Story: ${pr.story_id || '-'}`));
      if (pr.github_pr_url) {
        console.log(chalk.gray(`  GitHub: ${pr.github_pr_url}`));
      }
      console.log();
      console.log(chalk.cyan('To approve and merge:'));
      console.log(chalk.gray(`  hive pr approve ${pr.id}`));
      console.log(chalk.cyan('To reject:'));
      console.log(chalk.gray(`  hive pr reject ${pr.id} --reason "..."`));

      if (options.from) {
        createLog(db.db, {
          agentId: options.from,
          storyId: pr.story_id || undefined,
          eventType: 'PR_REVIEW_STARTED',
          message: `Started reviewing PR ${pr.id}`,
          metadata: { pr_id: pr.id, branch: pr.branch_name },
        });
        db.save();
      }
    } finally {
      db.close();
    }
  });

// View specific PR
prCommand
  .command('show <pr-id>')
  .description('View details of a PR')
  .action(async (prId: string) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const pr = getPullRequestById(db.db, prId);
      if (!pr) {
        console.error(chalk.red(`PR not found: ${prId}`));
        process.exit(1);
      }

      console.log(chalk.bold(`\nPull Request: ${pr.id}\n`));
      console.log(chalk.gray(`Branch:       ${pr.branch_name}`));
      console.log(chalk.gray(`Status:       ${pr.status.toUpperCase()}`));
      console.log(chalk.gray(`Story:        ${pr.story_id || '-'}`));
      console.log(chalk.gray(`Team:         ${pr.team_id || '-'}`));
      console.log(chalk.gray(`GitHub PR:    ${pr.github_pr_url || '-'}`));
      console.log(chalk.gray(`Submitted by: ${pr.submitted_by || '-'}`));
      console.log(chalk.gray(`Reviewed by:  ${pr.reviewed_by || '-'}`));
      console.log(chalk.gray(`Created:      ${pr.created_at}`));
      if (pr.reviewed_at) {
        console.log(chalk.gray(`Reviewed:     ${pr.reviewed_at}`));
      }
      if (pr.review_notes) {
        console.log(chalk.bold('\nReview Notes:'));
        console.log(pr.review_notes);
      }

      const position = getQueuePosition(db.db, pr.id);
      if (position > 0) {
        console.log(chalk.cyan(`\nQueue Position: ${position}`));
      }
      console.log();
    } finally {
      db.close();
    }
  });

// Approve and merge PR
prCommand
  .command('approve <pr-id>')
  .description('Approve and merge a PR')
  .option('--notes <notes>', 'Review notes')
  .option('--from <session>', 'QA agent session')
  .option('--no-merge', 'Approve without merging (manual merge needed)')
  .action(async (prId: string, options: { notes?: string; from?: string; merge?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const pr = getPullRequestById(db.db, prId);
      if (!pr) {
        console.error(chalk.red(`PR not found: ${prId}`));
        process.exit(1);
      }

      if (pr.status === 'merged') {
        console.log(chalk.yellow('PR already merged.'));
        return;
      }

      // Extract story ID from PR or branch name
      let storyId = pr.story_id;
      if (!storyId && pr.branch_name) {
        const storyMatch = pr.branch_name.match(/STORY-[A-Z0-9-]+/i);
        if (storyMatch) {
          storyId = storyMatch[0].toUpperCase();
        }
      }

      const shouldMerge = options.merge !== false;
      let actuallyMerged = false;

      if (shouldMerge && pr.github_pr_number) {
        // Actually merge on GitHub via gh CLI
        // Use the team's repo path as cwd so gh knows which repo to operate on
        let repoCwd = root;
        if (pr.team_id) {
          const team = getTeamById(db.db, pr.team_id);
          if (team?.repo_path) {
            repoCwd = join(root, team.repo_path);
          }
        }
        try {
          const { execSync } = await import('child_process');
          // First approve the PR on GitHub
          try {
            execSync(`gh pr review ${pr.github_pr_number} --approve`, { stdio: 'pipe', cwd: repoCwd });
          } catch {
            // May fail if already approved or if it's our own PR - continue
          }
          // Then merge
          execSync(`gh pr merge ${pr.github_pr_number} --squash --delete-branch`, { stdio: 'pipe', cwd: repoCwd });
          actuallyMerged = true;
          console.log(chalk.green(`PR ${prId} approved and merged on GitHub!`));
        } catch (mergeErr: unknown) {
          const errMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
          console.log(chalk.yellow(`GitHub merge failed: ${errMsg}`));
          console.log(chalk.yellow('Marking as approved (manual merge needed).'));
        }
      } else if (shouldMerge && !pr.github_pr_number) {
        console.log(chalk.yellow('No GitHub PR number linked - marking as approved only.'));
      }

      const newStatus = actuallyMerged ? 'merged' : 'approved';

      updatePullRequest(db.db, prId, {
        status: newStatus,
        reviewedBy: options.from || pr.reviewed_by,
        reviewNotes: options.notes || null,
      });

      if (storyId && newStatus === 'merged') {
        updateStory(db.db, storyId, { status: 'merged' });
      }

      db.save();

      if (!actuallyMerged && shouldMerge) {
        console.log(chalk.green(`PR ${prId} approved.`));
        console.log(chalk.gray('Manual merge is needed on GitHub.'));
      } else if (!shouldMerge) {
        console.log(chalk.green(`PR ${prId} approved.`));
        console.log(chalk.gray('Manual merge is needed.'));
      }

      if (options.from) {
        createLog(db.db, {
          agentId: options.from,
          storyId: storyId || undefined,
          eventType: newStatus === 'merged' ? 'PR_MERGED' : 'PR_APPROVED',
          message: `${newStatus === 'merged' ? 'Merged' : 'Approved'} PR ${prId}${storyId ? ` (${storyId})` : ''}`,
          metadata: { pr_id: prId, branch: pr.branch_name, story_id: storyId },
        });
        db.save();
      }
    } finally {
      db.close();
    }
  });

// Reject PR
prCommand
  .command('reject <pr-id>')
  .description('Reject a PR and send back for fixes')
  .requiredOption('-r, --reason <reason>', 'Reason for rejection')
  .option('--from <session>', 'QA agent session')
  .action(async (prId: string, options: { reason: string; from?: string }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const pr = getPullRequestById(db.db, prId);
      if (!pr) {
        console.error(chalk.red(`PR not found: ${prId}`));
        process.exit(1);
      }

      updatePullRequest(db.db, prId, {
        status: 'rejected',
        reviewedBy: options.from || pr.reviewed_by,
        reviewNotes: options.reason,
      });

      // Update story status - extract from branch name if not directly linked
      let storyId = pr.story_id;
      if (!storyId && pr.branch_name) {
        const storyMatch = pr.branch_name.match(/STORY-\d+-[A-Z]+/i);
        if (storyMatch) {
          storyId = storyMatch[0].toUpperCase();
        }
      }
      if (storyId) {
        updateStory(db.db, storyId, { status: 'qa_failed' });
      }

      db.save();

      console.log(chalk.yellow(`PR ${prId} rejected.`));
      console.log(chalk.gray(`Reason: ${options.reason}`));

      // Auto-notify the developer via tmux if their session is running
      if (pr.submitted_by) {
        try {
          if (await isTmuxSessionRunning(pr.submitted_by)) {
            await sendToTmuxSession(pr.submitted_by,
              `# PR REJECTED: ${prId}\n# Reason: ${options.reason}\n# Please fix the issues and resubmit.`
            );
            console.log(chalk.green(`Developer ${pr.submitted_by} notified via tmux`));
          } else {
            console.log(chalk.cyan(`\nNotify the developer:`));
            console.log(chalk.gray(`  hive msg send ${pr.submitted_by} "PR rejected: ${options.reason}" --from ${options.from || 'qa'}`));
          }
        } catch {
          console.log(chalk.cyan(`\nNotify the developer:`));
          console.log(chalk.gray(`  hive msg send ${pr.submitted_by} "PR rejected: ${options.reason}" --from ${options.from || 'qa'}`));
        }
      }

      if (options.from) {
        createLog(db.db, {
          agentId: options.from,
          storyId: storyId || undefined,
          eventType: 'PR_REJECTED',
          message: `Rejected PR ${prId}${storyId ? ` (${storyId})` : ''}: ${options.reason}`,
          metadata: { pr_id: prId, branch: pr.branch_name, story_id: storyId },
        });
        db.save();
      }
    } finally {
      db.close();
    }
  });

// Sync GitHub PRs into the merge queue
prCommand
  .command('sync')
  .description('Import open GitHub PRs into the merge queue')
  .option('-r, --repo <path>', 'Repository path (relative to repos/)')
  .action(async (options: { repo?: string }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      // Get ALL existing PRs (including merged/closed) to prevent duplicate imports
      const existingPRs = queryAll<PullRequestRow>(db.db,
        'SELECT * FROM pull_requests'
      );
      const existingBranches = new Set(existingPRs.filter(pr => !['merged', 'closed'].includes(pr.status)).map(pr => pr.branch_name));
      const existingPrNumbers = new Set(existingPRs.map(pr => pr.github_pr_number).filter(Boolean));

      // Find repo directories
      const repoDir = options.repo
        ? `${root}/repos/${options.repo}`
        : process.cwd();

      console.log(chalk.cyan(`Checking for open PRs in ${repoDir}...`));

      // Get open PRs from GitHub
      let ghPRs: Array<{ number: number; headRefName: string; url: string; title: string }> = [];
      try {
        const result = await execa('gh', ['pr', 'list', '--json', 'number,headRefName,url,title', '--state', 'open'], {
          cwd: repoDir,
        });
        ghPRs = JSON.parse(result.stdout);
      } catch (err) {
        console.error(chalk.red('Failed to list GitHub PRs. Is gh CLI authenticated?'), err);
        process.exit(1);
      }

      if (ghPRs.length === 0) {
        console.log(chalk.yellow('No open PRs found on GitHub.'));
        return;
      }

      let imported = 0;
      for (const ghPR of ghPRs) {
        // Skip if already in queue
        if (existingBranches.has(ghPR.headRefName) || existingPrNumbers.has(ghPR.number)) {
          console.log(chalk.gray(`  Skipping PR #${ghPR.number} (${ghPR.headRefName}) - already in queue`));
          continue;
        }

        // Try to match to a story by parsing branch name (e.g., feature/STORY-001-description)
        const storyMatch = ghPR.headRefName.match(/STORY-\d+/i);
        const storyId = storyMatch ? storyMatch[0].toUpperCase() : null;

        const pr = createPullRequest(db.db, {
          storyId,
          teamId: null,
          branchName: ghPR.headRefName,
          githubPrNumber: ghPR.number,
          githubPrUrl: ghPR.url,
          submittedBy: null,
        });

        console.log(chalk.green(`  Imported: PR #${ghPR.number} (${ghPR.headRefName}) → ${pr.id}`));
        imported++;
      }

      db.save();

      if (imported > 0) {
        console.log(chalk.green(`\nImported ${imported} PR(s) into merge queue.`));

        // Trigger QA check
        try {
          const config = loadConfig(paths.hiveDir);
          const scheduler = new Scheduler(db.db, {
            scaling: config.scaling,
            models: config.models,
            rootDir: root,
          });
          await scheduler.checkMergeQueue();
          db.save();
          console.log(chalk.gray('QA agents notified.'));
        } catch {
          // Non-fatal
        }
      } else {
        console.log(chalk.yellow('\nNo new PRs to import.'));
      }
    } finally {
      db.close();
    }
  });
