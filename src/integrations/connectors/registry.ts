// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type {
  ConnectorInfo,
  ProjectManagementConnector,
  SourceControlConnector,
} from './types.js';

/**
 * Factory function that creates a connector instance given provider-specific config.
 */
export type ConnectorFactory<T> = (config: Record<string, unknown>) => T;

/**
 * Registration entry for a connector provider.
 */
interface ConnectorEntry<T> {
  info: ConnectorInfo;
  factory: ConnectorFactory<T>;
}

/**
 * Central registry for source control and project management connectors.
 *
 * Connectors register themselves with the registry at startup.
 * Orchestration code looks up connectors by provider name.
 *
 * Usage:
 *   ConnectorRegistry.registerPMConnector({ ... }, factory);
 *   const connector = ConnectorRegistry.getPMConnector('jira', config);
 */
export class ConnectorRegistry {
  private static pmConnectors = new Map<string, ConnectorEntry<ProjectManagementConnector>>();
  private static scConnectors = new Map<string, ConnectorEntry<SourceControlConnector>>();

  // ─── Project Management ──────────────────────────────────────────────

  /**
   * Register a project management connector provider.
   */
  static registerPMConnector(
    info: ConnectorInfo,
    factory: ConnectorFactory<ProjectManagementConnector>
  ): void {
    ConnectorRegistry.pmConnectors.set(info.name, { info, factory });
  }

  /**
   * Create a project management connector instance for the given provider.
   * @throws Error if the provider is not registered.
   */
  static getPMConnector(
    providerName: string,
    config: Record<string, unknown>
  ): ProjectManagementConnector {
    const entry = ConnectorRegistry.pmConnectors.get(providerName);
    if (!entry) {
      throw new Error(
        `Unknown project management provider: "${providerName}". ` +
          `Registered providers: [${ConnectorRegistry.getPMProviderNames().join(', ')}]`
      );
    }
    return entry.factory(config);
  }

  /**
   * Get metadata for all registered PM providers.
   */
  static getPMProviders(): ConnectorInfo[] {
    return Array.from(ConnectorRegistry.pmConnectors.values()).map(e => e.info);
  }

  /**
   * Get names of all registered PM providers.
   */
  static getPMProviderNames(): string[] {
    return Array.from(ConnectorRegistry.pmConnectors.keys());
  }

  /**
   * Check if a PM provider is registered.
   */
  static hasPMConnector(providerName: string): boolean {
    return ConnectorRegistry.pmConnectors.has(providerName);
  }

  // ─── Source Control ──────────────────────────────────────────────────

  /**
   * Register a source control connector provider.
   */
  static registerSCConnector(
    info: ConnectorInfo,
    factory: ConnectorFactory<SourceControlConnector>
  ): void {
    ConnectorRegistry.scConnectors.set(info.name, { info, factory });
  }

  /**
   * Create a source control connector instance for the given provider.
   * @throws Error if the provider is not registered.
   */
  static getSCConnector(
    providerName: string,
    config: Record<string, unknown>
  ): SourceControlConnector {
    const entry = ConnectorRegistry.scConnectors.get(providerName);
    if (!entry) {
      throw new Error(
        `Unknown source control provider: "${providerName}". ` +
          `Registered providers: [${ConnectorRegistry.getSCProviderNames().join(', ')}]`
      );
    }
    return entry.factory(config);
  }

  /**
   * Get metadata for all registered SC providers.
   */
  static getSCProviders(): ConnectorInfo[] {
    return Array.from(ConnectorRegistry.scConnectors.values()).map(e => e.info);
  }

  /**
   * Get names of all registered SC providers.
   */
  static getSCProviderNames(): string[] {
    return Array.from(ConnectorRegistry.scConnectors.keys());
  }

  /**
   * Check if a SC provider is registered.
   */
  static hasSCConnector(providerName: string): boolean {
    return ConnectorRegistry.scConnectors.has(providerName);
  }

  // ─── Test Utilities ──────────────────────────────────────────────────

  /**
   * Clear all registered connectors. For testing only.
   */
  static _reset(): void {
    ConnectorRegistry.pmConnectors.clear();
    ConnectorRegistry.scConnectors.clear();
  }
}
