// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HiveConfig } from '../config/schema.js';
import { ConnectorRegistry } from './registry.js';
import type {
  ConnectorConfig,
  ProjectManagementConnector,
  SourceControlConnector,
} from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockSCConnector(name: string): SourceControlConnector {
  return {
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    name,
    auth: {
      authenticate: async () => {},
      refreshToken: async () => {},
      isAuthenticated: async () => true,
      getTokens: () => ({}),
    },
    createPR: async () => ({ number: 1, url: 'https://example.com/pr/1' }),
    getPR: async () => ({
      number: 1,
      url: 'https://example.com/pr/1',
      title: 'test',
      state: 'open' as const,
      headBranch: 'feat',
      baseBranch: 'main',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }),
    listPRs: async () => [],
    mergePR: async () => {},
    commentOnPR: async () => {},
    reviewPR: async () => {},
  };
}

function makeMockPMConnector(name: string): ProjectManagementConnector {
  return {
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    name,
    auth: {
      authenticate: async () => {},
      refreshToken: async () => {},
      isAuthenticated: async () => true,
      getTokens: () => ({}),
    },
    fetchIssue: async () => ({
      id: '1',
      key: 'PROJ-1',
      title: 'test',
      description: '',
      status: 'To Do',
      type: 'Story',
      labels: [],
    }),
    searchIssues: async () => [],
    createIssue: async () => ({ id: '1', key: 'PROJ-1' }),
    updateIssue: async () => {},
    transitionIssue: async () => true,
    syncStatuses: async () => 0,
    importEpic: async () => ({ key: 'PROJ-1', id: '1', title: 'Epic', description: '' }),
    parseEpicRef: () => null,
    isEpicRef: () => false,
  };
}

