import type { AgentLogRow, CreateLogInput, EventType } from '../../queries/logs.js';
import type { LogDao } from '../interfaces/log.dao.js';
import { LevelDbStore, type NowProvider, defaultNow } from './leveldb-store.js';
import { compareIsoAscByTimestamp, compareIsoDescByTimestamp } from './sort.js';

const LOG_PREFIX = 'log:';

export class LevelDbLogDao implements LogDao {
  private readonly now: NowProvider;

  constructor(
    private readonly store: LevelDbStore,
    now: NowProvider = defaultNow
  ) {
    this.now = now;
  }

  async createLog(input: CreateLogInput): Promise<AgentLogRow> {
    const id = await this.store.nextSeq('agent_logs');
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    const now = this.now();

    const log: AgentLogRow = {
      id,
      agent_id: input.agentId,
      story_id: input.storyId || null,
      event_type: input.eventType,
      status: input.status || null,
      message: input.message || null,
      metadata,
      timestamp: now,
    };

    await this.store.put(`${LOG_PREFIX}${id}`, log);
    return log;
  }

  async getLogById(id: number): Promise<AgentLogRow | undefined> {
    return this.store.get<AgentLogRow>(`${LOG_PREFIX}${id}`);
  }

  async getLogsByAgent(agentId: string, limit = 100): Promise<AgentLogRow[]> {
    const logs = await this.store.listValues<AgentLogRow>(LOG_PREFIX);
    return logs
      .filter(log => log.agent_id === agentId)
      .sort(compareIsoDescByTimestamp)
      .slice(0, limit);
  }

  async getLogsByStory(storyId: string): Promise<AgentLogRow[]> {
    const logs = await this.store.listValues<AgentLogRow>(LOG_PREFIX);
    return logs.filter(log => log.story_id === storyId).sort(compareIsoDescByTimestamp);
  }

  async getLogsByEventType(eventType: EventType, limit = 100): Promise<AgentLogRow[]> {
    const logs = await this.store.listValues<AgentLogRow>(LOG_PREFIX);
    return logs
      .filter(log => log.event_type === eventType)
      .sort(compareIsoDescByTimestamp)
      .slice(0, limit);
  }

  async getRecentLogs(limit = 50): Promise<AgentLogRow[]> {
    const logs = await this.store.listValues<AgentLogRow>(LOG_PREFIX);
    return logs.sort(compareIsoDescByTimestamp).slice(0, limit);
  }

  async getLogsSince(since: string): Promise<AgentLogRow[]> {
    const logs = await this.store.listValues<AgentLogRow>(LOG_PREFIX);
    return logs.filter(log => log.timestamp > since).sort(compareIsoAscByTimestamp);
  }

  async pruneOldLogs(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoff = cutoffDate.toISOString();

    const logs = await this.store.listEntries<AgentLogRow>(LOG_PREFIX);
    const toDelete = logs.filter(entry => entry.value.timestamp < cutoff);

    await Promise.all(toDelete.map(entry => this.store.del(entry.key)));
    return toDelete.length;
  }
}
