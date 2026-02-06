import type {
  CreateRequirementInput,
  RequirementRow,
  RequirementStatus,
  UpdateRequirementInput,
} from '../../queries/requirements.js';

export type { CreateRequirementInput, RequirementRow, RequirementStatus, UpdateRequirementInput };

export interface RequirementDao {
  createRequirement(input: CreateRequirementInput): Promise<RequirementRow>;
  getRequirementById(id: string): Promise<RequirementRow | undefined>;
  getAllRequirements(): Promise<RequirementRow[]>;
  getRequirementsByStatus(status: RequirementStatus): Promise<RequirementRow[]>;
  getPendingRequirements(): Promise<RequirementRow[]>;
  updateRequirement(id: string, input: UpdateRequirementInput): Promise<RequirementRow | undefined>;
  deleteRequirement(id: string): Promise<void>;
}
