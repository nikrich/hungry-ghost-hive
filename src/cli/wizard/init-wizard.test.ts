// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../../auth/jira-oauth.js', () => ({
  startJiraOAuthFlow: vi.fn(),
  storeJiraTokens: vi.fn(),
}));

vi.mock('../../auth/token-store.js', () => ({
  TokenStore: vi.fn(),
}));

vi.mock('./jira-setup.js', () => ({
  runJiraSetup: vi.fn(),
}));

vi.mock('../../utils/paths.js', () => ({
  getHivePaths: vi.fn().mockReturnValue({ hiveDir: '/tmp/test-hive' }),
}));

vi.mock('../../auth/env-store.js', () => ({
  writeEnvEntries: vi.fn(),
}));

vi.mock('../../connectors/bootstrap.js', () => ({
  bootstrapConnectors: vi.fn(),
}));

vi.mock('../../connectors/registry.js', () => ({
  registry: {
    listSourceControlProviders: vi.fn().mockReturnValue(['github']),
    listProjectManagementProviders: vi.fn().mockReturnValue(['jira']),
  },
}));

import { confirm, input, select } from '@inquirer/prompts';
import { startJiraOAuthFlow } from '../../auth/jira-oauth.js';
import { registry } from '../../connectors/registry.js';
import { runInitWizard } from './init-wizard.js';
import { runJiraSetup } from './jira-setup.js';

