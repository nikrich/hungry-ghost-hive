import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('./paths.js', () => ({
  findHiveRoot: vi.fn(),
  getHivePaths: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  getDatabase: vi.fn(),
}));

vi.mock('chalk', () => ({
  default: {
    red: (s: string) => s,
  },
}));

import { getDatabase } from '../db/client.js';
import { findHiveRoot, getHivePaths } from './paths.js';
import { withHiveContext, withHiveRoot } from './with-hive-context.js';

const mockedFindHiveRoot = vi.mocked(findHiveRoot);
const mockedGetHivePaths = vi.mocked(getHivePaths);
const mockedGetDatabase = vi.mocked(getDatabase);

const mockPaths = {
  root: '/test/workspace',
  hiveDir: '/test/workspace/.hive',
  dbPath: '/test/workspace/.hive/hive.db',
  configPath: '/test/workspace/.hive/hive.config.yaml',
  agentsDir: '/test/workspace/.hive/agents',
  logsDir: '/test/workspace/.hive/logs',
  reposDir: '/test/workspace/repos',
};

const mockDb = {
  db: {} as import('sql.js').Database,
  close: vi.fn(),
  save: vi.fn(),
  runMigrations: vi.fn(),
};

describe('withHiveContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFindHiveRoot.mockReturnValue('/test/workspace');
    mockedGetHivePaths.mockReturnValue(mockPaths);
    mockedGetDatabase.mockResolvedValue(mockDb);
  });

  it('should provide root, paths, and db to the handler', async () => {
    await withHiveContext(async (ctx) => {
      expect(ctx.root).toBe('/test/workspace');
      expect(ctx.paths).toBe(mockPaths);
      expect(ctx.db).toBe(mockDb);
    });
  });

  it('should return the handler result', async () => {
    const result = await withHiveContext(async () => 42);
    expect(result).toBe(42);
  });

  it('should close the database after the handler completes', async () => {
    await withHiveContext(async () => 'done');
    expect(mockDb.close).toHaveBeenCalledOnce();
  });

  it('should close the database even if the handler throws', async () => {
    await expect(
      withHiveContext(async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
    expect(mockDb.close).toHaveBeenCalledOnce();
  });

  it('should call process.exit(1) when not in a Hive workspace', async () => {
    mockedFindHiveRoot.mockReturnValue(null);
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(withHiveContext(async () => {})).rejects.toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Not in a Hive workspace'),
    );

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('should work with synchronous handlers', async () => {
    const result = await withHiveContext(() => 'sync-result');
    expect(result).toBe('sync-result');
    expect(mockDb.close).toHaveBeenCalledOnce();
  });
});

describe('withHiveRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFindHiveRoot.mockReturnValue('/test/workspace');
    mockedGetHivePaths.mockReturnValue(mockPaths);
  });

  it('should provide root and paths to the handler', () => {
    withHiveRoot((ctx) => {
      expect(ctx.root).toBe('/test/workspace');
      expect(ctx.paths).toBe(mockPaths);
    });
  });

  it('should return the handler result', () => {
    const result = withHiveRoot(() => 'hello');
    expect(result).toBe('hello');
  });

  it('should not open a database connection', () => {
    withHiveRoot(() => {});
    expect(mockedGetDatabase).not.toHaveBeenCalled();
  });

  it('should call process.exit(1) when not in a Hive workspace', () => {
    mockedFindHiveRoot.mockReturnValue(null);
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => withHiveRoot(() => {})).toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Not in a Hive workspace'),
    );

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});
