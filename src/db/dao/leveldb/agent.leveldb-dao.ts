import { nanoid } from 'nanoid';
import type { AgentDao, StaleAgent } from '../interfaces/agent.dao.js';
import type { AgentRow, CreateAgentInput, UpdateAgentInput, AgentType, AgentStatus } from '../../queries/agents.js';
import { LevelDbStore, type NowProvider, defaultNow } from './leveldb-store.js';

const AGENT_PREFIX = 'agent:';

const ACTIVE_STATUSES: AgentStatus[] = ['idle', 'working', 'blocked'];

export class LevelDbAgentDao implements AgentDao {
  private readonly now: NowProvider;

  constructor(private readonly store: LevelDbStore, now: NowProvider = defaultNow) {
    this.now = now;
  }

  async createAgent(input: CreateAgentInput): Promise<AgentRow> {
    const id = input.type === 'tech_lead'
      ? 'tech-lead'
      : `${input.type}-${nanoid(8)}`;
    const now = this.now();

    const agent: AgentRow = {
      id,
      type: input.type,
      team_id: input.teamId || null,
      tmux_session: input.tmuxSession || null,
      model: input.model || null,
      status: 'idle',
      current_story_id: null,
      memory_state: null,
      last_seen: now,
      cli_tool: 'claude',
      worktree_path: input.worktreePath || null,
      created_at: now,
      updated_at: now,
    };

    await this.store.put(`${AGENT_PREFIX}${id}`, agent);
    return agent;
  }

  async getAgentById(id: string): Promise<AgentRow | undefined> {
    return this.store.get<AgentRow>(`${AGENT_PREFIX}${id}`);
  }

  async getAgentsByTeam(teamId: string): Promise<AgentRow[]> {
    const agents = await this.store.listValues<AgentRow>(AGENT_PREFIX);
    return agents.filter(agent => agent.team_id === teamId);
  }

  async getAgentsByType(type: AgentType): Promise<AgentRow[]> {
    const agents = await this.store.listValues<AgentRow>(AGENT_PREFIX);
    return agents.filter(agent => agent.type === type);
  }

  async getAgentsByStatus(status: AgentStatus): Promise<AgentRow[]> {
    const agents = await this.store.listValues<AgentRow>(AGENT_PREFIX);
    return agents.filter(agent => agent.status === status);
  }

  async getAllAgents(): Promise<AgentRow[]> {
    const agents = await this.store.listValues<AgentRow>(AGENT_PREFIX);
    return agents.sort((a, b) => {
      const byType = a.type.localeCompare(b.type);
      if (byType !== 0) return byType;
      const teamA = a.team_id ?? '';
      const teamB = b.team_id ?? '';
      return teamA.localeCompare(teamB);
    });
  }

  async getActiveAgents(): Promise<AgentRow[]> {
    const agents = await this.store.listValues<AgentRow>(AGENT_PREFIX);
    return agents
      .filter(agent => ACTIVE_STATUSES.includes(agent.status))
      .sort((a, b) => {
        const byType = a.type.localeCompare(b.type);
        if (byType !== 0) return byType;
        const teamA = a.team_id ?? '';
        const teamB = b.team_id ?? '';
        return teamA.localeCompare(teamB);
      });
  }

  async getTechLead(): Promise<AgentRow | undefined> {
    const techLead = await this.getAgentById('tech-lead');
    return techLead?.type === 'tech_lead' ? techLead : undefined;
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<AgentRow | undefined> {
    const existing = await this.getAgentById(id);
    if (!existing) return undefined;

    const updates: Partial<AgentRow> = {};
    if (input.status !== undefined) updates.status = input.status;
    if (input.tmuxSession !== undefined) updates.tmux_session = input.tmuxSession;
    if (input.currentStoryId !== undefined) updates.current_story_id = input.currentStoryId;
    if (input.memoryState !== undefined) updates.memory_state = input.memoryState;
    if (input.worktreePath !== undefined) updates.worktree_path = input.worktreePath;

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const updated: AgentRow = {
      ...existing,
      ...updates,
      updated_at: this.now(),
    };

    await this.store.put(`${AGENT_PREFIX}${id}`, updated);
    return updated;
  }

  async deleteAgent(id: string): Promise<void> {
    await this.store.del(`${AGENT_PREFIX}${id}`);
  }

  async terminateAgent(id: string): Promise<void> {
    await this.updateAgent(id, { status: 'terminated', tmuxSession: null });
  }

  async updateAgentHeartbeat(agentId: string): Promise<void> {
    const existing = await this.getAgentById(agentId);
    if (!existing) return;
    const updated: AgentRow = {
      ...existing,
      last_seen: this.now(),
    };
    await this.store.put(`${AGENT_PREFIX}${agentId}`, updated);
  }

  async getStaleAgents(timeoutSeconds: number = 15): Promise<StaleAgent[]> {
    const agents = await this.store.listValues<AgentRow>(AGENT_PREFIX);
    const nowMs = Date.now();

    const stale: StaleAgent[] = [];

    for (const agent of agents) {
      if (!['working', 'idle'].includes(agent.status)) continue;

      const lastSeen = agent.last_seen ? Date.parse(agent.last_seen) : null;
      const createdAt = Date.parse(agent.created_at);
      const baseTime = lastSeen ?? createdAt;
      const secondsSince = Math.floor((nowMs - baseTime) / 1000);

      if (lastSeen === null) {
        if (secondsSince > (60 + timeoutSeconds)) {
          stale.push({
            id: agent.id,
            type: agent.type,
            status: agent.status,
            last_seen: agent.last_seen,
            seconds_since_heartbeat: secondsSince,
          });
        }
      } else if (secondsSince > timeoutSeconds) {
        stale.push({
          id: agent.id,
          type: agent.type,
          status: agent.status,
          last_seen: agent.last_seen,
          seconds_since_heartbeat: secondsSince,
        });
      }
    }

    return stale;
  }

  async isAgentHeartbeatCurrent(agentId: string, timeoutSeconds: number = 15): Promise<boolean> {
    const agent = await this.getAgentById(agentId);
    if (!agent || !agent.last_seen) return false;
    const lastSeenMs = Date.parse(agent.last_seen);
    const secondsSince = (Date.now() - lastSeenMs) / 1000;
    return secondsSince <= timeoutSeconds;
  }
}
