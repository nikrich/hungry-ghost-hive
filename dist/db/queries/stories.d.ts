import type Database from 'better-sqlite3';
export type { StoryRow } from '../client.js';
import type { StoryRow } from '../client.js';
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
export declare function createStory(db: Database.Database, input: CreateStoryInput): StoryRow;
export declare function getStoryById(db: Database.Database, id: string): StoryRow | undefined;
export declare function getStoriesByRequirement(db: Database.Database, requirementId: string): StoryRow[];
export declare function getStoriesByTeam(db: Database.Database, teamId: string): StoryRow[];
export declare function getStoriesByStatus(db: Database.Database, status: StoryStatus): StoryRow[];
export declare function getStoriesByAgent(db: Database.Database, agentId: string): StoryRow[];
export declare function getAllStories(db: Database.Database): StoryRow[];
export declare function getPlannedStories(db: Database.Database): StoryRow[];
export declare function getInProgressStories(db: Database.Database): StoryRow[];
export declare function getStoryPointsByTeam(db: Database.Database, teamId: string): number;
export declare function updateStory(db: Database.Database, id: string, input: UpdateStoryInput): StoryRow | undefined;
export declare function deleteStory(db: Database.Database, id: string): void;
export declare function addStoryDependency(db: Database.Database, storyId: string, dependsOnStoryId: string): void;
export declare function removeStoryDependency(db: Database.Database, storyId: string, dependsOnStoryId: string): void;
export declare function getStoryDependencies(db: Database.Database, storyId: string): StoryRow[];
export declare function getStoriesDependingOn(db: Database.Database, storyId: string): StoryRow[];
export declare function getStoryCounts(db: Database.Database): Record<StoryStatus, number>;
//# sourceMappingURL=stories.d.ts.map