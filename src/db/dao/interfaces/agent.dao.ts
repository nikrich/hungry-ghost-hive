import type {
  AgentRow,
  AgentStatus,
  AgentType,
  CreateAgentInput,
  UpdateAgentInput,
} from '../../queries/agents.js';

export type { AgentRow, AgentStatus, AgentType, CreateAgentInput, UpdateAgentInput };

export interface StaleAgent {
  id: string;
  type: string;
  status: string;
  last_seen: string | null;
  seconds_since_heartbeat: number;
}

export interface AgentDao {
  createAgent(input: CreateAgentInput): Promise<AgentRow>;
  getAgentById(id: string): Promise<AgentRow | undefined>;
  getAgentsByTeam(teamId: string): Promise<AgentRow[]>;
  getAgentsByType(type: AgentType): Promise<AgentRow[]>;
  getAgentsByStatus(status: AgentStatus): Promise<AgentRow[]>;
  getAllAgents(): Promise<AgentRow[]>;
  getActiveAgents(): Promise<AgentRow[]>;
  getTechLead(): Promise<AgentRow | undefined>;
  updateAgent(id: string, input: UpdateAgentInput): Promise<AgentRow | undefined>;
  deleteAgent(id: string): Promise<void>;
  terminateAgent(id: string): Promise<void>;
  // Heartbeat methods
  updateAgentHeartbeat(agentId: string): Promise<void>;
  getStaleAgents(timeoutSeconds?: number): Promise<StaleAgent[]>;
  isAgentHeartbeatCurrent(agentId: string, timeoutSeconds?: number): Promise<boolean>;
}
