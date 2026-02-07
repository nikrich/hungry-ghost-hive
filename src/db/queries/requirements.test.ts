import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createRequirement,
  deleteRequirement,
  getAllRequirements,
  getPendingRequirements,
  getRequirementById,
  getRequirementsByStatus,
  updateRequirement,
} from './requirements.js';
import { createTestDatabase } from './test-helpers.js';

describe('requirements queries', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  describe('createRequirement', () => {
    it('should create a requirement with all fields', () => {
      const req = createRequirement(db, {
        title: 'New Feature',
        description: 'Add new feature to the app',
        submittedBy: 'user123',
      });

      expect(req.id).toMatch(/^REQ-/);
      expect(req.title).toBe('New Feature');
      expect(req.description).toBe('Add new feature to the app');
      expect(req.submitted_by).toBe('user123');
      expect(req.status).toBe('pending');
      expect(req.created_at).toBeDefined();
    });

    it('should default submittedBy to "human"', () => {
      const req = createRequirement(db, {
        title: 'New Feature',
        description: 'Add new feature',
      });

      expect(req.submitted_by).toBe('human');
    });

    it('should create a requirement with godmode enabled', () => {
      const req = createRequirement(db, {
        title: 'Godmode Feature',
        description: 'Add feature with godmode',
        godmode: true,
      });

      expect(req.id).toMatch(/^REQ-/);
      expect(req.godmode).toBe(1);
    });

    it('should default godmode to 0 when not specified', () => {
      const req = createRequirement(db, {
        title: 'Normal Feature',
        description: 'Add feature without godmode',
      });

      expect(req.godmode).toBe(0);
    });

    it('should generate unique IDs', () => {
      const req1 = createRequirement(db, {
        title: 'Feature 1',
        description: 'Description 1',
      });

      const req2 = createRequirement(db, {
        title: 'Feature 2',
        description: 'Description 2',
      });

      expect(req1.id).not.toBe(req2.id);
    });
  });

  describe('getRequirementById', () => {
    it('should retrieve a requirement by ID', () => {
      const created = createRequirement(db, {
        title: 'Test Requirement',
        description: 'Test description',
      });

      const retrieved = getRequirementById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Test Requirement');
    });

    it('should return undefined for non-existent requirement', () => {
      const result = getRequirementById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllRequirements', () => {
    it('should return empty array when no requirements exist', () => {
      const requirements = getAllRequirements(db);
      expect(requirements).toEqual([]);
    });

    it('should return all requirements ordered by created_at DESC', () => {
      const req1 = createRequirement(db, {
        title: 'First',
        description: 'First requirement',
      });

      const req2 = createRequirement(db, {
        title: 'Second',
        description: 'Second requirement',
      });

      const requirements = getAllRequirements(db);

      expect(requirements).toHaveLength(2);
      // Verify both requirements are present
      expect(requirements.map(r => r.id)).toContain(req1.id);
      expect(requirements.map(r => r.id)).toContain(req2.id);
    });
  });

  describe('getRequirementsByStatus', () => {
    it('should filter requirements by status', () => {
      createRequirement(db, {
        title: 'Pending Req',
        description: 'Description',
      });

      const req2 = createRequirement(db, {
        title: 'In Progress Req',
        description: 'Description',
      });

      updateRequirement(db, req2.id, { status: 'in_progress' });

      const pending = getRequirementsByStatus(db, 'pending');
      const inProgress = getRequirementsByStatus(db, 'in_progress');

      expect(pending).toHaveLength(1);
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].id).toBe(req2.id);
    });

    it('should return empty array when no requirements match status', () => {
      const completed = getRequirementsByStatus(db, 'completed');
      expect(completed).toEqual([]);
    });
  });

  describe('getPendingRequirements', () => {
    it('should return requirements with pending, planning, or in_progress status', () => {
      const req1 = createRequirement(db, {
        title: 'Pending',
        description: 'Pending req',
      });

      const req2 = createRequirement(db, {
        title: 'Planning',
        description: 'Planning req',
      });
      updateRequirement(db, req2.id, { status: 'planning' });

      const req3 = createRequirement(db, {
        title: 'In Progress',
        description: 'In progress req',
      });
      updateRequirement(db, req3.id, { status: 'in_progress' });

      const req4 = createRequirement(db, {
        title: 'Completed',
        description: 'Completed req',
      });
      updateRequirement(db, req4.id, { status: 'completed' });

      const pending = getPendingRequirements(db);

      expect(pending).toHaveLength(3);
      expect(pending.map(r => r.id)).toContain(req1.id);
      expect(pending.map(r => r.id)).toContain(req2.id);
      expect(pending.map(r => r.id)).toContain(req3.id);
      expect(pending.map(r => r.id)).not.toContain(req4.id);
    });
  });

  describe('updateRequirement', () => {
    it('should update requirement title', () => {
      const req = createRequirement(db, {
        title: 'Original Title',
        description: 'Description',
      });

      const updated = updateRequirement(db, req.id, {
        title: 'Updated Title',
      });

      expect(updated?.title).toBe('Updated Title');
      expect(updated?.description).toBe('Description'); // Unchanged
    });

    it('should update requirement description', () => {
      const req = createRequirement(db, {
        title: 'Title',
        description: 'Original Description',
      });

      const updated = updateRequirement(db, req.id, {
        description: 'Updated Description',
      });

      expect(updated?.description).toBe('Updated Description');
    });

    it('should update requirement status', () => {
      const req = createRequirement(db, {
        title: 'Title',
        description: 'Description',
      });

      const updated = updateRequirement(db, req.id, {
        status: 'completed',
      });

      expect(updated?.status).toBe('completed');
    });

    it('should update requirement godmode flag', () => {
      const req = createRequirement(db, {
        title: 'Title',
        description: 'Description',
        godmode: false,
      });

      expect(req.godmode).toBe(0);

      const updated = updateRequirement(db, req.id, {
        godmode: true,
      });

      expect(updated?.godmode).toBe(1);
    });

    it('should update multiple fields at once', () => {
      const req = createRequirement(db, {
        title: 'Original',
        description: 'Original',
      });

      const updated = updateRequirement(db, req.id, {
        title: 'New Title',
        description: 'New Description',
        status: 'planned',
      });

      expect(updated?.title).toBe('New Title');
      expect(updated?.description).toBe('New Description');
      expect(updated?.status).toBe('planned');
    });

    it('should return original requirement when no updates provided', () => {
      const req = createRequirement(db, {
        title: 'Title',
        description: 'Description',
      });

      const updated = updateRequirement(db, req.id, {});

      expect(updated?.id).toBe(req.id);
      expect(updated?.title).toBe(req.title);
    });

    it('should return undefined for non-existent requirement', () => {
      const updated = updateRequirement(db, 'non-existent-id', {
        title: 'New Title',
      });

      expect(updated).toBeUndefined();
    });
  });

  describe('deleteRequirement', () => {
    it('should delete a requirement', () => {
      const req = createRequirement(db, {
        title: 'To Delete',
        description: 'Will be deleted',
      });

      deleteRequirement(db, req.id);

      const retrieved = getRequirementById(db, req.id);
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent requirement', () => {
      expect(() => deleteRequirement(db, 'non-existent-id')).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings in title and description', () => {
      const req = createRequirement(db, {
        title: '',
        description: '',
      });

      expect(req.title).toBe('');
      expect(req.description).toBe('');
    });

    it('should handle very long text fields', () => {
      const longText = 'A'.repeat(10000);
      const req = createRequirement(db, {
        title: longText,
        description: longText,
      });

      const retrieved = getRequirementById(db, req.id);
      expect(retrieved?.title).toBe(longText);
      expect(retrieved?.description).toBe(longText);
    });

    it('should handle special characters', () => {
      const req = createRequirement(db, {
        title: 'Title with \'quotes\' and "double" quotes',
        description: 'Description with\nnewlines\tand\ttabs',
      });

      const retrieved = getRequirementById(db, req.id);
      expect(retrieved?.title).toBe('Title with \'quotes\' and "double" quotes');
      expect(retrieved?.description).toBe('Description with\nnewlines\tand\ttabs');
    });
  });
});
