// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Generic types for project management and source code management connectors.
 * These types abstract away provider-specific details (Jira, GitHub, etc.)
 * and provide a unified boundary layer for the Hive orchestrator.
 */

// ── Issue Status ────────────────────────────────────────────────────────────

/** Generic issue status */
export interface ExternalStatus {
  /** Provider-specific status ID */
  id: string;
  /** Human-readable status name (e.g., "In Progress", "Done") */
  name: string;
  /** Status category for grouping: todo, in_progress, or done */
  category: 'todo' | 'in_progress' | 'done';
}

// ── Issue Priority ──────────────────────────────────────────────────────────

/** Generic issue priority */
export interface ExternalPriority {
  /** Provider-specific priority ID */
  id: string;
  /** Human-readable priority name (e.g., "High", "Medium") */
  name: string;
}

// ── User ────────────────────────────────────────────────────────────────────

/** Generic user/assignee from an external provider */
export interface ExternalUser {
  /** Provider-specific user ID */
  id: string;
  /** Display name */
  displayName: string;
  /** Email address (if available) */
  email?: string;
}

// ── Issue Type ──────────────────────────────────────────────────────────────

/** Generic issue type */
export interface ExternalIssueType {
  /** Provider-specific type ID */
  id: string;
  /** Type name (e.g., "Story", "Bug", "Epic", "Subtask") */
  name: string;
  /** Whether this is a subtask type */
  subtask: boolean;
}

// ── Issue ───────────────────────────────────────────────────────────────────

/** Generic issue from a project management tool */
export interface ExternalIssue {
  /** Provider-specific issue ID */
  id: string;
  /** Human-readable issue key (e.g., "PROJ-123") */
  key: string;
  /** Issue summary/title */
  summary: string;
  /** Plain-text description */
  description: string;
  /** Current status */
  status: ExternalStatus;
  /** Issue type */
  issueType: ExternalIssueType;
  /** Priority (if set) */
  priority?: ExternalPriority;
  /** Assigned user */
  assignee?: ExternalUser;
  /** Reporter/creator */
  reporter?: ExternalUser;
  /** Labels/tags */
  labels: string[];
  /** Story points (if set) */
  storyPoints?: number;
  /** Parent issue key (for subtasks or stories under epics) */
  parentKey?: string;
  /** Project identifier */
  project: {
    id: string;
    key: string;
    name: string;
  };
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-updated timestamp */
  updatedAt: string;
  /** Direct URL to this issue in the provider UI */
  url?: string;
  /** Provider-specific raw data for escape-hatch access */
  raw?: unknown;
}

// ── Epic ────────────────────────────────────────────────────────────────────

/** Generic epic from a project management tool */
export interface ExternalEpic {
  /** Provider-specific epic ID */
  id: string;
  /** Human-readable epic key (e.g., "PROJ-2") */
  key: string;
  /** Epic title */
  title: string;
  /** Plain-text description */
  description: string;
  /** Current status */
  status: ExternalStatus;
  /** Labels/tags */
  labels: string[];
  /** Project identifier */
  project: {
    id: string;
    key: string;
    name: string;
  };
  /** Direct URL to this epic in the provider UI */
  url?: string;
  /** Provider-specific raw data for escape-hatch access */
  raw?: unknown;
}

// ── Sprint ──────────────────────────────────────────────────────────────────

/** Generic sprint/iteration */
export interface ExternalSprint {
  /** Provider-specific sprint ID */
  id: string;
  /** Sprint name */
  name: string;
  /** Sprint state */
  state: 'active' | 'closed' | 'future';
  /** ISO 8601 start date */
  startDate?: string;
  /** ISO 8601 end date */
  endDate?: string;
}

// ── Status Transition ───────────────────────────────────────────────────────

/** Available status transition for an issue */
export interface ExternalTransition {
  /** Provider-specific transition ID */
  id: string;
  /** Transition name (e.g., "Start Progress") */
  name: string;
  /** The target status after this transition */
  to: ExternalStatus;
}

// ── Comment ─────────────────────────────────────────────────────────────────

/** A comment on an external issue */
export interface ExternalComment {
  /** Provider-specific comment ID */
  id: string;
  /** Comment author */
  author: ExternalUser;
  /** Plain-text comment body */
  body: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
}

