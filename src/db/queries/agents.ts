// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { AgentRow } from '../client.js';
import type { DatabaseProvider } from '../provider.js';

export type { AgentRow };

export type AgentType =
  | 'tech_lead'
  | 'senior'
  | 'intermediate'
  | 'junior'
  | 'qa'
  | 'feature_test'
  | 'auditor';
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'terminated';

export interface CreateAgentInput {
  type: AgentType;
  teamId?: string | null;
  tmuxSession?: string | null;
  model?: string | null;
  worktreePath?: string | null;
}

export interface UpdateAgentInput {
  status?: AgentStatus;
  tmuxSession?: string | null;
  currentStoryId?: string | null;
  memoryState?: string | null;
  worktreePath?: string | null;
  createdAt?: string;
}

export function createAgent(provider: DatabaseProvider, input: CreateAgentInput): AgentRow {
  const id = input.type === 'tech_lead' ? 'tech-lead' : `${input.type}-${nanoid(8)}`;
  const now = new Date().toISOString();

  provider.run(
    `
    INSERT INTO agents (id, type, team_id, tmux_session, model, status, worktree_path, created_at, updated_at, last_seen)
    VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?)
  `,
    [
      id,
      input.type,
      input.teamId || null,
      input.tmuxSession || null,
      input.model || null,
      input.worktreePath || null,
      now,
      now,
      now,
    ]
  );

  return getAgentById(provider, id)!;
}

export function getAgentById(provider: DatabaseProvider, id: string): AgentRow | undefined {
  return provider.queryOne<AgentRow>('SELECT * FROM agents WHERE id = ?', [id]);
}

export function getAgentsByTeam(provider: DatabaseProvider, teamId: string): AgentRow[] {
  return provider.queryAll<AgentRow>('SELECT * FROM agents WHERE team_id = ?', [teamId]);
}

export function getAgentsByType(provider: DatabaseProvider, type: AgentType): AgentRow[] {
  return provider.queryAll<AgentRow>('SELECT * FROM agents WHERE type = ?', [type]);
}

export function getAgentsByStatus(provider: DatabaseProvider, status: AgentStatus): AgentRow[] {
  return provider.queryAll<AgentRow>('SELECT * FROM agents WHERE status = ?', [status]);
}

export function getAllAgents(provider: DatabaseProvider): AgentRow[] {
  return provider.queryAll<AgentRow>('SELECT * FROM agents ORDER BY type, team_id');
}

export function getActiveAgents(provider: DatabaseProvider): AgentRow[] {
  return provider.queryAll<AgentRow>(
    `
    SELECT * FROM agents
    WHERE status IN ('idle', 'working', 'blocked')
    ORDER BY type, team_id
  `
  );
}

export function getTechLead(provider: DatabaseProvider): AgentRow | undefined {
  return provider.queryOne<AgentRow>(`SELECT * FROM agents WHERE type = 'tech_lead'`);
}

export function updateAgent(
  provider: DatabaseProvider,
  id: string,
  input: UpdateAgentInput
): AgentRow | undefined {
  const updates: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [new Date().toISOString()];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.tmuxSession !== undefined) {
    updates.push('tmux_session = ?');
    values.push(input.tmuxSession);
  }
  if (input.currentStoryId !== undefined) {
    updates.push('current_story_id = ?');
    values.push(input.currentStoryId);
  }
  if (input.memoryState !== undefined) {
    updates.push('memory_state = ?');
    values.push(input.memoryState);
  }
  if (input.worktreePath !== undefined) {
    updates.push('worktree_path = ?');
    values.push(input.worktreePath);
  }
  if (input.createdAt !== undefined) {
    updates.push('created_at = ?');
    values.push(input.createdAt);
  }

  if (updates.length === 1) {
    // Only updated_at, nothing to update
    return getAgentById(provider, id);
  }

  values.push(id);
  provider.run(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`, values);
  return getAgentById(provider, id);
}

export function deleteAgent(provider: DatabaseProvider, id: string): void {
  provider.run('DELETE FROM agents WHERE id = ?', [id]);
}

export function getAgentByTmuxSession(
  provider: DatabaseProvider,
  tmuxSession: string
): AgentRow | undefined {
  return provider.queryOne<AgentRow>('SELECT * FROM agents WHERE tmux_session = ? LIMIT 1', [
    tmuxSession,
  ]);
}

export function terminateAgent(provider: DatabaseProvider, id: string): void {
  updateAgent(provider, id, { status: 'terminated', tmuxSession: null });
}
