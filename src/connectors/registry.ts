// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { IAuthConnector } from './auth/types.js';
import type { IProjectManagementConnector } from './project-management/types.js';
import type { ISourceControlConnector } from './source-control/types.js';

/**
 * Factory function that creates a connector instance.
 * Called lazily on first access — connectors are not instantiated until needed.
 */
export type ConnectorFactory<T> = () => T;

/**
 * Central registry for all connector implementations.
 *
 * Each connector self-registers when imported by calling the appropriate
 * register function. At runtime, the orchestrator resolves the active
 * connector from config and retrieves it from the registry.
 *
 * Key principles:
 * - Factory pattern with lazy instantiation: connectors are created on first access
 * - Provider-keyed: each provider string maps to exactly one factory
 * - No provider-specific imports outside connector implementations
 */
class ConnectorRegistry {
  private sourceControlFactories = new Map<string, ConnectorFactory<ISourceControlConnector>>();
  private projectManagementFactories = new Map<
    string,
    ConnectorFactory<IProjectManagementConnector>
  >();
  private authFactories = new Map<string, ConnectorFactory<IAuthConnector>>();

  private sourceControlInstances = new Map<string, ISourceControlConnector>();
  private projectManagementInstances = new Map<string, IProjectManagementConnector>();
  private authInstances = new Map<string, IAuthConnector>();

  // ── Source Control ──────────────────────────────────────────────────────

  /**
   * Register a source control connector factory.
   * @param provider - Provider identifier (e.g., "github")
   * @param factory - Factory function that creates the connector
   */
  registerSourceControl(
    provider: string,
    factory: ConnectorFactory<ISourceControlConnector>
  ): void {
    this.sourceControlFactories.set(provider, factory);
    // Clear cached instance so next access uses the new factory
    this.sourceControlInstances.delete(provider);
  }

  /**
   * Get the source control connector for a provider.
   * Creates the instance lazily on first access.
   * @param provider - Provider identifier
   * @returns The connector instance, or null if no factory is registered
   */
  getSourceControl(provider: string): ISourceControlConnector | null {
    const existing = this.sourceControlInstances.get(provider);
    if (existing) return existing;

    const factory = this.sourceControlFactories.get(provider);
    if (!factory) return null;

    const instance = factory();
    this.sourceControlInstances.set(provider, instance);
    return instance;
  }

  // ── Project Management ─────────────────────────────────────────────────

  /**
   * Register a project management connector factory.
   * @param provider - Provider identifier (e.g., "jira")
   * @param factory - Factory function that creates the connector
   */
  registerProjectManagement(
    provider: string,
    factory: ConnectorFactory<IProjectManagementConnector>
  ): void {
    this.projectManagementFactories.set(provider, factory);
    this.projectManagementInstances.delete(provider);
  }

  /**
   * Get the project management connector for a provider.
   * Creates the instance lazily on first access.
   * @param provider - Provider identifier
   * @returns The connector instance, or null if no factory is registered
   */
  getProjectManagement(provider: string): IProjectManagementConnector | null {
    const existing = this.projectManagementInstances.get(provider);
    if (existing) return existing;

    const factory = this.projectManagementFactories.get(provider);
    if (!factory) return null;

    const instance = factory();
    this.projectManagementInstances.set(provider, instance);
    return instance;
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  /**
   * Register an auth connector factory.
   * @param provider - Provider identifier (e.g., "github", "jira")
   * @param factory - Factory function that creates the connector
   */
  registerAuth(provider: string, factory: ConnectorFactory<IAuthConnector>): void {
    this.authFactories.set(provider, factory);
    this.authInstances.delete(provider);
  }

  /**
   * Get the auth connector for a provider.
   * Creates the instance lazily on first access.
   * @param provider - Provider identifier
   * @returns The connector instance, or null if no factory is registered
   */
  getAuth(provider: string): IAuthConnector | null {
    const existing = this.authInstances.get(provider);
    if (existing) return existing;

    const factory = this.authFactories.get(provider);
    if (!factory) return null;

    const instance = factory();
    this.authInstances.set(provider, instance);
    return instance;
  }

  // ── Introspection ──────────────────────────────────────────────────────

  /** List all registered source control provider names */
  listSourceControlProviders(): string[] {
    return [...this.sourceControlFactories.keys()];
  }

  /** List all registered project management provider names */
  listProjectManagementProviders(): string[] {
    return [...this.projectManagementFactories.keys()];
  }

  /** List all registered auth provider names */
  listAuthProviders(): string[] {
    return [...this.authFactories.keys()];
  }

  /**
   * Reset the registry, clearing all factories and cached instances.
   * Primarily useful for testing.
   */
  reset(): void {
    this.sourceControlFactories.clear();
    this.projectManagementFactories.clear();
    this.authFactories.clear();
    this.sourceControlInstances.clear();
    this.projectManagementInstances.clear();
    this.authInstances.clear();
  }
}

/** Global singleton connector registry */
export const registry = new ConnectorRegistry();
