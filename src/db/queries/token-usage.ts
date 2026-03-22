// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { DatabaseProvider } from '../provider.js';

export interface TokenUsageRow {
  id: number;
  agent_id: string;
  story_id: string | null;
  requirement_id: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  model: string | null;
  session_id: string | null;
  recorded_at: string;
}

export interface RecordTokenUsageInput {
  agentId: string;
  storyId?: string | null;
  requirementId?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model?: string | null;
  sessionId?: string | null;
}

export interface TokenUsageSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  record_count: number;
}

export async function recordTokenUsage(
  provider: DatabaseProvider,
  input: RecordTokenUsageInput
): Promise<TokenUsageRow> {
  const now = new Date().toISOString();

  const result = await provider.queryOne<{ id: number }>(
    `
    INSERT INTO token_usage (agent_id, story_id, requirement_id, input_tokens, output_tokens, total_tokens, model, session_id, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
    [
      input.agentId,
      input.storyId || null,
      input.requirementId || null,
      input.inputTokens,
      input.outputTokens,
      input.totalTokens,
      input.model || null,
      input.sessionId || null,
      now,
    ]
  );

  return (await provider.queryOne<TokenUsageRow>('SELECT * FROM token_usage WHERE id = ?', [
    result?.id || 0,
  ]))!;
}

export async function getTokensByAgent(
  provider: DatabaseProvider,
  agentId: string
): Promise<TokenUsageRow[]> {
  return await provider.queryAll<TokenUsageRow>(
    `
    SELECT * FROM token_usage
    WHERE agent_id = ?
    ORDER BY recorded_at DESC
  `,
    [agentId]
  );
}

export async function getTokensByStory(
  provider: DatabaseProvider,
  storyId: string
): Promise<TokenUsageRow[]> {
  return await provider.queryAll<TokenUsageRow>(
    `
    SELECT * FROM token_usage
    WHERE story_id = ?
    ORDER BY recorded_at DESC
  `,
    [storyId]
  );
}

export async function getTokensByRequirement(
  provider: DatabaseProvider,
  requirementId: string
): Promise<TokenUsageRow[]> {
  return await provider.queryAll<TokenUsageRow>(
    `
    SELECT * FROM token_usage
    WHERE requirement_id = ?
    ORDER BY recorded_at DESC
  `,
    [requirementId]
  );
}

export async function getTotalTokens(
  provider: DatabaseProvider,
  options?: { since?: string; until?: string }
): Promise<TokenUsageSummary> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.since) {
    conditions.push('recorded_at >= ?');
    params.push(options.since);
  }
  if (options?.until) {
    conditions.push('recorded_at <= ?');
    params.push(options.until);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await provider.queryOne<TokenUsageSummary>(
    `
    SELECT
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COUNT(*) as record_count
    FROM token_usage
    ${whereClause}
  `,
    params
  );

  // Postgres SUM/COUNT return bigint, which node-postgres converts to strings.
  // Coerce to numbers for consistent behavior across SQLite and Postgres.
  const raw = result || {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    record_count: 0,
  };
  return {
    total_input_tokens: Number(raw.total_input_tokens),
    total_output_tokens: Number(raw.total_output_tokens),
    total_tokens: Number(raw.total_tokens),
    record_count: Number(raw.record_count),
  };
}
