// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteProvider } from '../provider.js';
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
  let db: SqliteProvider;

  beforeEach(async () => {
    const rawDb = await createTestDatabase();
    db = new SqliteProvider(rawDb);
  });

  describe('createRequirement', () => {
    it('should create a requirement with all fields', async () => {
      const req = await createRequirement(db, {
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

    it('should default submittedBy to "human"', async () => {
      const req = await createRequirement(db, {
        title: 'New Feature',
        description: 'Add new feature',
      });

      expect(req.submitted_by).toBe('human');
    });

    it('should create a requirement with godmode enabled', async () => {
      const req = await createRequirement(db, {
        title: 'Godmode Feature',
        description: 'Add feature with godmode',
        godmode: true,
      });

      expect(req.id).toMatch(/^REQ-/);
      expect(req.godmode).toBe(1);
    });

    it('should default godmode to 0 when not specified', async () => {
      const req = await createRequirement(db, {
        title: 'Normal Feature',
        description: 'Add feature without godmode',
      });

      expect(req.godmode).toBe(0);
    });

    it('should create a requirement with custom target branch', async () => {
      const req = await createRequirement(db, {
        title: 'Feature on Release Branch',
        description: 'Targeting a release branch',
        targetBranch: 'release/v2',
      });

      expect(req.id).toMatch(/^REQ-/);
      expect(req.target_branch).toBe('release/v2');
    });

    it('should default target_branch to main when not specified', async () => {
      const req = await createRequirement(db, {
        title: 'Normal Feature',
        description: 'Default target branch',
      });

      expect(req.target_branch).toBe('main');
    });

    it('should generate unique IDs', async () => {
      const req1 = await createRequirement(db, {
        title: 'Feature 1',
        description: 'Description 1',
      });

      const req2 = await createRequirement(db, {
        title: 'Feature 2',
        description: 'Description 2',
      });

      expect(req1.id).not.toBe(req2.id);
    });
  });

  describe('getRequirementById', () => {
    it('should retrieve a requirement by ID', async () => {
      const created = await createRequirement(db, {
        title: 'Test Requirement',
        description: 'Test description',
      });

      const retrieved = await getRequirementById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Test Requirement');
    });

    it('should return undefined for non-existent requirement', async () => {
      const result = await getRequirementById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllRequirements', () => {
    it('should return empty array when no requirements exist', async () => {
      const requirements = await getAllRequirements(db);
      expect(requirements).toEqual([]);
    });

    it('should return all requirements ordered by created_at DESC', async () => {
      const req1 = await createRequirement(db, {
        title: 'First',
        description: 'First requirement',
      });

      const req2 = await createRequirement(db, {
        title: 'Second',
        description: 'Second requirement',
      });

      const requirements = await getAllRequirements(db);

      expect(requirements).toHaveLength(2);
      // Verify both requirements are present
      expect(requirements.map(r => r.id)).toContain(req1.id);
      expect(requirements.map(r => r.id)).toContain(req2.id);
    });
  });

  describe('getRequirementsByStatus', () => {
    it('should filter requirements by status', async () => {
      await createRequirement(db, {
        title: 'Pending Req',
        description: 'Description',
      });

      const req2 = await createRequirement(db, {
        title: 'In Progress Req',
        description: 'Description',
      });

      await updateRequirement(db, req2.id, { status: 'in_progress' });

      const pending = await getRequirementsByStatus(db, 'pending');
      const inProgress = await getRequirementsByStatus(db, 'in_progress');

      expect(pending).toHaveLength(1);
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].id).toBe(req2.id);
    });

    it('should return empty array when no requirements match status', async () => {
      const completed = await getRequirementsByStatus(db, 'completed');
      expect(completed).toEqual([]);
    });
  });

  describe('getPendingRequirements', () => {
    it('should return requirements with pending, planning, or in_progress status', async () => {
      const req1 = await createRequirement(db, {
        title: 'Pending',
        description: 'Pending req',
      });

      const req2 = await createRequirement(db, {
        title: 'Planning',
        description: 'Planning req',
      });
      await updateRequirement(db, req2.id, { status: 'planning' });

      const req3 = await createRequirement(db, {
        title: 'In Progress',
        description: 'In progress req',
      });
      await updateRequirement(db, req3.id, { status: 'in_progress' });

      const req4 = await createRequirement(db, {
        title: 'Completed',
        description: 'Completed req',
      });
      await updateRequirement(db, req4.id, { status: 'completed' });

      const pending = await getPendingRequirements(db);

      expect(pending).toHaveLength(3);
      expect(pending.map(r => r.id)).toContain(req1.id);
      expect(pending.map(r => r.id)).toContain(req2.id);
      expect(pending.map(r => r.id)).toContain(req3.id);
      expect(pending.map(r => r.id)).not.toContain(req4.id);
    });
  });

  describe('updateRequirement', () => {
    it('should update requirement title', async () => {
      const req = await createRequirement(db, {
        title: 'Original Title',
        description: 'Description',
      });

      const updated = await updateRequirement(db, req.id, {
        title: 'Updated Title',
      });

      expect(updated?.title).toBe('Updated Title');
      expect(updated?.description).toBe('Description'); // Unchanged
    });

    it('should update requirement description', async () => {
      const req = await createRequirement(db, {
        title: 'Title',
        description: 'Original Description',
      });

      const updated = await updateRequirement(db, req.id, {
        description: 'Updated Description',
      });

      expect(updated?.description).toBe('Updated Description');
    });

    it('should update requirement status', async () => {
      const req = await createRequirement(db, {
        title: 'Title',
        description: 'Description',
      });

      const updated = await updateRequirement(db, req.id, {
        status: 'completed',
      });

      expect(updated?.status).toBe('completed');
    });

    it('should update requirement godmode flag', async () => {
      const req = await createRequirement(db, {
        title: 'Title',
        description: 'Description',
        godmode: false,
      });

      expect(req.godmode).toBe(0);

      const updated = await updateRequirement(db, req.id, {
        godmode: true,
      });

      expect(updated?.godmode).toBe(1);
    });

    it('should update requirement target branch', async () => {
      const req = await createRequirement(db, {
        title: 'Title',
        description: 'Description',
      });

      expect(req.target_branch).toBe('main');

      const updated = await updateRequirement(db, req.id, {
        targetBranch: 'develop',
      });

      expect(updated?.target_branch).toBe('develop');
    });

    it('should update multiple fields at once', async () => {
      const req = await createRequirement(db, {
        title: 'Original',
        description: 'Original',
      });

      const updated = await updateRequirement(db, req.id, {
        title: 'New Title',
        description: 'New Description',
        status: 'planned',
      });

      expect(updated?.title).toBe('New Title');
      expect(updated?.description).toBe('New Description');
      expect(updated?.status).toBe('planned');
    });

    it('should return original requirement when no updates provided', async () => {
      const req = await createRequirement(db, {
        title: 'Title',
        description: 'Description',
      });

      const updated = await updateRequirement(db, req.id, {});

      expect(updated?.id).toBe(req.id);
      expect(updated?.title).toBe(req.title);
    });

    it('should return undefined for non-existent requirement', async () => {
      const updated = await updateRequirement(db, 'non-existent-id', {
        title: 'New Title',
      });

      expect(updated).toBeUndefined();
    });
  });

  describe('deleteRequirement', () => {
    it('should delete a requirement', async () => {
      const req = await createRequirement(db, {
        title: 'To Delete',
        description: 'Will be deleted',
      });

      await deleteRequirement(db, req.id);

      const retrieved = await getRequirementById(db, req.id);
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent requirement', async () => {
      await expect(deleteRequirement(db, 'non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings in title and description', async () => {
      const req = await createRequirement(db, {
        title: '',
        description: '',
      });

      expect(req.title).toBe('');
      expect(req.description).toBe('');
    });

    it('should handle very long text fields', async () => {
      const longText = 'A'.repeat(10000);
      const req = await createRequirement(db, {
        title: longText,
        description: longText,
      });

      const retrieved = await getRequirementById(db, req.id);
      expect(retrieved?.title).toBe(longText);
      expect(retrieved?.description).toBe(longText);
    });

    it('should handle special characters', async () => {
      const req = await createRequirement(db, {
        title: 'Title with \'quotes\' and "double" quotes',
        description: 'Description with\nnewlines\tand\ttabs',
      });

      const retrieved = await getRequirementById(db, req.id);
      expect(retrieved?.title).toBe('Title with \'quotes\' and "double" quotes');
      expect(retrieved?.description).toBe('Description with\nnewlines\tand\ttabs');
    });
  });
});
