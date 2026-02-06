import { nanoid } from 'nanoid';
import type { StoryDao } from '../interfaces/story.dao.js';
import type { StoryRow, CreateStoryInput, UpdateStoryInput, StoryStatus } from '../../queries/stories.js';
import { LevelDbStore, type NowProvider, defaultNow } from './leveldb-store.js';
import { compareIsoAsc, compareIsoDesc } from './sort.js';

const STORY_PREFIX = 'story:';
const STORY_DEP_PREFIX = 'storydep:';

export class LevelDbStoryDao implements StoryDao {
  private readonly now: NowProvider;

  constructor(private readonly store: LevelDbStore, now: NowProvider = defaultNow) {
    this.now = now;
  }

  async createStory(input: CreateStoryInput): Promise<StoryRow> {
    const id = `STORY-${nanoid(6).toUpperCase()}`;
    const now = this.now();
    const acceptanceCriteria = input.acceptanceCriteria
      ? JSON.stringify(input.acceptanceCriteria)
      : null;

    const story: StoryRow = {
      id,
      requirement_id: input.requirementId || null,
      team_id: input.teamId || null,
      title: input.title,
      description: input.description,
      acceptance_criteria: acceptanceCriteria,
      complexity_score: null,
      story_points: null,
      status: 'draft',
      assigned_agent_id: null,
      branch_name: null,
      pr_url: null,
      created_at: now,
      updated_at: now,
    };

    await this.store.put(`${STORY_PREFIX}${id}`, story);
    return story;
  }

  async getStoryById(id: string): Promise<StoryRow | undefined> {
    return this.store.get<StoryRow>(`${STORY_PREFIX}${id}`);
  }

