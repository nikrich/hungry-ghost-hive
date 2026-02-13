// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Connector bootstrap module.
 *
 * This file registers all available connector implementations with the
 * global connector registry. Import this module early in the application
 * lifecycle to ensure connectors are available when needed.
 *
 * Adding a new connector:
 * 1. Implement the connector class (e.g., src/connectors/auth/newprovider.ts)
 * 2. Export a register() function that calls registry.registerAuth/SourceControl/ProjectManagement
 * 3. Import and call the register function in this file
 */

// Auth connectors
import { register as registerGitHubAuth } from './auth/github.js';
import { register as registerJiraAuth } from './auth/jira.js';

// Source control connectors
import { register as registerGitHubSourceControl } from './source-control/github.js';

// Project management connectors
import { register as registerJiraProjectManagement } from './project-management/jira.js';

/**
 * Register all available connectors with the global registry.
 * Call this function once at application startup.
 */
export function bootstrapConnectors(): void {
  // Register auth connectors
  registerGitHubAuth();
  registerJiraAuth();

  // Register source control connectors
  registerGitHubSourceControl();

  // Register project management connectors
  registerJiraProjectManagement();
}
