// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
}));

import { select } from '@inquirer/prompts';
import { runInitWizard } from './init-wizard.js';

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
      });
    });

    it('should use provided CLI flags', async () => {
      const result = await runInitWizard({
        nonInteractive: true,
        sourceControl: 'github',
        projectManagement: 'jira',
        autonomy: 'partial',
      });

      expect(result).toEqual({
        integrations: {
          source_control: { provider: 'github' },
          project_management: { provider: 'jira' },
          autonomy: { level: 'partial' },
        },
      });
    });

    it('should throw on invalid source control provider', async () => {
      await expect(
        runInitWizard({ nonInteractive: true, sourceControl: 'svn' }),
      ).rejects.toThrow('Invalid source control provider: "svn"');
    });

    it('should throw on invalid project management tool', async () => {
      await expect(
        runInitWizard({ nonInteractive: true, projectManagement: 'trello' }),
      ).rejects.toThrow('Invalid project management tool: "trello"');
    });

    it('should throw on invalid autonomy level', async () => {
      await expect(runInitWizard({ nonInteractive: true, autonomy: 'auto' })).rejects.toThrow(
        'Invalid autonomy level: "auto"',
      );
    });
  });

  describe('interactive mode', () => {
    it('should prompt for all three selections', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');

      const result = await runInitWizard();

      expect(mockSelect).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        integrations: {
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
          autonomy: { level: 'full' },
        },
      });
    });

    it('should pass through user selections', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('jira');
      mockSelect.mockResolvedValueOnce('partial');

      const result = await runInitWizard();

      expect(result).toEqual({
        integrations: {
          source_control: { provider: 'github' },
          project_management: { provider: 'jira' },
          autonomy: { level: 'partial' },
        },
      });
    });

    it('should configure source control prompt with correct choices', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');

      await runInitWizard();

      const firstCall = mockSelect.mock.calls[0][0];
      expect(firstCall.message).toBe('Source control provider');
      expect(firstCall.choices).toEqual([
        { name: 'GitHub', value: 'github' },
        { name: 'GitLab (coming soon)', value: 'gitlab', disabled: true },
        { name: 'Bitbucket (coming soon)', value: 'bitbucket', disabled: true },
      ]);
    });

    it('should configure project management prompt with correct choices', async () => {
      const mockSelect = vi.mocked(select);
      mockSelect.mockResolvedValueOnce('github');
      mockSelect.mockResolvedValueOnce('none');
      mockSelect.mockResolvedValueOnce('full');

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
  });
});
