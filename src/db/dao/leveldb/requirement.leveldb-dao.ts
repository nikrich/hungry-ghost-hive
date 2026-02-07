import { nanoid } from 'nanoid';
import type {
  CreateRequirementInput,
  RequirementRow,
  RequirementStatus,
  UpdateRequirementInput,
} from '../../queries/requirements.js';
import type { RequirementDao } from '../interfaces/requirement.dao.js';
import { LevelDbStore, type NowProvider, defaultNow } from './leveldb-store.js';
import { compareIsoAsc, compareIsoDesc } from './sort.js';

const REQ_PREFIX = 'requirement:';

export class LevelDbRequirementDao implements RequirementDao {
  private readonly now: NowProvider;

  constructor(
    private readonly store: LevelDbStore,
    now: NowProvider = defaultNow
  ) {
    this.now = now;
  }

  async createRequirement(input: CreateRequirementInput): Promise<RequirementRow> {
    const id = `REQ-${nanoid(8).toUpperCase()}`;
    const now = this.now();

    const requirement: RequirementRow = {
      id,
      title: input.title,
      description: input.description,
      submitted_by: input.submittedBy || 'human',
      status: 'pending',
      godmode: input.godmode ? 1 : 0,
      created_at: now,
    };

    await this.store.put(`${REQ_PREFIX}${id}`, requirement);
    return requirement;
  }

  async getRequirementById(id: string): Promise<RequirementRow | undefined> {
    return this.store.get<RequirementRow>(`${REQ_PREFIX}${id}`);
  }

  async getAllRequirements(): Promise<RequirementRow[]> {
    const reqs = await this.store.listValues<RequirementRow>(REQ_PREFIX);
    return reqs.sort(compareIsoDesc);
  }

  async getRequirementsByStatus(status: RequirementStatus): Promise<RequirementRow[]> {
    const reqs = await this.store.listValues<RequirementRow>(REQ_PREFIX);
    return reqs.filter(req => req.status === status).sort(compareIsoDesc);
  }

  async getPendingRequirements(): Promise<RequirementRow[]> {
    const reqs = await this.store.listValues<RequirementRow>(REQ_PREFIX);
    return reqs
      .filter(req => ['pending', 'planning', 'in_progress'].includes(req.status))
      .sort(compareIsoAsc);
  }

  async updateRequirement(
    id: string,
    input: UpdateRequirementInput
  ): Promise<RequirementRow | undefined> {
    const existing = await this.getRequirementById(id);
    if (!existing) return undefined;

    const updates: Partial<RequirementRow> = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.status !== undefined) updates.status = input.status;
    if (input.godmode !== undefined) updates.godmode = input.godmode ? 1 : 0;

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const updated: RequirementRow = {
      ...existing,
      ...updates,
    };

    await this.store.put(`${REQ_PREFIX}${id}`, updated);
    return updated;
  }

  async deleteRequirement(id: string): Promise<void> {
    await this.store.del(`${REQ_PREFIX}${id}`);
  }
}
