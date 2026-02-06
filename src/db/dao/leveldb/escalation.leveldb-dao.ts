import { nanoid } from 'nanoid';
import type {
  CreateEscalationInput,
  EscalationRow,
  EscalationStatus,
  UpdateEscalationInput,
} from '../../queries/escalations.js';
import type { EscalationDao } from '../interfaces/escalation.dao.js';
import { LevelDbStore, type NowProvider, defaultNow } from './leveldb-store.js';
import { compareIsoAsc, compareIsoDesc } from './sort.js';

const ESC_PREFIX = 'escalation:';

export class LevelDbEscalationDao implements EscalationDao {
  private readonly now: NowProvider;

  constructor(
    private readonly store: LevelDbStore,
    now: NowProvider = defaultNow
  ) {
    this.now = now;
  }

  async createEscalation(input: CreateEscalationInput): Promise<EscalationRow> {
    const id = `ESC-${nanoid(6).toUpperCase()}`;
    const now = this.now();

    const escalation: EscalationRow = {
      id,
      story_id: input.storyId || null,
      from_agent_id: input.fromAgentId || null,
      to_agent_id: input.toAgentId || null,
      reason: input.reason,
      status: 'pending',
      resolution: null,
      created_at: now,
      resolved_at: null,
    };

    await this.store.put(`${ESC_PREFIX}${id}`, escalation);
    return escalation;
  }

  async getEscalationById(id: string): Promise<EscalationRow | undefined> {
    return this.store.get<EscalationRow>(`${ESC_PREFIX}${id}`);
  }

  async getEscalationsByStory(storyId: string): Promise<EscalationRow[]> {
    const escalations = await this.store.listValues<EscalationRow>(ESC_PREFIX);
    return escalations.filter(esc => esc.story_id === storyId).sort(compareIsoDesc);
  }

  async getEscalationsByFromAgent(agentId: string): Promise<EscalationRow[]> {
    const escalations = await this.store.listValues<EscalationRow>(ESC_PREFIX);
    return escalations.filter(esc => esc.from_agent_id === agentId).sort(compareIsoDesc);
  }

  async getEscalationsByToAgent(agentId: string | null): Promise<EscalationRow[]> {
    const escalations = await this.store.listValues<EscalationRow>(ESC_PREFIX);
    if (agentId === null) {
      return escalations.filter(esc => esc.to_agent_id === null).sort(compareIsoDesc);
    }
    return escalations.filter(esc => esc.to_agent_id === agentId).sort(compareIsoDesc);
  }

  async getEscalationsByStatus(status: EscalationStatus): Promise<EscalationRow[]> {
    const escalations = await this.store.listValues<EscalationRow>(ESC_PREFIX);
    return escalations.filter(esc => esc.status === status).sort(compareIsoDesc);
  }

  async getPendingEscalations(): Promise<EscalationRow[]> {
    return this.getEscalationsByStatus('pending');
  }

  async getPendingHumanEscalations(): Promise<EscalationRow[]> {
    const escalations = await this.store.listValues<EscalationRow>(ESC_PREFIX);
    return escalations
      .filter(esc => esc.status === 'pending' && esc.to_agent_id === null)
      .sort(compareIsoAsc);
  }

  async getAllEscalations(): Promise<EscalationRow[]> {
    const escalations = await this.store.listValues<EscalationRow>(ESC_PREFIX);
    return escalations.sort(compareIsoDesc);
  }

  async updateEscalation(
    id: string,
    input: UpdateEscalationInput
  ): Promise<EscalationRow | undefined> {
    const existing = await this.getEscalationById(id);
    if (!existing) return undefined;

    const updates: Partial<EscalationRow> = {};
    if (input.status !== undefined) {
      updates.status = input.status;
      if (input.status === 'resolved') {
        updates.resolved_at = this.now();
      }
    }
    if (input.toAgentId !== undefined) updates.to_agent_id = input.toAgentId;
    if (input.resolution !== undefined) updates.resolution = input.resolution;

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const updated: EscalationRow = {
      ...existing,
      ...updates,
    };

    await this.store.put(`${ESC_PREFIX}${id}`, updated);
    return updated;
  }

  async resolveEscalation(id: string, resolution: string): Promise<EscalationRow | undefined> {
    return this.updateEscalation(id, { status: 'resolved', resolution });
  }

  async acknowledgeEscalation(id: string): Promise<EscalationRow | undefined> {
    return this.updateEscalation(id, { status: 'acknowledged' });
  }

  async deleteEscalation(id: string): Promise<void> {
    await this.store.del(`${ESC_PREFIX}${id}`);
  }
}
