// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry } from './registry.js';
import type {
  ConnectorInfo,
  ProjectManagementConnector,
  SourceControlConnector,
} from './types.js';

function makePMInfo(name: string): ConnectorInfo {
  return { name, displayName: name.toUpperCase(), available: true };
}

function makeSCInfo(name: string): ConnectorInfo {
  return { name, displayName: name.toUpperCase(), available: true };
}

// Minimal stub implementing the PM connector interface for testing
function stubPMConnector(name: string): ProjectManagementConnector {
  return {
    info: makePMInfo(name),
    authenticate: async () => {},
    isAuthenticated: async () => true,
    fetchEpic: async () => ({ key: '', id: '', title: '', description: '' }),
    createEpic: async () => ({ ref: { provider: name, externalId: '', externalKey: '' } }),
    createIssue: async () => ({ ref: { provider: name, externalId: '', externalKey: '' } }),
    createSubtask: async () => ({ ref: { provider: name, externalId: '', externalKey: '' } }),
    transitionIssue: async () => true,
    postComment: async () => true,
    syncRequirement: async () => ({ epicRef: null, stories: [], errors: [] }),
    getSetupWizard: () => ({ run: async () => ({}) }),
    getInstructions: () => '',
  };
}

function stubSCConnector(name: string): SourceControlConnector {
  return {
    info: makeSCInfo(name),
    authenticate: async () => {},
    isAuthenticated: async () => true,
    createPullRequest: async () => ({ number: 1, url: '' }),
    getPullRequest: async () => ({
      number: 1,
      url: '',
      title: '',
      state: 'open' as const,
      headBranch: '',
      baseBranch: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }),
    mergePullRequest: async () => {},
    listPullRequests: async () => [],
  };
}

describe('ConnectorRegistry', () => {
  afterEach(() => {
    ConnectorRegistry._reset();
  });

  describe('PM connectors', () => {
    it('should register and retrieve a PM connector', () => {
      const info = makePMInfo('jira');
      ConnectorRegistry.registerPMConnector(info, () => stubPMConnector('jira'));

      const connector = ConnectorRegistry.getPMConnector('jira', {});
      expect(connector.info.name).toBe('jira');
    });

    it('should throw for unregistered PM provider', () => {
      expect(() => ConnectorRegistry.getPMConnector('linear', {})).toThrow(
        /Unknown project management provider: "linear"/
      );
    });

    it('should list registered PM providers', () => {
      ConnectorRegistry.registerPMConnector(makePMInfo('jira'), () => stubPMConnector('jira'));
      ConnectorRegistry.registerPMConnector(makePMInfo('linear'), () => stubPMConnector('linear'));

      const names = ConnectorRegistry.getPMProviderNames();
      expect(names).toContain('jira');
      expect(names).toContain('linear');
    });

    it('should return PM provider info', () => {
      ConnectorRegistry.registerPMConnector(
        { name: 'linear', displayName: 'Linear', available: false, comingSoon: true },
        () => stubPMConnector('linear')
      );

      const providers = ConnectorRegistry.getPMProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].name).toBe('linear');
      expect(providers[0].available).toBe(false);
      expect(providers[0].comingSoon).toBe(true);
    });

    it('should check if PM connector exists', () => {
      expect(ConnectorRegistry.hasPMConnector('jira')).toBe(false);
      ConnectorRegistry.registerPMConnector(makePMInfo('jira'), () => stubPMConnector('jira'));
      expect(ConnectorRegistry.hasPMConnector('jira')).toBe(true);
    });

    it('should pass config to PM factory', () => {
      const info = makePMInfo('jira');
      let receivedConfig: Record<string, unknown> = {};
      ConnectorRegistry.registerPMConnector(info, config => {
        receivedConfig = config;
        return stubPMConnector('jira');
      });

      ConnectorRegistry.getPMConnector('jira', { project_key: 'HIVE' });
      expect(receivedConfig).toEqual({ project_key: 'HIVE' });
    });
  });

  describe('SC connectors', () => {
    it('should register and retrieve a SC connector', () => {
      const info = makeSCInfo('github');
      ConnectorRegistry.registerSCConnector(info, () => stubSCConnector('github'));

      const connector = ConnectorRegistry.getSCConnector('github', {});
      expect(connector.info.name).toBe('github');
    });

    it('should throw for unregistered SC provider', () => {
      expect(() => ConnectorRegistry.getSCConnector('gitlab', {})).toThrow(
        /Unknown source control provider: "gitlab"/
      );
    });

    it('should list registered SC providers', () => {
      ConnectorRegistry.registerSCConnector(makeSCInfo('github'), () => stubSCConnector('github'));

      const names = ConnectorRegistry.getSCProviderNames();
      expect(names).toEqual(['github']);
    });

    it('should check if SC connector exists', () => {
      expect(ConnectorRegistry.hasSCConnector('github')).toBe(false);
      ConnectorRegistry.registerSCConnector(makeSCInfo('github'), () => stubSCConnector('github'));
      expect(ConnectorRegistry.hasSCConnector('github')).toBe(true);
    });
  });

  describe('_reset', () => {
    it('should clear all registrations', () => {
      ConnectorRegistry.registerPMConnector(makePMInfo('jira'), () => stubPMConnector('jira'));
      ConnectorRegistry.registerSCConnector(makeSCInfo('github'), () => stubSCConnector('github'));

      ConnectorRegistry._reset();

      expect(ConnectorRegistry.getPMProviderNames()).toHaveLength(0);
      expect(ConnectorRegistry.getSCProviderNames()).toHaveLength(0);
    });
  });
});
