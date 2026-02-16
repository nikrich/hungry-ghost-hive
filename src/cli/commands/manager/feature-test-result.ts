// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { execSync } from 'child_process';
import { join } from 'path';
import { createLog } from '../../../db/queries/logs.js';
import { getRequirementById, updateRequirement } from '../../../db/queries/requirements.js';
import { getAllTeams } from '../../../db/queries/teams.js';
import { getAgentsByType } from '../../../db/queries/agents.js';
import { queryAll, type AgentRow, type AgentLogRow } from '../../../db/client.js';
import type { ManagerCheckContext } from './types.js';

function verboseLogCtx(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  if (!ctx.verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

/**
 * Check for completed feature_test agents and handle their E2E test results.
 * On success: merge feature branch to main and update requirement to sign_off_passed.
 * On failure: update requirement to sign_off_failed and create escalation.
 */
export async function checkFeatureTestResult(ctx: ManagerCheckContext): Promise<void> {
  // Get all feature_test agents (including terminated ones, since they finish when tests complete)
  const featureTestAgents = getAgentsByType(ctx.db.db, 'feature_test');
  verboseLogCtx(ctx, `checkFeatureTestResult: agents=${featureTestAgents.length}`);

  if (featureTestAgents.length === 0) return;

  for (const agent of featureTestAgents) {
    // Get recent logs for this agent to check for test results
    const recentLogs = queryAll<AgentLogRow>(
      ctx.db.db,
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

    // Check if we've already processed this result
    const alreadyProcessed = queryAll<AgentLogRow>(
      ctx.db.db,
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

    // Parse requirement ID from spawn log (FEATURE_TEST_SPAWNED event has requirement_id in metadata)
    const spawnLog = queryAll<AgentLogRow>(
      ctx.db.db,
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

    const requirement = getRequirementById(ctx.db.db, requirementId);
    if (!requirement) {
      verboseLogCtx(
        ctx,
        `checkFeatureTestResult: agent=${agent.id} skip=requirement_not_found id=${requirementId}`
      );
      continue;
    }

    // Check if requirement is still in sign_off status
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

    // Determine if tests passed or failed
    const testsPassed = message.includes('E2E tests PASSED');
    const testsFailed = message.includes('E2E tests FAILED');

    if (!testsPassed && !testsFailed) {
      verboseLogCtx(
        ctx,
        `checkFeatureTestResult: agent=${agent.id} skip=unclear_result message="${message.substring(0, 100)}"`
      );
      continue;
    }

    verboseLogCtx(
      ctx,
      `checkFeatureTestResult: agent=${agent.id} requirement=${requirementId} result=${testsPassed ? 'PASSED' : 'FAILED'}`
    );

    if (testsPassed) {
      await handleTestSuccess(ctx, agent, requirement, featureBranch, message);
    } else {
      await handleTestFailure(ctx, agent, requirement, featureBranch, message);
    }
  }
}

async function handleTestSuccess(
  ctx: ManagerCheckContext,
  agent: AgentRow,
  requirement: ReturnType<typeof getRequirementById>,
  featureBranch: string,
  testMessage: string
): Promise<void> {
  if (!requirement) return;

  const requirementId = requirement.id;
  verboseLogCtx(
    ctx,
    `handleTestSuccess: requirement=${requirementId} branch=${featureBranch} merging to main`
  );

  try {
    // Find the repo path from teams
    const teams = getAllTeams(ctx.db.db);
    const team = teams.length > 0 ? teams[0] : null;

    if (!team) {
      throw new Error('No team found for feature branch merge');
    }

    const repoPath = join(ctx.root, team.repo_path);

    // Create a PR from the feature branch to main
    const prTitle = `feat: ${requirement.title}`;
    const prBody = `## Feature Sign-off Complete

All stories for requirement ${requirementId} have been merged and E2E tests have passed.

### Test Results
${testMessage}

Co-Authored-By: Feature Test Agent <noreply@hive>`;

    // Create PR
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

    // Merge the PR automatically
    const prNumber = prUrl.split('/').pop();
    execSync(`gh pr merge ${prNumber} --squash --delete-branch`, {
      cwd: repoPath,
      stdio: 'pipe',
    });

    verboseLogCtx(ctx, `handleTestSuccess: requirement=${requirementId} pr_merged=#${prNumber}`);

    // Update requirement status to sign_off_passed
    updateRequirement(ctx.db.db, requirementId, { status: 'sign_off_passed' });

    createLog(ctx.db.db, {
      agentId: 'manager',
      eventType: 'FEATURE_SIGN_OFF_PASSED',
      message: `Feature sign-off PASSED for ${requirementId} — feature branch ${featureBranch} merged to main`,
      metadata: {
        requirement_id: requirementId,
        feature_branch: featureBranch,
        agent_id: agent.id,
        pr_url: prUrl,
        test_message: testMessage,
      },
    });

    ctx.db.save();
    console.log(
      chalk.green(
        `  Feature sign-off: ${requirementId} PASSED — merged ${featureBranch} to main (PR #${prNumber})`
      )
    );
  } catch (err) {
    // Revert status on failure
    updateRequirement(ctx.db.db, requirementId, { status: 'sign_off' });
    ctx.db.save();

    console.error(
      chalk.red(`  Feature sign-off merge failed for ${requirementId}:`),
      err instanceof Error ? err.message : err
    );

    createLog(ctx.db.db, {
      agentId: 'manager',
      eventType: 'FEATURE_SIGN_OFF_FAILED',
      status: 'error',
      message: `Failed to merge feature branch for ${requirementId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      metadata: {
        requirement_id: requirementId,
        feature_branch: featureBranch,
        agent_id: agent.id,
        error: String(err),
      },
    });
  }
}

async function handleTestFailure(
  ctx: ManagerCheckContext,
  agent: AgentRow,
  requirement: ReturnType<typeof getRequirementById>,
  featureBranch: string,
  testMessage: string
): Promise<void> {
  if (!requirement) return;

  const requirementId = requirement.id;
  verboseLogCtx(
    ctx,
    `handleTestFailure: requirement=${requirementId} branch=${featureBranch} tests failed`
  );

  // Update requirement status to sign_off_failed
  updateRequirement(ctx.db.db, requirementId, { status: 'sign_off_failed' });

  createLog(ctx.db.db, {
    agentId: 'manager',
    eventType: 'FEATURE_SIGN_OFF_FAILED',
    message: `Feature sign-off FAILED for ${requirementId} — E2E tests failed on ${featureBranch}`,
    metadata: {
      requirement_id: requirementId,
      feature_branch: featureBranch,
      agent_id: agent.id,
      test_message: testMessage,
    },
  });

  ctx.db.save();
  console.log(
    chalk.red(
      `  Feature sign-off: ${requirementId} FAILED — E2E tests failed (see test agent logs for details)`
    )
  );
}