function makeMinimalConfig(
  scProvider: string = 'github',
  pmProvider: string = 'none'
): HiveConfig {
  return {
    integrations: {
      source_control: { provider: scProvider },
      project_management: { provider: pmProvider },
      autonomy: { level: 'full' },
    },
  } as unknown as HiveConfig;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ConnectorRegistry', () => {
  beforeEach(() => {
    ConnectorRegistry.resetInstance();
  });

  afterEach(() => {
    ConnectorRegistry.resetInstance();
  });

  // ── Singleton ───────────────────────────────────────────────────────────

  describe('singleton', () => {
    it('should return the same instance', () => {
      const a = ConnectorRegistry.getInstance();
      const b = ConnectorRegistry.getInstance();
      expect(a).toBe(b);
    });

    it('should return a fresh instance after resetInstance()', () => {
      const a = ConnectorRegistry.getInstance();
      ConnectorRegistry.resetInstance();
      const b = ConnectorRegistry.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // ── Registration ────────────────────────────────────────────────────────

  describe('registerSourceControl', () => {
    it('should register a source control factory', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerSourceControl('github', () => makeMockSCConnector('github'));

      expect(registry.hasSourceControl('github')).toBe(true);
      expect(registry.hasSourceControl('gitlab')).toBe(false);
    });

    it('should list registered source control names', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerSourceControl('github', () => makeMockSCConnector('github'));
      registry.registerSourceControl('gitlab', () => makeMockSCConnector('gitlab'));

      const names = registry.getRegisteredSourceControlNames();
      expect(names).toContain('github');
      expect(names).toContain('gitlab');
      expect(names).toHaveLength(2);
    });
  });

  describe('registerProjectManagement', () => {
    it('should register a project management factory', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerProjectManagement('jira', () => makeMockPMConnector('jira'));

      expect(registry.hasProjectManagement('jira')).toBe(true);
      expect(registry.hasProjectManagement('monday')).toBe(false);
    });

    it('should list registered project management names', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerProjectManagement('jira', () => makeMockPMConnector('jira'));
      registry.registerProjectManagement('monday', () => makeMockPMConnector('monday'));

      const names = registry.getRegisteredProjectManagementNames();
      expect(names).toContain('jira');
      expect(names).toContain('monday');
      expect(names).toHaveLength(2);
    });
  });

  // ── Retrieval ───────────────────────────────────────────────────────────

  describe('getSourceControl', () => {
    it('should throw when no connector is initialized', () => {
      const registry = ConnectorRegistry.getInstance();
      expect(() => registry.getSourceControl()).toThrow(
        'No source control connector initialized'
      );
    });
  });

  describe('getProjectManagement', () => {
    it('should return null when no PM connector is initialized', () => {
      const registry = ConnectorRegistry.getInstance();
      expect(registry.getProjectManagement()).toBeNull();
    });
  });

  // ── initializeFromConfig ────────────────────────────────────────────────

  describe('initializeFromConfig', () => {
    it('should initialize source control connector from config', () => {
      const registry = ConnectorRegistry.getInstance();
      let receivedConfig: ConnectorConfig | null = null;

      registry.registerSourceControl('github', (config) => {
        receivedConfig = config;
        return makeMockSCConnector('github');
      });

      const config = makeMinimalConfig('github', 'none');
      registry.initializeFromConfig(config);

      const sc = registry.getSourceControl();
      expect(sc.name).toBe('github');
      expect(receivedConfig).not.toBeNull();
      expect(receivedConfig!.name).toBe('github');
    });

    it('should initialize PM connector when provider is not "none"', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerSourceControl('github', () => makeMockSCConnector('github'));
      registry.registerProjectManagement('jira', () => makeMockPMConnector('jira'));

      registry.initializeFromConfig(makeMinimalConfig('github', 'jira'));

      const pm = registry.getProjectManagement();
      expect(pm).not.toBeNull();
      expect(pm!.name).toBe('jira');
    });

    it('should set PM to null when provider is "none"', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerSourceControl('github', () => makeMockSCConnector('github'));

      registry.initializeFromConfig(makeMinimalConfig('github', 'none'));

      expect(registry.getProjectManagement()).toBeNull();
    });

    it('should throw when SC provider is not registered', () => {
      const registry = ConnectorRegistry.getInstance();
      expect(() => registry.initializeFromConfig(makeMinimalConfig('gitlab', 'none'))).toThrow(
        'Source control provider "gitlab" is not registered'
      );
    });

    it('should throw when PM provider is not registered', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerSourceControl('github', () => makeMockSCConnector('github'));

      expect(() =>
        registry.initializeFromConfig(makeMinimalConfig('github', 'monday'))
      ).toThrow('Project management provider "monday" is not registered');
    });

    it('should include available providers in error messages', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerSourceControl('github', () => makeMockSCConnector('github'));
      registry.registerProjectManagement('jira', () => makeMockPMConnector('jira'));

      expect(() =>
        registry.initializeFromConfig(makeMinimalConfig('github', 'monday'))
      ).toThrow('Available: [jira]');
    });

    it('should pass the full config to the factory', () => {
      const registry = ConnectorRegistry.getInstance();
      let receivedConfig: ConnectorConfig | null = null;

      registry.registerSourceControl('github', (config) => {
        receivedConfig = config;
        return makeMockSCConnector('github');
      });

      const config = makeMinimalConfig('github', 'none');
      registry.initializeFromConfig(config);

      // The factory receives a spread of { name, ...config }
      expect(receivedConfig).not.toBeNull();
      expect(receivedConfig!.name).toBe('github');
      expect((receivedConfig as any).integrations).toBeDefined();
    });
  });

  // ── reset() ─────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all factories and active connectors', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerSourceControl('github', () => makeMockSCConnector('github'));
      registry.registerProjectManagement('jira', () => makeMockPMConnector('jira'));
      registry.initializeFromConfig(makeMinimalConfig('github', 'jira'));

      // Verify connectors are active
      expect(registry.getSourceControl().name).toBe('github');
      expect(registry.getProjectManagement()?.name).toBe('jira');

      registry.reset();

      // Everything should be cleared
      expect(registry.hasSourceControl('github')).toBe(false);
      expect(registry.hasProjectManagement('jira')).toBe(false);
      expect(registry.getRegisteredSourceControlNames()).toHaveLength(0);
      expect(registry.getRegisteredProjectManagementNames()).toHaveLength(0);
      expect(() => registry.getSourceControl()).toThrow();
      expect(registry.getProjectManagement()).toBeNull();
    });
  });

  // ── Overwrite registration ──────────────────────────────────────────────

  describe('overwriting registrations', () => {
    it('should allow overwriting a registered factory', () => {
      const registry = ConnectorRegistry.getInstance();
      registry.registerSourceControl('github', () => makeMockSCConnector('github-v1'));
      registry.registerSourceControl('github', () => makeMockSCConnector('github-v2'));

      registry.initializeFromConfig(makeMinimalConfig('github', 'none'));
      // Should use the latest registered factory
      expect(registry.getSourceControl().name).toBe('github-v2');
    });
  });
});
