import type {
  CreateStoryInput,
  StoryRow,
  StoryStatus,
  UpdateStoryInput,
} from '../../queries/stories.js';

export type { CreateStoryInput, StoryRow, StoryStatus, UpdateStoryInput };

export interface StoryDao {
  createStory(input: CreateStoryInput): Promise<StoryRow>;
  getStoryById(id: string): Promise<StoryRow | undefined>;
  getStoriesByRequirement(requirementId: string): Promise<StoryRow[]>;
  getStoriesByTeam(teamId: string): Promise<StoryRow[]>;
  getStoriesByStatus(status: StoryStatus): Promise<StoryRow[]>;
  getStoriesByAgent(agentId: string): Promise<StoryRow[]>;
  getActiveStoriesByAgent(agentId: string): Promise<StoryRow[]>;
  getAllStories(): Promise<StoryRow[]>;
  getPlannedStories(): Promise<StoryRow[]>;
  getInProgressStories(): Promise<StoryRow[]>;
  getStoryPointsByTeam(teamId: string): Promise<number>;
  updateStory(id: string, input: UpdateStoryInput): Promise<StoryRow | undefined>;
  deleteStory(id: string): Promise<void>;
  addStoryDependency(storyId: string, dependsOnStoryId: string): Promise<void>;
  removeStoryDependency(storyId: string, dependsOnStoryId: string): Promise<void>;
  getStoryDependencies(storyId: string): Promise<StoryRow[]>;
  getStoriesDependingOn(storyId: string): Promise<StoryRow[]>;
  getStoryCounts(): Promise<Record<StoryStatus, number>>;
  getStoriesWithOrphanedAssignments(): Promise<Array<{ id: string; agent_id: string }>>;
  updateStoryAssignment(storyId: string, agentId: string | null): Promise<void>;
}
