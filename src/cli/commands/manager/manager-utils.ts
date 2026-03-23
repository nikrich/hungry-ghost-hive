// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import type { HiveConfig } from '../../../config/schema.js';
import { sendBtwToTmuxSession } from '../../../tmux/manager.js';
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

export async function sendManagerNudge(
  _ctx: ManagerCheckContext,
  sessionName: string,
  message: string
): Promise<void> {
  // Use /btw for non-interrupting nudge delivery
  await sendBtwToTmuxSession(sessionName, message);
  console.log(chalk.gray(`  Nudge delivered via /btw to ${sessionName}`));
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
