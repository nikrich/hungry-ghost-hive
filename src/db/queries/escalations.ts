// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { EscalationRow } from '../client.js';
import type { DatabaseProvider } from '../provider.js';

export type { EscalationRow };

export type EscalationStatus = 'pending' | 'acknowledged' | 'resolved';

export interface CreateEscalationInput {
  storyId?: string | null;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  reason: string;
}

export interface UpdateEscalationInput {
  status?: EscalationStatus;
  toAgentId?: string | null;
  resolution?: string | null;
}

export function createEscalation(
  provider: DatabaseProvider,
  input: CreateEscalationInput
): EscalationRow {
  const id = `ESC-${nanoid(6).toUpperCase()}`;
  const now = new Date().toISOString();

  provider.run(
    `
    INSERT INTO escalations (id, story_id, from_agent_id, to_agent_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    [
      id,
      input.storyId || null,
      input.fromAgentId || null,
      input.toAgentId || null,
      input.reason,
      now,
    ]
  );

  return getEscalationById(provider, id)!;
}

export function getEscalationById(
  provider: DatabaseProvider,
  id: string
): EscalationRow | undefined {
  return provider.queryOne<EscalationRow>('SELECT * FROM escalations WHERE id = ?', [id]);
}

export function getEscalationsByStory(
  provider: DatabaseProvider,
  storyId: string
): EscalationRow[] {
  return provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE story_id = ?
    ORDER BY created_at DESC
  `,
    [storyId]
  );
}

export function getEscalationsByFromAgent(
  provider: DatabaseProvider,
  agentId: string
): EscalationRow[] {
  return provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    ORDER BY created_at DESC
  `,
    [agentId]
  );
}

export function getEscalationsByToAgent(
  provider: DatabaseProvider,
  agentId: string | null
): EscalationRow[] {
  if (agentId === null) {
    return provider.queryAll<EscalationRow>(`
      SELECT * FROM escalations
      WHERE to_agent_id IS NULL
      ORDER BY created_at DESC
    `);
  }
  return provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE to_agent_id = ?
    ORDER BY created_at DESC
  `,
    [agentId]
  );
}

export function getEscalationsByStatus(
  provider: DatabaseProvider,
  status: EscalationStatus
): EscalationRow[] {
  return provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE status = ?
    ORDER BY created_at DESC
  `,
    [status]
  );
}

export function getPendingEscalations(provider: DatabaseProvider): EscalationRow[] {
  return getEscalationsByStatus(provider, 'pending');
}

export function getPendingHumanEscalations(provider: DatabaseProvider): EscalationRow[] {
  return provider.queryAll<EscalationRow>(`
    SELECT * FROM escalations
    WHERE status = 'pending' AND to_agent_id IS NULL
    ORDER BY created_at
  `);
}

export function getRecentEscalationsForAgent(
  provider: DatabaseProvider,
  agentId: string,
  minutesBack: number = 30
): EscalationRow[] {
  return provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    AND created_at > datetime('now', ?)
    ORDER BY created_at DESC
  `,
    [agentId, `-${minutesBack} minutes`]
  );
}

export function getActiveEscalationsForAgent(
  provider: DatabaseProvider,
  agentId: string
): EscalationRow[] {
  return provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    AND status IN ('pending', 'acknowledged')
    ORDER BY created_at DESC
  `,
    [agentId]
  );
}

export function getAllEscalations(provider: DatabaseProvider): EscalationRow[] {
  return provider.queryAll<EscalationRow>('SELECT * FROM escalations ORDER BY created_at DESC');
}

export function updateEscalation(
  provider: DatabaseProvider,
  id: string,
  input: UpdateEscalationInput
): EscalationRow | undefined {
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
    if (input.status === 'resolved') {
      updates.push('resolved_at = ?');
      values.push(new Date().toISOString());
    }
  }
  if (input.toAgentId !== undefined) {
    updates.push('to_agent_id = ?');
    values.push(input.toAgentId);
  }
  if (input.resolution !== undefined) {
    updates.push('resolution = ?');
    values.push(input.resolution);
  }

  if (updates.length === 0) {
    return getEscalationById(provider, id);
  }

  values.push(id);
  provider.run(`UPDATE escalations SET ${updates.join(', ')} WHERE id = ?`, values);
  return getEscalationById(provider, id);
}

export function resolveEscalation(
  provider: DatabaseProvider,
  id: string,
  resolution: string
): EscalationRow | undefined {
  return updateEscalation(provider, id, { status: 'resolved', resolution });
}

export function acknowledgeEscalation(
  provider: DatabaseProvider,
  id: string
): EscalationRow | undefined {
  return updateEscalation(provider, id, { status: 'acknowledged' });
}

export function deleteEscalation(provider: DatabaseProvider, id: string): void {
  provider.run('DELETE FROM escalations WHERE id = ?', [id]);
}
