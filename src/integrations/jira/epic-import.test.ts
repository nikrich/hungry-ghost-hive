// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi } from 'vitest';
import { fetchEpicFromJira, isJiraUrl, parseEpicUrl } from './epic-import.js';
import type { JiraIssue } from './types.js';

describe('isJiraUrl', () => {
  it('should detect /browse/ URLs', () => {
    expect(isJiraUrl('https://nikrich.atlassian.net/browse/HIVE-2')).toBe(true);
    expect(isJiraUrl('https://mycompany.atlassian.net/browse/PROJ-123')).toBe(true);
  });

  it('should detect /issues/ URLs', () => {
    expect(isJiraUrl('https://nikrich.atlassian.net/issues/HIVE-2')).toBe(true);
  });

  it('should detect ?selectedIssue= URLs', () => {
    expect(
      isJiraUrl(
        'https://nikrich.atlassian.net/jira/software/projects/HIVE/boards/1?selectedIssue=HIVE-2'
      )
    ).toBe(true);
  });

  it('should reject non-Jira URLs', () => {
    expect(isJiraUrl('https://github.com/some/repo')).toBe(false);
    expect(isJiraUrl('https://google.com')).toBe(false);
    expect(isJiraUrl('not-a-url')).toBe(false);
    expect(isJiraUrl('')).toBe(false);
  });

  it('should reject http (non-https) URLs', () => {
    expect(isJiraUrl('http://mycompany.atlassian.net/browse/PROJ-1')).toBe(false);
  });

  it('should reject URLs without proper issue key format', () => {
    expect(isJiraUrl('https://site.atlassian.net/browse/invalid')).toBe(false);
    expect(isJiraUrl('https://site.atlassian.net/browse/123')).toBe(false);
  });
});

describe('parseEpicUrl', () => {
  it('should parse /browse/KEY-123 URLs', () => {
    const result = parseEpicUrl('https://nikrich.atlassian.net/browse/HIVE-2');
    expect(result).toEqual({
      issueKey: 'HIVE-2',
      siteUrl: 'https://nikrich.atlassian.net',
    });
  });

  it('should parse /issues/KEY-123 URLs', () => {
    const result = parseEpicUrl('https://nikrich.atlassian.net/issues/PROJ-42');
    expect(result).toEqual({
      issueKey: 'PROJ-42',
      siteUrl: 'https://nikrich.atlassian.net',
    });
  });

  it('should parse ?selectedIssue=KEY-123 URLs', () => {
    const result = parseEpicUrl(
      'https://nikrich.atlassian.net/jira/software/projects/HIVE/boards/1?selectedIssue=HIVE-99'
    );
    expect(result).toEqual({
      issueKey: 'HIVE-99',
      siteUrl: 'https://nikrich.atlassian.net',
    });
  });

  it('should return null for unparseable URLs', () => {
    expect(parseEpicUrl('not-a-url')).toBeNull();
    expect(parseEpicUrl('https://example.com/no-match')).toBeNull();
  });

  it('should handle multi-character project keys', () => {
    const result = parseEpicUrl('https://site.atlassian.net/browse/MYPROJECT-999');
    expect(result).toEqual({
      issueKey: 'MYPROJECT-999',
      siteUrl: 'https://site.atlassian.net',
    });
  });
});

describe('fetchEpicFromJira', () => {
  it('should fetch and transform epic data', async () => {
    const mockIssue: JiraIssue = {
      id: '10001',
      key: 'HIVE-2',
      self: 'https://api.atlassian.com/rest/api/3/issue/10001',
      fields: {
        summary: 'Build authentication system',
        description: {
          version: 1,
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Implement OAuth 2.0 for the API.' }],
            },
          ],
        },
        status: {
          id: '1',
          name: 'To Do',
          statusCategory: { id: 1, key: 'new', name: 'To Do' },
        },
        issuetype: { id: '10000', name: 'Epic', subtask: false },
        labels: [],
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
        project: { id: '1', key: 'HIVE', name: 'Hive' },
      },
    };

    const mockClient = {
      getBaseUrl: () => 'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3',
      request: vi.fn(async () => mockIssue),
    } as any;

    const result = await fetchEpicFromJira(mockClient, 'HIVE-2');

    expect(result.key).toBe('HIVE-2');
    expect(result.id).toBe('10001');
    expect(result.title).toBe('Build authentication system');
    expect(result.description).toBe('Implement OAuth 2.0 for the API.');
    expect(result.issue).toBe(mockIssue);
  });

  it('should fall back to title when description is empty', async () => {
    const mockIssue: JiraIssue = {
      id: '10002',
      key: 'HIVE-3',
      self: 'https://api.atlassian.com/rest/api/3/issue/10002',
      fields: {
        summary: 'Epic without description',
        description: null,
        status: {
          id: '1',
          name: 'To Do',
          statusCategory: { id: 1, key: 'new', name: 'To Do' },
        },
        issuetype: { id: '10000', name: 'Epic', subtask: false },
        labels: [],
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
        project: { id: '1', key: 'HIVE', name: 'Hive' },
      },
    };

    const mockClient = {
      getBaseUrl: () => 'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3',
      request: vi.fn(async () => mockIssue),
    } as any;

    const result = await fetchEpicFromJira(mockClient, 'HIVE-3');
    expect(result.description).toBe('Epic without description');
  });
});
