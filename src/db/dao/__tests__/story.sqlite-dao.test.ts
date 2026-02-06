import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAgentDao } from '../sqlite/agent.sqlite-dao.js';
import { SqliteRequirementDao } from '../sqlite/requirement.sqlite-dao.js';
import { SqliteStoryDao } from '../sqlite/story.sqlite-dao.js';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';
import { createTestDb } from './helpers.js';

describe('SqliteStoryDao', () => {
  let db: Database;
  let dao: SqliteStoryDao;
  let teamDao: SqliteTeamDao;
  let agentDao: SqliteAgentDao;
  let reqDao: SqliteRequirementDao;
  let teamId: string;

  beforeEach(async () => {
    db = await createTestDb();
    dao = new SqliteStoryDao(db);
    teamDao = new SqliteTeamDao(db);
    agentDao = new SqliteAgentDao(db);
    reqDao = new SqliteRequirementDao(db);
    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    teamId = team.id;
  });

  afterEach(() => {
    db.close();
  });

  it('story.sqlite-dao case 1', async () => {
    const story = await dao.createStory({
      title: 'Add login',
      description: 'Implement login page',
      teamId,
    });

    expect(story.id).toMatch(/^STORY-/);
    expect(story.title).toBe('Add login');
    expect(story.team_id).toBe(teamId);
    expect(story.status).toBe('draft');
  });

  it('story.sqlite-dao case 2', async () => {
    const req = await reqDao.createRequirement({ title: 'Req', description: 'Desc' });
    const story = await dao.createStory({
      title: 'Story',
      description: 'Desc',
      requirementId: req.id,
    });
    expect(story.requirement_id).toBe(req.id);
  });

  it('story.sqlite-dao case 3', async () => {
    const story = await dao.createStory({
      title: 'Story',
      description: 'Desc',
      acceptanceCriteria: ['AC1', 'AC2'],
    });
    expect(story.acceptance_criteria).toBe(JSON.stringify(['AC1', 'AC2']));
  });

  it('story.sqlite-dao case 4', async () => {
    const created = await dao.createStory({ title: 'Test', description: 'Desc' });
    const found = await dao.getStoryById(created.id);
    expect(found).toEqual(created);
  });

  it('story.sqlite-dao case 5', async () => {
    expect(await dao.getStoryById('STORY-NOPE')).toBeUndefined();
  });

  it('story.sqlite-dao case 6', async () => {
    const req = await reqDao.createRequirement({ title: 'Req', description: 'Desc' });
    await dao.createStory({ title: 'S1', description: 'D1', requirementId: req.id });
    await dao.createStory({ title: 'S2', description: 'D2', requirementId: req.id });
    await dao.createStory({ title: 'S3', description: 'D3' });

    const stories = await dao.getStoriesByRequirement(req.id);
    expect(stories).toHaveLength(2);
  });

  it('story.sqlite-dao case 7', async () => {
    await dao.createStory({ title: 'S1', description: 'D1', teamId });
    await dao.createStory({ title: 'S2', description: 'D2', teamId });

    const stories = await dao.getStoriesByTeam(teamId);
    expect(stories).toHaveLength(2);
  });

  it('story.sqlite-dao case 8', async () => {
    const s1 = await dao.createStory({ title: 'S1', description: 'D1' });
    await dao.updateStory(s1.id, { status: 'in_progress' });

    const inProgress = await dao.getStoriesByStatus('in_progress');
    expect(inProgress).toHaveLength(1);
  });

  it('story.sqlite-dao case 9', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const s1 = await dao.createStory({ title: 'S1', description: 'D1', teamId });
    await dao.updateStory(s1.id, { assignedAgentId: agent.id });

    const stories = await dao.getStoriesByAgent(agent.id);
    expect(stories).toHaveLength(1);
  });

  it('story.sqlite-dao case 10', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const s1 = await dao.createStory({ title: 'S1', description: 'D1', teamId });
    const s2 = await dao.createStory({ title: 'S2', description: 'D2', teamId });
    const s3 = await dao.createStory({ title: 'S3', description: 'D3', teamId });

    await dao.updateStory(s1.id, { assignedAgentId: agent.id, status: 'in_progress' });
    await dao.updateStory(s2.id, { assignedAgentId: agent.id, status: 'merged' });
    await dao.updateStory(s3.id, { assignedAgentId: agent.id, status: 'planned' });

    const active = await dao.getActiveStoriesByAgent(agent.id);
    expect(active).toHaveLength(2); // in_progress + planned
  });

  it('story.sqlite-dao case 11', async () => {
    const s1 = await dao.createStory({ title: 'First', description: 'D1' });
    // Ensure distinct timestamps so ordering is deterministic
    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', s1.id]);
    const s2 = await dao.createStory({ title: 'Second', description: 'D2' });
    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', s2.id]);

    const all = await dao.getAllStories();
    expect(all).toHaveLength(2);
    expect(all[0].title).toBe('Second');
    expect(all[1].title).toBe('First');
  });

  it('story.sqlite-dao case 12', async () => {
    const s1 = await dao.createStory({ title: 'Small', description: 'D1' });
    const s2 = await dao.createStory({ title: 'Large', description: 'D2' });

    await dao.updateStory(s1.id, { status: 'planned', storyPoints: 3 });
    await dao.updateStory(s2.id, { status: 'planned', storyPoints: 8 });

    const planned = await dao.getPlannedStories();
    expect(planned).toHaveLength(2);
    expect(planned[0].title).toBe('Large');
  });

  it('story.sqlite-dao case 13', async () => {
    const s1 = await dao.createStory({ title: 'S1', description: 'D1' });
    const s2 = await dao.createStory({ title: 'S2', description: 'D2' });
    await dao.createStory({ title: 'S3', description: 'D3' });

    await dao.updateStory(s1.id, { status: 'in_progress' });
    await dao.updateStory(s2.id, { status: 'review' });

    const inProg = await dao.getInProgressStories();
    expect(inProg).toHaveLength(2);
  });

  it('story.sqlite-dao case 14', async () => {
    const s1 = await dao.createStory({ title: 'S1', description: 'D1', teamId });
    const s2 = await dao.createStory({ title: 'S2', description: 'D2', teamId });
    const s3 = await dao.createStory({ title: 'S3', description: 'D3', teamId });

    await dao.updateStory(s1.id, { status: 'planned', storyPoints: 5 });
    await dao.updateStory(s2.id, { status: 'in_progress', storyPoints: 3 });
    await dao.updateStory(s3.id, { status: 'merged', storyPoints: 8 }); // not counted

    const points = await dao.getStoryPointsByTeam(teamId);
    expect(points).toBe(8); // 5 + 3
  });

  it('story.sqlite-dao case 15', async () => {
    const points = await dao.getStoryPointsByTeam(teamId);
    expect(points).toBe(0);
  });

  it('story.sqlite-dao case 16', async () => {
    const story = await dao.createStory({ title: 'Original', description: 'Desc' });
    const updated = await dao.updateStory(story.id, {
      title: 'Updated',
      status: 'estimated',
      complexityScore: 5,
      storyPoints: 3,
    });

    expect(updated!.title).toBe('Updated');
    expect(updated!.status).toBe('estimated');
    expect(updated!.complexity_score).toBe(5);
    expect(updated!.story_points).toBe(3);
  });

  it('story.sqlite-dao case 17', async () => {
    const s1 = await dao.createStory({ title: 'S1', description: 'D1' });
    const s2 = await dao.createStory({ title: 'S2', description: 'D2' });

    await dao.addStoryDependency(s2.id, s1.id);
    await dao.deleteStory(s1.id);

    expect(await dao.getStoryById(s1.id)).toBeUndefined();
    const deps = await dao.getStoryDependencies(s2.id);
    expect(deps).toHaveLength(0);
  });

  it('story.sqlite-dao case 18', async () => {
    const s1 = await dao.createStory({ title: 'S1', description: 'D1' });
    const s2 = await dao.createStory({ title: 'S2', description: 'D2' });
    const s3 = await dao.createStory({ title: 'S3', description: 'D3' });

    await dao.addStoryDependency(s3.id, s1.id);
    await dao.addStoryDependency(s3.id, s2.id);

    const deps = await dao.getStoryDependencies(s3.id);
    expect(deps).toHaveLength(2);
  });

  it('story.sqlite-dao case 19', async () => {
    const s1 = await dao.createStory({ title: 'S1', description: 'D1' });
    const s2 = await dao.createStory({ title: 'S2', description: 'D2' });

    await dao.addStoryDependency(s2.id, s1.id);

    const dependents = await dao.getStoriesDependingOn(s1.id);
    expect(dependents).toHaveLength(1);
    expect(dependents[0].id).toBe(s2.id);
  });

  it('story.sqlite-dao case 20', async () => {
    const s1 = await dao.createStory({ title: 'S1', description: 'D1' });
    const s2 = await dao.createStory({ title: 'S2', description: 'D2' });

    await dao.addStoryDependency(s2.id, s1.id);
    await dao.removeStoryDependency(s2.id, s1.id);

    const deps = await dao.getStoryDependencies(s2.id);
    expect(deps).toHaveLength(0);
  });

  it('story.sqlite-dao case 21', async () => {
    const counts = await dao.getStoryCounts();
    expect(counts).toEqual({
      draft: 0,
      estimated: 0,
      planned: 0,
      in_progress: 0,
      review: 0,
      qa: 0,
      qa_failed: 0,
      pr_submitted: 0,
      merged: 0,
    });
  });

  it('story.sqlite-dao case 22', async () => {
    const s1 = await dao.createStory({ title: 'S1', description: 'D1' });
    await dao.createStory({ title: 'S2', description: 'D2' });
    await dao.updateStory(s1.id, { status: 'in_progress' });

    const counts = await dao.getStoryCounts();
    expect(counts.draft).toBe(1);
    expect(counts.in_progress).toBe(1);
  });

  it('story.sqlite-dao case 23', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const story = await dao.createStory({ title: 'S1', description: 'D1', teamId });
    await dao.updateStory(story.id, { assignedAgentId: agent.id });

    // Terminate the agent
    await agentDao.terminateAgent(agent.id);

    const orphaned = await dao.getStoriesWithOrphanedAssignments();
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].id).toBe(story.id);
    expect(orphaned[0].agent_id).toBe(agent.id);
  });

  it('story.sqlite-dao case 24', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const story = await dao.createStory({ title: 'S1', description: 'D1', teamId });

    await dao.updateStoryAssignment(story.id, agent.id);
    const updated = await dao.getStoryById(story.id);
    expect(updated!.assigned_agent_id).toBe(agent.id);

    await dao.updateStoryAssignment(story.id, null);
    const cleared = await dao.getStoryById(story.id);
    expect(cleared!.assigned_agent_id).toBeNull();
  });
});
