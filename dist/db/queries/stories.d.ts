import type { Database } from 'sql.js';
import { type StoryRow } from '../client.js';
export type { StoryRow };
export type StoryStatus = 'draft' | 'estimated' | 'planned' | 'in_progress' | 'review' | 'qa' | 'qa_failed' | 'pr_submitted' | 'merged';
export interface CreateStoryInput {
    requirementId?: string | null;
    teamId?: string | null;
    title: string;
    description: string;
    acceptanceCriteria?: string[] | null;
}
export interface UpdateStoryInput {
    teamId?: string | null;
    title?: string;
    description?: string;
    acceptanceCriteria?: string[] | null;
    complexityScore?: number | null;
    storyPoints?: number | null;
    status?: StoryStatus;
    assignedAgentId?: string | null;
    branchName?: string | null;
    prUrl?: string | null;
}
export declare function createStory(db: Database, input: CreateStoryInput): StoryRow;
export declare function getStoryById(db: Database, id: string): StoryRow | undefined;
export declare function getStoriesByRequirement(db: Database, requirementId: string): StoryRow[];
export declare function getStoriesByTeam(db: Database, teamId: string): StoryRow[];
export declare function getStoriesByStatus(db: Database, status: StoryStatus): StoryRow[];
export declare function getStoriesByAgent(db: Database, agentId: string): StoryRow[];
export declare function getActiveStoriesByAgent(db: Database, agentId: string): StoryRow[];
export declare function getAllStories(db: Database): StoryRow[];
export declare function getPlannedStories(db: Database): StoryRow[];
export declare function getInProgressStories(db: Database): StoryRow[];
export declare function getStoryPointsByTeam(db: Database, teamId: string): number;
export declare function updateStory(db: Database, id: string, input: UpdateStoryInput): StoryRow | undefined;
export declare function deleteStory(db: Database, id: string): void;
export declare function addStoryDependency(db: Database, storyId: string, dependsOnStoryId: string): void;
export declare function removeStoryDependency(db: Database, storyId: string, dependsOnStoryId: string): void;
export declare function getStoryDependencies(db: Database, storyId: string): StoryRow[];
export declare function getStoriesDependingOn(db: Database, storyId: string): StoryRow[];
/**
 * Get dependencies for multiple stories in a single query.
 * Returns a map of story ID to its dependencies for improved query performance.
 * Avoids N+1 queries when building dependency graphs.
 * @param storyIds Array of story IDs to get dependencies for
 * @returns Map of story ID to array of dependent story IDs
 */
export declare function getBatchStoryDependencies(db: Database, storyIds: string[]): Map<string, string[]>;
export declare function getStoryCounts(db: Database): Record<StoryStatus, number>;
export declare function getStoriesWithOrphanedAssignments(db: Database): Array<{
    id: string;
    agent_id: string;
}>;
export declare function updateStoryAssignment(db: Database, storyId: string, agentId: string | null): void;
//# sourceMappingURL=stories.d.ts.map