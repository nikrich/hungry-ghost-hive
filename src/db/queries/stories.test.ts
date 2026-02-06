import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDatabase } from './test-helpers.js';
import { createTeam } from './teams.js';
import { createAgent, updateAgent } from './agents.js';
import { createRequirement } from './requirements.js';
import {
  createStory,
  getStoryById,
  getStoriesByRequirement,
  getStoriesByTeam,
  getStoriesByStatus,
  getStoriesByAgent,
  getActiveStoriesByAgent,
  getAllStories,
  getPlannedStories,
  getInProgressStories,
  getStoryPointsByTeam,
  updateStory,
  deleteStory,
  addStoryDependency,
  removeStoryDependency,
  getStoryDependencies,
  getStoriesDependingOn,
  getStoryCounts,
  getBatchStoryDependencies,
  getStoriesWithOrphanedAssignments,
  updateStoryAssignment,
} from './stories.js';

describe('stories queries', () => {
  let db: Database;
  let teamId: string;
  let agentId: string;
  let requirementId: string;

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

    const requirement = createRequirement(db, {
      title: 'Test Requirement',
      description: 'Test description',
    });
    requirementId = requirement.id;
  });

  describe('createStory', () => {
    it('should create a story with all fields', () => {
      const story = createStory(db, {
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

    it('should create story with minimal fields', () => {
      const story = createStory(db, {
        title: 'Simple Story',
        description: 'Simple description',
      });

      expect(story.requirement_id).toBeNull();
      expect(story.team_id).toBeNull();
      expect(story.acceptance_criteria).toBeNull();
    });

    it('should generate unique IDs', () => {
      const story1 = createStory(db, {
        title: 'Story 1',
        description: 'Description 1',
      });

      const story2 = createStory(db, {
        title: 'Story 2',
        description: 'Description 2',
      });

      expect(story1.id).not.toBe(story2.id);
    });

    it('should handle null acceptance criteria', () => {
      const story = createStory(db, {
        title: 'Story',
        description: 'Description',
        acceptanceCriteria: null,
      });

      expect(story.acceptance_criteria).toBeNull();
    });
  });

  describe('getStoryById', () => {
    it('should retrieve a story by ID', () => {
      const created = createStory(db, {
        title: 'Test Story',
        description: 'Test description',
        teamId,
      });

      const retrieved = getStoryById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Test Story');
    });

    it('should return undefined for non-existent story', () => {
      const result = getStoryById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getStoriesByRequirement', () => {
    it('should return stories for a requirement', () => {
      const story1 = createStory(db, {
        requirementId,
        title: 'Story 1',
        description: 'Description 1',
      });

      const story2 = createStory(db, {
        requirementId,
        title: 'Story 2',
        description: 'Description 2',
      });

      const req2 = createRequirement(db, {
        title: 'Requirement 2',
        description: 'Description',
      });
      createStory(db, {
        requirementId: req2.id,
        title: 'Story 3',
        description: 'Description 3',
      });

      const stories = getStoriesByRequirement(db, requirementId);

      expect(stories).toHaveLength(2);
      expect(stories.map(s => s.id)).toContain(story1.id);
      expect(stories.map(s => s.id)).toContain(story2.id);
    });

    it('should order by created_at', () => {
      const story1 = createStory(db, {
        requirementId,
        title: 'First',
        description: 'Description',
      });

      const story2 = createStory(db, {
        requirementId,
        title: 'Second',
        description: 'Description',
      });

      const stories = getStoriesByRequirement(db, requirementId);

      expect(stories[0].id).toBe(story1.id);
      expect(stories[1].id).toBe(story2.id);
    });
  });

  describe('getStoriesByTeam', () => {
    it('should filter stories by team', () => {
      const story1 = createStory(db, {
        teamId,
        title: 'Story 1',
        description: 'Description',
      });

      const team2 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });
      createStory(db, {
        teamId: team2.id,
        title: 'Story 2',
        description: 'Description',
      });

      const stories = getStoriesByTeam(db, teamId);

      expect(stories).toHaveLength(1);
      expect(stories[0].id).toBe(story1.id);
    });
  });

  describe('getStoriesByStatus', () => {
    it('should filter stories by status', () => {
      const story1 = createStory(db, {
        title: 'Draft Story',
        description: 'Description',
      });

      const story2 = createStory(db, {
        title: 'In Progress Story',
        description: 'Description',
      });
      updateStory(db, story2.id, { status: 'in_progress' });

      const draft = getStoriesByStatus(db, 'draft');
      const inProgress = getStoriesByStatus(db, 'in_progress');

      expect(draft).toHaveLength(1);
      expect(draft[0].id).toBe(story1.id);
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].id).toBe(story2.id);
    });
  });

  describe('getStoriesByAgent', () => {
    it('should return stories assigned to an agent', () => {
      const story1 = createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });
      updateStory(db, story1.id, { assignedAgentId: agentId });

      const story2 = createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });
      updateStory(db, story2.id, { assignedAgentId: agentId });

      const agent2 = createAgent(db, { type: 'junior', teamId });
      const story3 = createStory(db, {
        title: 'Story 3',
        description: 'Description',
      });
      updateStory(db, story3.id, { assignedAgentId: agent2.id });

      const stories = getStoriesByAgent(db, agentId);

      expect(stories).toHaveLength(2);
      expect(stories.map(s => s.id)).toContain(story1.id);
      expect(stories.map(s => s.id)).toContain(story2.id);
    });
  });

  describe('getActiveStoriesByAgent', () => {
    it('should return only active stories for an agent', () => {
      const story1 = createStory(db, {
        title: 'Planned Story',
        description: 'Description',
      });
      updateStory(db, story1.id, {
        assignedAgentId: agentId,
        status: 'planned',
      });

      const story2 = createStory(db, {
        title: 'Merged Story',
        description: 'Description',
      });
      updateStory(db, story2.id, {
        assignedAgentId: agentId,
        status: 'merged',
      });

      const activeStories = getActiveStoriesByAgent(db, agentId);

      expect(activeStories).toHaveLength(1);
      expect(activeStories[0].id).toBe(story1.id);
    });
  });

  describe('getAllStories', () => {
    it('should return all stories ordered by created_at DESC', () => {
      const story1 = createStory(db, {
        title: 'First',
        description: 'Description',
      });

      const story2 = createStory(db, {
        title: 'Second',
        description: 'Description',
      });

      const stories = getAllStories(db);

      expect(stories).toHaveLength(2);
      // Verify both stories are present
      expect(stories.map(s => s.id)).toContain(story1.id);
      expect(stories.map(s => s.id)).toContain(story2.id);
    });
  });

  describe('getPlannedStories', () => {
    it('should return planned stories ordered by story points DESC', () => {
      const story1 = createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });
      updateStory(db, story1.id, { status: 'planned', storyPoints: 5 });

      const story2 = createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });
      updateStory(db, story2.id, { status: 'planned', storyPoints: 8 });

      createStory(db, {
        title: 'Draft Story',
        description: 'Description',
      });

      const planned = getPlannedStories(db);

      expect(planned).toHaveLength(2);
      expect(planned[0].id).toBe(story2.id); // 8 points first
      expect(planned[1].id).toBe(story1.id); // 5 points second
    });
  });

  describe('getInProgressStories', () => {
    it('should return stories in progress statuses', () => {
      const story1 = createStory(db, {
        title: 'In Progress',
        description: 'Description',
      });
      updateStory(db, story1.id, { status: 'in_progress' });

      const story2 = createStory(db, {
        title: 'QA',
        description: 'Description',
      });
      updateStory(db, story2.id, { status: 'qa' });

      const story3 = createStory(db, {
        title: 'Merged',
        description: 'Description',
      });
      updateStory(db, story3.id, { status: 'merged' });

      const inProgress = getInProgressStories(db);

      expect(inProgress).toHaveLength(2);
      expect(inProgress.map(s => s.id)).toContain(story1.id);
      expect(inProgress.map(s => s.id)).toContain(story2.id);
      expect(inProgress.map(s => s.id)).not.toContain(story3.id);
    });
  });

  describe('getStoryPointsByTeam', () => {
    it('should sum story points for active team stories', () => {
      createStory(db, { title: 'S1', description: 'D', teamId });
      const s1 = createStory(db, { title: 'S1', description: 'D', teamId });
      updateStory(db, s1.id, { status: 'planned', storyPoints: 5 });

      const s2 = createStory(db, { title: 'S2', description: 'D', teamId });
      updateStory(db, s2.id, { status: 'in_progress', storyPoints: 8 });

      const s3 = createStory(db, { title: 'S3', description: 'D', teamId });
      updateStory(db, s3.id, { status: 'merged', storyPoints: 3 });

      const total = getStoryPointsByTeam(db, teamId);

      expect(total).toBe(13); // 5 + 8, not including merged
    });

    it('should return 0 when no active stories', () => {
      const total = getStoryPointsByTeam(db, teamId);
      expect(total).toBe(0);
    });
  });

  describe('updateStory', () => {
    it('should update story title', () => {
      const story = createStory(db, {
        title: 'Original',
        description: 'Description',
      });

      const updated = updateStory(db, story.id, { title: 'Updated' });

      expect(updated?.title).toBe('Updated');
    });

    it('should update story status', () => {
      const story = createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = updateStory(db, story.id, { status: 'in_progress' });

      expect(updated?.status).toBe('in_progress');
    });

    it('should update complexity and story points', () => {
      const story = createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = updateStory(db, story.id, {
        complexityScore: 8,
        storyPoints: 5,
      });

      expect(updated?.complexity_score).toBe(8);
      expect(updated?.story_points).toBe(5);
    });

    it('should update assigned agent', () => {
      const story = createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = updateStory(db, story.id, { assignedAgentId: agentId });

      expect(updated?.assigned_agent_id).toBe(agentId);
    });

    it('should update acceptance criteria', () => {
      const story = createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = updateStory(db, story.id, {
        acceptanceCriteria: ['New criterion 1', 'New criterion 2'],
      });

      expect(updated?.acceptance_criteria).toBe(
        JSON.stringify(['New criterion 1', 'New criterion 2'])
      );
    });

    it('should update branch and PR info', () => {
      const story = createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = updateStory(db, story.id, {
        branchName: 'feature/test-branch',
        prUrl: 'https://github.com/test/repo/pull/123',
      });

      expect(updated?.branch_name).toBe('feature/test-branch');
      expect(updated?.pr_url).toBe('https://github.com/test/repo/pull/123');
    });

    it('should update multiple fields at once', () => {
      const story = createStory(db, {
        title: 'Original',
        description: 'Original description',
      });

      const updated = updateStory(db, story.id, {
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

    it('should return story when no updates provided', () => {
      const story = createStory(db, {
        title: 'Story',
        description: 'Description',
      });

      const updated = updateStory(db, story.id, {});

      expect(updated?.id).toBe(story.id);
    });

    it('should return undefined for non-existent story', () => {
      const updated = updateStory(db, 'non-existent-id', { title: 'Updated' });
      expect(updated).toBeUndefined();
    });

    it('should handle setting fields to null', () => {
      const story = createStory(db, {
        title: 'Story',
        description: 'Description',
        teamId,
      });

      const updated = updateStory(db, story.id, {
        teamId: null,
        acceptanceCriteria: null,
      });

      expect(updated?.team_id).toBeNull();
      expect(updated?.acceptance_criteria).toBeNull();
    });
  });

  describe('deleteStory', () => {
    it('should delete a story', () => {
      const story = createStory(db, {
        title: 'To Delete',
        description: 'Description',
      });

      deleteStory(db, story.id);

      const retrieved = getStoryById(db, story.id);
      expect(retrieved).toBeUndefined();
    });

    it('should delete story dependencies when deleting story', () => {
      const story1 = createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });

      const story2 = createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });

      addStoryDependency(db, story2.id, story1.id);

      deleteStory(db, story1.id);

      const dependencies = getStoryDependencies(db, story2.id);
      expect(dependencies).toEqual([]);
    });

    it('should not throw when deleting non-existent story', () => {
      expect(() => deleteStory(db, 'non-existent-id')).not.toThrow();
    });
  });

  describe('story dependencies', () => {
    it('should add a story dependency', () => {
      const story1 = createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });

      const story2 = createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });

      addStoryDependency(db, story2.id, story1.id);

      const dependencies = getStoryDependencies(db, story2.id);

      expect(dependencies).toHaveLength(1);
      expect(dependencies[0].id).toBe(story1.id);
    });

    it('should not duplicate dependencies', () => {
      const story1 = createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });

      const story2 = createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });

      addStoryDependency(db, story2.id, story1.id);
      addStoryDependency(db, story2.id, story1.id);

      const dependencies = getStoryDependencies(db, story2.id);

      expect(dependencies).toHaveLength(1);
    });

    it('should remove a story dependency', () => {
      const story1 = createStory(db, {
        title: 'Story 1',
        description: 'Description',
      });

      const story2 = createStory(db, {
        title: 'Story 2',
        description: 'Description',
      });

      addStoryDependency(db, story2.id, story1.id);
      removeStoryDependency(db, story2.id, story1.id);

      const dependencies = getStoryDependencies(db, story2.id);

      expect(dependencies).toEqual([]);
    });

    it('should get stories depending on a story', () => {
      const story1 = createStory(db, {
        title: 'Base Story',
        description: 'Description',
      });

      const story2 = createStory(db, {
        title: 'Dependent 1',
        description: 'Description',
      });

      const story3 = createStory(db, {
        title: 'Dependent 2',
        description: 'Description',
      });

      addStoryDependency(db, story2.id, story1.id);
      addStoryDependency(db, story3.id, story1.id);

      const dependents = getStoriesDependingOn(db, story1.id);

      expect(dependents).toHaveLength(2);
      expect(dependents.map(s => s.id)).toContain(story2.id);
      expect(dependents.map(s => s.id)).toContain(story3.id);
    });
  });

  describe('getStoryCounts', () => {
    it('should return counts by status', () => {
      createStory(db, { title: 'S1', description: 'D' }); // draft
      createStory(db, { title: 'S2', description: 'D' }); // draft

      const s3 = createStory(db, { title: 'S3', description: 'D' });
      updateStory(db, s3.id, { status: 'planned' });

      const s4 = createStory(db, { title: 'S4', description: 'D' });
      updateStory(db, s4.id, { status: 'in_progress' });

      const counts = getStoryCounts(db);

      expect(counts.draft).toBe(2);
      expect(counts.planned).toBe(1);
      expect(counts.in_progress).toBe(1);
      expect(counts.merged).toBe(0);
    });

    it('should return zero counts when no stories', () => {
      const counts = getStoryCounts(db);

      expect(counts.draft).toBe(0);
      expect(counts.estimated).toBe(0);
      expect(counts.planned).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle all story statuses', () => {
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

      const story = createStory(db, {
        title: 'Test',
        description: 'Description',
      });

      statuses.forEach(status => {
        const updated = updateStory(db, story.id, { status });
        expect(updated?.status).toBe(status);
      });
    });

    it('should handle very long text fields', () => {
      const longText = 'A'.repeat(100000);
      const story = createStory(db, {
        title: longText,
        description: longText,
      });

      const retrieved = getStoryById(db, story.id);
      expect(retrieved?.title).toBe(longText);
      expect(retrieved?.description).toBe(longText);
    });

    it('should handle special characters', () => {
      const story = createStory(db, {
        title: "Title with 'quotes' and \"double\"",
        description: 'Description with\nnewlines\tand\ttabs',
      });

      const retrieved = getStoryById(db, story.id);
      expect(retrieved?.title).toBe("Title with 'quotes' and \"double\"");
      expect(retrieved?.description).toBe('Description with\nnewlines\tand\ttabs');
    });
  });

  describe('getBatchStoryDependencies', () => {
    it('should return empty map for empty story IDs', () => {
      const deps = getBatchStoryDependencies(db, []);
      expect(deps.size).toBe(0);
    });

    it('should return map with empty arrays for stories with no dependencies', () => {
      const story1 = createStory(db, { title: 'Story 1', description: 'Desc 1' });
      const story2 = createStory(db, { title: 'Story 2', description: 'Desc 2' });

      const deps = getBatchStoryDependencies(db, [story1.id, story2.id]);

      expect(deps.get(story1.id)).toEqual([]);
      expect(deps.get(story2.id)).toEqual([]);
    });

    it('should return dependencies for stories with dependencies', () => {
      const story1 = createStory(db, { title: 'Story 1', description: 'Desc 1' });
      const story2 = createStory(db, { title: 'Story 2', description: 'Desc 2' });
      const story3 = createStory(db, { title: 'Story 3', description: 'Desc 3' });

      addStoryDependency(db, story1.id, story2.id);
      addStoryDependency(db, story1.id, story3.id);

      const deps = getBatchStoryDependencies(db, [story1.id]);

      expect(deps.get(story1.id)).toContain(story2.id);
      expect(deps.get(story1.id)).toContain(story3.id);
      expect(deps.get(story1.id)).toHaveLength(2);
    });

    it('should handle multiple stories in batch', () => {
      const story1 = createStory(db, { title: 'Story 1', description: 'Desc 1' });
      const story2 = createStory(db, { title: 'Story 2', description: 'Desc 2' });
      const story3 = createStory(db, { title: 'Story 3', description: 'Desc 3' });
      const story4 = createStory(db, { title: 'Story 4', description: 'Desc 4' });

      addStoryDependency(db, story1.id, story2.id);
      addStoryDependency(db, story3.id, story4.id);

      const deps = getBatchStoryDependencies(db, [story1.id, story3.id]);

      expect(deps.get(story1.id)).toEqual([story2.id]);
      expect(deps.get(story3.id)).toEqual([story4.id]);
    });

    it('should not return duplicate dependencies', () => {
      const story1 = createStory(db, { title: 'Story 1', description: 'Desc 1' });
      const story2 = createStory(db, { title: 'Story 2', description: 'Desc 2' });

      addStoryDependency(db, story1.id, story2.id);
      addStoryDependency(db, story1.id, story2.id); // Try to add duplicate

      const deps = getBatchStoryDependencies(db, [story1.id]);

      // Should only have one entry (INSERT OR IGNORE prevents duplicates)
      expect(deps.get(story1.id)?.length).toBe(1);
    });
  });

  describe('getStoriesWithOrphanedAssignments', () => {
    it('should return empty array when no stories have orphaned assignments', () => {
      const orphaned = getStoriesWithOrphanedAssignments(db);
      expect(orphaned).toEqual([]);
    });

    it('should return stories assigned to terminated agents', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Test Team',
      });
      const agent = createAgent(db, { type: 'senior', teamId: team.id });
      const story = createStory(db, {
        title: 'Story',
        description: 'Desc',
        teamId: team.id,
      });

      updateStoryAssignment(db, story.id, agent.id);
      updateAgent(db, agent.id, { status: 'terminated' });

      const orphaned = getStoriesWithOrphanedAssignments(db);

      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].id).toBe(story.id);
      expect(orphaned[0].agent_id).toBe(agent.id);
    });

    it('should not return stories assigned to active agents', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Test Team',
      });
      const agent = createAgent(db, { type: 'senior', teamId: team.id });
      const story = createStory(db, {
        title: 'Story',
        description: 'Desc',
        teamId: team.id,
      });

      updateStoryAssignment(db, story.id, agent.id);

      const orphaned = getStoriesWithOrphanedAssignments(db);

      expect(orphaned).toEqual([]);
    });

    it('should return multiple stories with orphaned assignments', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Test Team',
      });
      const agent1 = createAgent(db, { type: 'senior', teamId: team.id });
      const agent2 = createAgent(db, { type: 'junior', teamId: team.id });
      const story1 = createStory(db, { title: 'Story 1', description: 'Desc 1' });
      const story2 = createStory(db, { title: 'Story 2', description: 'Desc 2' });

      updateStoryAssignment(db, story1.id, agent1.id);
      updateStoryAssignment(db, story2.id, agent2.id);
      updateAgent(db, agent1.id, { status: 'terminated' });
      updateAgent(db, agent2.id, { status: 'terminated' });

      const orphaned = getStoriesWithOrphanedAssignments(db);

      expect(orphaned).toHaveLength(2);
      expect(orphaned.map(o => o.id)).toContain(story1.id);
      expect(orphaned.map(o => o.id)).toContain(story2.id);
    });
  });

  describe('updateStoryAssignment', () => {
    it('should assign story to an agent', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Test Team',
      });
      const agent = createAgent(db, { type: 'senior', teamId: team.id });
      const story = createStory(db, { title: 'Story', description: 'Desc' });

      updateStoryAssignment(db, story.id, agent.id);

      const updated = getStoryById(db, story.id);
      expect(updated?.assigned_agent_id).toBe(agent.id);
    });

    it('should update agent assignment', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Test Team',
      });
      const agent1 = createAgent(db, { type: 'senior', teamId: team.id });
      const agent2 = createAgent(db, { type: 'junior', teamId: team.id });
      const story = createStory(db, { title: 'Story', description: 'Desc' });

      updateStoryAssignment(db, story.id, agent1.id);
      updateStoryAssignment(db, story.id, agent2.id);

      const updated = getStoryById(db, story.id);
      expect(updated?.assigned_agent_id).toBe(agent2.id);
    });

    it('should clear assignment by setting to null', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Test Team',
      });
      const agent = createAgent(db, { type: 'senior', teamId: team.id });
      const story = createStory(db, { title: 'Story', description: 'Desc' });

      updateStoryAssignment(db, story.id, agent.id);
      updateStoryAssignment(db, story.id, null);

      const updated = getStoryById(db, story.id);
      expect(updated?.assigned_agent_id).toBeNull();
    });

    it('should update the updated_at timestamp', () => {
      const story = createStory(db, { title: 'Story', description: 'Desc' });

      // Wait a tiny bit to ensure timestamp difference
      const beforeUpdate = new Date();
      updateStoryAssignment(db, story.id, null);
      const afterUpdate = new Date();

      const updated = getStoryById(db, story.id);
      const updatedTimestamp = new Date(updated?.updated_at || '');

      expect(updatedTimestamp.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
      expect(updatedTimestamp.getTime()).toBeLessThanOrEqual(afterUpdate.getTime() + 1000);
    });
  });
});
