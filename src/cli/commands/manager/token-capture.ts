// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Token capture integration for the manager workflow.
 *
 * Captures tmux pane output, parses token usage, and persists to the database.
 * Used by spin-down, done-detection, and agent-monitoring flows.
 */

import { resolve } from 'path';
import { createLog } from '../../../db/queries/logs.js';
import { recordTokenUsage } from '../../../db/queries/token-usage.js';
import {
  getTokenUsageForAgent,
  parseTokenUsage,
  type ParsedTokenUsage,
} from '../../../parsers/token-usage-parser.js';
import { captureTmuxPane } from '../../../tmux/manager.js';
import type { ManagerCheckContext } from './types.js';

/** Large capture to get the full session summary with token info */
export const TOKEN_CAPTURE_LINES = 500;

export interface TokenCaptureResult {
  captured: boolean;
  tokens: ParsedTokenUsage | null;
  persisted: boolean;
}

export interface TokenCaptureCycleResult extends TokenCaptureResult {
  /** True if token counts changed since the last captured cycle for this agent */
  changed: boolean;
}

interface LastTokenSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** In-memory deduplication map: agentId → last recorded token counts */
const lastTokensByAgent = new Map<string, LastTokenSnapshot>();

/** Reset deduplication state (exported for use in tests) */
export function clearTokenDeduplicationState(): void {
  lastTokensByAgent.clear();
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
  } catch (err) {
    console.error(`[token-capture] captureAndPersistTokenUsage failed for agent=${agentId}:`, err);
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
  } catch (err) {
    console.error(`[token-capture] parseAndPersistTokenUsage failed for agent=${agentId}:`, err);
    return { captured: false, tokens: null, persisted: false };
  }
}

/**
 * Parse token usage from already-captured pane output and persist only if the
 * token counts have changed since the last manager cycle (deduplication).
 * Falls back to reading Claude Code JSONL session logs if text parsing finds nothing.
 * Use this for periodic captures in the manager monitoring loop.
 */
export async function parseAndPersistTokenUsageIfChanged(
  output: string,
  ctx: ManagerCheckContext,
  agentId: string,
  storyId?: string | null,
  worktreePath?: string | null
): Promise<TokenCaptureCycleResult> {
  try {
    let tokens = parseTokenUsage(output);

    // Fall back to JSONL session logs if text parsing found nothing
    if (!tokens) {
      const absoluteWorkDir = worktreePath ? resolve(ctx.root, worktreePath) : ctx.root;
      tokens = getTokenUsageForAgent(absoluteWorkDir);
    }

    if (!tokens) {
      return { captured: true, tokens: null, persisted: false, changed: false };
    }

    const last = lastTokensByAgent.get(agentId);
    if (
      last &&
      last.inputTokens === tokens.inputTokens &&
      last.outputTokens === tokens.outputTokens &&
      last.totalTokens === tokens.totalTokens
    ) {
      return { captured: true, tokens, persisted: false, changed: false };
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
        message: `Periodic token capture: input=${tokens.inputTokens}, output=${tokens.outputTokens}, total=${tokens.totalTokens}${tokens.cost !== undefined ? `, cost=$${tokens.cost}` : ''}`,
      });

      db.save();
    });

    lastTokensByAgent.set(agentId, {
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
    });

    return { captured: true, tokens, persisted: true, changed: true };
  } catch (err) {
    console.error(`[token-capture] parseAndPersistTokenUsageIfChanged failed for agent=${agentId}:`, err);
    return { captured: false, tokens: null, persisted: false, changed: false };
  }
}
