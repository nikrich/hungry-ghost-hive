import type { Database } from 'sql.js';
import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../../client.js';
import type { EscalationDao } from '../interfaces/escalation.dao.js';
import type { EscalationRow, CreateEscalationInput, UpdateEscalationInput, EscalationStatus } from '../../queries/escalations.js';

export class SqliteEscalationDao implements EscalationDao {
  constructor(private readonly db: Database) {}

  async createEscalation(input: CreateEscalationInput): Promise<EscalationRow> {
    const id = `ESC-${nanoid(6).toUpperCase()}`;
    const now = new Date().toISOString();

    run(this.db, `
      INSERT INTO escalations (id, story_id, from_agent_id, to_agent_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      id,
      input.storyId || null,
      input.fromAgentId || null,
      input.toAgentId || null,
      input.reason,
      now
    ]);

    return (await this.getEscalationById(id))!;
  }

  async getEscalationById(id: string): Promise<EscalationRow | undefined> {
    return queryOne<EscalationRow>(this.db, 'SELECT * FROM escalations WHERE id = ?', [id]);
  }

  async getEscalationsByStory(storyId: string): Promise<EscalationRow[]> {
    return queryAll<EscalationRow>(this.db, `
      SELECT * FROM escalations
      WHERE story_id = ?
      ORDER BY created_at DESC
    `, [storyId]);
  }

  async getEscalationsByFromAgent(agentId: string): Promise<EscalationRow[]> {
    return queryAll<EscalationRow>(this.db, `
      SELECT * FROM escalations
      WHERE from_agent_id = ?
      ORDER BY created_at DESC
    `, [agentId]);
  }

  async getEscalationsByToAgent(agentId: string | null): Promise<EscalationRow[]> {
    if (agentId === null) {
      return queryAll<EscalationRow>(this.db, `
        SELECT * FROM escalations
        WHERE to_agent_id IS NULL
        ORDER BY created_at DESC
      `);
    }
    return queryAll<EscalationRow>(this.db, `
      SELECT * FROM escalations
      WHERE to_agent_id = ?
      ORDER BY created_at DESC
    `, [agentId]);
  }

  async getEscalationsByStatus(status: EscalationStatus): Promise<EscalationRow[]> {
    return queryAll<EscalationRow>(this.db, `
      SELECT * FROM escalations
      WHERE status = ?
      ORDER BY created_at DESC
    `, [status]);
  }

  async getPendingEscalations(): Promise<EscalationRow[]> {
    return this.getEscalationsByStatus('pending');
  }

  async getPendingHumanEscalations(): Promise<EscalationRow[]> {
    return queryAll<EscalationRow>(this.db, `
      SELECT * FROM escalations
      WHERE status = 'pending' AND to_agent_id IS NULL
      ORDER BY created_at
    `);
  }

  async getAllEscalations(): Promise<EscalationRow[]> {
    return queryAll<EscalationRow>(this.db, 'SELECT * FROM escalations ORDER BY created_at DESC');
  }

  async updateEscalation(id: string, input: UpdateEscalationInput): Promise<EscalationRow | undefined> {
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
      return this.getEscalationById(id);
    }

    values.push(id);
    run(this.db, `UPDATE escalations SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.getEscalationById(id);
  }

  async resolveEscalation(id: string, resolution: string): Promise<EscalationRow | undefined> {
    return this.updateEscalation(id, { status: 'resolved', resolution });
  }

  async acknowledgeEscalation(id: string): Promise<EscalationRow | undefined> {
    return this.updateEscalation(id, { status: 'acknowledged' });
  }

  async deleteEscalation(id: string): Promise<void> {
    run(this.db, 'DELETE FROM escalations WHERE id = ?', [id]);
  }
}
