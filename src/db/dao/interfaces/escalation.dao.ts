import type {
  CreateEscalationInput,
  EscalationRow,
  EscalationStatus,
  UpdateEscalationInput,
} from '../../queries/escalations.js';

export type { CreateEscalationInput, EscalationRow, EscalationStatus, UpdateEscalationInput };

export interface EscalationDao {
  createEscalation(input: CreateEscalationInput): Promise<EscalationRow>;
  getEscalationById(id: string): Promise<EscalationRow | undefined>;
  getEscalationsByStory(storyId: string): Promise<EscalationRow[]>;
  getEscalationsByFromAgent(agentId: string): Promise<EscalationRow[]>;
  getEscalationsByToAgent(agentId: string | null): Promise<EscalationRow[]>;
  getEscalationsByStatus(status: EscalationStatus): Promise<EscalationRow[]>;
  getPendingEscalations(): Promise<EscalationRow[]>;
  getPendingHumanEscalations(): Promise<EscalationRow[]>;
  getAllEscalations(): Promise<EscalationRow[]>;
  updateEscalation(id: string, input: UpdateEscalationInput): Promise<EscalationRow | undefined>;
  resolveEscalation(id: string, resolution: string): Promise<EscalationRow | undefined>;
  acknowledgeEscalation(id: string): Promise<EscalationRow | undefined>;
  deleteEscalation(id: string): Promise<void>;
}
