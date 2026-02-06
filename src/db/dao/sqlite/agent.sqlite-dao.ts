import { nanoid } from 'nanoid';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../../client.js';
import type {
  AgentRow,
  AgentStatus,
  AgentType,
  CreateAgentInput,
  UpdateAgentInput,
} from '../../queries/agents.js';
import type { AgentDao, StaleAgent } from '../interfaces/agent.dao.js';

export class SqliteAgentDao implements AgentDao {
  constructor(private readonly db: Database) {}

  async createAgent(input: CreateAgentInput): Promise<AgentRow> {
    const id = input.type === 'tech_lead' ? 'tech-lead' : `${input.type}-${nanoid(8)}`;
    const now = new Date().toISOString();

    run(
      this.db,
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

    return (await this.getAgentById(id))!;
  }

  async getAgentById(id: string): Promise<AgentRow | undefined> {
    return queryOne<AgentRow>(this.db, 'SELECT * FROM agents WHERE id = ?', [id]);
  }

  async getAgentsByTeam(teamId: string): Promise<AgentRow[]> {
    return queryAll<AgentRow>(this.db, 'SELECT * FROM agents WHERE team_id = ?', [teamId]);
  }

  async getAgentsByType(type: AgentType): Promise<AgentRow[]> {
    return queryAll<AgentRow>(this.db, 'SELECT * FROM agents WHERE type = ?', [type]);
  }

  async getAgentsByStatus(status: AgentStatus): Promise<AgentRow[]> {
    return queryAll<AgentRow>(this.db, 'SELECT * FROM agents WHERE status = ?', [status]);
  }

  async getAllAgents(): Promise<AgentRow[]> {
    return queryAll<AgentRow>(this.db, 'SELECT * FROM agents ORDER BY type, team_id');
  }

  async getActiveAgents(): Promise<AgentRow[]> {
    return queryAll<AgentRow>(
      this.db,
      `
      SELECT * FROM agents
      WHERE status IN ('idle', 'working', 'blocked')
      ORDER BY type, team_id
    `
    );
  }

  async getTechLead(): Promise<AgentRow | undefined> {
    return queryOne<AgentRow>(this.db, `SELECT * FROM agents WHERE type = 'tech_lead'`);
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<AgentRow | undefined> {
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

    if (updates.length === 1) {
      return this.getAgentById(id);
    }

    values.push(id);
    run(this.db, `UPDATE agents SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.getAgentById(id);
  }

  async deleteAgent(id: string): Promise<void> {
    run(this.db, 'DELETE FROM agents WHERE id = ?', [id]);
  }

  async terminateAgent(id: string): Promise<void> {
    await this.updateAgent(id, { status: 'terminated', tmuxSession: null });
  }

  async updateAgentHeartbeat(agentId: string): Promise<void> {
    run(this.db, 'UPDATE agents SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [agentId]);
  }

  async getStaleAgents(timeoutSeconds: number = 15): Promise<StaleAgent[]> {
    const query = `
      SELECT
        id,
        type,
        status,
        last_seen,
        CAST((julianday('now') - julianday(COALESCE(last_seen, created_at))) * 86400 AS INTEGER) as seconds_since_heartbeat
      FROM agents
      WHERE status IN ('working', 'idle')
        AND (
          (last_seen IS NULL AND (julianday('now') - julianday(created_at)) * 86400 > (60 + ?))
          OR
          (last_seen IS NOT NULL AND (julianday('now') - julianday(last_seen)) * 86400 > ?)
        )
    `;

    const stmt = this.db.prepare(query);
    stmt.bind([timeoutSeconds, timeoutSeconds]);

    const results: StaleAgent[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as StaleAgent;
      results.push(row);
    }
    stmt.free();

    return results;
  }

  async isAgentHeartbeatCurrent(agentId: string, timeoutSeconds: number = 15): Promise<boolean> {
    const query = `
      SELECT
        CASE
          WHEN last_seen IS NULL THEN 0
          WHEN (julianday('now') - julianday(last_seen)) * 86400 <= ? THEN 1
          ELSE 0
        END as is_current
      FROM agents
      WHERE id = ?
    `;

    const stmt = this.db.prepare(query);
    stmt.bind([timeoutSeconds, agentId]);

    let isCurrent = false;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { is_current: number };
      isCurrent = row.is_current === 1;
    }
    stmt.free();

    return isCurrent;
  }
}