// ── Pull Request ────────────────────────────────────────────────────────────

/** Generic pull/merge request from an SCM provider */
export interface ExternalPullRequest {
  /** Provider-specific PR ID or number */
  id: string;
  /** PR number (e.g., 42) */
  number: number;
  /** Direct URL to the PR */
  url: string;
  /** PR title */
  title: string;
  /** PR body/description */
  body?: string;
  /** Current state */
  state: 'open' | 'closed' | 'merged';
  /** Source branch */
  headBranch: string;
  /** Target branch */
  baseBranch: string;
  /** Lines added */
  additions: number;
  /** Lines deleted */
  deletions: number;
  /** Number of changed files */
  changedFiles: number;
  /** PR author */
  author?: ExternalUser;
  /** Assigned reviewers */
  reviewers?: ExternalUser[];
  /** Labels */
  labels?: string[];
  /** Whether this is a draft PR */
  draft?: boolean;
  /** ISO 8601 creation timestamp */
  createdAt?: string;
  /** ISO 8601 last-updated timestamp */
  updatedAt?: string;
}

// ── PR Review ───────────────────────────────────────────────────────────────

/** A review on a pull request */
export interface ExternalPRReview {
  /** Reviewer identity */
  author: string;
  /** Review state */
  state: 'approved' | 'changes_requested' | 'commented' | 'pending';
  /** Review body */
  body: string;
}

// ── Lifecycle Events ────────────────────────────────────────────────────────

/**
 * Lifecycle events that connectors can post as comments/updates.
 * Provider-agnostic equivalent of JiraLifecycleEvent.
 */
export type LifecycleEvent =
  | 'assigned'
  | 'work_started'
  | 'progress'
  | 'approach_posted'
  | 'pr_created'
  | 'qa_started'
  | 'qa_passed'
  | 'qa_failed'
  | 'merged'
  | 'blocked';

/** Context for posting lifecycle event comments */
export interface LifecycleCommentContext {
  agentName?: string;
  branchName?: string;
  prUrl?: string;
  reason?: string;
  subtaskKey?: string;
  approachText?: string;
}

// ── Input Types for Connector Methods ───────────────────────────────────────

/** Input for creating an epic */
export interface CreateEpicInput {
  /** Epic title/summary */
  title: string;
  /** Description in plain text */
  description: string;
  /** Labels to apply */
  labels?: string[];
}

/** Input for creating a story/issue */
export interface CreateStoryInput {
  /** Story title/summary */
  title: string;
  /** Description in plain text */
  description: string;
  /** Parent epic key (if linking to an epic) */
  epicKey?: string;
  /** Story points */
  storyPoints?: number;
  /** Priority name */
  priority?: string;
  /** Labels to apply */
  labels?: string[];
  /** Acceptance criteria (plain text items) */
  acceptanceCriteria?: string[];
}

/** Input for creating a subtask */
export interface CreateSubtaskInput {
  /** Parent issue key */
  parentIssueKey: string;
  /** Agent name performing the implementation */
  agentName: string;
  /** Parent story title */
  storyTitle: string;
  /** Implementation approach steps */
  approachSteps?: string[];
}

/** Input for creating a pull request */
export interface CreatePRInput {
  /** PR title */
  title: string;
  /** PR body/description */
  body: string;
  /** Target/base branch */
  baseBranch: string;
  /** Source/head branch */
  headBranch: string;
  /** Whether to create as draft */
  draft?: boolean;
  /** Labels to apply */
  labels?: string[];
  /** Users to assign to the PR */
  assignees?: string[];
}

/** Options for merging a pull request */
export interface MergePROptions {
  /** Merge strategy */
  method?: 'merge' | 'squash' | 'rebase';
  /** Whether to delete the branch after merge */
  deleteBranch?: boolean;
}

/** Result of creating an issue/epic/subtask */
export interface CreateIssueResult {
  /** Provider-specific ID */
  id: string;
  /** Human-readable key (e.g., "PROJ-123") */
  key: string;
  /** Direct URL to the created issue */
  url?: string;
}

/** Result of creating a pull request */
export interface CreatePRResult {
  /** PR number */
  number: number;
  /** Direct URL to the PR */
  url: string;
}

/** Link type for issue dependencies */
export type DependencyLinkType = 'blocks' | 'is_blocked_by' | 'relates_to';
