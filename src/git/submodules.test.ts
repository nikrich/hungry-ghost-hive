// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as submodules from './submodules.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

import { execa as mockExeca } from 'execa';
import { existsSync as mockExistsSync } from 'fs';

const mockedExeca = vi.mocked(mockExeca);
const mockedExistsSync = vi.mocked(mockExistsSync);

describe('submodules module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addSubmodule', () => {
    const rootDir = '/test/repo';
    const url = 'https://github.com/test/submodule.git';
    const path = 'libs/submodule';

    it('should add a submodule with default branch', async () => {
      mockedExistsSync.mockReturnValueOnce(false);
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Cloning into...',
        stderr: '',
      } as any);

      await submodules.addSubmodule(rootDir, url, path);

      expect(mockedExeca).toHaveBeenCalledWith(
        'git',
        ['submodule', 'add', '-f', '-b', 'main', url, path],
        { cwd: rootDir }
      );
    });

    it('should add a submodule with custom branch', async () => {
      mockedExistsSync.mockReturnValueOnce(false);
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Cloning into...',
        stderr: '',
      } as any);

      await submodules.addSubmodule(rootDir, url, path, 'develop');

      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('develop');
    });

    it('should throw error if path already exists', async () => {
      mockedExistsSync.mockReturnValueOnce(true);

      await expect(submodules.addSubmodule(rootDir, url, path)).rejects.toThrow(
        'Path already exists'
      );
    });
  });

  describe('initSubmodules', () => {
    const rootDir = '/test/repo';

    it('should initialize submodules', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Submodule(s) registered for path',
        stderr: '',
      } as any);

      await submodules.initSubmodules(rootDir);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['submodule', 'init'], {
        cwd: rootDir,
      });
    });

    it('should handle initialization error', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      await expect(submodules.initSubmodules(rootDir)).rejects.toThrow();
    });
  });

  describe('updateSubmodules', () => {
    const rootDir = '/test/repo';

    it('should update submodules recursively by default', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Submodule(s) updated',
        stderr: '',
      } as any);

      await submodules.updateSubmodules(rootDir);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['submodule', 'update', '--recursive'], {
        cwd: rootDir,
      });
    });

    it('should update submodules non-recursively when specified', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Submodule(s) updated',
        stderr: '',
      } as any);

      await submodules.updateSubmodules(rootDir, false);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['submodule', 'update'], { cwd: rootDir });
    });
  });

  describe('initAndUpdateSubmodules', () => {
    const rootDir = '/test/repo';

    it('should initialize and update submodules in one call', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Submodule(s) updated',
        stderr: '',
      } as any);

      await submodules.initAndUpdateSubmodules(rootDir);

      expect(mockedExeca).toHaveBeenCalledWith(
        'git',
        ['submodule', 'update', '--init', '--recursive'],
        { cwd: rootDir }
      );
    });
  });

  describe('removeSubmodule', () => {
    const rootDir = '/test/repo';
    const path = 'libs/submodule';

    it('should remove a submodule', async () => {
      mockedExeca
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

      await submodules.removeSubmodule(rootDir, path);

      expect(mockedExeca).toHaveBeenCalledTimes(2);
      expect(mockedExeca).toHaveBeenNthCalledWith(1, 'git', ['submodule', 'deinit', '-f', path], {
        cwd: rootDir,
      });
      expect(mockedExeca).toHaveBeenNthCalledWith(2, 'git', ['rm', '-f', path], { cwd: rootDir });
    });

    it('should handle removal errors', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: No submodule mapping found'));

      await expect(submodules.removeSubmodule(rootDir, path)).rejects.toThrow();
    });
  });

  describe('listSubmodules', () => {
    const rootDir = '/test/repo';

    it('should list all submodules with branch info', async () => {
      mockedExeca
        .mockResolvedValueOnce({
          stdout: ` abc1234 libs/submodule1 (heads/main)
 def5678 libs/submodule2 (heads/develop)`,
          stderr: '',
        } as any)
        .mockResolvedValueOnce({ stdout: 'https://github.com/test/sub1.git', stderr: '' } as any)
        .mockResolvedValueOnce({ stdout: 'https://github.com/test/sub2.git', stderr: '' } as any);

      const result = await submodules.listSubmodules(rootDir);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        path: 'libs/submodule1',
        url: 'https://github.com/test/sub1.git',
        branch: 'main',
        commit: 'abc1234',
      });
      expect(result[1]).toEqual({
        path: 'libs/submodule2',
        url: 'https://github.com/test/sub2.git',
        branch: 'develop',
        commit: 'def5678',
      });
    });

    it('should list submodules without branch info', async () => {
      mockedExeca
        .mockResolvedValueOnce({
          stdout: ` abc1234 libs/submodule1`,
          stderr: '',
        } as any)
        .mockResolvedValueOnce({ stdout: 'https://github.com/test/sub1.git', stderr: '' } as any);

      const result = await submodules.listSubmodules(rootDir);

      expect(result).toHaveLength(1);
      expect(result[0].branch).toBeUndefined();
    });

    it('should return empty array when no submodules exist', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      const result = await submodules.listSubmodules(rootDir);

      expect(result).toEqual([]);
    });

    it('should handle listing error and return empty array', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      const result = await submodules.listSubmodules(rootDir);

      expect(result).toEqual([]);
    });

    it('should handle submodules with +/- prefix for modified status', async () => {
      mockedExeca
        .mockResolvedValueOnce({
          stdout: `+abc1234 libs/submodule1 (heads/main)
-def5678 libs/submodule2`,
          stderr: '',
        } as any)
        .mockResolvedValueOnce({ stdout: 'https://github.com/test/sub1.git', stderr: '' } as any)
        .mockResolvedValueOnce({ stdout: 'https://github.com/test/sub2.git', stderr: '' } as any);

      const result = await submodules.listSubmodules(rootDir);

      expect(result).toHaveLength(2);
      expect(result[0].commit).toBe('abc1234');
      expect(result[1].commit).toBe('def5678');
    });
  });

  describe('getSubmoduleUrl', () => {
    const rootDir = '/test/repo';
    const path = 'libs/submodule';

    it('should get submodule URL', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'https://github.com/test/submodule.git\n',
        stderr: '',
      } as any);

      const result = await submodules.getSubmoduleUrl(rootDir, path);

      expect(result).toBe('https://github.com/test/submodule.git');
      expect(mockedExeca).toHaveBeenCalledWith(
        'git',
        ['config', '--file', '.gitmodules', 'submodule.libs/submodule.url'],
        { cwd: rootDir }
      );
    });

    it('should return empty string if URL not found', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('key not found in section'));

      const result = await submodules.getSubmoduleUrl(rootDir, path);

      expect(result).toBe('');
    });
  });

  describe('isSubmodule', () => {
    const rootDir = '/test/repo';

    it('should return true if path is a submodule', async () => {
      mockedExeca
        .mockResolvedValueOnce({
          stdout: ` abc1234 libs/submodule`,
          stderr: '',
        } as any)
        .mockResolvedValueOnce({ stdout: 'https://github.com/test/sub.git', stderr: '' } as any);

      const result = await submodules.isSubmodule(rootDir, 'libs/submodule');

      expect(result).toBe(true);
    });

    it('should return false if path is not a submodule', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      const result = await submodules.isSubmodule(rootDir, 'libs/notasubmodule');

      expect(result).toBe(false);
    });

    it('should return false if error listing submodules', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      const result = await submodules.isSubmodule(rootDir, 'libs/submodule');

      expect(result).toBe(false);
    });
  });

  describe('syncSubmodules', () => {
    const rootDir = '/test/repo';

    it('should sync submodule URLs', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Synchronizing submodule url',
        stderr: '',
      } as any);

      await submodules.syncSubmodules(rootDir);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['submodule', 'sync'], {
        cwd: rootDir,
      });
    });

    it('should handle sync error', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      await expect(submodules.syncSubmodules(rootDir)).rejects.toThrow();
    });
  });

  describe('fetchSubmodules', () => {
    const rootDir = '/test/repo';

    it('should fetch updates for all submodules', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Fetching submodule...',
        stderr: '',
      } as any);

      await submodules.fetchSubmodules(rootDir);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['submodule', 'foreach', 'git', 'fetch'], {
        cwd: rootDir,
      });
    });

    it('should handle fetch error', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: not a git repository'));

      await expect(submodules.fetchSubmodules(rootDir)).rejects.toThrow();
    });
  });
});
