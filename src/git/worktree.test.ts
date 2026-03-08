// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeWorktree } from './worktree.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}));

import { execSync } from 'child_process';
import { existsSync } from 'fs';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
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

  it('should return success without running git when worktree path does not exist on disk', () => {
    mockExistsSync.mockReturnValue(false);

    const result = removeWorktree('/root', 'repos/team-agent-stale');

    expect(result.success).toBe(true);
    expect(result.fullWorktreePath).toBe('/root/repos/team-agent-stale');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('should log debug message when path missing and HIVE_DEBUG is set', () => {
    mockExistsSync.mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.HIVE_DEBUG = '1';

    removeWorktree('/root', 'repos/team-agent-stale');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('does not exist on disk, skipping removal')
    );

    delete process.env.HIVE_DEBUG;
    consoleSpy.mockRestore();
  });

  it('should not log when path missing and HIVE_DEBUG is not set', () => {
    mockExistsSync.mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.HIVE_DEBUG;

    removeWorktree('/root', 'repos/team-agent-stale');

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
