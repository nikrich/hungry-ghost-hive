import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InitializationError } from '../errors/index.js';
import { createDatabase, queryAll, queryOne, run, withTransaction } from './client.js';

describe('createDatabase', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-db-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create a new database file', async () => {
    const dbPath = join(tempDir, 'new.db');
    const client = await createDatabase(dbPath);

    expect(client.db).toBeDefined();
    client.close();
  });

  it('should enable WAL journal mode', async () => {
    const dbPath = join(tempDir, 'wal.db');
    const client = await createDatabase(dbPath);

    const result = client.db.pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');

    client.close();
  });

  it('should enable foreign keys', async () => {
    const dbPath = join(tempDir, 'fk.db');
    const client = await createDatabase(dbPath);

    const result = client.db.pragma('foreign_keys') as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);

    client.close();
  });

  it('should run migrations and create core tables', async () => {
    const dbPath = join(tempDir, 'migrations.db');
    const client = await createDatabase(dbPath);

    // Core tables should exist after migrations
    const tables = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('teams');
    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('stories');
    expect(tableNames).toContain('requirements');
    expect(tableNames).toContain('migrations');

    client.close();
  });

  it('should throw InitializationError for invalid path', async () => {
    const dbPath = join(tempDir, 'nonexistent', 'subdir', 'deep', 'bad.db');

    await expect(createDatabase(dbPath)).rejects.toThrow(InitializationError);
  });

  it('should load an existing database file without data loss', async () => {
    const dbPath = join(tempDir, 'persist.db');

    // Create database and insert data
    const client1 = await createDatabase(dbPath);
    client1.db
      .prepare(
        "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('t1', 'https://example.com', '/tmp/repo', 'Test Team')"
      )
      .run();
    client1.close();

    // Reopen and verify data persists (better-sqlite3 auto-persists)
    const client2 = await createDatabase(dbPath);
    const team = client2.db.prepare("SELECT name FROM teams WHERE id = 't1'").get() as {
      name: string;
    };
    expect(team.name).toBe('Test Team');

    client2.close();
  });
});

describe('queryAll', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-db-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return all matching rows', async () => {
    const client = await createDatabase(join(tempDir, 'qa.db'));

    client.db
      .prepare(
        "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('t1', 'url1', '/p1', 'Team A')"
      )
      .run();
    client.db
      .prepare(
        "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('t2', 'url2', '/p2', 'Team B')"
      )
      .run();

    const rows = queryAll<{ id: string; name: string }>(
      client.db,
      'SELECT id, name FROM teams ORDER BY id'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('t1');
    expect(rows[1].id).toBe('t2');

    client.close();
  });

  it('should return empty array when no rows match', async () => {
    const client = await createDatabase(join(tempDir, 'empty.db'));
    const rows = queryAll(client.db, 'SELECT * FROM teams');
    expect(rows).toEqual([]);
    client.close();
  });
});

describe('queryOne', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-db-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return a single matching row', async () => {
    const client = await createDatabase(join(tempDir, 'qo.db'));
    client.db
      .prepare(
        "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('t1', 'url1', '/p1', 'Team A')"
      )
      .run();

    const row = queryOne<{ name: string }>(client.db, "SELECT name FROM teams WHERE id = ?", [
      't1',
    ]);
    expect(row?.name).toBe('Team A');

    client.close();
  });

  it('should return undefined when no row matches', async () => {
    const client = await createDatabase(join(tempDir, 'qo-miss.db'));
    const row = queryOne(client.db, "SELECT * FROM teams WHERE id = 'nonexistent'");
    expect(row).toBeUndefined();
    client.close();
  });
});

describe('run', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-db-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should execute a parameterized statement', async () => {
    const client = await createDatabase(join(tempDir, 'run.db'));

    run(client.db, "INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)", [
      't1',
      'url',
      '/path',
      'Team',
    ]);

    const row = queryOne<{ id: string }>(client.db, "SELECT id FROM teams WHERE id = 't1'");
    expect(row?.id).toBe('t1');

    client.close();
  });
});

describe('withTransaction', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-db-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should commit on success', async () => {
    const client = await createDatabase(join(tempDir, 'txn.db'));

    await withTransaction(client.db, () => {
      run(client.db, "INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)", [
        't1',
        'url',
        '/path',
        'Team',
      ]);
    });

    const row = queryOne<{ id: string }>(client.db, "SELECT id FROM teams WHERE id = 't1'");
    expect(row?.id).toBe('t1');

    client.close();
  });

  it('should rollback on failure', async () => {
    const client = await createDatabase(join(tempDir, 'txn-fail.db'));

    await expect(
      withTransaction(client.db, () => {
        run(client.db, "INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)", [
          't1',
          'url',
          '/path',
          'Team',
        ]);
        throw new Error('deliberate failure');
      })
    ).rejects.toThrow('deliberate failure');

    // Data should not be persisted after rollback
    const row = queryOne(client.db, "SELECT id FROM teams WHERE id = 't1'");
    expect(row).toBeUndefined();

    client.close();
  });

  it('should work without saveFn (backward compatible)', async () => {
    const client = await createDatabase(join(tempDir, 'txn-compat.db'));

    await withTransaction(client.db, () => {
      run(client.db, "INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)", [
        't1',
        'url',
        '/path',
        'Compat',
      ]);
    });

    const row = queryOne<{ name: string }>(client.db, "SELECT name FROM teams WHERE id = 't1'");
    expect(row?.name).toBe('Compat');

    client.close();
  });
});
