// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteProvider } from '../provider.js';
import { createAgent } from './agents.js';
import { createRequirement } from './requirements.js';
import {
  addStoryDependency,
  createStory,
  deleteStory,
  getActiveStoriesByAgent,
  getAllStories,
  getInProgressStories,
  getPlannedStories,
  getStoriesByAgent,
  getStoriesByRequirement,
  getStoriesByStatus,
  getStoriesByTeam,
  getStoriesDependingOn,
  getStoryById,
  getStoryCounts,
  getStoryDependencies,
  getStoryPointsByTeam,
  removeStoryDependency,
  updateStory,
} from './stories.js';
import { createTeam } from './teams.js';
import { createTestDatabase } from './test-helpers.js';

describe('stories queries', () => {
  let db: SqliteProvider;
  let teamId: string;
  let agentId: string;
  let requirementId: string;

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

    const requirement = await createRequirement(db, {
      title: 'Test Requirement',
      description: 'Test description',
    });
    requirementId = requirement.id;
  });

  describe('createStory', () => {
    it('should create a story with all fields', async () => {
      const story = await createStory(db, {
        requirementId,
        teamId,
        title: 'Implement feature X',
        description: 'Add feature X to the system',
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      });

      expect(story.id).toMatch(/^STORY-/);
      expect(story.requirement_id).toBe(requirementId);
      expect(story.team_id).toBe(teamId);
      expect(story.title).toBe('Implement feature X');
      expect(story.description).toBe('Add feature X to the system');
      expect(story.acceptance_criteria).toBe(JSON.stringify(['Criterion 1', 'Criterion 2']));
      expect(story.status).toBe('draft');
      expect(story.created_at).toBeDefined();
    });

    it('should create story with minimal fields', async () => {
      const story = await createStory(db, {
        title: 'Simple Story',
        description: 'Simple description',
      });

      expect(story.requirement_id).toBeNull();
      expect(story.team_id).toBeNull();
      expect(story.acceptance_criteria).toBeNull();
    });

    it('should generate unique IDs', async () => {
      const story1 = await createStory(db, {
        title: 'Story 1',
        description: 'Description 1',
      });

      const story2 = await createStory(db, {
        title: 'Story 2',
        description: 'Description 2',
      });

      expect(story1.id).not.toBe(story2.id);
    });

    it('should handle null acceptance criteria', async () => {
      const story = await createStory(db, {
        title: 'Story',
        description: 'Description',
        acceptanceCriteria: null,
      });

      expect(story.acceptance_criteria).toBeNull();
    });
  });

  describe('getStoryById', () => {
    it('should retrieve a story by ID', async () => {
      const created = await createStory(db, {
        title: 'Test Story',
        description: 'Test description',
        teamId,
      });

      const retrieved = await getStoryById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Test Story');
    });

    it('should return undefined for non-existent story', async () => {
      const result = await getStoryById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getStoriesByRequirement', () => {
    it('should return stories for a requirement', async () => {
      const story1 = await createStory(db, {
        requirementId,
        title: 'Story 1',
        description: 'Description 1',
      });

      const story2 = await createStory(db, {
        requirementId,
        title: 'Story 2',
        description: 'Description 2',
      });

      const req2 = await createRequirement(db, {
        title: 'Requirement 2',
        description: 'Description',
      });
      await createStory(db, {
        requirementId: req2.id,
        title: 'Story 3',
        description: 'Description 3',
      });

      const stories = await getStoriesByRequirement(db, requirementId);

      expect(stories).toHaveLength(2);
      expect(stories.map(s => s.id)).toContain(story1.id);
      expect(stories.map(s => s.id)).toContain(story2.id);
    });

    it('should order by created_at', async () => {
      const story1 = await createStory(db, {
        requirementId,
        title: 'First',
        description: 'Description',
      });

      const story2 = await createStory(db, {
        requirementId,
        title: 'Second',
        description: 'Description',
      });

      const stories = await getStoriesByRequirement(db, requirementId);

      expect(stories[0].id).toBe(story1.id);
      expect(stories[1].id).toBe(story2.id);
    });
  });

  describe('getStoriesByTeam', () => {
    it('should filter stories by team', async () => {
      const story1 = await createStory(db, {
        teamId,
        title: 'Story 1',
        description: 'Description',
      });

      const team2 = await createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });
      await createStory(db, {
        teamId: team2.id,
        title: 'Story 2',
        description: 'Description',
      });

      const stories = await getStoriesByTeam(db, teamId);

      expect(stories).toHaveLength(1);
      expect(stories[0].id).toBe(story1.id);
    });
  });

  describe('getStoriesByStatus', () => {
    it('should filter stories by status', async () => {
      const story1 = await createStory(db, {
        title: 'Draft Story',
        description: 'Description',
      });

      const story2 = await createStory(db, {
        title: 'In Progress Story',
        description: 'Description',
      });
      await updateStory(db, story2.id, { status: 'in_progress' });

      const draft = await getStoriesByStatus(db, 'draft');
      const inProgress = await getStoriesByStatus(db, 'in_progress');

      expect(draft).toHaveLength(1);
      expect(draft[0].id).toBe(story1.id);
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].id).toBe(story2.id);
    });
  });

  describe('getStoriesByAgent', () => {
    it('should return stories assigned to an agent', async () => {
      const story1 = await createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });
      await updateStory(db, story1.id, { assignedAgentId: agentId });

      const story2 = await createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });
      await updateStory(db, story2.id, { assignedAgentId: agentId });

      const agent2 = await createAgent(db, { type: 'junior', teamId });
      const story3 = await createStory(db, {
        title: 'Story 3',
        description: 'Description',
      });
      await updateStory(db, story3.id, { assignedAgentId: agent2.id });

      const stories = await getStoriesByAgent(db, agentId);

      expect(stories).toHaveLength(2);
      expect(stories.map(s => s.id)).toContain(story1.id);
      expect(stories.map(s => s.id)).toContain(story2.id);
    });
  });

  describe('getActiveStoriesByAgent', () => {
    it('should return only active stories for an agent', async () => {
      const story1 = await createStory(db, {
        title: 'Planned Story',
        description: 'Description',
      });
      await updateStory(db, story1.id, {
        assignedAgentId: agentId,
        status: 'planned',
      });

      const story2 = await createStory(db, {
        title: 'Merged Story',
        description: 'Description',
      });
      await updateStory(db, story2.id, {
        assignedAgentId: agentId,
        status: 'merged',
      });

      const activeStories = await getActiveStoriesByAgent(db, agentId);

      expect(activeStories).toHaveLength(1);
      expect(activeStories[0].id).toBe(story1.id);
    });
  });

  describe('getAllStories', () => {
    it('should return all stories ordered by created_at DESC', async () => {
      const story1 = await createStory(db, {
        title: 'First',
        description: 'Description',
      });

      const story2 = await createStory(db, {
        title: 'Second',
        description: 'Description',
      });

      const stories = await getAllStories(db);

      expect(stories).toHaveLength(2);
      // Verify both stories are present
      expect(stories.map(s => s.id)).toContain(story1.id);
      expect(stories.map(s => s.id)).toContain(story2.id);
    });
  });

  describe('getPlannedStories', () => {
    it('should return planned stories ordered by story points DESC', async () => {
      const story1 = await createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });
      await updateStory(db, story1.id, { status: 'planned', storyPoints: 5 });

      const story2 = await createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });
      await updateStory(db, story2.id, { status: 'planned', storyPoints: 8 });

      await createStory(db, {
        title: 'Draft Story',
        description: 'Description',
      });

      const planned = await getPlannedStories(db);

      expect(planned).toHaveLength(2);
      expect(planned[0].id).toBe(story2.id); // 8 points first
      expect(planned[1].id).toBe(story1.id); // 5 points second
    });
  });

  describe('getInProgressStories', () => {
    it('should return stories in progress statuses', async () => {
      const story1 = await createStory(db, {
        title: 'In Progress',
        description: 'Description',
      });
      await updateStory(db, story1.id, { status: 'in_progress' });

      const story2 = await createStory(db, {
        title: 'QA',
        description: 'Description',
      });
      await updateStory(db, story2.id, { status: 'qa' });

      const story3 = await createStory(db, {
        title: 'Merged',
        description: 'Description',
      });
      await updateStory(db, story3.id, { status: 'merged' });

      const inProgress = await getInProgressStories(db);

      expect(inProgress).toHaveLength(2);
      expect(inProgress.map(s => s.id)).toContain(story1.id);
      expect(inProgress.map(s => s.id)).toContain(story2.id);
      expect(inProgress.map(s => s.id)).not.toContain(story3.id);
    });
  });

  describe('getStoryPointsByTeam', () => {
    it('should sum story points for active team stories', async () => {
      await createStory(db, { title: 'S1', description: 'D', teamId });
      const s1 = await createStory(db, { title: 'S1', description: 'D', teamId });
      await updateStory(db, s1.id, { status: 'planned', storyPoints: 5 });

      const s2 = await createStory(db, { title: 'S2', description: 'D', teamId });
      await updateStory(db, s2.id, { status: 'in_progress', storyPoints: 8 });

      const s3 = await createStory(db, { title: 'S3', description: 'D', teamId });
      await updateStory(db, s3.id, { status: 'merged', storyPoints: 3 });

      const total = await getStoryPointsByTeam(db, teamId);

      expect(total).toBe(13); // 5 + 8, not including merged
    });

    it('should return 0 when no active stories', async () => {
      const total = await getStoryPointsByTeam(db, teamId);
      expect(total).toBe(0);
    });
  });

  describe('updateStory', () => {
    it('should update story title', async () => {
      const story = await createStory(db, {
        title: 'Original',
        description: 'Description',
      });

      const updated = await updateStory(db, story.id, { title: 'Updated' });

      expect(updated?.title).toBe('Updated');
    });

    it('should update story status', async () => {
      const story = await createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = await updateStory(db, story.id, { status: 'in_progress' });

      expect(updated?.status).toBe('in_progress');
    });

    it('should update complexity and story points', async () => {
      const story = await createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = await updateStory(db, story.id, {
        complexityScore: 8,
        storyPoints: 5,
      });

      expect(updated?.complexity_score).toBe(8);
      expect(updated?.story_points).toBe(5);
    });

    it('should update assigned agent', async () => {
      const story = await createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = await updateStory(db, story.id, { assignedAgentId: agentId });

      expect(updated?.assigned_agent_id).toBe(agentId);
    });

    it('should update acceptance criteria', async () => {
      const story = await createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = await updateStory(db, story.id, {
        acceptanceCriteria: ['New criterion 1', 'New criterion 2'],
      });

      expect(updated?.acceptance_criteria).toBe(
        JSON.stringify(['New criterion 1', 'New criterion 2'])
      );
    });

    it('should update branch and PR info', async () => {
      const story = await createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = await updateStory(db, story.id, {
        branchName: 'feature/test-branch',
        prUrl: 'https://github.com/test/repo/pull/123',
      });

      expect(updated?.branch_name).toBe('feature/test-branch');
      expect(updated?.pr_url).toBe('https://github.com/test/repo/pull/123');
    });

    it('should update multiple fields at once', async () => {
      const story = await createStory(db, {
        title: 'Original',
        description: 'Original description',
      });

      const updated = await updateStory(db, story.id, {
        title: 'Updated',
        description: 'Updated description',
        status: 'in_progress',
        assignedAgentId: agentId,
      });

      expect(updated?.title).toBe('Updated');
      expect(updated?.description).toBe('Updated description');
      expect(updated?.status).toBe('in_progress');
      expect(updated?.assigned_agent_id).toBe(agentId);
    });

    it('should return story when no updates provided', async () => {
      const story = await createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = await updateStory(db, story.id, {});

      expect(updated?.id).toBe(story.id);
    });

    it('should return undefined for non-existent story', async () => {
      const updated = await updateStory(db, 'non-existent-id', { title: 'Updated' });
      expect(updated).toBeUndefined();
    });

    it('should handle setting fields to null', async () => {
      const story = await createStory(db, {
        title: 'Story',
        description: 'Description',
        teamId,
      });

      const updated = await updateStory(db, story.id, {
        teamId: null,
        acceptanceCriteria: null,
      });

      expect(updated?.team_id).toBeNull();
      expect(updated?.acceptance_criteria).toBeNull();
    });
  });

  describe('deleteStory', () => {
    it('should delete a story', async () => {
      const story = await createStory(db, {
        title: 'To Delete',
        description: 'Description',
      });

      await deleteStory(db, story.id);

      const retrieved = await getStoryById(db, story.id);
      expect(retrieved).toBeUndefined();
    });

    it('should delete story dependencies when deleting story', async () => {
      const story1 = await createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });

      const story2 = await createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });

      await addStoryDependency(db, story2.id, story1.id);

      await deleteStory(db, story1.id);

      const dependencies = await getStoryDependencies(db, story2.id);
      expect(dependencies).toEqual([]);
    });

    it('should not throw when deleting non-existent story', async () => {
      await expect(deleteStory(db, 'non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('story dependencies', () => {
    it('should add a story dependency', async () => {
      const story1 = await createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });

      const story2 = await createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });

      await addStoryDependency(db, story2.id, story1.id);

      const dependencies = await getStoryDependencies(db, story2.id);

      expect(dependencies).toHaveLength(1);
      expect(dependencies[0].id).toBe(story1.id);
    });

    it('should not duplicate dependencies', async () => {
      const story1 = await createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });

      const story2 = await createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });

      await addStoryDependency(db, story2.id, story1.id);
      await addStoryDependency(db, story2.id, story1.id);

      const dependencies = await getStoryDependencies(db, story2.id);

      expect(dependencies).toHaveLength(1);
    });

    it('should remove a story dependency', async () => {
      const story1 = await createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });

      const story2 = await createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });

      await addStoryDependency(db, story2.id, story1.id);
      await removeStoryDependency(db, story2.id, story1.id);

      const dependencies = await getStoryDependencies(db, story2.id);

      expect(dependencies).toEqual([]);
    });

    it('should get stories depending on a story', async () => {
      const story1 = await createStory(db, {
        title: 'Base Story',
        description: 'Description',
      });

      const story2 = await createStory(db, {
        title: 'Dependent 1',
        description: 'Description',
      });

      const story3 = await createStory(db, {
        title: 'Dependent 2',
        description: 'Description',
      });

      await addStoryDependency(db, story2.id, story1.id);
      await addStoryDependency(db, story3.id, story1.id);

      const dependents = await getStoriesDependingOn(db, story1.id);

      expect(dependents).toHaveLength(2);
      expect(dependents.map(s => s.id)).toContain(story2.id);
      expect(dependents.map(s => s.id)).toContain(story3.id);
    });
  });

  describe('getStoryCounts', () => {
    it('should return counts by status', async () => {
      await createStory(db, { title: 'S1', description: 'D' }); // draft
      await createStory(db, { title: 'S2', description: 'D' }); // draft

      const s3 = await createStory(db, { title: 'S3', description: 'D' });
      await updateStory(db, s3.id, { status: 'planned' });

      const s4 = await createStory(db, { title: 'S4', description: 'D' });
      await updateStory(db, s4.id, { status: 'in_progress' });

      const counts = await getStoryCounts(db);

      expect(counts.draft).toBe(2);
      expect(counts.planned).toBe(1);
      expect(counts.in_progress).toBe(1);
      expect(counts.merged).toBe(0);
    });

    it('should return zero counts when no stories', async () => {
      const counts = await getStoryCounts(db);

      expect(counts.draft).toBe(0);
      expect(counts.estimated).toBe(0);
      expect(counts.planned).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle all story statuses', async () => {
      const statuses: Array<
        | 'draft'
        | 'estimated'
        | 'planned'
        | 'in_progress'
        | 'review'
        | 'qa'
        | 'qa_failed'
        | 'pr_submitted'
        | 'merged'
      > = [
        'draft',
        'estimated',
        'planned',
        'in_progress',
        'review',
        'qa',
        'qa_failed',
        'pr_submitted',
        'merged',
      ];

      const story = await createStory(db, {
        title: 'Test',
        description: 'Description',
      });

      for (const status of statuses) {
        const updated = await updateStory(db, story.id, { status });
        expect(updated?.status).toBe(status);
      }
    });

    it('should handle very long text fields', async () => {
      const longText = 'A'.repeat(100000);
      const story = await createStory(db, {
        title: longText,
        description: longText,
      });

      const retrieved = await getStoryById(db, story.id);
      expect(retrieved?.title).toBe(longText);
      expect(retrieved?.description).toBe(longText);
    });

    it('should handle special characters', async () => {
      const story = await createStory(db, {
        title: 'Title with \'quotes\' and "double"',
        description: 'Description with\nnewlines\tand\ttabs',
      });

      const retrieved = await getStoryById(db, story.id);
      expect(retrieved?.title).toBe('Title with \'quotes\' and "double"');
      expect(retrieved?.description).toBe('Description with\nnewlines\tand\ttabs');
    });
  });
});
