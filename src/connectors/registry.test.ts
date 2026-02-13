// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IAuthConnector } from './auth/types.js';
import type { IProjectManagementConnector } from './project-management/types.js';
import { registry } from './registry.js';
import type { ISourceControlConnector } from './source-control/types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockSourceControl(provider = 'github'): ISourceControlConnector {
  return {
    provider,
    createPullRequest: vi.fn(),
    mergePullRequest: vi.fn(),
    listPullRequests: vi.fn(),
    getPullRequestDiff: vi.fn(),
    addPRComment: vi.fn(),
    getPRReviews: vi.fn(),
    approvePullRequest: vi.fn(),
  };
}

function createMockProjectManagement(provider = 'jira'): IProjectManagementConnector {
  return {
    provider,
    fetchEpic: vi.fn(),
    createEpic: vi.fn(),
    createStory: vi.fn(),
    transitionStory: vi.fn(),
    searchIssues: vi.fn(),
    getIssue: vi.fn(),
    syncStatus: vi.fn(),
    postComment: vi.fn(),
    createSubtask: vi.fn(),
    transitionSubtask: vi.fn(),
    isEpicUrl: vi.fn(),
    parseEpicUrl: vi.fn(),
  };
}

function createMockAuth(provider = 'github'): IAuthConnector {
  return {
    provider,
    authenticate: vi.fn(),
    validateCredentials: vi.fn(),
    getProviderName: vi.fn(() => 'GitHub'),
  };
}

afterEach(() => {
  registry.reset();
});

// ── Source Control ───────────────────────────────────────────────────────────

describe('ConnectorRegistry - Source Control', () => {
  it('should register and retrieve a source control connector', () => {
    const mock = createMockSourceControl();
    registry.registerSourceControl('github', () => mock);

    const result = registry.getSourceControl('github');
    expect(result).toBe(mock);
  });

  it('should return null for unregistered provider', () => {
    expect(registry.getSourceControl('bitbucket')).toBeNull();
  });

  it('should lazily instantiate connectors', () => {
    const factory = vi.fn(() => createMockSourceControl());
    registry.registerSourceControl('github', factory);

    expect(factory).not.toHaveBeenCalled();

    registry.getSourceControl('github');
    expect(factory).toHaveBeenCalledTimes(1);

    // Second access should reuse cached instance
    registry.getSourceControl('github');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should clear cached instance when re-registering', () => {
    const mock1 = createMockSourceControl();
    const mock2 = createMockSourceControl();

    registry.registerSourceControl('github', () => mock1);
    expect(registry.getSourceControl('github')).toBe(mock1);

    registry.registerSourceControl('github', () => mock2);
    expect(registry.getSourceControl('github')).toBe(mock2);
  });

  it('should list registered providers', () => {
    registry.registerSourceControl('github', () => createMockSourceControl('github'));
    registry.registerSourceControl('gitlab', () => createMockSourceControl('gitlab'));

    const providers = registry.listSourceControlProviders();
    expect(providers).toContain('github');
    expect(providers).toContain('gitlab');
    expect(providers).toHaveLength(2);
  });
});

// ── Project Management ──────────────────────────────────────────────────────

describe('ConnectorRegistry - Project Management', () => {
  it('should register and retrieve a PM connector', () => {
    const mock = createMockProjectManagement();
    registry.registerProjectManagement('jira', () => mock);

    const result = registry.getProjectManagement('jira');
    expect(result).toBe(mock);
  });

  it('should return null for unregistered provider', () => {
    expect(registry.getProjectManagement('linear')).toBeNull();
  });

  it('should lazily instantiate connectors', () => {
    const factory = vi.fn(() => createMockProjectManagement());
    registry.registerProjectManagement('jira', factory);

    expect(factory).not.toHaveBeenCalled();

    registry.getProjectManagement('jira');
    expect(factory).toHaveBeenCalledTimes(1);

    registry.getProjectManagement('jira');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should clear cached instance when re-registering', () => {
    const mock1 = createMockProjectManagement();
    const mock2 = createMockProjectManagement();

    registry.registerProjectManagement('jira', () => mock1);
    expect(registry.getProjectManagement('jira')).toBe(mock1);

    registry.registerProjectManagement('jira', () => mock2);
    expect(registry.getProjectManagement('jira')).toBe(mock2);
  });

  it('should list registered providers', () => {
    registry.registerProjectManagement('jira', () => createMockProjectManagement('jira'));
    registry.registerProjectManagement('linear', () => createMockProjectManagement('linear'));

    const providers = registry.listProjectManagementProviders();
    expect(providers).toContain('jira');
    expect(providers).toContain('linear');
    expect(providers).toHaveLength(2);
  });
});

// ── Auth ────────────────────────────────────────────────────────────────────

describe('ConnectorRegistry - Auth', () => {
  it('should register and retrieve an auth connector', () => {
    const mock = createMockAuth();
    registry.registerAuth('github', () => mock);

    const result = registry.getAuth('github');
    expect(result).toBe(mock);
  });

  it('should return null for unregistered provider', () => {
    expect(registry.getAuth('jira')).toBeNull();
  });

  it('should lazily instantiate connectors', () => {
    const factory = vi.fn(() => createMockAuth());
    registry.registerAuth('github', factory);

    expect(factory).not.toHaveBeenCalled();

    registry.getAuth('github');
    expect(factory).toHaveBeenCalledTimes(1);

    registry.getAuth('github');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should list registered providers', () => {
    registry.registerAuth('github', () => createMockAuth('github'));
    registry.registerAuth('jira', () => createMockAuth('jira'));

    const providers = registry.listAuthProviders();
    expect(providers).toContain('github');
    expect(providers).toContain('jira');
    expect(providers).toHaveLength(2);
  });
});

// ── Reset ───────────────────────────────────────────────────────────────────

describe('ConnectorRegistry - Reset', () => {
  it('should clear all factories and instances on reset', () => {
    registry.registerSourceControl('github', () => createMockSourceControl());
    registry.registerProjectManagement('jira', () => createMockProjectManagement());
    registry.registerAuth('github', () => createMockAuth());

    // Instantiate all
    registry.getSourceControl('github');
    registry.getProjectManagement('jira');
    registry.getAuth('github');

    registry.reset();

    expect(registry.getSourceControl('github')).toBeNull();
    expect(registry.getProjectManagement('jira')).toBeNull();
    expect(registry.getAuth('github')).toBeNull();
    expect(registry.listSourceControlProviders()).toHaveLength(0);
    expect(registry.listProjectManagementProviders()).toHaveLength(0);
    expect(registry.listAuthProviders()).toHaveLength(0);
  });
});

// ── Multiple Providers ──────────────────────────────────────────────────────

describe('ConnectorRegistry - Multiple Providers', () => {
  it('should support multiple providers simultaneously', () => {
    const githubSC = createMockSourceControl('github');
    const gitlabSC = createMockSourceControl('gitlab');
    const jiraPM = createMockProjectManagement('jira');
    const linearPM = createMockProjectManagement('linear');

    registry.registerSourceControl('github', () => githubSC);
    registry.registerSourceControl('gitlab', () => gitlabSC);
    registry.registerProjectManagement('jira', () => jiraPM);
    registry.registerProjectManagement('linear', () => linearPM);

    expect(registry.getSourceControl('github')).toBe(githubSC);
    expect(registry.getSourceControl('gitlab')).toBe(gitlabSC);
    expect(registry.getProjectManagement('jira')).toBe(jiraPM);
    expect(registry.getProjectManagement('linear')).toBe(linearPM);
  });
});
