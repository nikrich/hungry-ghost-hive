// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { execSync } from 'child_process';
import { join } from 'path';
import { queryAll, type AgentLogRow } from '../../../db/client.js';
import { getAgentsByType } from '../../../db/queries/agents.js';
import { createLog } from '../../../db/queries/logs.js';
import { getRequirementById, updateRequirement } from '../../../db/queries/requirements.js';
import { getAllTeams } from '../../../db/queries/teams.js';
import type { ManagerCheckContext } from './types.js';

function verboseLogCtx(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  if (!ctx.verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

interface FeatureTestCandidate {
  agentId: string;
  requirementId: string;
  featureBranch: string;
  testsPassed: boolean;
  testMessage: string;
  repoPath: string;
  requirementTitle: string;
}

/**
 * Check for completed feature_test agents and handle their E2E test results.
 * On success: merge feature branch to main and update requirement to sign_off_passed.
 * On failure: update requirement to sign_off_failed and create escalation.
 */
export async function checkFeatureTestResult(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read DB to find candidates (brief lock)
  const candidates = await ctx.withDb(async db => {
    const featureTestAgents = getAgentsByType(db.db, 'feature_test');
    verboseLogCtx(ctx, `checkFeatureTestResult: agents=${featureTestAgents.length}`);

    if (featureTestAgents.length === 0) return [];

    const result: FeatureTestCandidate[] = [];

    for (const agent of featureTestAgents) {
      const recentLogs = queryAll<AgentLogRow>(
        db.db,
        `
        SELECT * FROM agent_logs
        WHERE agent_id = ?
        AND event_type = 'STORY_PROGRESS_UPDATE'
        AND message LIKE '%E2E tests%'
        ORDER BY timestamp DESC
        LIMIT 1
      `,
        [agent.id]
      );

      if (recentLogs.length === 0) {
        verboseLogCtx(ctx, `checkFeatureTestResult: agent=${agent.id} skip=no_test_results`);
        continue;
      }

      const resultLog = recentLogs[0];
      const message = resultLog.message || '';

      const alreadyProcessed = queryAll<AgentLogRow>(
        db.db,
        `
        SELECT * FROM agent_logs
        WHERE agent_id = 'manager'
        AND event_type IN ('FEATURE_SIGN_OFF_PASSED', 'FEATURE_SIGN_OFF_FAILED')
        AND metadata LIKE ?
        LIMIT 1
      `,
        [`%"agent_id":"${agent.id}"%`]
      );

      if (alreadyProcessed.length > 0) {
        verboseLogCtx(ctx, `checkFeatureTestResult: agent=${agent.id} skip=already_processed`);
        continue;
      }

      const spawnLog = queryAll<AgentLogRow>(
        db.db,
        `
        SELECT * FROM agent_logs
        WHERE agent_id = ?
        AND event_type = 'FEATURE_TEST_SPAWNED'
        ORDER BY timestamp DESC
        LIMIT 1
      `,
        [agent.id]
      );

      if (spawnLog.length === 0) {
        verboseLogCtx(ctx, `checkFeatureTestResult: agent=${agent.id} skip=no_spawn_log`);
        continue;
      }

      const spawnMetadata = spawnLog[0].metadata ? JSON.parse(spawnLog[0].metadata) : null;
      const requirementId = spawnMetadata?.requirement_id;

      if (!requirementId) {
        verboseLogCtx(ctx, `checkFeatureTestResult: agent=${agent.id} skip=no_requirement_id`);
        continue;
      }

      const requirement = getRequirementById(db.db, requirementId);
      if (!requirement) {
        verboseLogCtx(
          ctx,
          `checkFeatureTestResult: agent=${agent.id} skip=requirement_not_found id=${requirementId}`
        );
        continue;
      }

      if (requirement.status !== 'sign_off') {
        verboseLogCtx(
          ctx,
          `checkFeatureTestResult: agent=${agent.id} skip=wrong_status requirement=${requirementId} status=${requirement.status}`
        );
        continue;
      }

      const featureBranch = requirement.feature_branch;
      if (!featureBranch) {
        verboseLogCtx(
          ctx,
          `checkFeatureTestResult: agent=${agent.id} skip=no_feature_branch requirement=${requirementId}`
        );
        continue;
      }

      const testsPassed = message.includes('E2E tests PASSED');
      const testsFailed = message.includes('E2E tests FAILED');

      if (!testsPassed && !testsFailed) {
        verboseLogCtx(
          ctx,
          `checkFeatureTestResult: agent=${agent.id} skip=unclear_result message="${message.substring(0, 100)}"`
        );
        continue;
      }

      // Find repo path
      const teams = getAllTeams(db.db);
      const team = teams.length > 0 ? teams[0] : null;
      if (!team) {
        verboseLogCtx(ctx, `checkFeatureTestResult: agent=${agent.id} skip=no_team`);
        continue;
      }

      verboseLogCtx(
        ctx,
        `checkFeatureTestResult: agent=${agent.id} requirement=${requirementId} result=${testsPassed ? 'PASSED' : 'FAILED'}`
      );

      result.push({
        agentId: agent.id,
        requirementId,
        featureBranch,
        testsPassed,
        testMessage: message,
        repoPath: join(ctx.root, team.repo_path),
        requirementTitle: requirement.title,
      });
    }

    return result;
  });

  // Phase 2: GitHub CLI operations and DB writes per candidate
  for (const candidate of candidates) {
    if (candidate.testsPassed) {
      await handleTestSuccess(ctx, candidate);
    } else {
      await handleTestFailure(ctx, candidate);
    }
  }
}

async function handleTestSuccess(
  ctx: ManagerCheckContext,
  candidate: FeatureTestCandidate
): Promise<void> {
  const { requirementId, featureBranch, testMessage, repoPath, requirementTitle, agentId } =
    candidate;
  verboseLogCtx(
    ctx,
    `handleTestSuccess: requirement=${requirementId} branch=${featureBranch} merging to main`
  );

  try {
    // Phase 2a: GitHub CLI operations (no lock)
    const prTitle = `feat: ${requirementTitle}`;
    const prBody = `## Feature Sign-off Complete

All stories for requirement ${requirementId} have been merged and E2E tests have passed.

### Test Results
${testMessage}

Co-Authored-By: Feature Test Agent <noreply@hive>`;

    const prResult = execSync(
      `gh pr create --base main --head "${featureBranch}" --title "${prTitle}" --body "${prBody}"`,
      {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );

    const prUrl = prResult.trim();
    verboseLogCtx(ctx, `handleTestSuccess: requirement=${requirementId} pr_created=${prUrl}`);

    const prNumber = prUrl.split('/').pop();
    execSync(`gh pr merge ${prNumber} --squash --delete-branch`, {
      cwd: repoPath,
      stdio: 'pipe',
    });

    verboseLogCtx(ctx, `handleTestSuccess: requirement=${requirementId} pr_merged=#${prNumber}`);

    // Phase 2b: DB writes (brief lock)
    await ctx.withDb(async db => {
      updateRequirement(db.db, requirementId, { status: 'sign_off_passed' });
      createLog(db.db, {
        agentId: 'manager',
        eventType: 'FEATURE_SIGN_OFF_PASSED',
        message: `Feature sign-off PASSED for ${requirementId} — feature branch ${featureBranch} merged to main`,
        metadata: {
          requirement_id: requirementId,
          feature_branch: featureBranch,
          agent_id: agentId,
          pr_url: prUrl,
          test_message: testMessage,
        },
      });
      db.save();
    });

    console.log(
      chalk.green(
        `  Feature sign-off: ${requirementId} PASSED — merged ${featureBranch} to main (PR #${prNumber})`
      )
    );
  } catch (err) {
    // Revert status on failure (brief lock)
    await ctx.withDb(async db => {
      updateRequirement(db.db, requirementId, { status: 'sign_off' });
      createLog(db.db, {
        agentId: 'manager',
        eventType: 'FEATURE_SIGN_OFF_FAILED',
        status: 'error',
        message: `Failed to merge feature branch for ${requirementId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        metadata: {
          requirement_id: requirementId,
          feature_branch: featureBranch,
          agent_id: agentId,
          error: String(err),
        },
      });
      db.save();
    });

    console.error(
      chalk.red(`  Feature sign-off merge failed for ${requirementId}:`),
      err instanceof Error ? err.message : err
    );
  }
}

async function handleTestFailure(
  ctx: ManagerCheckContext,
  candidate: FeatureTestCandidate
): Promise<void> {
  const { requirementId, featureBranch, testMessage, agentId } = candidate;
  verboseLogCtx(
    ctx,
    `handleTestFailure: requirement=${requirementId} branch=${featureBranch} tests failed`
  );

  await ctx.withDb(async db => {
    updateRequirement(db.db, requirementId, { status: 'sign_off_failed' });
    createLog(db.db, {
      agentId: 'manager',
      eventType: 'FEATURE_SIGN_OFF_FAILED',
      message: `Feature sign-off FAILED for ${requirementId} — E2E tests failed on ${featureBranch}`,
      metadata: {
        requirement_id: requirementId,
        feature_branch: featureBranch,
        agent_id: agentId,
        test_message: testMessage,
      },
    });
    db.save();
  });

  console.log(
    chalk.red(
      `  Feature sign-off: ${requirementId} FAILED — E2E tests failed (see test agent logs for details)`
    )
  );
}
