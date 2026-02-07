// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeWorktree } from './worktree.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('removeWorktree', () => {
  it('should return success when worktree is removed', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));

    const result = removeWorktree('/root', 'repos/team-agent-1');

    expect(result.success).toBe(true);
    expect(result.fullWorktreePath).toBe('/root/repos/team-agent-1');
    expect(result.error).toBeUndefined();
    expect(mockExecSync).toHaveBeenCalledWith(
      'git worktree remove "/root/repos/team-agent-1" --force',
      { cwd: '/root', stdio: 'pipe', timeout: 30000 }
    );
  });

  it('should return success for empty worktree path without running git', () => {
    const result = removeWorktree('/root', '');

    expect(result.success).toBe(true);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('should return failure with error message on git error', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = removeWorktree('/root', 'repos/team-agent-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied');
    expect(result.fullWorktreePath).toBe('/root/repos/team-agent-1');
  });

  it('should use custom timeout when provided', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));

    removeWorktree('/root', 'repos/team-agent-1', { timeout: 60000 });

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 60000 })
    );
  });

  it('should use default 30s timeout when not specified', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));

    removeWorktree('/root', 'repos/team-agent-1');

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 30000 })
    );
  });

  it('should handle non-Error thrown objects', () => {
    mockExecSync.mockImplementation(() => {
      throw 'string error';
    });

    const result = removeWorktree('/root', 'repos/team-agent-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });
});
