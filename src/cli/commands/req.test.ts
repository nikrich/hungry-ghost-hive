// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorEpic, ConnectorParsedEpicUrl } from '../../connectors/common-types.js';
import type { IProjectManagementConnector } from '../../connectors/project-management/types.js';
import { registry } from '../../connectors/registry.js';

function createMockPMConnector(provider: string): IProjectManagementConnector {
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

afterEach(() => {
  registry.reset();
  vi.restoreAllMocks();
});

describe('req command - URL validation', () => {
  it('should detect Jira epic URL when Jira is configured', () => {
    const jiraConnector = createMockPMConnector('jira');
    (jiraConnector.isEpicUrl as any).mockReturnValue(true);
    (jiraConnector.parseEpicUrl as any).mockReturnValue({
      issueKey: 'PROJ-123',
      siteUrl: 'https://site.atlassian.net',
    } as ConnectorParsedEpicUrl);

    registry.registerProjectManagement('jira', () => jiraConnector);

    // Verify the connector detects Jira URLs
    const connector = registry.getProjectManagement('jira');
    expect(connector).not.toBeNull();
    expect(connector!.isEpicUrl('https://site.atlassian.net/browse/PROJ-123')).toBe(true);
  });

  it('should detect provider mismatch when URL is for different provider', () => {
    const jiraConnector = createMockPMConnector('jira');
    const linearConnector = createMockPMConnector('linear');

    (jiraConnector.isEpicUrl as any).mockImplementation((url: string) =>
      url.includes('atlassian.net')
    );
    (linearConnector.isEpicUrl as any).mockImplementation((url: string) =>
      url.includes('linear.app')
    );

    registry.registerProjectManagement('jira', () => jiraConnector);
    registry.registerProjectManagement('linear', () => linearConnector);

    // Test that we can detect a Linear URL when Jira is configured
    const providers = registry.listProjectManagementProviders();
    expect(providers).toContain('jira');
    expect(providers).toContain('linear');

    // Verify the URL detection works for both providers
    const jira = registry.getProjectManagement('jira');
    const linear = registry.getProjectManagement('linear');

    expect(jira!.isEpicUrl('https://site.atlassian.net/browse/PROJ-123')).toBe(true);
    expect(linear!.isEpicUrl('https://linear.app/team/issue/ABC-123')).toBe(true);

    // Verify cross-provider URL detection fails
    expect(jira!.isEpicUrl('https://linear.app/team/issue/ABC-123')).toBe(false);
    expect(linear!.isEpicUrl('https://site.atlassian.net/browse/PROJ-123')).toBe(false);
  });

  it('should handle plain text requirement when no PM provider is configured', () => {
    // When provider is 'none', no connector should be retrieved
    const connector = registry.getProjectManagement('none');
    expect(connector).toBeNull();
  });

  it('should allow fetching epic when provider matches URL', async () => {
    const jiraConnector = createMockPMConnector('jira');
    const mockEpic: ConnectorEpic = {
      key: 'PROJ-123',
      id: '10001',
      title: 'Test Epic',
      description: 'Test description',
      provider: 'jira',
    };

    (jiraConnector.isEpicUrl as any).mockReturnValue(true);
    (jiraConnector.parseEpicUrl as any).mockReturnValue({
      issueKey: 'PROJ-123',
      siteUrl: 'https://site.atlassian.net',
    } as ConnectorParsedEpicUrl);
    (jiraConnector.fetchEpic as any).mockResolvedValue(mockEpic);

    registry.registerProjectManagement('jira', () => jiraConnector);

    const connector = registry.getProjectManagement('jira');
    expect(connector).not.toBeNull();

    const url = 'https://site.atlassian.net/browse/PROJ-123';
    expect(connector!.isEpicUrl(url)).toBe(true);

    const epic = await connector!.fetchEpic(url);
    expect(epic).toEqual(mockEpic);
    expect(jiraConnector.fetchEpic).toHaveBeenCalledWith(url);
  });

  it('should list all registered PM providers', () => {
    const jiraConnector = createMockPMConnector('jira');
    const linearConnector = createMockPMConnector('linear');

    registry.registerProjectManagement('jira', () => jiraConnector);
    registry.registerProjectManagement('linear', () => linearConnector);

    const providers = registry.listProjectManagementProviders();
    expect(providers).toContain('jira');
    expect(providers).toContain('linear');
    expect(providers).toHaveLength(2);
  });

  it('should return null when checking unregistered provider', () => {
    const connector = registry.getProjectManagement('monday');
    expect(connector).toBeNull();
  });
});
