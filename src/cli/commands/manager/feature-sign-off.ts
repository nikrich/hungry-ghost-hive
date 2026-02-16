// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { createLog } from '../../../db/queries/logs.js';
import { getRequirementsByStatus, updateRequirement } from '../../../db/queries/requirements.js';
import { getStoriesByRequirement } from '../../../db/queries/stories.js';
import { getAllTeams } from '../../../db/queries/teams.js';
import type { ManagerCheckContext } from './types.js';

function verboseLogCtx(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  if (!ctx.verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

export async function checkFeatureSignOff(ctx: ManagerCheckContext): Promise<void> {
  if (!ctx.config.e2e_tests?.path) {
    verboseLogCtx(ctx, 'checkFeatureSignOff: skip=no_e2e_tests_configured');
    return;
  }

  const inProgressReqs = getRequirementsByStatus(ctx.db.db, 'in_progress').filter(
    req => req.feature_branch
  );
  verboseLogCtx(ctx, `checkFeatureSignOff: candidates=${inProgressReqs.length}`);

  if (inProgressReqs.length === 0) return;

  const teams = getAllTeams(ctx.db.db);
  const e2eTestsPath = ctx.config.e2e_tests.path;

  for (const req of inProgressReqs) {
    const stories = getStoriesByRequirement(ctx.db.db, req.id);
    if (stories.length === 0) {
      verboseLogCtx(ctx, `checkFeatureSignOff: req=${req.id} skip=no_stories`);
      continue;
    }

    const allMerged = stories.every(story => story.status === 'merged');
    if (!allMerged) {
      const mergedCount = stories.filter(s => s.status === 'merged').length;
      verboseLogCtx(
        ctx,
        `checkFeatureSignOff: req=${req.id} skip=not_all_merged (${mergedCount}/${stories.length})`
      );
      continue;
    }

    // All stories merged - find the team from the first story
    const teamId = stories[0].team_id;
    if (!teamId) {
      verboseLogCtx(ctx, `checkFeatureSignOff: req=${req.id} skip=no_team_id`);
      continue;
    }

    const team = teams.find(t => t.id === teamId);
    if (!team) {
      verboseLogCtx(ctx, `checkFeatureSignOff: req=${req.id} skip=team_not_found id=${teamId}`);
      continue;
    }

    verboseLogCtx(
      ctx,
      `checkFeatureSignOff: req=${req.id} all_merged=${stories.length} stories, spawning feature_test`
    );

    try {
      // Transition requirement to sign_off
      updateRequirement(ctx.db.db, req.id, { status: 'sign_off' });

      // Spawn feature_test agent
      const agent = await ctx.scheduler.spawnFeatureTest(teamId, team.name, team.repo_path, {
        featureBranch: req.feature_branch!,
        requirementId: req.id,
        e2eTestsPath,
      });

      createLog(ctx.db.db, {
        agentId: agent.id,
        eventType: 'FEATURE_TEST_SPAWNED',
        message: `Spawned feature_test agent for requirement ${req.id} (branch: ${req.feature_branch})`,
        metadata: {
          requirement_id: req.id,
          feature_branch: req.feature_branch,
          team_id: teamId,
          stories_merged: stories.length,
        },
      });
      createLog(ctx.db.db, {
        agentId: 'manager',
        eventType: 'FEATURE_SIGN_OFF_TRIGGERED',
        message: `All ${stories.length} stories merged for ${req.id} — triggered feature sign-off`,
        metadata: {
          requirement_id: req.id,
          feature_branch: req.feature_branch,
          agent_id: agent.id,
        },
      });

      ctx.db.save();
      ctx.counters.featureTestsSpawned++;
      console.log(
        chalk.green(
          `  Feature sign-off: spawned E2E test agent for ${req.id} (${stories.length} stories merged)`
        )
      );
    } catch (err) {
      // Revert status on failure
      updateRequirement(ctx.db.db, req.id, { status: 'in_progress' });
      ctx.db.save();
      console.error(
        chalk.red(`  Feature sign-off failed for ${req.id}:`),
        err instanceof Error ? err.message : err
      );
    }
  }
}
