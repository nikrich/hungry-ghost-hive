// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import { type EscalationRow } from '../client.js';
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

export async function createEscalation(
  provider: DatabaseProvider,
  input: CreateEscalationInput
): Promise<EscalationRow> {
  const id = `ESC-${nanoid(6).toUpperCase()}`;
  const now = new Date().toISOString();

  await provider.run(
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

  return (await getEscalationById(provider, id))!;
}

export async function getEscalationById(
  provider: DatabaseProvider,
  id: string
): Promise<EscalationRow | undefined> {
  return await provider.queryOne<EscalationRow>('SELECT * FROM escalations WHERE id = ?', [id]);
}

export async function getEscalationsByStory(
  provider: DatabaseProvider,
  storyId: string
): Promise<EscalationRow[]> {
  return await provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE story_id = ?
    ORDER BY created_at DESC
  `,
    [storyId]
  );
}

export async function getEscalationsByFromAgent(
  provider: DatabaseProvider,
  agentId: string
): Promise<EscalationRow[]> {
  return await provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    ORDER BY created_at DESC
  `,
    [agentId]
  );
}

export async function getEscalationsByToAgent(
  provider: DatabaseProvider,
  agentId: string | null
): Promise<EscalationRow[]> {
  if (agentId === null) {
    return await provider.queryAll<EscalationRow>(`
      SELECT * FROM escalations
      WHERE to_agent_id IS NULL
      ORDER BY created_at DESC
    `);
  }
  return await provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE to_agent_id = ?
    ORDER BY created_at DESC
  `,
    [agentId]
  );
}

export async function getEscalationsByStatus(
  provider: DatabaseProvider,
  status: EscalationStatus
): Promise<EscalationRow[]> {
  return await provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE status = ?
    ORDER BY created_at DESC
  `,
    [status]
  );
}

export async function getPendingEscalations(provider: DatabaseProvider): Promise<EscalationRow[]> {
  return await getEscalationsByStatus(provider, 'pending');
}

export async function getPendingHumanEscalations(
  provider: DatabaseProvider
): Promise<EscalationRow[]> {
  return await provider.queryAll<EscalationRow>(`
    SELECT * FROM escalations
    WHERE status = 'pending' AND to_agent_id IS NULL
    ORDER BY created_at
  `);
}

export async function getRecentEscalationsForAgent(
  provider: DatabaseProvider,
  agentId: string,
  minutesBack: number = 30
): Promise<EscalationRow[]> {
  const cutoff = new Date(Date.now() - minutesBack * 60 * 1000).toISOString();
  return await provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    AND created_at > ?
    ORDER BY created_at DESC
  `,
    [agentId, cutoff]
  );
}

export async function getActiveEscalationsForAgent(
  provider: DatabaseProvider,
  agentId: string
): Promise<EscalationRow[]> {
  return await provider.queryAll<EscalationRow>(
    `
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    AND status IN ('pending', 'acknowledged')
    ORDER BY created_at DESC
  `,
    [agentId]
  );
}

export async function getAllEscalations(provider: DatabaseProvider): Promise<EscalationRow[]> {
  return await provider.queryAll<EscalationRow>(
    'SELECT * FROM escalations ORDER BY created_at DESC'
  );
}

export async function updateEscalation(
  provider: DatabaseProvider,
  id: string,
  input: UpdateEscalationInput
): Promise<EscalationRow | undefined> {
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
    return await getEscalationById(provider, id);
  }

  values.push(id);
  await provider.run(`UPDATE escalations SET ${updates.join(', ')} WHERE id = ?`, values);
  return await getEscalationById(provider, id);
}

export async function resolveEscalation(
  provider: DatabaseProvider,
  id: string,
  resolution: string
): Promise<EscalationRow | undefined> {
  return await updateEscalation(provider, id, { status: 'resolved', resolution });
}

export async function acknowledgeEscalation(
  provider: DatabaseProvider,
  id: string
): Promise<EscalationRow | undefined> {
  return await updateEscalation(provider, id, { status: 'acknowledged' });
}

export async function deleteEscalation(provider: DatabaseProvider, id: string): Promise<void> {
  await provider.run('DELETE FROM escalations WHERE id = ?', [id]);
}
