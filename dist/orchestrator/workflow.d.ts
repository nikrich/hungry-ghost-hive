import type Database from 'better-sqlite3';
import type { StoryStatus } from '../db/queries/stories.js';
export declare function canTransitionStory(from: StoryStatus, to: StoryStatus): boolean;
export declare function getNextStatuses(status: StoryStatus): StoryStatus[];
export type RequirementStatus = 'pending' | 'planning' | 'planned' | 'in_progress' | 'completed';
export declare function canTransitionRequirement(from: RequirementStatus, to: RequirementStatus): boolean;
export type WorkflowPhase = 'idle' | 'requirement_intake' | 'planning' | 'estimation' | 'development' | 'review' | 'qa' | 'pr_submission' | 'completed';
export interface WorkflowState {
    phase: WorkflowPhase;
    requirementId?: string;
    activeStories: number;
    completedStories: number;
    blockedStories: number;
}
export declare function getWorkflowState(db: Database.Database, requirementId?: string): WorkflowState;
export declare function isWorkflowBlocked(state: WorkflowState): boolean;
export declare function getWorkflowProgress(state: WorkflowState): number;
//# sourceMappingURL=workflow.d.ts.map