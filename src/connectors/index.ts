// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Connector abstraction layer.
 *
 * This module provides provider-agnostic interfaces for source control,
 * project management, and authentication. Concrete implementations
 * (e.g., GitHub, Jira) self-register with the registry at import time.
 */

// Common types
export type {
  ConnectorAuthResult,
  ConnectorEpic,
  ConnectorIssue,
  ConnectorParsedEpicUrl,
  ConnectorPRInfo,
  ConnectorPRResult,
  ConnectorPRReview,
  ConnectorSyncResult,
  CreateEpicOptions,
  CreatePROptions,
  CreateStoryOptions,
  MergePROptions,
  ProjectManagementProvider,
  SearchIssuesOptions,
  SourceControlProvider,
} from './common-types.js';

// Connector interfaces
export type { IAuthConnector } from './auth/types.js';
export type { IProjectManagementConnector } from './project-management/types.js';
export type { ISourceControlConnector } from './source-control/types.js';

// Registry
export { registry, type ConnectorFactory } from './registry.js';
