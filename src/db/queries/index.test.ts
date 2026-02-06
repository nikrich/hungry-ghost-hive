import { describe, it, expect } from 'vitest';
import * as queries from './index.js';

describe('queries index exports', () => {
  it('should export team functions', () => {
    expect(queries.createTeam).toBeDefined();
    expect(queries.getTeamById).toBeDefined();
    expect(queries.getTeamByName).toBeDefined();
    expect(queries.getAllTeams).toBeDefined();
    expect(queries.deleteTeam).toBeDefined();
  });

  it('should export agent functions', () => {
    expect(queries.createAgent).toBeDefined();
    expect(queries.getAgentById).toBeDefined();
    expect(queries.getAgentsByTeam).toBeDefined();
    expect(queries.getAgentsByType).toBeDefined();
    expect(queries.getAgentsByStatus).toBeDefined();
    expect(queries.getAllAgents).toBeDefined();
    expect(queries.getActiveAgents).toBeDefined();
    expect(queries.getTechLead).toBeDefined();
    expect(queries.updateAgent).toBeDefined();
    expect(queries.deleteAgent).toBeDefined();
    expect(queries.terminateAgent).toBeDefined();
  });

  it('should export requirement functions', () => {
    expect(queries.createRequirement).toBeDefined();
    expect(queries.getRequirementById).toBeDefined();
    expect(queries.getAllRequirements).toBeDefined();
    expect(queries.getRequirementsByStatus).toBeDefined();
    expect(queries.getPendingRequirements).toBeDefined();
    expect(queries.updateRequirement).toBeDefined();
    expect(queries.deleteRequirement).toBeDefined();
  });

  it('should export story functions', () => {
    expect(queries.createStory).toBeDefined();
    expect(queries.getStoryById).toBeDefined();
    expect(queries.getStoriesByRequirement).toBeDefined();
    expect(queries.getStoriesByTeam).toBeDefined();
    expect(queries.getStoriesByStatus).toBeDefined();
    expect(queries.getStoriesByAgent).toBeDefined();
    expect(queries.getActiveStoriesByAgent).toBeDefined();
    expect(queries.getAllStories).toBeDefined();
    expect(queries.getPlannedStories).toBeDefined();
    expect(queries.getInProgressStories).toBeDefined();
    expect(queries.getStoryPointsByTeam).toBeDefined();
    expect(queries.updateStory).toBeDefined();
    expect(queries.deleteStory).toBeDefined();
    expect(queries.addStoryDependency).toBeDefined();
    expect(queries.removeStoryDependency).toBeDefined();
    expect(queries.getStoryDependencies).toBeDefined();
    expect(queries.getStoriesDependingOn).toBeDefined();
    expect(queries.getStoryCounts).toBeDefined();
  });

  it('should export log functions', () => {
    expect(queries.createLog).toBeDefined();
    expect(queries.getLogById).toBeDefined();
    expect(queries.getLogsByAgent).toBeDefined();
    expect(queries.getLogsByStory).toBeDefined();
    expect(queries.getLogsByEventType).toBeDefined();
    expect(queries.getRecentLogs).toBeDefined();
    expect(queries.getLogsSince).toBeDefined();
    expect(queries.pruneOldLogs).toBeDefined();
  });

  it('should export escalation functions', () => {
    expect(queries.createEscalation).toBeDefined();
    expect(queries.getEscalationById).toBeDefined();
    expect(queries.getEscalationsByStory).toBeDefined();
    expect(queries.getEscalationsByFromAgent).toBeDefined();
    expect(queries.getEscalationsByToAgent).toBeDefined();
    expect(queries.getEscalationsByStatus).toBeDefined();
    expect(queries.getPendingEscalations).toBeDefined();
    expect(queries.getPendingHumanEscalations).toBeDefined();
    expect(queries.getAllEscalations).toBeDefined();
    expect(queries.updateEscalation).toBeDefined();
    expect(queries.resolveEscalation).toBeDefined();
    expect(queries.acknowledgeEscalation).toBeDefined();
    expect(queries.deleteEscalation).toBeDefined();
  });

  it('should export pull request functions', () => {
    expect(queries.createPullRequest).toBeDefined();
    expect(queries.getPullRequestById).toBeDefined();
    expect(queries.getPullRequestByStory).toBeDefined();
    expect(queries.getPullRequestByGithubNumber).toBeDefined();
    expect(queries.getMergeQueue).toBeDefined();
    expect(queries.getNextInQueue).toBeDefined();
    expect(queries.getQueuePosition).toBeDefined();
    expect(queries.getPullRequestsByStatus).toBeDefined();
    expect(queries.getApprovedPullRequests).toBeDefined();
    expect(queries.getAllPullRequests).toBeDefined();
    expect(queries.getPullRequestsByTeam).toBeDefined();
    expect(queries.updatePullRequest).toBeDefined();
    expect(queries.deletePullRequest).toBeDefined();
  });
});
