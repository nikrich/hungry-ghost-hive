// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraConfig } from '../../config/schema.js';
import { registry } from '../registry.js';
import { JiraProjectManagementConnector, register } from './jira.js';

// Mock the underlying Jira modules
vi.mock('../../auth/env-store.js', () => ({
  loadEnvIntoProcess: vi.fn(),
}));

vi.mock('../../integrations/jira/client.js', () => ({
  JiraClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../integrations/jira/epic-import.js', () => ({
  isJiraUrl: vi.fn(),
  parseEpicUrl: vi.fn(),
  fetchEpicFromJira: vi.fn(),
}));

vi.mock('../../integrations/jira/issues.js', () => ({
  createIssue: vi.fn(),
  getIssue: vi.fn(),
  searchJql: vi.fn(),
}));

vi.mock('../../integrations/jira/transitions.js', () => ({
  transitionJiraIssue: vi.fn(),
}));

vi.mock('../../integrations/jira/adf-utils.js', () => ({
  adfToPlainText: vi.fn(),
}));

const baseConfig: JiraConfig = {
  project_key: 'TEST',
  site_url: 'https://test.atlassian.net',
  story_type: 'Story',
  subtask_type: 'Subtask',
  story_points_field: 'story_points',
  status_mapping: {},
};

function createMockTokenStore() {
  return {
    getToken: vi.fn(),
    setToken: vi.fn(),
    loadFromEnv: vi.fn(),
  } as any;
}

