// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import type { HiveConfig } from '../../../config/schema.js';
import { sendToTmuxSession } from '../../../tmux/manager.js';
import {
  createManagerNudgeEnvelope,
  submitManagerNudgeWithVerification,
} from './agent-monitoring.js';
import type { ManagerCheckContext } from './types.js';

const DEFAULT_SCREEN_STATIC_INACTIVITY_THRESHOLD_MS = 10 * 60 * 1000;
const DEFAULT_MAX_STUCK_NUDGES_PER_STORY = 1;

export function verboseLog(verbose: boolean, message: string): void {
  if (!verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

export function verboseLogCtx(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  verboseLog(ctx.verbose, message);
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

async function submitManagerNudge(
  ctx: ManagerCheckContext,
  sessionName: string,
  nudgeId: string
): Promise<void> {
  console.log(
    chalk.gray(
      `  Nudge ${nudgeId}: double-checking Enter delivery after nudge (verification loop enabled)`
    )
  );
  const result = await submitManagerNudgeWithVerification(sessionName, nudgeId);
  ctx.counters.nudgeEnterPresses = (ctx.counters.nudgeEnterPresses ?? 0) + result.enterPresses;
  ctx.counters.nudgeEnterRetries = (ctx.counters.nudgeEnterRetries ?? 0) + result.retryEnters;
  if (!result.confirmed) {
    ctx.counters.nudgeSubmitUnconfirmed = (ctx.counters.nudgeSubmitUnconfirmed ?? 0) + 1;
    console.log(
      chalk.yellow(
        `  Nudge ${nudgeId}: unable to confirm Enter delivery after ${result.checks} check(s), ${result.enterPresses} Enter keypress(es)`
      )
    );
    return;
  }
  console.log(
    chalk.gray(
      `  Nudge ${nudgeId}: Enter delivery confirmed after ${result.checks} check(s), ${result.enterPresses} Enter keypress(es)`
    )
  );
}

export async function sendManagerNudge(
  ctx: ManagerCheckContext,
  sessionName: string,
  message: string
): Promise<void> {
  const envelope = createManagerNudgeEnvelope(message);
  await sendToTmuxSession(sessionName, envelope.text);
  await submitManagerNudge(ctx, sessionName, envelope.nudgeId);
}

export function getScreenStaticInactivityThresholdMs(config?: HiveConfig): number {
  return Math.max(
    1,
    config?.manager.screen_static_inactivity_threshold_ms ??
      DEFAULT_SCREEN_STATIC_INACTIVITY_THRESHOLD_MS
  );
}

export function getMaxStuckNudgesPerStory(config?: HiveConfig): number {
  return Math.max(
    0,
    config?.manager.max_stuck_nudges_per_story ?? DEFAULT_MAX_STUCK_NUDGES_PER_STORY
  );
}
