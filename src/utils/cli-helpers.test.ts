// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/queries/agents.js', () => ({
  getAgentById: vi.fn(),
}));

vi.mock('../db/queries/pull-requests.js', () => ({
  getPullRequestById: vi.fn(),
}));

vi.mock('../db/queries/stories.js', () => ({
  getStoryById: vi.fn(),
}));

import { getAgentById } from '../db/queries/agents.js';
import { getPullRequestById } from '../db/queries/pull-requests.js';
import { getStoryById } from '../db/queries/stories.js';
import {
  requireAgent,
  requireAgentBySession,
  requirePullRequest,
  requireStory,
} from './cli-helpers.js';

const mockDb = {
  queryOne: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireStory', () => {
  it('returns the story when found', async () => {
    const story = { id: 'STORY-1', title: 'Test' };
    vi.mocked(getStoryById).mockResolvedValue(story as any);

    const result = await requireStory(mockDb, 'STORY-1');

    expect(result).toBe(story);
    expect(getStoryById).toHaveBeenCalledWith(mockDb, 'STORY-1');
  });

  it('exits with error when story not found', async () => {
    vi.mocked(getStoryById).mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    await expect(requireStory(mockDb, 'STORY-99')).rejects.toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Story not found: STORY-99'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('requireAgent', () => {
  it('returns the agent when found', async () => {
    const agent = { id: 'agent-1', type: 'senior' };
    vi.mocked(getAgentById).mockResolvedValue(agent as any);

    const result = await requireAgent(mockDb, 'agent-1');

    expect(result).toBe(agent);
    expect(getAgentById).toHaveBeenCalledWith(mockDb, 'agent-1');
  });

  it('exits with error when agent not found', async () => {
    vi.mocked(getAgentById).mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    await expect(requireAgent(mockDb, 'agent-99')).rejects.toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Agent not found: agent-99'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('requireAgentBySession', () => {
  it('returns the agent when session matches', async () => {
    const agent = { id: 'agent-1', tmux_session: 'hive-senior-team' };
    mockDb.queryOne.mockResolvedValue(agent as any);

    const result = await requireAgentBySession(mockDb, 'hive-senior-team');

    expect(result).toBe(agent);
    expect(mockDb.queryOne).toHaveBeenCalledWith(
      expect.stringContaining("status != 'terminated'"),
      ['hive-senior-team']
    );
  });

  it('exits with error when session not found', async () => {
    mockDb.queryOne.mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    await expect(requireAgentBySession(mockDb, 'unknown-session')).rejects.toThrow(
      'process.exit called'
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('No agent found with session: unknown-session')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('requirePullRequest', () => {
  it('returns the PR when found', async () => {
    const pr = { id: 'pr-1', branch_name: 'feature/test' };
    vi.mocked(getPullRequestById).mockResolvedValue(pr as any);

    const result = await requirePullRequest(mockDb, 'pr-1');

    expect(result).toBe(pr);
    expect(getPullRequestById).toHaveBeenCalledWith(mockDb, 'pr-1');
  });

  it('exits with error when PR not found', async () => {
    vi.mocked(getPullRequestById).mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    await expect(requirePullRequest(mockDb, 'pr-99')).rejects.toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PR not found: pr-99'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
