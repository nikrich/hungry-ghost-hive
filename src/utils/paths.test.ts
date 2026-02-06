import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as paths from './paths.js';
import { join } from 'path';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

import { existsSync as mockExistsSync } from 'fs';

const mockedExistsSync = vi.mocked(mockExistsSync);

describe('paths utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constants', () => {
    it('should have correct directory names', () => {
      expect(paths.HIVE_DIR_NAME).toBe('.hive');
      expect(paths.REPOS_DIR_NAME).toBe('repos');
      expect(paths.AGENTS_DIR_NAME).toBe('agents');
      expect(paths.LOGS_DIR_NAME).toBe('logs');
    });
  });

  describe('findHiveRoot', () => {
    it('should find .hive directory in current directory', () => {
      mockedExistsSync.mockReturnValueOnce(true);

      const result = paths.findHiveRoot('/test/project');

      expect(result).toBe('/test/project');
      expect(mockedExistsSync).toHaveBeenCalledWith('/test/project/.hive');
    });

    it('should find .hive directory in parent directories', () => {
      mockedExistsSync
        .mockReturnValueOnce(false) // /test/project/src/.hive
        .mockReturnValueOnce(false) // /test/project/.hive
        .mockReturnValueOnce(true);  // /test/.hive

      const result = paths.findHiveRoot('/test/project/src');

      expect(result).toBe('/test');
    });

    it('should return null if .hive not found anywhere', () => {
      mockedExistsSync.mockReturnValue(false);

      const result = paths.findHiveRoot('/test/project');

      expect(result).toBeNull();
    });

    it('should stop at root directory', () => {
      mockedExistsSync.mockReturnValue(false);

      const result = paths.findHiveRoot('/test/project/deep/nested/path');

      expect(result).toBeNull();
    });

    it('should use current working directory by default', () => {
      mockedExistsSync.mockReturnValueOnce(true);

      const result = paths.findHiveRoot();

      expect(result).toBeTruthy();
      expect(mockedExistsSync).toHaveBeenCalled();
    });

    it('should search parent directories starting from provided directory', () => {
      const callCount = { count: 0 };
      mockedExistsSync.mockImplementation(() => {
        callCount.count++;
        // Return true on the 3rd call (simulating finding .hive in grandparent)
        return callCount.count === 3;
      });

      const result = paths.findHiveRoot('/home/user/projects/myapp/src');

      expect(result).toBeTruthy();
      expect(mockedExistsSync).toHaveBeenCalled();
    });
  });

  describe('getHivePaths', () => {
    const rootDir = '/home/user/workspace';

    it('should return all standard paths', () => {
      const result = paths.getHivePaths(rootDir);

      expect(result).toEqual({
        root: rootDir,
        hiveDir: join(rootDir, '.hive'),
        dbPath: join(rootDir, '.hive', 'hive.db'),
        configPath: join(rootDir, '.hive', 'hive.config.yaml'),
        agentsDir: join(rootDir, '.hive', 'agents'),
        logsDir: join(rootDir, '.hive', 'logs'),
        reposDir: join(rootDir, 'repos'),
      });
    });

    it('should handle trailing slashes correctly', () => {
      const result = paths.getHivePaths('/home/user/workspace/');

      expect(result.hiveDir).toContain('.hive');
      expect(result.dbPath).toContain('hive.db');
      expect(result.configPath).toContain('hive.config.yaml');
    });

    it('should handle relative paths', () => {
      const result = paths.getHivePaths('./workspace');

      expect(result.root).toBe('./workspace');
      expect(result.hiveDir).toContain('.hive');
    });

    it('should have correct nested structure', () => {
      const result = paths.getHivePaths(rootDir);

      // Verify paths are properly nested
      expect(result.dbPath).toContain(result.hiveDir);
      expect(result.configPath).toContain(result.hiveDir);
      expect(result.agentsDir).toContain(result.hiveDir);
      expect(result.logsDir).toContain(result.hiveDir);
      expect(result.reposDir).not.toContain(result.hiveDir);
    });

    it('should use HIVE_DIR_NAME constant for hive directory', () => {
      const result = paths.getHivePaths(rootDir);

      expect(result.hiveDir).toBe(join(rootDir, paths.HIVE_DIR_NAME));
    });

    it('should use REPOS_DIR_NAME constant for repos directory', () => {
      const result = paths.getHivePaths(rootDir);

      expect(result.reposDir).toBe(join(rootDir, paths.REPOS_DIR_NAME));
    });

    it('should use AGENTS_DIR_NAME constant for agents directory', () => {
      const result = paths.getHivePaths(rootDir);

      expect(result.agentsDir).toContain(paths.AGENTS_DIR_NAME);
    });

    it('should use LOGS_DIR_NAME constant for logs directory', () => {
      const result = paths.getHivePaths(rootDir);

      expect(result.logsDir).toContain(paths.LOGS_DIR_NAME);
    });
  });

  describe('isHiveWorkspace', () => {
    it('should return true if .hive directory exists', () => {
      mockedExistsSync.mockReturnValueOnce(true);

      const result = paths.isHiveWorkspace('/test/project');

      expect(result).toBe(true);
      expect(mockedExistsSync).toHaveBeenCalledWith('/test/project/.hive');
    });

    it('should return false if .hive directory does not exist', () => {
      mockedExistsSync.mockReturnValueOnce(false);

      const result = paths.isHiveWorkspace('/test/project');

      expect(result).toBe(false);
    });

    it('should check for .hive in the exact directory provided', () => {
      mockedExistsSync.mockReturnValueOnce(true);

      paths.isHiveWorkspace('/home/user/myworkspace');

      expect(mockedExistsSync).toHaveBeenCalledWith('/home/user/myworkspace/.hive');
    });

    it('should handle paths with trailing slashes', () => {
      mockedExistsSync.mockReturnValueOnce(false);

      const result = paths.isHiveWorkspace('/test/project/');

      expect(result).toBe(false);
      expect(mockedExistsSync).toHaveBeenCalled();
    });

    it('should handle relative paths', () => {
      mockedExistsSync.mockReturnValueOnce(true);

      const result = paths.isHiveWorkspace('.');

      expect(result).toBe(true);
      expect(mockedExistsSync).toHaveBeenCalledWith('.hive');
    });
  });

  describe('interface HivePaths', () => {
    it('should have all required properties', () => {
      const rootDir = '/test';
      const result = paths.getHivePaths(rootDir);

      expect(result).toHaveProperty('root');
      expect(result).toHaveProperty('hiveDir');
      expect(result).toHaveProperty('dbPath');
      expect(result).toHaveProperty('configPath');
      expect(result).toHaveProperty('agentsDir');
      expect(result).toHaveProperty('logsDir');
      expect(result).toHaveProperty('reposDir');
    });

    it('should have properties of correct types', () => {
      const rootDir = '/test';
      const result = paths.getHivePaths(rootDir);

      expect(typeof result.root).toBe('string');
      expect(typeof result.hiveDir).toBe('string');
      expect(typeof result.dbPath).toBe('string');
      expect(typeof result.configPath).toBe('string');
      expect(typeof result.agentsDir).toBe('string');
      expect(typeof result.logsDir).toBe('string');
      expect(typeof result.reposDir).toBe('string');
    });
  });
});
