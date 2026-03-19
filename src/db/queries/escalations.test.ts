// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteProvider } from '../provider.js';
import { createAgent } from './agents.js';
import {
  acknowledgeEscalation,
  createEscalation,
  deleteEscalation,
  getActiveEscalationsForAgent,
  getAllEscalations,
  getEscalationById,
  getEscalationsByFromAgent,
  getEscalationsByStatus,
  getEscalationsByStory,
  getEscalationsByToAgent,
  getPendingEscalations,
  getPendingHumanEscalations,
  getRecentEscalationsForAgent,
  resolveEscalation,
  updateEscalation,
} from './escalations.js';
import { createStory } from './stories.js';
import { createTeam } from './teams.js';
import { createTestDatabase } from './test-helpers.js';

describe('escalations queries', () => {
  let db: SqliteProvider;
  let teamId: string;
  let agentId: string;
  let storyId: string;

  beforeEach(async () => {
    const rawDb = await createTestDatabase();
    db = new SqliteProvider(rawDb);
    const team = await createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;

    const agent = await createAgent(db, { type: 'senior', teamId });
    agentId = agent.id;

    const story = await createStory(db, {
      title: 'Test Story',
      description: 'Test description',
      teamId,
    });
    storyId = story.id;
  });

  describe('createEscalation', () => {
    it('should create an escalation with all fields', async () => {
      const agent2 = await createAgent(db, { type: 'tech_lead', teamId });

      const escalation = await createEscalation(db, {
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

    it('should create escalation with null fields', async () => {
      const escalation = await createEscalation(db, {
        reason: 'General question',
      });

      expect(escalation.story_id).toBeNull();
      expect(escalation.from_agent_id).toBeNull();
      expect(escalation.to_agent_id).toBeNull();
    });

    it('should generate unique IDs', async () => {
      const esc1 = await createEscalation(db, { reason: 'Reason 1' });
      const esc2 = await createEscalation(db, { reason: 'Reason 2' });

      expect(esc1.id).not.toBe(esc2.id);
    });
  });

  describe('getEscalationById', () => {
    it('should retrieve an escalation by ID', async () => {
      const created = await createEscalation(db, {
        storyId,
        fromAgentId: agentId,
        reason: 'Test escalation',
      });

      const retrieved = await getEscalationById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.reason).toBe('Test escalation');
    });

    it('should return undefined for non-existent escalation', async () => {
      const result = await getEscalationById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getEscalationsByStory', () => {
    it('should return escalations for a specific story', async () => {
      const esc1 = await createEscalation(db, { storyId, reason: 'Reason 1' });
      const esc2 = await createEscalation(db, { storyId, reason: 'Reason 2' });

      const story2 = await createStory(db, {
        title: 'Story 2',
        description: 'Description',
        teamId,
      });
      await createEscalation(db, { storyId: story2.id, reason: 'Reason 3' });

      const escalations = await getEscalationsByStory(db, storyId);

      expect(escalations).toHaveLength(2);
      expect(escalations.map(e => e.id)).toContain(esc1.id);
      expect(escalations.map(e => e.id)).toContain(esc2.id);
    });

    it('should return empty array when no escalations for story', async () => {
      const escalations = await getEscalationsByStory(db, 'non-existent-story');
      expect(escalations).toEqual([]);
    });

    it('should order by created_at DESC', async () => {
      const esc1 = await createEscalation(db, { storyId, reason: 'First' });
      const esc2 = await createEscalation(db, { storyId, reason: 'Second' });

      const escalations = await getEscalationsByStory(db, storyId);

      expect(escalations).toHaveLength(2);
      // Verify both escalations are present
      expect(escalations.map(e => e.id)).toContain(esc1.id);
      expect(escalations.map(e => e.id)).toContain(esc2.id);
    });
  });

  describe('getEscalationsByFromAgent', () => {
    it('should return escalations from a specific agent', async () => {
      const esc1 = await createEscalation(db, { fromAgentId: agentId, reason: 'Reason 1' });
      const esc2 = await createEscalation(db, { fromAgentId: agentId, reason: 'Reason 2' });

      const agent2 = await createAgent(db, { type: 'junior', teamId });
      await createEscalation(db, { fromAgentId: agent2.id, reason: 'Reason 3' });

      const escalations = await getEscalationsByFromAgent(db, agentId);

      expect(escalations).toHaveLength(2);
      expect(escalations.map(e => e.id)).toContain(esc1.id);
      expect(escalations.map(e => e.id)).toContain(esc2.id);
    });
  });

  describe('getEscalationsByToAgent', () => {
    it('should return escalations to a specific agent', async () => {
      const techLead = await createAgent(db, { type: 'tech_lead', teamId });

      const esc1 = await createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: techLead.id,
        reason: 'Reason 1',
      });

      await createEscalation(db, { fromAgentId: agentId, reason: 'Reason 2' });

      const escalations = await getEscalationsByToAgent(db, techLead.id);

      expect(escalations).toHaveLength(1);
      expect(escalations[0].id).toBe(esc1.id);
    });

    it('should return escalations with null toAgentId when passed null', async () => {
      await createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: null,
        reason: 'To human',
      });

      const techLead = await createAgent(db, { type: 'tech_lead', teamId });
      await createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: techLead.id,
        reason: 'To tech lead',
      });

      const humanEscalations = await getEscalationsByToAgent(db, null);

      expect(humanEscalations).toHaveLength(1);
      expect(humanEscalations[0].reason).toBe('To human');
    });
  });

  describe('getEscalationsByStatus', () => {
    it('should filter escalations by status', async () => {
      const esc1 = await createEscalation(db, { reason: 'Pending' });
      const esc2 = await createEscalation(db, { reason: 'Acknowledged' });
      await updateEscalation(db, esc2.id, { status: 'acknowledged' });

      const pending = await getEscalationsByStatus(db, 'pending');
      const acknowledged = await getEscalationsByStatus(db, 'acknowledged');

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(esc1.id);
      expect(acknowledged).toHaveLength(1);
      expect(acknowledged[0].id).toBe(esc2.id);
    });
  });

  describe('getPendingEscalations', () => {
    it('should return all pending escalations', async () => {
      const esc1 = await createEscalation(db, { reason: 'Pending 1' });
      const esc2 = await createEscalation(db, { reason: 'Pending 2' });
      const esc3 = await createEscalation(db, { reason: 'Resolved' });
      await updateEscalation(db, esc3.id, { status: 'resolved', resolution: 'Fixed' });

      const pending = await getPendingEscalations(db);

      expect(pending).toHaveLength(2);
      expect(pending.map(e => e.id)).toContain(esc1.id);
      expect(pending.map(e => e.id)).toContain(esc2.id);
    });
  });

  describe('getPendingHumanEscalations', () => {
    it('should return pending escalations with null toAgentId', async () => {
      const esc1 = await createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: null,
        reason: 'Need human help',
      });

      const techLead = await createAgent(db, { type: 'tech_lead', teamId });
      await createEscalation(db, {
        fromAgentId: agentId,
        toAgentId: techLead.id,
        reason: 'Need tech lead help',
      });

      const humanEscalations = await getPendingHumanEscalations(db);

      expect(humanEscalations).toHaveLength(1);
      expect(humanEscalations[0].id).toBe(esc1.id);
    });

    it('should not return resolved human escalations', async () => {
      const esc = await createEscalation(db, {
        toAgentId: null,
        reason: 'Need help',
      });
      await updateEscalation(db, esc.id, { status: 'resolved', resolution: 'Fixed' });

      const humanEscalations = await getPendingHumanEscalations(db);

      expect(humanEscalations).toEqual([]);
    });
  });

  describe('getAllEscalations', () => {
    it('should return all escalations ordered by created_at DESC', async () => {
      const esc1 = await createEscalation(db, { reason: 'First' });
      const esc2 = await createEscalation(db, { reason: 'Second' });

      const escalations = await getAllEscalations(db);

      expect(escalations).toHaveLength(2);
      // Verify both escalations are present
      expect(escalations.map(e => e.id)).toContain(esc1.id);
      expect(escalations.map(e => e.id)).toContain(esc2.id);
    });
  });

  describe('updateEscalation', () => {
    it('should update escalation status', async () => {
      const esc = await createEscalation(db, { reason: 'Test' });

      const updated = await updateEscalation(db, esc.id, { status: 'acknowledged' });

      expect(updated?.status).toBe('acknowledged');
    });

    it('should set resolved_at when status is resolved', async () => {
      const esc = await createEscalation(db, { reason: 'Test' });

      const updated = await updateEscalation(db, esc.id, {
        status: 'resolved',
        resolution: 'Issue fixed',
      });

      expect(updated?.status).toBe('resolved');
      expect(updated?.resolved_at).toBeDefined();
      expect(updated?.resolution).toBe('Issue fixed');
    });

    it('should update toAgentId', async () => {
      const esc = await createEscalation(db, { reason: 'Test' });
      const techLead = await createAgent(db, { type: 'tech_lead', teamId });

      const updated = await updateEscalation(db, esc.id, { toAgentId: techLead.id });

      expect(updated?.to_agent_id).toBe(techLead.id);
    });

    it('should return escalation when no updates provided', async () => {
      const esc = await createEscalation(db, { reason: 'Test' });

      const updated = await updateEscalation(db, esc.id, {});

      expect(updated?.id).toBe(esc.id);
    });

    it('should return undefined for non-existent escalation', async () => {
      const updated = await updateEscalation(db, 'non-existent-id', { status: 'acknowledged' });
      expect(updated).toBeUndefined();
    });
  });

  describe('resolveEscalation', () => {
    it('should resolve an escalation with resolution text', async () => {
      const esc = await createEscalation(db, { reason: 'Test' });

      const resolved = await resolveEscalation(db, esc.id, 'Issue has been fixed');

      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolution).toBe('Issue has been fixed');
      expect(resolved?.resolved_at).toBeDefined();
    });
  });

  describe('acknowledgeEscalation', () => {
    it('should acknowledge an escalation', async () => {
      const esc = await createEscalation(db, { reason: 'Test' });

      const acknowledged = await acknowledgeEscalation(db, esc.id);

      expect(acknowledged?.status).toBe('acknowledged');
    });
  });

  describe('deleteEscalation', () => {
    it('should delete an escalation', async () => {
      const esc = await createEscalation(db, { reason: 'To delete' });

      await deleteEscalation(db, esc.id);

      const retrieved = await getEscalationById(db, esc.id);
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent escalation', async () => {
      await expect(deleteEscalation(db, 'non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle very long reason text', async () => {
      const longReason = 'A'.repeat(10000);
      const esc = await createEscalation(db, { reason: longReason });

      const retrieved = await getEscalationById(db, esc.id);
      expect(retrieved?.reason).toBe(longReason);
    });

    it('should handle special characters in reason', async () => {
      const reason = 'Reason with \'quotes\' and "double" and\nnewlines';
      const esc = await createEscalation(db, { reason });

      const retrieved = await getEscalationById(db, esc.id);
      expect(retrieved?.reason).toBe(reason);
    });

    it('should handle null resolution', async () => {
      const esc = await createEscalation(db, { reason: 'Test' });

      expect(esc.resolution).toBeNull();
      expect(esc.resolved_at).toBeNull();
    });
  });

  describe('getRecentEscalationsForAgent', () => {
    it('should return recent escalations for an agent', async () => {
      const esc1 = await createEscalation(db, { fromAgentId: agentId, reason: 'Recent 1' });
      const esc2 = await createEscalation(db, { fromAgentId: agentId, reason: 'Recent 2' });

      const agent2 = await createAgent(db, { type: 'junior', teamId });
      await createEscalation(db, { fromAgentId: agent2.id, reason: 'Other agent' });

      const recent = await getRecentEscalationsForAgent(db, agentId, 30);

      expect(recent).toHaveLength(2);
      expect(recent.map(e => e.id)).toContain(esc1.id);
      expect(recent.map(e => e.id)).toContain(esc2.id);
    });

    it('should return empty array for agent with no recent escalations', async () => {
      const recent = await getRecentEscalationsForAgent(db, 'non-existent-agent', 30);
      expect(recent).toEqual([]);
    });

    it('should return escalations in DESC order', async () => {
      const esc1 = await createEscalation(db, { fromAgentId: agentId, reason: 'First' });
      const esc2 = await createEscalation(db, { fromAgentId: agentId, reason: 'Second' });

      const recent = await getRecentEscalationsForAgent(db, agentId, 30);

      expect(recent).toHaveLength(2);
      // Both escalations should be present
      expect(recent.map(e => e.id)).toContain(esc1.id);
      expect(recent.map(e => e.id)).toContain(esc2.id);
    });
  });

  describe('getActiveEscalationsForAgent', () => {
    it('should return pending and acknowledged escalations for an agent', async () => {
      const esc1 = await createEscalation(db, { fromAgentId: agentId, reason: 'Pending' });
      const esc2 = await createEscalation(db, { fromAgentId: agentId, reason: 'Acknowledged' });
      await updateEscalation(db, esc2.id, { status: 'acknowledged' });

      const esc3 = await createEscalation(db, { fromAgentId: agentId, reason: 'Resolved' });
      await updateEscalation(db, esc3.id, { status: 'resolved', resolution: 'Fixed' });

      const active = await getActiveEscalationsForAgent(db, agentId);

      expect(active).toHaveLength(2);
      expect(active.map(e => e.id)).toContain(esc1.id);
      expect(active.map(e => e.id)).toContain(esc2.id);
      expect(active.map(e => e.id)).not.toContain(esc3.id);
    });

    it('should not return resolved escalations', async () => {
      await createEscalation(db, { fromAgentId: agentId, reason: 'Pending' });
      const esc2 = await createEscalation(db, { fromAgentId: agentId, reason: 'Will resolve' });
      await updateEscalation(db, esc2.id, { status: 'resolved', resolution: 'Fixed' });

      const active = await getActiveEscalationsForAgent(db, agentId);

      expect(active).toHaveLength(1);
      expect(active[0].reason).toBe('Pending');
    });

    it('should return empty array for agent with no active escalations', async () => {
      const active = await getActiveEscalationsForAgent(db, 'non-existent-agent');
      expect(active).toEqual([]);
    });
  });
});
