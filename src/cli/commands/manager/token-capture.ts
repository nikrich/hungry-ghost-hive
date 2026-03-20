// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Token capture integration for the manager workflow.
 *
 * Captures tmux pane output, parses token usage, and persists to the database.
 * Used by spin-down, done-detection, and agent-monitoring flows.
 */

import { createLog } from '../../../db/queries/logs.js';
import { recordTokenUsage } from '../../../db/queries/token-usage.js';
import { parseTokenUsage, type ParsedTokenUsage } from '../../../parsers/token-usage-parser.js';
import { captureTmuxPane } from '../../../tmux/manager.js';
import type { ManagerCheckContext } from './types.js';

/** Large capture to get the full session summary with token info */
export const TOKEN_CAPTURE_LINES = 500;

export interface TokenCaptureResult {
  captured: boolean;
  tokens: ParsedTokenUsage | null;
  persisted: boolean;
}

/**
 * Capture tmux pane output, parse token usage, and persist to the database.
 * Uses ctx.withDb for safe database access following the manager lock pattern.
 */
export async function captureAndPersistTokenUsage(
  sessionName: string,
  ctx: ManagerCheckContext,
  agentId: string,
  storyId?: string | null
): Promise<TokenCaptureResult> {
  try {
    const output = await captureTmuxPane(sessionName, TOKEN_CAPTURE_LINES);
    if (!output) {
      return { captured: false, tokens: null, persisted: false };
    }

    return await parseAndPersistTokenUsage(output, ctx, agentId, storyId);
  } catch {
    return { captured: false, tokens: null, persisted: false };
  }
}

/**
 * Parse token usage from already-captured pane output and persist.
 * Use this when pane output has already been captured (e.g. during monitoring checks).
 */
export async function parseAndPersistTokenUsage(
  output: string,
  ctx: ManagerCheckContext,
  agentId: string,
  storyId?: string | null
): Promise<TokenCaptureResult> {
  try {
    const tokens = parseTokenUsage(output);
    if (!tokens) {
      return { captured: true, tokens: null, persisted: false };
    }

    await ctx.withDb(async db => {
      await recordTokenUsage(db.provider, {
        agentId,
        storyId: storyId ?? null,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        totalTokens: tokens.totalTokens,
      });

      await createLog(db.provider, {
        agentId,
        storyId: storyId ?? undefined,
        eventType: 'STORY_PROGRESS_UPDATE',
        message: `Captured token usage: input=${tokens.inputTokens}, output=${tokens.outputTokens}, total=${tokens.totalTokens}${tokens.cost !== undefined ? `, cost=$${tokens.cost}` : ''}`,
      });

      db.save();
    });

    return { captured: true, tokens, persisted: true };
  } catch {
    return { captured: false, tokens: null, persisted: false };
  }
}
