import type Database from 'better-sqlite3';
import { getStoryPointsByTeam } from '../db/queries/stories.js';
import { getAgentsByTeam, terminateAgent, type AgentRow } from '../db/queries/agents.js';
import { getAllTeams, type TeamRow } from '../db/queries/teams.js';
import { createLog } from '../db/queries/logs.js';
import { killTmuxSession } from '../tmux/manager.js';
import type { ScalingConfig } from '../config/schema.js';

export interface ScalerConfig {
  scaling: ScalingConfig;
}

export interface ScalingRecommendation {
  teamId: string;
  teamName: string;
  currentSeniors: number;
  recommendedSeniors: number;
  action: 'scale_up' | 'scale_down' | 'none';
  reason: string;
}

export class Scaler {
  private db: Database.Database;
  private config: ScalerConfig;

  constructor(db: Database.Database, config: ScalerConfig) {
    this.db = db;
    this.config = config;
  }

  /**
   * Analyze current workload and recommend scaling actions
   */
  analyzeScaling(): ScalingRecommendation[] {
    const teams = getAllTeams(this.db);
    const recommendations: ScalingRecommendation[] = [];

    for (const team of teams) {
      const recommendation = this.analyzeTeam(team);
      recommendations.push(recommendation);
    }

    return recommendations;
  }

  private analyzeTeam(team: TeamRow): ScalingRecommendation {
    const storyPoints = getStoryPointsByTeam(this.db, team.id);
    const agents = getAgentsByTeam(this.db, team.id);
    const activeSeniors = agents.filter(
      a => a.type === 'senior' && a.status !== 'terminated'
    );

    const seniorCapacity = this.config.scaling.senior_capacity;
    const recommendedSeniors = Math.max(1, Math.ceil(storyPoints / seniorCapacity));
    const currentSeniors = activeSeniors.length;

    let action: ScalingRecommendation['action'] = 'none';
    let reason = '';

    if (recommendedSeniors > currentSeniors) {
      action = 'scale_up';
      reason = `${storyPoints} story points exceeds capacity of ${currentSeniors} senior(s) (${currentSeniors * seniorCapacity} points)`;
    } else if (recommendedSeniors < currentSeniors && currentSeniors > 1) {
      action = 'scale_down';
      reason = `Only ${storyPoints} story points, can be handled by ${recommendedSeniors} senior(s)`;
    } else {
      reason = `Current capacity is appropriate for ${storyPoints} story points`;
    }

    return {
      teamId: team.id,
      teamName: team.name,
      currentSeniors,
      recommendedSeniors,
      action,
      reason,
    };
  }

  /**
   * Scale down idle agents when workload decreases
   */
  async scaleDown(): Promise<number> {
    const teams = getAllTeams(this.db);
    let terminated = 0;

    for (const team of teams) {
      const storyPoints = getStoryPointsByTeam(this.db, team.id);
      const agents = getAgentsByTeam(this.db, team.id);

      // Only scale down if no active work
      if (storyPoints > 0) continue;

      // Find idle agents (except the first Senior)
      const idleAgents = agents.filter(a =>
        a.status === 'idle' &&
        a.type !== 'tech_lead' &&
        !a.current_story_id
      );

      // Keep at least one Senior
      const seniorsToKeep = agents.filter(a => a.type === 'senior' && a.status !== 'terminated')[0];

      for (const agent of idleAgents) {
        if (agent.type === 'senior' && agent.id === seniorsToKeep?.id) {
          continue; // Keep the primary Senior
        }

        await this.terminateAgent(agent);
        terminated++;
      }
    }

    return terminated;
  }

  private async terminateAgent(agent: AgentRow): Promise<void> {
    // Kill tmux session if exists
    if (agent.tmux_session) {
      await killTmuxSession(agent.tmux_session);
    }

    // Mark as terminated
    terminateAgent(this.db, agent.id);

    // Log the event
    createLog(this.db, {
      agentId: agent.id,
      eventType: 'AGENT_TERMINATED',
      message: 'Scaled down due to reduced workload',
    });
  }

  /**
   * Get scaling statistics
   */
  getStatistics(): {
    totalAgents: number;
    activeAgents: number;
    agentsByType: Record<string, number>;
    teamCapacity: Record<string, { agents: number; storyPoints: number }>;
  } {
    const teams = getAllTeams(this.db);
    const agentsByType: Record<string, number> = {};
    const teamCapacity: Record<string, { agents: number; storyPoints: number }> = {};
    let totalAgents = 0;
    let activeAgents = 0;

    for (const team of teams) {
      const agents = getAgentsByTeam(this.db, team.id);
      const storyPoints = getStoryPointsByTeam(this.db, team.id);

      teamCapacity[team.name] = {
        agents: agents.filter(a => a.status !== 'terminated').length,
        storyPoints,
      };

      for (const agent of agents) {
        if (agent.status === 'terminated') continue;
        totalAgents++;
        agentsByType[agent.type] = (agentsByType[agent.type] || 0) + 1;
        if (agent.status === 'working') {
          activeAgents++;
        }
      }
    }

    // Add Tech Lead
    const techLead = this.db.prepare(`SELECT * FROM agents WHERE type = 'tech_lead'`).get() as AgentRow | undefined;
    if (techLead && techLead.status !== 'terminated') {
      totalAgents++;
      agentsByType['tech_lead'] = 1;
      if (techLead.status === 'working') {
        activeAgents++;
      }
    }

    return {
      totalAgents,
      activeAgents,
      agentsByType,
      teamCapacity,
    };
  }
}
