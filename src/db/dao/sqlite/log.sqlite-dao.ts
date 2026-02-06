import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../../client.js';
import type { LogDao } from '../interfaces/log.dao.js';
import type { AgentLogRow, CreateLogInput, EventType } from '../../queries/logs.js';

export class SqliteLogDao implements LogDao {
  constructor(private readonly db: Database) {}

  async createLog(input: CreateLogInput): Promise<AgentLogRow> {
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    const now = new Date().toISOString();

    run(this.db, `
      INSERT INTO agent_logs (agent_id, story_id, event_type, status, message, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      input.agentId,
      input.storyId || null,
      input.eventType,
      input.status || null,
      input.message || null,
      metadata,
      now
    ]);

    const result = queryOne<{ id: number }>(this.db, 'SELECT last_insert_rowid() as id');
    return (await this.getLogById(result?.id || 0))!;
  }

  async getLogById(id: number): Promise<AgentLogRow | undefined> {
    return queryOne<AgentLogRow>(this.db, 'SELECT * FROM agent_logs WHERE id = ?', [id]);
  }

  async getLogsByAgent(agentId: string, limit = 100): Promise<AgentLogRow[]> {
    return queryAll<AgentLogRow>(this.db, `
      SELECT * FROM agent_logs
      WHERE agent_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [agentId, limit]);
  }

  async getLogsByStory(storyId: string): Promise<AgentLogRow[]> {
    return queryAll<AgentLogRow>(this.db, `
      SELECT * FROM agent_logs
      WHERE story_id = ?
      ORDER BY timestamp DESC
    `, [storyId]);
  }

  async getLogsByEventType(eventType: EventType, limit = 100): Promise<AgentLogRow[]> {
    return queryAll<AgentLogRow>(this.db, `
      SELECT * FROM agent_logs
      WHERE event_type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [eventType, limit]);
  }

  async getRecentLogs(limit = 50): Promise<AgentLogRow[]> {
    return queryAll<AgentLogRow>(this.db, `
      SELECT * FROM agent_logs
      ORDER BY timestamp DESC
      LIMIT ?
    `, [limit]);
  }

  async getLogsSince(since: string): Promise<AgentLogRow[]> {
    return queryAll<AgentLogRow>(this.db, `
      SELECT * FROM agent_logs
      WHERE timestamp > ?
      ORDER BY timestamp ASC
    `, [since]);
  }

  async pruneOldLogs(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoff = cutoffDate.toISOString();

    const before = queryOne<{ count: number }>(this.db, `
      SELECT COUNT(*) as count FROM agent_logs WHERE timestamp < ?
    `, [cutoff]);

    run(this.db, `DELETE FROM agent_logs WHERE timestamp < ?`, [cutoff]);

    return before?.count || 0;
  }
}
