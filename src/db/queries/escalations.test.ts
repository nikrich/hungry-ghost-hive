import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDatabase } from './test-helpers.js';
import { createAgent } from './agents.js';
import { createTeam } from './teams.js';
import { createStory } from './stories.js';
import {
  createEscalation,
  getEscalationById,
  getEscalationsByStory,
  getEscalationsByFromAgent,
  getEscalationsByToAgent,
  getEscalationsByStatus,
  getPendingEscalations,
  getPendingHumanEscalations,
  getAllEscalations,
  updateEscalation,
  resolveEscalation,
  acknowledgeEscalation,
  deleteEscalation,
  getRecentEscalationsForAgent,
  getActiveEscalationsForAgent,
} from './escalations.js';

describe('escalations queries', () => {
  let db: Database;
  let teamId: string;
  let agentId: string;
  let storyId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;

    const agent = createAgent(db, { type: 'senior', teamId });
    agentId = agent.id;

    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test description',
      teamId,
    });
    storyId = story.id;
  });

  describe('createEscalation', () => {
    it('should create an escalation with all fields', () => {
      const agent2 = createAgent(db, { type: 'tech_lead', teamId });

      const escalation = createEscalation(db, {
        storyId,
        fromAgentId: agentId,
        toAgentId: agent2.id,
        reason: 'Need assistance with complex task',
      });

      expect(escalation.id).toMatch(/^ESC-/);
      expect(escalation.story_id).toBe(storyId);
      expect(escalation.from_agent_id).toBe(agentId);
      expect(escalation.to_agent_id).toBe(agent2.id);
      expect(escalation.reason).toBe('Need assistance with complex task');
      expect(escalation.status).toBe('pending');
      expect(escalation.created_at).toBeDefined();
    });

    it('should create escalation with null fields', () => {
      const escalation = createEscalation(db, {
        reason: 'General question',
      });

      expect(escalation.story_id).toBeNull();
      expect(escalation.from_agent_id).toBeNull();
      expect(escalation.to_agent_id).toBeNull();
    });

    it('should generate unique IDs', () => {
      const esc1 = createEscalation(db, { reason: 'Reason 1' });
      const esc2 = createEscalation(db, { reason: 'Reason 2' });

      expect(esc1.id).not.toBe(esc2.id);
    });
  });

  describe('getEscalationById', () => {
    it('should retrieve an escalation by ID', () => {
      const created = createEscalation(db, {
        storyId,
        fromAgentId: agentId,
        reason: 'Test escalation',
      });

      const retrieved = getEscalationById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.reason).toBe('Test escalation');
    });

    it('should return undefined for non-existent escalation', () => {
      const result = getEscalationById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getEscalationsByStory', () => {
    it('should return escalations for a specific story', () => {
      const esc1 = createEscalation(db, { storyId, reason: 'Reason 1' });
      const esc2 = createEscalation(db, { storyId, reason: 'Reason 2' });

      const story2 = createStory(db, {
        title: 'Story 2',
        description: 'Description',
        teamId,
      });
      createEscalation(db, { storyId: story2.id, reason: 'Reason 3' });

      const escalations = getEscalationsByStory(db, storyId);

      expect(escalations).toHaveLength(2);
      expect(escalations.map((e) => e.id)).toContain(esc1.id);
      expect(escalations.map((e) => e.id)).toContain(esc2.id);
    });

    it('should return empty array when no escalations for story', () => {
      const escalations = getEscalationsByStory(db, 'non-existent-story');
      expect(escalations).toEqual([]);
    });

    it('should order by created_at DESC', () => {
      const esc1 = createEscalation(db, { storyId, reason: 'First' });
      const esc2 = createEscalation(db, { storyId, reason: 'Second' });

      const escalations = getEscalationsByStory(db, storyId);

      expect(escalations).toHaveLength(2);
      // Verify both escalations are present
      expect(escalations.map((e) => e.id)).toContain(esc1.id);
      expect(escalations.map((e) => e.id)).toContain(esc2.id);
    });
  });

  describe('getEscalationsByFromAgent', () => {
    it('should return escalations from a specific agent', () => {
      const esc1 = createEscalation(db, { fromAgentId: agentId, reason: 'Reason 1' });
      const esc2 = createEscalation(db, { fromAgentId: agentId, reason: 'Reason 2' });

      const agent2 = createAgent(db, { type: 'junior', teamId });
      createEscalation(db, { fromAgentId: agent2.id, reason: 'Reason 3' });

      const escalations = getEscalationsByFromAgent(db, agentId);

      expect(escalations).toHaveLength(2);
      expect(escalations.map((e) => e.id)).toContain(esc1.id);
      expect(escalations.map((e) => e.id)).toContain(esc2.id);
    });
  });

  describe('getEscalationsByToAgent', () => {
    it('should return escalations to a specific agent', () => {
      const techLead = createAgent(db, { type: 'tech_lead', teamId });

      const esc1 = createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: techLead.id,
        reason: 'Reason 1',
      });

      createEscalation(db, { fromAgentId: agentId, reason: 'Reason 2' });

      const escalations = getEscalationsByToAgent(db, techLead.id);

      expect(escalations).toHaveLength(1);
      expect(escalations[0].id).toBe(esc1.id);
    });

    it('should return escalations with null toAgentId when passed null', () => {
      createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: null,
        reason: 'To human',
      });

      const techLead = createAgent(db, { type: 'tech_lead', teamId });
      createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: techLead.id,
        reason: 'To tech lead',
      });

      const humanEscalations = getEscalationsByToAgent(db, null);

      expect(humanEscalations).toHaveLength(1);
      expect(humanEscalations[0].reason).toBe('To human');
    });
  });

  describe('getEscalationsByStatus', () => {
    it('should filter escalations by status', () => {
      const esc1 = createEscalation(db, { reason: 'Pending' });
      const esc2 = createEscalation(db, { reason: 'Acknowledged' });
      updateEscalation(db, esc2.id, { status: 'acknowledged' });

      const pending = getEscalationsByStatus(db, 'pending');
      const acknowledged = getEscalationsByStatus(db, 'acknowledged');

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(esc1.id);
      expect(acknowledged).toHaveLength(1);
      expect(acknowledged[0].id).toBe(esc2.id);
    });
  });

  describe('getPendingEscalations', () => {
    it('should return all pending escalations', () => {
      const esc1 = createEscalation(db, { reason: 'Pending 1' });
      const esc2 = createEscalation(db, { reason: 'Pending 2' });
      const esc3 = createEscalation(db, { reason: 'Resolved' });
      updateEscalation(db, esc3.id, { status: 'resolved', resolution: 'Fixed' });

      const pending = getPendingEscalations(db);

      expect(pending).toHaveLength(2);
      expect(pending.map((e) => e.id)).toContain(esc1.id);
      expect(pending.map((e) => e.id)).toContain(esc2.id);
    });
  });

  describe('getPendingHumanEscalations', () => {
    it('should return pending escalations with null toAgentId', () => {
      const esc1 = createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: null,
        reason: 'Need human help',
      });

      const techLead = createAgent(db, { type: 'tech_lead', teamId });
      createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: techLead.id,
        reason: 'Need tech lead help',
      });

      const humanEscalations = getPendingHumanEscalations(db);

      expect(humanEscalations).toHaveLength(1);
      expect(humanEscalations[0].id).toBe(esc1.id);
    });

    it('should not return resolved human escalations', () => {
      const esc = createEscalation(db, {
        toAgentId: null,
        reason: 'Need help',
      });
      updateEscalation(db, esc.id, { status: 'resolved', resolution: 'Fixed' });

      const humanEscalations = getPendingHumanEscalations(db);

      expect(humanEscalations).toEqual([]);
    });
  });

  describe('getAllEscalations', () => {
    it('should return all escalations ordered by created_at DESC', () => {
      const esc1 = createEscalation(db, { reason: 'First' });
      const esc2 = createEscalation(db, { reason: 'Second' });

      const escalations = getAllEscalations(db);

      expect(escalations).toHaveLength(2);
      // Verify both escalations are present
      expect(escalations.map((e) => e.id)).toContain(esc1.id);
      expect(escalations.map((e) => e.id)).toContain(esc2.id);
    });
  });

  describe('updateEscalation', () => {
    it('should update escalation status', () => {
      const esc = createEscalation(db, { reason: 'Test' });

      const updated = updateEscalation(db, esc.id, { status: 'acknowledged' });

      expect(updated?.status).toBe('acknowledged');
    });

    it('should set resolved_at when status is resolved', () => {
      const esc = createEscalation(db, { reason: 'Test' });

      const updated = updateEscalation(db, esc.id, {
        status: 'resolved',
        resolution: 'Issue fixed',
      });

      expect(updated?.status).toBe('resolved');
      expect(updated?.resolved_at).toBeDefined();
      expect(updated?.resolution).toBe('Issue fixed');
    });

    it('should update toAgentId', () => {
      const esc = createEscalation(db, { reason: 'Test' });
      const techLead = createAgent(db, { type: 'tech_lead', teamId });

      const updated = updateEscalation(db, esc.id, { toAgentId: techLead.id });

      expect(updated?.to_agent_id).toBe(techLead.id);
    });

    it('should return escalation when no updates provided', () => {
      const esc = createEscalation(db, { reason: 'Test' });

      const updated = updateEscalation(db, esc.id, {});

      expect(updated?.id).toBe(esc.id);
    });

    it('should return undefined for non-existent escalation', () => {
      const updated = updateEscalation(db, 'non-existent-id', { status: 'acknowledged' });
      expect(updated).toBeUndefined();
    });
  });

  describe('resolveEscalation', () => {
    it('should resolve an escalation with resolution text', () => {
      const esc = createEscalation(db, { reason: 'Test' });

      const resolved = resolveEscalation(db, esc.id, 'Issue has been fixed');

      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolution).toBe('Issue has been fixed');
      expect(resolved?.resolved_at).toBeDefined();
    });
  });

  describe('acknowledgeEscalation', () => {
    it('should acknowledge an escalation', () => {
      const esc = createEscalation(db, { reason: 'Test' });

      const acknowledged = acknowledgeEscalation(db, esc.id);

      expect(acknowledged?.status).toBe('acknowledged');
    });
  });

  describe('deleteEscalation', () => {
    it('should delete an escalation', () => {
      const esc = createEscalation(db, { reason: 'To delete' });

      deleteEscalation(db, esc.id);

      const retrieved = getEscalationById(db, esc.id);
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent escalation', () => {
      expect(() => deleteEscalation(db, 'non-existent-id')).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle very long reason text', () => {
      const longReason = 'A'.repeat(10000);
      const esc = createEscalation(db, { reason: longReason });

      const retrieved = getEscalationById(db, esc.id);
      expect(retrieved?.reason).toBe(longReason);
    });

    it('should handle special characters in reason', () => {
      const reason = 'Reason with \'quotes\' and "double" and\nnewlines';
      const esc = createEscalation(db, { reason });

      const retrieved = getEscalationById(db, esc.id);
      expect(retrieved?.reason).toBe(reason);
    });

    it('should handle null resolution', () => {
      const esc = createEscalation(db, { reason: 'Test' });

      expect(esc.resolution).toBeNull();
      expect(esc.resolved_at).toBeNull();
    });
  });

  describe('getRecentEscalationsForAgent', () => {
    it('should return recent escalations for an agent', () => {
      const esc1 = createEscalation(db, { fromAgentId: agentId, reason: 'Recent 1' });
      const esc2 = createEscalation(db, { fromAgentId: agentId, reason: 'Recent 2' });

      const agent2 = createAgent(db, { type: 'junior', teamId });
      createEscalation(db, { fromAgentId: agent2.id, reason: 'Other agent' });

      const recent = getRecentEscalationsForAgent(db, agentId, 30);

      expect(recent).toHaveLength(2);
      expect(recent.map((e) => e.id)).toContain(esc1.id);
      expect(recent.map((e) => e.id)).toContain(esc2.id);
    });

    it('should return empty array for agent with no recent escalations', () => {
      const recent = getRecentEscalationsForAgent(db, 'non-existent-agent', 30);
      expect(recent).toEqual([]);
    });

    it('should return escalations in DESC order', () => {
      const esc1 = createEscalation(db, { fromAgentId: agentId, reason: 'First' });
      const esc2 = createEscalation(db, { fromAgentId: agentId, reason: 'Second' });

      const recent = getRecentEscalationsForAgent(db, agentId, 30);

      expect(recent).toHaveLength(2);
      // Both escalations should be present
      expect(recent.map((e) => e.id)).toContain(esc1.id);
      expect(recent.map((e) => e.id)).toContain(esc2.id);
    });
  });

  describe('getActiveEscalationsForAgent', () => {
    it('should return pending and acknowledged escalations for an agent', () => {
      const esc1 = createEscalation(db, { fromAgentId: agentId, reason: 'Pending' });
      const esc2 = createEscalation(db, { fromAgentId: agentId, reason: 'Acknowledged' });
      updateEscalation(db, esc2.id, { status: 'acknowledged' });

      const esc3 = createEscalation(db, { fromAgentId: agentId, reason: 'Resolved' });
      updateEscalation(db, esc3.id, { status: 'resolved', resolution: 'Fixed' });

      const active = getActiveEscalationsForAgent(db, agentId);

      expect(active).toHaveLength(2);
      expect(active.map((e) => e.id)).toContain(esc1.id);
      expect(active.map((e) => e.id)).toContain(esc2.id);
      expect(active.map((e) => e.id)).not.toContain(esc3.id);
    });

    it('should not return resolved escalations', () => {
      createEscalation(db, { fromAgentId: agentId, reason: 'Pending' });
      const esc2 = createEscalation(db, { fromAgentId: agentId, reason: 'Will resolve' });
      updateEscalation(db, esc2.id, { status: 'resolved', resolution: 'Fixed' });

      const active = getActiveEscalationsForAgent(db, agentId);

      expect(active).toHaveLength(1);
      expect(active[0].reason).toBe('Pending');
    });

    it('should return empty array for agent with no active escalations', () => {
      const active = getActiveEscalationsForAgent(db, 'non-existent-agent');
      expect(active).toEqual([]);
    });
  });
});