  async getStoriesByRequirement(requirementId: string): Promise<StoryRow[]> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories.filter(story => story.requirement_id === requirementId).sort(compareIsoAsc);
  }

  async getStoriesByTeam(teamId: string): Promise<StoryRow[]> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories.filter(story => story.team_id === teamId).sort(compareIsoAsc);
  }

  async getStoriesByStatus(status: StoryStatus): Promise<StoryRow[]> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories.filter(story => story.status === status).sort(compareIsoAsc);
  }

  async getStoriesByAgent(agentId: string): Promise<StoryRow[]> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories.filter(story => story.assigned_agent_id === agentId).sort(compareIsoAsc);
  }

  async getActiveStoriesByAgent(agentId: string): Promise<StoryRow[]> {
    const activeStatuses = new Set(['planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted']);
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories
      .filter(story => story.assigned_agent_id === agentId && activeStatuses.has(story.status))
      .sort(compareIsoAsc);
  }

  async getAllStories(): Promise<StoryRow[]> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories.sort(compareIsoDesc);
  }

  async getPlannedStories(): Promise<StoryRow[]> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories
      .filter(story => story.status === 'planned')
      .sort((a, b) => {
        const pointsA = a.story_points ?? -Infinity;
        const pointsB = b.story_points ?? -Infinity;
        if (pointsA !== pointsB) return pointsB - pointsA;
        return compareIsoAsc(a, b);
      });
  }

  async getInProgressStories(): Promise<StoryRow[]> {
    const statuses = new Set(['in_progress', 'review', 'qa', 'qa_failed']);
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories
      .filter(story => statuses.has(story.status))
      .sort(compareIsoAsc);
  }

  async getStoryPointsByTeam(teamId: string): Promise<number> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    return stories
      .filter(story => story.team_id === teamId && ['planned', 'in_progress', 'review', 'qa'].includes(story.status))
      .reduce((sum, story) => sum + (story.story_points ?? 0), 0);
  }

  async updateStory(id: string, input: UpdateStoryInput): Promise<StoryRow | undefined> {
    const existing = await this.getStoryById(id);
    if (!existing) return undefined;

    const updates: Partial<StoryRow> = {};
    if (input.teamId !== undefined) updates.team_id = input.teamId;
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.acceptanceCriteria !== undefined) {
      updates.acceptance_criteria = input.acceptanceCriteria ? JSON.stringify(input.acceptanceCriteria) : null;
    }
    if (input.complexityScore !== undefined) updates.complexity_score = input.complexityScore;
    if (input.storyPoints !== undefined) updates.story_points = input.storyPoints;
    if (input.status !== undefined) updates.status = input.status;
    if (input.assignedAgentId !== undefined) updates.assigned_agent_id = input.assignedAgentId;
    if (input.branchName !== undefined) updates.branch_name = input.branchName;
    if (input.prUrl !== undefined) updates.pr_url = input.prUrl;

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const updated: StoryRow = {
      ...existing,
      ...updates,
      updated_at: this.now(),
    };

    await this.store.put(`${STORY_PREFIX}${id}`, updated);
    return updated;
  }

  async deleteStory(id: string): Promise<void> {
    await this.store.del(`${STORY_PREFIX}${id}`);

    const deps = await this.store.listEntries<string>(STORY_DEP_PREFIX);
    await Promise.all(
      deps
        .filter(dep => {
          const [, storyId, dependsOnId] = dep.key.split(':');
          return storyId === id || dependsOnId === id;
        })
        .map(dep => this.store.del(dep.key))
    );
  }

  async addStoryDependency(storyId: string, dependsOnStoryId: string): Promise<void> {
    const key = `${STORY_DEP_PREFIX}${storyId}:${dependsOnStoryId}`;
    const existing = await this.store.get<string>(key);
    if (existing !== undefined) return;
    await this.store.put(key, '1');
  }

  async removeStoryDependency(storyId: string, dependsOnStoryId: string): Promise<void> {
    await this.store.del(`${STORY_DEP_PREFIX}${storyId}:${dependsOnStoryId}`);
  }

  async getStoryDependencies(storyId: string): Promise<StoryRow[]> {
    const deps = await this.store.listEntries<string>(`${STORY_DEP_PREFIX}${storyId}:`);
    const stories: StoryRow[] = [];
    for (const dep of deps) {
      const [, , dependsOnId] = dep.key.split(':');
      const story = await this.getStoryById(dependsOnId);
      if (story) stories.push(story);
    }
    return stories;
  }

  async getStoriesDependingOn(storyId: string): Promise<StoryRow[]> {
    const deps = await this.store.listEntries<string>(STORY_DEP_PREFIX);
    const stories: StoryRow[] = [];

    for (const dep of deps) {
      const [, storyKey, dependsOnId] = dep.key.split(':');
      if (dependsOnId !== storyId) continue;
      const story = await this.getStoryById(storyKey);
      if (story) stories.push(story);
    }

    return stories;
  }

  async getStoryCounts(): Promise<Record<StoryStatus, number>> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    const counts: Record<StoryStatus, number> = {
      draft: 0,
      estimated: 0,
      planned: 0,
      in_progress: 0,
      review: 0,
      qa: 0,
      qa_failed: 0,
      pr_submitted: 0,
      merged: 0,
    };

    for (const story of stories) {
      counts[story.status] += 1;
    }

    return counts;
  }

  async getStoriesWithOrphanedAssignments(): Promise<Array<{ id: string; agent_id: string }>> {
    const stories = await this.store.listValues<StoryRow>(STORY_PREFIX);
    const agents = await this.store.listValues<{ id: string; status: string }>('agent:');
    const activeAgentIds = new Set(agents.filter(agent => agent.status !== 'terminated').map(agent => agent.id));

    return stories
      .filter(story => story.assigned_agent_id && !activeAgentIds.has(story.assigned_agent_id))
      .map(story => ({ id: story.id, agent_id: story.assigned_agent_id! }));
  }

  async updateStoryAssignment(storyId: string, agentId: string | null): Promise<void> {
    const story = await this.getStoryById(storyId);
    if (!story) return;

    const updated: StoryRow = {
      ...story,
      assigned_agent_id: agentId,
      updated_at: this.now(),
    };

    await this.store.put(`${STORY_PREFIX}${storyId}`, updated);
  }
}
