import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/client.js');
vi.mock('./paths.js');

import { getDatabase } from '../db/client.js';
import { findHiveRoot, getHivePaths } from './paths.js';
import { withHiveContext, withHiveRoot } from './with-hive-context.js';

describe('withHiveContext', () => {
  const mockDb = { db: {}, save: vi.fn(), close: vi.fn(), runMigrations: vi.fn() } as unknown as Awaited<ReturnType<typeof getDatabase>>;
  const mockPaths = { hiveDir: '/mock/.hive', reposDir: '/mock/repos' } as ReturnType<typeof getHivePaths>;

  beforeEach(() => {
    vi.mocked(findHiveRoot).mockReturnValue('/mock');
    vi.mocked(getHivePaths).mockReturnValue(mockPaths);
    vi.mocked(getDatabase).mockResolvedValue(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provides root, paths, and db to callback', async () => {
    await withHiveContext(ctx => {
      expect(ctx.root).toBe('/mock');
      expect(ctx.paths).toBe(mockPaths);
      expect(ctx.db).toBe(mockDb);
    });
  });

  it('returns the callback result', async () => {
    const result = await withHiveContext(() => 42);
    expect(result).toBe(42);
  });

  it('closes db after callback completes', async () => {
    await withHiveContext(() => {});
    expect(mockDb.close).toHaveBeenCalledOnce();
  });

  it('closes db even if callback throws', async () => {
    await expect(
      withHiveContext(() => {
        throw new Error('test');
      })
    ).rejects.toThrow('test');
    expect(mockDb.close).toHaveBeenCalledOnce();
  });

  it('works with async callbacks', async () => {
    const result = await withHiveContext(async () => {
      return Promise.resolve('async-result');
    });
    expect(result).toBe('async-result');
  });

  it('exits when not in a Hive workspace', async () => {
    vi.mocked(findHiveRoot).mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(withHiveContext(() => {})).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});

describe('withHiveRoot', () => {
  beforeEach(() => {
    vi.mocked(findHiveRoot).mockReturnValue('/mock');
    vi.mocked(getHivePaths).mockReturnValue({
      hiveDir: '/mock/.hive',
      reposDir: '/mock/repos',
    } as ReturnType<typeof getHivePaths>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provides root and paths to callback', () => {
    withHiveRoot(ctx => {
      expect(ctx.root).toBe('/mock');
      expect(ctx.paths.hiveDir).toBe('/mock/.hive');
    });
  });

  it('returns the callback result', () => {
    const result = withHiveRoot(() => 'sync-result');
    expect(result).toBe('sync-result');
  });

  it('exits when not in a Hive workspace', () => {
    vi.mocked(findHiveRoot).mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => withHiveRoot(() => {})).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