describe('JiraProjectManagementConnector', () => {
  let connector: JiraProjectManagementConnector;
  let mockTokenStore: any;

  beforeEach(() => {
    mockTokenStore = createMockTokenStore();
    connector = new JiraProjectManagementConnector({
      config: baseConfig,
      tokenStore: mockTokenStore,
    });
    vi.clearAllMocks();
  });

  it('should have provider set to "jira"', () => {
    expect(connector.provider).toBe('jira');
  });

  describe('isEpicUrl', () => {
    it('should delegate to isJiraUrl', async () => {
      const { isJiraUrl } = await import('../../integrations/jira/epic-import.js');
      vi.mocked(isJiraUrl).mockReturnValue(true);

      const result = connector.isEpicUrl('https://test.atlassian.net/browse/TEST-1');
      expect(result).toBe(true);
      expect(isJiraUrl).toHaveBeenCalledWith('https://test.atlassian.net/browse/TEST-1');
    });

    it('should return false for non-Jira URLs', async () => {
      const { isJiraUrl } = await import('../../integrations/jira/epic-import.js');
      vi.mocked(isJiraUrl).mockReturnValue(false);

      const result = connector.isEpicUrl('https://example.com');
      expect(result).toBe(false);
    });
  });

  describe('parseEpicUrl', () => {
    it('should delegate to parseEpicUrl and add provider', async () => {
      const { parseEpicUrl } = await import('../../integrations/jira/epic-import.js');
      vi.mocked(parseEpicUrl).mockReturnValue({
        issueKey: 'TEST-1',
        siteUrl: 'https://test.atlassian.net',
      });

      const result = connector.parseEpicUrl('https://test.atlassian.net/browse/TEST-1');
      expect(result).toEqual({
        issueKey: 'TEST-1',
        siteUrl: 'https://test.atlassian.net',
        provider: 'jira',
      });
    });

    it('should return null for non-parseable URLs', async () => {
      const { parseEpicUrl } = await import('../../integrations/jira/epic-import.js');
      vi.mocked(parseEpicUrl).mockReturnValue(null);

      const result = connector.parseEpicUrl('https://example.com');
      expect(result).toBeNull();
    });
  });

  describe('fetchEpic', () => {
    it('should fetch epic by issue key', async () => {
      const { fetchEpicFromJira } = await import('../../integrations/jira/epic-import.js');
      const { isJiraUrl } = await import('../../integrations/jira/epic-import.js');
      vi.mocked(isJiraUrl).mockReturnValue(false);
      vi.mocked(fetchEpicFromJira).mockResolvedValue({
        key: 'TEST-1',
        id: '10001',
        title: 'Epic Title',
        description: 'Epic description',
        issue: { id: '10001', key: 'TEST-1' } as any,
      });

      const result = await connector.fetchEpic('TEST-1');

      expect(fetchEpicFromJira).toHaveBeenCalled();
      expect(result).toEqual({
        key: 'TEST-1',
        id: '10001',
        title: 'Epic Title',
        description: 'Epic description',
        provider: 'jira',
        raw: { id: '10001', key: 'TEST-1' },
      });
    });

    it('should parse URL and fetch epic by extracted key', async () => {
      const { isJiraUrl, parseEpicUrl, fetchEpicFromJira } =
        await import('../../integrations/jira/epic-import.js');
      vi.mocked(isJiraUrl).mockReturnValue(true);
      vi.mocked(parseEpicUrl).mockReturnValue({
        issueKey: 'TEST-5',
        siteUrl: 'https://test.atlassian.net',
      });
      vi.mocked(fetchEpicFromJira).mockResolvedValue({
        key: 'TEST-5',
        id: '10005',
        title: 'URL Epic',
        description: 'From URL',
        issue: {} as any,
      });

      const result = await connector.fetchEpic('https://test.atlassian.net/browse/TEST-5');

      expect(result.key).toBe('TEST-5');
      expect(result.provider).toBe('jira');
    });

    it('should throw when URL cannot be parsed', async () => {
      const { isJiraUrl, parseEpicUrl } = await import('../../integrations/jira/epic-import.js');
      vi.mocked(isJiraUrl).mockReturnValue(true);
      vi.mocked(parseEpicUrl).mockReturnValue(null);

      await expect(connector.fetchEpic('https://bad-url.com')).rejects.toThrow(
        'Could not parse Jira epic URL'
      );
    });
  });

  describe('createEpic', () => {
    it('should create a Jira epic', async () => {
      const { createIssue } = await import('../../integrations/jira/issues.js');
      vi.mocked(createIssue).mockResolvedValue({
        key: 'TEST-10',
        id: '10010',
        self: 'https://test.atlassian.net/rest/api/3/issue/10010',
      });

      const result = await connector.createEpic({
        projectKey: 'TEST',
        title: 'New Epic',
        description: 'Epic desc',
        labels: ['hive-managed'],
      });

      expect(createIssue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fields: expect.objectContaining({
            project: { key: 'TEST' },
            summary: 'New Epic',
            issuetype: { name: 'Epic' },
            labels: ['hive-managed'],
          }),
        })
      );
      expect(result).toEqual({ key: 'TEST-10', id: '10010' });
    });
  });

  describe('createStory', () => {
    it('should create a Jira story with epic parent', async () => {
      const { createIssue } = await import('../../integrations/jira/issues.js');
      vi.mocked(createIssue).mockResolvedValue({
        key: 'TEST-20',
        id: '10020',
        self: 'https://test.atlassian.net/rest/api/3/issue/10020',
      });

      const result = await connector.createStory({
        projectKey: 'TEST',
        title: 'New Story',
        description: 'Story desc',
        epicKey: 'TEST-10',
        storyPoints: 5,
      });

      expect(createIssue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fields: expect.objectContaining({
            project: { key: 'TEST' },
            summary: 'New Story',
            issuetype: { name: 'Story' },
            parent: { key: 'TEST-10' },
            story_points: 5,
          }),
        })
      );
      expect(result).toEqual({ key: 'TEST-20', id: '10020' });
    });

    it('should omit parent and story_points when not provided', async () => {
      const { createIssue } = await import('../../integrations/jira/issues.js');
      vi.mocked(createIssue).mockResolvedValue({
        key: 'TEST-21',
        id: '10021',
        self: '',
      });

      await connector.createStory({
        projectKey: 'TEST',
        title: 'Simple Story',
        description: 'No epic',
      });

      const callArgs = vi.mocked(createIssue).mock.calls[0][1] as any;
      expect(callArgs.fields.parent).toBeUndefined();
      expect(callArgs.fields.story_points).toBeUndefined();
    });
  });

  describe('transitionStory', () => {
    it('should delegate to transitionJiraIssue', async () => {
      const { transitionJiraIssue } = await import('../../integrations/jira/transitions.js');
      vi.mocked(transitionJiraIssue).mockResolvedValue(true);

      const result = await connector.transitionStory('TEST-1', 'in_progress', {
        'In Progress': 'in_progress',
      });

      expect(transitionJiraIssue).toHaveBeenCalledWith(expect.anything(), 'TEST-1', 'in_progress', {
        'In Progress': 'in_progress',
      });
      expect(result).toBe(true);
    });

    it('should return false when no transition available', async () => {
      const { transitionJiraIssue } = await import('../../integrations/jira/transitions.js');
      vi.mocked(transitionJiraIssue).mockResolvedValue(false);

      const result = await connector.transitionStory('TEST-1', 'unknown', {});
      expect(result).toBe(false);
    });
  });

  describe('searchIssues', () => {
    it('should search with JQL and map results to ConnectorIssue', async () => {
      const { searchJql } = await import('../../integrations/jira/issues.js');
      const { adfToPlainText } = await import('../../integrations/jira/adf-utils.js');
      vi.mocked(adfToPlainText).mockReturnValue('Description text');
      vi.mocked(searchJql).mockResolvedValue({
        issues: [
          {
            id: '10001',
            key: 'TEST-1',
            self: '',
            fields: {
              summary: 'Test Issue',
              description: null,
              status: {
                id: '1',
                name: 'To Do',
                statusCategory: { id: 2, key: 'new', name: 'To Do' },
              },
              issuetype: { id: '10001', name: 'Story', subtask: false },
              labels: ['hive-managed'],
              assignee: { accountId: 'abc', displayName: 'Alice', active: true },
              story_points: 3,
              parent: { id: '10000', key: 'TEST-0' },
              created: '2024-01-01',
              updated: '2024-01-02',
              project: { id: '1', key: 'TEST', name: 'Test' },
            },
          },
        ],
      });

      const result = await connector.searchIssues('project = TEST', { maxResults: 10 });

      expect(searchJql).toHaveBeenCalledWith(expect.anything(), 'project = TEST', {
        maxResults: 10,
        fields: undefined,
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        key: 'TEST-1',
        id: '10001',
        title: 'Test Issue',
        description: 'Description text',
        status: 'To Do',
        issueType: 'Story',
        labels: ['hive-managed'],
        assignee: 'Alice',
        storyPoints: 3,
        parentKey: 'TEST-0',
        provider: 'jira',
        raw: expect.any(Object),
      });
    });
  });

  describe('getIssue', () => {
    it('should fetch and map a single issue', async () => {
      const { getIssue } = await import('../../integrations/jira/issues.js');
      const { adfToPlainText } = await import('../../integrations/jira/adf-utils.js');
      vi.mocked(adfToPlainText).mockReturnValue('Issue desc');
      vi.mocked(getIssue).mockResolvedValue({
        id: '10001',
        key: 'TEST-1',
        self: '',
        fields: {
          summary: 'Test Issue',
          description: null,
          status: {
            id: '1',
            name: 'In Progress',
            statusCategory: { id: 3, key: 'indeterminate', name: 'In Progress' },
          },
          issuetype: { id: '10001', name: 'Bug', subtask: false },
          labels: [],
          created: '2024-01-01',
          updated: '2024-01-02',
          project: { id: '1', key: 'TEST', name: 'Test' },
        },
      });

      const result = await connector.getIssue('TEST-1');

      expect(getIssue).toHaveBeenCalledWith(expect.anything(), 'TEST-1');
      expect(result.key).toBe('TEST-1');
      expect(result.status).toBe('In Progress');
      expect(result.issueType).toBe('Bug');
      expect(result.provider).toBe('jira');
    });
  });

  describe('syncStatus', () => {
    it('should delegate to transitionStory', async () => {
      const { transitionJiraIssue } = await import('../../integrations/jira/transitions.js');
      vi.mocked(transitionJiraIssue).mockResolvedValue(true);

      const result = await connector.syncStatus('TEST-1', 'in_progress', {
        'In Progress': 'in_progress',
      });

      expect(result).toBe(true);
    });
  });
});

describe('register', () => {
  afterEach(() => {
    registry.reset();
  });

  it('should register the Jira PM connector', () => {
    const mockTokenStore = createMockTokenStore();
    register({ config: baseConfig, tokenStore: mockTokenStore });

    const connector = registry.getProjectManagement('jira');
    expect(connector).toBeInstanceOf(JiraProjectManagementConnector);
    expect(connector?.provider).toBe('jira');
  });

  it('should lazily instantiate the connector', () => {
    const mockTokenStore = createMockTokenStore();
    register({ config: baseConfig, tokenStore: mockTokenStore });

    const providers = registry.listProjectManagementProviders();
    expect(providers).toContain('jira');
  });
});
