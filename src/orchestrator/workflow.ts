import type { Database } from 'sql.js';
import { queryAll, queryOne } from '../db/client.js';
import type { StoryStatus } from '../db/queries/stories.js';

// Valid story status transitions
const STORY_TRANSITIONS: Record<StoryStatus, StoryStatus[]> = {
  draft: ['estimated'],
  estimated: ['planned'],
  planned: ['in_progress'],
  in_progress: ['review', 'qa_failed'],
  review: ['in_progress', 'qa'],
  qa: ['qa_failed', 'pr_submitted'],
  qa_failed: ['in_progress'],
  pr_submitted: ['merged'],
  merged: [],
};

export function canTransitionStory(from: StoryStatus, to: StoryStatus): boolean {
  return STORY_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getNextStatuses(status: StoryStatus): StoryStatus[] {
  return STORY_TRANSITIONS[status] || [];
}

export type RequirementStatus = 'pending' | 'planning' | 'planned' | 'in_progress' | 'completed';

const REQUIREMENT_TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  pending: ['planning'],
  planning: ['planned'],
  planned: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
};

export function canTransitionRequirement(from: RequirementStatus, to: RequirementStatus): boolean {
  return REQUIREMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// Workflow phase tracking
export type WorkflowPhase =
  | 'idle'
  | 'requirement_intake'
  | 'planning'
  | 'estimation'
  | 'development'
  | 'review'
  | 'qa'
  | 'pr_submission'
  | 'completed';

export interface WorkflowState {
  phase: WorkflowPhase;
  requirementId?: string;
  activeStories: number;
  completedStories: number;
  blockedStories: number;
}

export function getWorkflowState(db: Database, requirementId?: string): WorkflowState {
  let whereClause = '';
  const params: string[] = [];

  if (requirementId) {
    whereClause = 'WHERE requirement_id = ?';
    params.push(requirementId);
  }

  const stories = queryAll<{ status: StoryStatus; count: number }>(
    db,
    `
    SELECT status, COUNT(*) as count
    FROM stories
    ${whereClause}
    GROUP BY status
  `,
    params
  );

  const counts: Record<string, number> = {};
  for (const row of stories) {
    counts[row.status] = row.count;
  }

  const activeStories = (counts.in_progress || 0) + (counts.review || 0) + (counts.qa || 0);

  const completedStories = (counts.pr_submitted || 0) + (counts.merged || 0);

  const blockedStories = counts.qa_failed || 0;

  // Determine current phase
  let phase: WorkflowPhase = 'idle';

  if (counts.merged && completedStories === Object.values(counts).reduce((a, b) => a + b, 0)) {
    phase = 'completed';
  } else if (counts.pr_submitted) {
    phase = 'pr_submission';
  } else if (counts.qa) {
    phase = 'qa';
  } else if (counts.review) {
    phase = 'review';
  } else if (counts.in_progress) {
    phase = 'development';
  } else if (counts.planned) {
    phase = 'development'; // Ready to start development
  } else if (counts.estimated) {
    phase = 'estimation';
  } else if (counts.draft) {
    phase = 'planning';
  } else if (requirementId) {
    // Check requirement status
    const req = queryOne<{ status: string }>(db, 'SELECT status FROM requirements WHERE id = ?', [
      requirementId,
    ]);
    if (req) {
      if (req.status === 'planning') phase = 'planning';
      else if (req.status === 'pending') phase = 'requirement_intake';
    }
  }

  return {
    phase,
    requirementId,
    activeStories,
    completedStories,
    blockedStories,
  };
}

export function isWorkflowBlocked(state: WorkflowState): boolean {
  return state.blockedStories > 0;
}

export function getWorkflowProgress(state: WorkflowState): number {
  const total = state.activeStories + state.completedStories + state.blockedStories;
  if (total === 0) return 0;
  return Math.round((state.completedStories / total) * 100);
}
