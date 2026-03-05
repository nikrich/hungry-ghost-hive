// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/client.js', () => ({
  queryOne: vi.fn(),
}));

vi.mock('../db/queries/agents.js', () => ({
  getAgentById: vi.fn(),
}));

vi.mock('../db/queries/pull-requests.js', () => ({
  getPullRequestById: vi.fn(),
}));

vi.mock('../db/queries/stories.js', () => ({
  getStoryById: vi.fn(),
}));

import { queryOne } from '../db/client.js';
import { getAgentById } from '../db/queries/agents.js';
import { getPullRequestById } from '../db/queries/pull-requests.js';
import { getStoryById } from '../db/queries/stories.js';
import {
  requireAgent,
  requireAgentBySession,
  requirePullRequest,
  requireStory,
} from './cli-helpers.js';

const mockDb = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireStory', () => {
  it('returns the story when found', () => {
    const story = { id: 'STORY-1', title: 'Test' };
    vi.mocked(getStoryById).mockReturnValue(story as any);

    const result = requireStory(mockDb, 'STORY-1');

    expect(result).toBe(story);
    expect(getStoryById).toHaveBeenCalledWith(mockDb, 'STORY-1');
  });

  it('exits with error when story not found', () => {
    vi.mocked(getStoryById).mockReturnValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    expect(() => requireStory(mockDb, 'STORY-99')).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Story not found: STORY-99'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('requireAgent', () => {
  it('returns the agent when found', () => {
    const agent = { id: 'agent-1', type: 'senior' };
    vi.mocked(getAgentById).mockReturnValue(agent as any);

    const result = requireAgent(mockDb, 'agent-1');

    expect(result).toBe(agent);
    expect(getAgentById).toHaveBeenCalledWith(mockDb, 'agent-1');
  });

  it('exits with error when agent not found', () => {
    vi.mocked(getAgentById).mockReturnValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    expect(() => requireAgent(mockDb, 'agent-99')).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Agent not found: agent-99'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('requireAgentBySession', () => {
  it('returns the agent when session matches', () => {
    const agent = { id: 'agent-1', tmux_session: 'hive-senior-team' };
    vi.mocked(queryOne).mockReturnValue(agent as any);

    const result = requireAgentBySession(mockDb, 'hive-senior-team');

    expect(result).toBe(agent);
    expect(queryOne).toHaveBeenCalledWith(
      mockDb,
      expect.stringContaining("status != 'terminated'"),
      ['hive-senior-team']
    );
  });

  it('exits with error when session not found', () => {
    vi.mocked(queryOne).mockReturnValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    expect(() => requireAgentBySession(mockDb, 'unknown-session')).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('No agent found with session: unknown-session')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('requirePullRequest', () => {
  it('returns the PR when found', () => {
    const pr = { id: 'pr-1', branch_name: 'feature/test' };
    vi.mocked(getPullRequestById).mockReturnValue(pr as any);

    const result = requirePullRequest(mockDb, 'pr-1');

    expect(result).toBe(pr);
    expect(getPullRequestById).toHaveBeenCalledWith(mockDb, 'pr-1');
  });

  it('exits with error when PR not found', () => {
    vi.mocked(getPullRequestById).mockReturnValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    expect(() => requirePullRequest(mockDb, 'pr-99')).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PR not found: pr-99'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
