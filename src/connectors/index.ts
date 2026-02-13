// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Generic connector interfaces and types for project management and SCM integrations.
 *
 * @module connectors
 */

export type { ProjectManagementConnector, SCMConnector } from './interfaces.js';

export type {
  CreateEpicInput,
  CreateIssueResult,
  CreatePRInput,
  CreatePRResult,
  CreateStoryInput,
  CreateSubtaskInput,
  DependencyLinkType,
  ExternalComment,
  ExternalEpic,
  ExternalIssue,
  ExternalIssueType,
  ExternalPRReview,
  ExternalPriority,
  ExternalPullRequest,
  ExternalSprint,
  ExternalStatus,
  ExternalTransition,
  ExternalUser,
  LifecycleCommentContext,
  LifecycleEvent,
  MergePROptions,
} from './types.js';
