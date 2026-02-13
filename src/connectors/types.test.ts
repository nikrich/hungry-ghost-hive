// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import {
  ConnectorType,
  type ConnectorAuth,
  type ConnectorConfig,
  type ExternalEpic,
  type ExternalIssue,
  type PRCreateOptions,
  type PRInfo,
  type PRMergeOptions,
  type PRReview,
  type ProjectManagementConnector,
  type SourceControlConnector,
} from './types.js';

describe('ConnectorType enum', () => {
  it('should contain source control provider values', () => {
    expect(ConnectorType.GitHub).toBe('github');
    expect(ConnectorType.GitLab).toBe('gitlab');
    expect(ConnectorType.Bitbucket).toBe('bitbucket');
  });

  it('should contain project management provider values', () => {
    expect(ConnectorType.Jira).toBe('jira');
    expect(ConnectorType.Monday).toBe('monday');
    expect(ConnectorType.Linear).toBe('linear');
  });
});

describe('ConnectorConfig', () => {
  it('should accept a config with name and arbitrary keys', () => {
    const config: ConnectorConfig = {
      name: 'github',
      base_branch: 'main',
      extra: 42,
    };
    expect(config.name).toBe('github');
    expect(config.base_branch).toBe('main');
  });
});

describe('ConnectorAuth interface', () => {
  it('should be implementable', async () => {
    const auth: ConnectorAuth = {
      authenticate: async () => {},
      refreshToken: async () => {},
      isAuthenticated: async () => true,
      getTokens: () => ({ token: 'abc' }),
    };

    expect(await auth.isAuthenticated()).toBe(true);
    expect(auth.getTokens()).toEqual({ token: 'abc' });
  });
});

describe('SourceControlConnector interface', () => {
  it('should be implementable with all required methods', async () => {
    const mockPR: PRInfo = {
      number: 1,
      url: 'https://github.com/org/repo/pull/1',
      title: 'feat: add feature',
      state: 'open',
      headBranch: 'feature/test',
      baseBranch: 'main',
      additions: 10,
      deletions: 2,
      changedFiles: 3,
    };

    const connector: SourceControlConnector = {
      displayName: 'GitHub',
      name: 'github',
      auth: {
        authenticate: async () => {},
        refreshToken: async () => {},
        isAuthenticated: async () => true,
        getTokens: () => ({ GITHUB_TOKEN: 'ghp_xxx' }),
      },
      createPR: async (_workDir: string, _options: PRCreateOptions) => ({
        number: 1,
        url: 'https://github.com/org/repo/pull/1',
      }),
      getPR: async () => mockPR,
      listPRs: async () => [mockPR],
      mergePR: async (_workDir: string, _prNumber: number, _options?: PRMergeOptions) => {},
      commentOnPR: async () => {},
      reviewPR: async (_workDir: string, _prNumber: number, _review: PRReview) => {},
    };

    expect(connector.name).toBe('github');
    expect(connector.displayName).toBe('GitHub');

    const created = await connector.createPR('/tmp', {
      title: 'test',
      body: 'body',
      baseBranch: 'main',
      headBranch: 'feature',
    });
    expect(created.number).toBe(1);

    const pr = await connector.getPR('/tmp', 1);
    expect(pr.state).toBe('open');

    const prs = await connector.listPRs('/tmp', 'open');
    expect(prs).toHaveLength(1);
  });
});

describe('ProjectManagementConnector interface', () => {
  it('should be implementable with all required methods', async () => {
    const mockIssue: ExternalIssue = {
      id: '10001',
      key: 'PROJ-1',
      title: 'Test story',
      description: 'A test story description',
      status: 'To Do',
      type: 'Story',
      labels: ['hive-managed'],
    };

    const mockEpic: ExternalEpic = {
      key: 'PROJ-100',
      id: '10100',
      title: 'Test epic',
      description: 'An epic description',
    };

    const connector: ProjectManagementConnector = {
      displayName: 'Jira',
      name: 'jira',
      auth: {
        authenticate: async () => {},
        refreshToken: async () => {},
        isAuthenticated: async () => true,
        getTokens: () => ({ JIRA_ACCESS_TOKEN: 'tok' }),
      },
      fetchIssue: async () => mockIssue,
      searchIssues: async () => [mockIssue],
      createIssue: async () => ({ id: '10001', key: 'PROJ-1' }),
      updateIssue: async () => {},
      transitionIssue: async () => true,
      syncStatuses: async () => 3,
      importEpic: async () => mockEpic,
      parseEpicRef: (url: string) => {
        if (url.includes('atlassian.net')) {
          return { issueKey: 'PROJ-100', siteUrl: 'https://mysite.atlassian.net' };
        }
        return null;
      },
      isEpicRef: (value: string) => value.includes('atlassian.net'),
    };

    expect(connector.name).toBe('jira');
    expect(connector.displayName).toBe('Jira');

    const issue = await connector.fetchIssue('PROJ-1');
    expect(issue.key).toBe('PROJ-1');
    expect(issue.title).toBe('Test story');

    const results = await connector.searchIssues({ query: 'project = PROJ', maxResults: 10 });
    expect(results).toHaveLength(1);

    const created = await connector.createIssue({
      projectKey: 'PROJ',
      title: 'New story',
      type: 'Story',
    });
    expect(created.key).toBe('PROJ-1');

    const transitioned = await connector.transitionIssue('PROJ-1', 'In Progress');
    expect(transitioned).toBe(true);

    const syncCount = await connector.syncStatuses({ 'To Do': 'draft' });
    expect(syncCount).toBe(3);

    const epic = await connector.importEpic('https://mysite.atlassian.net/browse/PROJ-100');
    expect(epic.key).toBe('PROJ-100');

    const parsed = connector.parseEpicRef('https://mysite.atlassian.net/browse/PROJ-100');
    expect(parsed).toEqual({ issueKey: 'PROJ-100', siteUrl: 'https://mysite.atlassian.net' });

    expect(connector.parseEpicRef('not-a-url')).toBeNull();
    expect(connector.isEpicRef('https://mysite.atlassian.net/browse/PROJ-100')).toBe(true);
    expect(connector.isEpicRef('not-a-url')).toBe(false);
  });
});
