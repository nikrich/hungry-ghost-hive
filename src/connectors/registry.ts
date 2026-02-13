// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * ConnectorRegistry — singleton that manages source control and project
 * management connector instances.
 *
 * Connectors register themselves by name; consumer code retrieves the
 * active connector without knowing which provider is in use.
 */

import type { HiveConfig } from '../config/schema.js';
import type {
  ConnectorConfig,
  ProjectManagementConnector,
  SourceControlConnector,
} from './types.js';

/** Factory function that creates a connector from its config section. */
export type SourceControlFactory = (config: ConnectorConfig) => SourceControlConnector;
export type ProjectManagementFactory = (config: ConnectorConfig) => ProjectManagementConnector;

export class ConnectorRegistry {
  // ── Singleton ───────────────────────────────────────────────────────────

  private static instance: ConnectorRegistry | null = null;

  static getInstance(): ConnectorRegistry {
    if (!ConnectorRegistry.instance) {
      ConnectorRegistry.instance = new ConnectorRegistry();
    }
    return ConnectorRegistry.instance;
  }

  /** Reset the singleton (useful for testing). */
  static resetInstance(): void {
    ConnectorRegistry.instance = null;
  }

  // ── Internal state ──────────────────────────────────────────────────────

  private sourceControlFactories = new Map<string, SourceControlFactory>();
  private projectManagementFactories = new Map<string, ProjectManagementFactory>();

  private activeSourceControl: SourceControlConnector | null = null;
  private activeProjectManagement: ProjectManagementConnector | null = null;

  // ── Registration ────────────────────────────────────────────────────────

  /** Register a source control connector factory by name. */
  registerSourceControl(name: string, factory: SourceControlFactory): void {
    this.sourceControlFactories.set(name, factory);
  }

  /** Register a project management connector factory by name. */
  registerProjectManagement(name: string, factory: ProjectManagementFactory): void {
    this.projectManagementFactories.set(name, factory);
  }

  // ── Retrieval ───────────────────────────────────────────────────────────

  /** Get the active source control connector. Throws if none initialized. */
  getSourceControl(): SourceControlConnector {
    if (!this.activeSourceControl) {
      throw new Error(
        'No source control connector initialized. Call initializeFromConfig() first.'
      );
    }
    return this.activeSourceControl;
  }

  /** Get the active project management connector, or null if none configured. */
  getProjectManagement(): ProjectManagementConnector | null {
    return this.activeProjectManagement;
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  /** List registered source control connector names. */
  getRegisteredSourceControlNames(): string[] {
    return [...this.sourceControlFactories.keys()];
  }

  /** List registered project management connector names. */
  getRegisteredProjectManagementNames(): string[] {
    return [...this.projectManagementFactories.keys()];
  }

  /** Check whether a source control connector is registered by name. */
  hasSourceControl(name: string): boolean {
    return this.sourceControlFactories.has(name);
  }

  /** Check whether a project management connector is registered by name. */
  hasProjectManagement(name: string): boolean {
    return this.projectManagementFactories.has(name);
  }

  // ── Initialization ──────────────────────────────────────────────────────

  /**
   * Read provider names from the Hive config, look up registered factories,
   * and instantiate the active connectors.
   */
  initializeFromConfig(config: HiveConfig): void {
    const scProvider = config.integrations.source_control.provider;
    const pmProvider = config.integrations.project_management.provider;

    // Source control (required)
    const scFactory = this.sourceControlFactories.get(scProvider);
    if (!scFactory) {
      throw new Error(
        `Source control provider "${scProvider}" is not registered. ` +
          `Available: [${this.getRegisteredSourceControlNames().join(', ')}]`
      );
    }
    this.activeSourceControl = scFactory({ name: scProvider, ...config });

    // Project management (optional — "none" means no PM)
    if (pmProvider && pmProvider !== 'none') {
      const pmFactory = this.projectManagementFactories.get(pmProvider);
      if (!pmFactory) {
        throw new Error(
          `Project management provider "${pmProvider}" is not registered. ` +
            `Available: [${this.getRegisteredProjectManagementNames().join(', ')}]`
        );
      }
      this.activeProjectManagement = pmFactory({ name: pmProvider, ...config });
    } else {
      this.activeProjectManagement = null;
    }
  }

  // ── Reset ───────────────────────────────────────────────────────────────

  /** Clear all registered factories and active instances (useful for testing). */
  reset(): void {
    this.sourceControlFactories.clear();
    this.projectManagementFactories.clear();
    this.activeSourceControl = null;
    this.activeProjectManagement = null;
  }
}
