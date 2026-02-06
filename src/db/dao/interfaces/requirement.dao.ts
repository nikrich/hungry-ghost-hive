import type { RequirementRow } from '../../queries/requirements.js';
import type { CreateRequirementInput, UpdateRequirementInput, RequirementStatus } from '../../queries/requirements.js';

export type { RequirementRow, CreateRequirementInput, UpdateRequirementInput, RequirementStatus };

export interface RequirementDao {
  createRequirement(input: CreateRequirementInput): Promise<RequirementRow>;
  getRequirementById(id: string): Promise<RequirementRow | undefined>;
  getAllRequirements(): Promise<RequirementRow[]>;
  getRequirementsByStatus(status: RequirementStatus): Promise<RequirementRow[]>;
  getPendingRequirements(): Promise<RequirementRow[]>;
  updateRequirement(id: string, input: UpdateRequirementInput): Promise<RequirementRow | undefined>;
  deleteRequirement(id: string): Promise<void>;
}
