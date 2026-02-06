import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HiveDao } from '../hive-dao.js';
import { createSqliteHiveDao } from '../hive-dao.js';
import { createTestDb } from './helpers.js';

describe('HiveDao integration', () => {
  let db: Database;
  let hive: HiveDao;

  beforeEach(async () => {
    db = await createTestDb();
    hive = createSqliteHiveDao(db);
  });

  afterEach(() => {
    db.close();
  });

  it('hive-dao case 1', async () => {
    expect(hive.teams).toBeDefined();
    expect(hive.agents).toBeDefined();
    expect(hive.stories).toBeDefined();
    expect(hive.requirements).toBeDefined();
    expect(hive.pullRequests).toBeDefined();
    expect(hive.escalations).toBeDefined();
    expect(hive.logs).toBeDefined();
    expect(hive.messages).toBeDefined();
  });

  it('hive-dao case 2', async () => {
    const team = await hive.teams.createTeam({
      repoUrl: 'https://github.com/test/repo',
      repoPath: '/tmp/repo',
      name: 'Integration Team',
    });

    const agent = await hive.agents.createAgent({
      type: 'senior',
      teamId: team.id,
      model: 'claude-sonnet-4-5-20250929',
    });

    const foundAgent = await hive.agents.getAgentById(agent.id);
    expect(foundAgent).toBeDefined();
    expect(foundAgent!.team_id).toBe(team.id);
    expect(foundAgent!.model).toBe('claude-sonnet-4-5-20250929');

    const teamAgents = await hive.agents.getAgentsByTeam(team.id);
    expect(teamAgents).toHaveLength(1);
    expect(teamAgents[0].id).toBe(agent.id);
  });

  it('hive-dao case 3', async () => {
    const team = await hive.teams.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const agent = await hive.agents.createAgent({ type: 'senior', teamId: team.id });
    const req = await hive.requirements.createRequirement({
      title: 'Add feature',
      description: 'Full description',
    });

    const story = await hive.stories.createStory({
      title: 'Implement feature',
      description: 'Story desc',
      requirementId: req.id,
      teamId: team.id,
    });

    await hive.stories.updateStory(story.id, {
      status: 'in_progress',
      assignedAgentId: agent.id,
    });

    const log = await hive.logs.createLog({
      agentId: agent.id,
      storyId: story.id,
      eventType: 'STORY_STARTED',
      message: 'Started working on story',
    });

    expect(log.agent_id).toBe(agent.id);
    expect(log.story_id).toBe(story.id);

    const agentStories = await hive.stories.getStoriesByAgent(agent.id);
    expect(agentStories).toHaveLength(1);

    const reqStories = await hive.stories.getStoriesByRequirement(req.id);
    expect(reqStories).toHaveLength(1);
  });

  it('hive-dao case 4', async () => {
    const team = await hive.teams.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const story = await hive.stories.createStory({
      title: 'Feature',
      description: 'Desc',
      teamId: team.id,
    });

    const pr = await hive.pullRequests.createPullRequest({
      branchName: 'feature/branch',
      storyId: story.id,
      teamId: team.id,
    });

    const queue = await hive.pullRequests.getMergeQueue(team.id);
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(pr.id);

    const pos = await hive.pullRequests.getQueuePosition(pr.id);
    expect(pos).toBe(1);
  });

  it('hive-dao case 5', async () => {
    const team = await hive.teams.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const agent = await hive.agents.createAgent({ type: 'senior', teamId: team.id });
    const story = await hive.stories.createStory({ title: 'S', description: 'D', teamId: team.id });

    const esc = await hive.escalations.createEscalation({
      storyId: story.id,
      fromAgentId: agent.id,
      reason: 'Need help',
    });

    const pending = await hive.escalations.getPendingHumanEscalations();
    expect(pending).toHaveLength(1);

    await hive.escalations.resolveEscalation(esc.id, 'Resolved by human');

    const resolved = await hive.escalations.getEscalationById(esc.id);
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolved_at).not.toBeNull();

    const pendingAfter = await hive.escalations.getPendingHumanEscalations();
    expect(pendingAfter).toHaveLength(0);
  });
});