describe('Init Wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('non-interactive mode', () => {
    it('should return defaults when no flags are provided', async () => {
      const result = await runInitWizard({ nonInteractive: true });

      expect(result).toEqual({
        integrations: {
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
          autonomy: { level: 'full' },
        },
        agent_runtime: 'claude',
      });
    });

    it('should use provided CLI flags', async () => {
      const mockInput = vi.mocked(input);
      mockInput.mockResolvedValueOnce('test-client-id');
      mockInput.mockResolvedValueOnce('test-client-secret');
      vi.mocked(startJiraOAuthFlow).mockResolvedValueOnce({
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        cloudId: 'test-cloud',
        siteUrl: 'https://test.atlassian.net',
        expiresIn: 3600,
      });
      vi.mocked(runJiraSetup).mockResolvedValueOnce({
        jiraConfig: {
          project_key: 'TEST',
          site_url: 'https://test.atlassian.net',
          story_type: 'Story',
          subtask_type: 'Subtask',
          story_points_field: 'story_points',
          status_mapping: {},
        },
      });

      const result = await runInitWizard({
        nonInteractive: true,
        sourceControl: 'github',
        projectManagement: 'jira',
        autonomy: 'partial',
      });

      expect(result.integrations.source_control).toEqual({ provider: 'github' });
      expect(result.integrations.project_management.provider).toBe('jira');
      expect(result.integrations.autonomy).toEqual({ level: 'partial' });
      expect(result.agent_runtime).toBe('claude');
    });

    it('should throw on invalid source control provider', async () => {
      // Mock registry to return only 'github'
      vi.mocked(registry.listSourceControlProviders).mockReturnValueOnce(['github']);

      await expect(runInitWizard({ nonInteractive: true, sourceControl: 'svn' })).rejects.toThrow(
        'Invalid source control provider: "svn". Valid options: github'
      );
    });

    it('should throw on invalid project management tool', async () => {
      // Mock registry to return only 'jira'
      vi.mocked(registry.listProjectManagementProviders).mockReturnValueOnce(['jira']);

      await expect(
        runInitWizard({ nonInteractive: true, projectManagement: 'trello' })
      ).rejects.toThrow('Invalid project management tool: "trello". Valid options: none, jira');
    });

    it('should throw on invalid autonomy level', async () => {
      await expect(runInitWizard({ nonInteractive: true, autonomy: 'auto' })).rejects.toThrow(
        'Invalid autonomy level: "auto"'
      );
    });

    it('should throw on invalid agent runtime', async () => {
      await expect(runInitWizard({ nonInteractive: true, agentRuntime: 'gemini' })).rejects.toThrow(
        'Invalid agent runtime: "gemini". Valid options: claude, codex'
      );
    });
  });

  describe('interactive mode', () => {
    it('should prompt for all selections including E2E', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');
      mockSelect.mockResolvedValueOnce('claude');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const result = await runInitWizard();

      expect(mockSelect).toHaveBeenCalledTimes(4);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        integrations: {
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
          autonomy: { level: 'full' },
        },
        agent_runtime: 'claude',
      });
    });

    it('should include e2e_tests when user opts in', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');
      mockSelect.mockResolvedValueOnce('claude');
      vi.mocked(confirm).mockResolvedValueOnce(true);
      vi.mocked(input).mockResolvedValueOnce('./e2e');

      const result = await runInitWizard();

      expect(result.e2e_tests).toEqual({ path: './e2e' });
    });

    it('should not include e2e_tests when user declines', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');
      mockSelect.mockResolvedValueOnce('claude');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const result = await runInitWizard();

      expect(result.e2e_tests).toBeUndefined();
    });

    it('should pass through user selections', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('jira');
      mockSelect.mockResolvedValueOnce('partial');
      mockSelect.mockResolvedValueOnce('codex');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const mockInput = vi.mocked(input);
      mockInput.mockResolvedValueOnce('test-client-id');
      mockInput.mockResolvedValueOnce('test-client-secret');
      vi.mocked(startJiraOAuthFlow).mockResolvedValueOnce({
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        cloudId: 'test-cloud',
        siteUrl: 'https://test.atlassian.net',
        expiresIn: 3600,
      });
      vi.mocked(runJiraSetup).mockResolvedValueOnce({
        jiraConfig: {
          project_key: 'TEST',
          site_url: 'https://test.atlassian.net',
          story_type: 'Story',
          subtask_type: 'Subtask',
          story_points_field: 'story_points',
          status_mapping: {},
        },
      });

      const result = await runInitWizard();

      expect(result.integrations.source_control).toEqual({ provider: 'github' });
      expect(result.integrations.project_management.provider).toBe('jira');
      expect(result.integrations.autonomy).toEqual({ level: 'partial' });
      expect(result.agent_runtime).toBe('codex');
    });

    it('should configure source control prompt with choices from registry', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');
      mockSelect.mockResolvedValueOnce('claude');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      // Mock registry to return available providers
      vi.mocked(registry.listSourceControlProviders).mockReturnValueOnce(['github']);

      await runInitWizard();

      const firstCall = mockSelect.mock.calls[0][0];
      expect(firstCall.message).toBe('Source control provider');
      expect(firstCall.choices).toEqual([{ name: 'Github', value: 'github' }]);
    });

    it('should configure project management prompt with choices from registry', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');
      mockSelect.mockResolvedValueOnce('claude');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      // Mock registry to return available providers
      vi.mocked(registry.listProjectManagementProviders).mockReturnValueOnce(['jira']);

      await runInitWizard();

      const secondCall = mockSelect.mock.calls[1][0];
      expect(secondCall.message).toBe('Project management tool');
      expect(secondCall.choices).toEqual([
        { name: 'None', value: 'none' },
        { name: 'Jira', value: 'jira' },
      ]);
    });

    it('should configure autonomy prompt with correct choices', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');
      mockSelect.mockResolvedValueOnce('claude');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await runInitWizard();

      const thirdCall = mockSelect.mock.calls[2][0] as {
        message: string;
        choices: { name: string; value: string }[];
      };
      expect(thirdCall.message).toBe('Agent autonomy level');
      expect(thirdCall.choices).toHaveLength(2);
      expect(thirdCall.choices[0].value).toBe('full');
      expect(thirdCall.choices[1].value).toBe('partial');
    });

    it('should configure agent runtime prompt with claude/codex choices', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');
      mockSelect.mockResolvedValueOnce('claude');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await runInitWizard();

      const fourthCall = mockSelect.mock.calls[3][0] as {
        message: string;
        choices: { name: string; value: string }[];
      };
      expect(fourthCall.message).toBe('Agent runtime');
      expect(fourthCall.choices).toEqual([
        { name: 'Claude', value: 'claude' },
        { name: 'Codex', value: 'codex' },
      ]);
    });
  });

  describe('e2e_tests non-interactive', () => {
    it('should include e2e_tests when e2eTestPath is provided', async () => {
      const result = await runInitWizard({
        nonInteractive: true,
        e2eTestPath: './tests/e2e',
      });

      expect(result.e2e_tests).toEqual({ path: './tests/e2e' });
    });

    it('should not include e2e_tests when e2eTestPath is not provided', async () => {
      const result = await runInitWizard({ nonInteractive: true });

      expect(result.e2e_tests).toBeUndefined();
    });
  });
});
