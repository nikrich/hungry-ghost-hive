import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';

describe('createDatabase', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `hive-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create a new database when file does not exist', async () => {
    const dbPath = join(testDir, 'new.db');
    const client = await createDatabase(dbPath);

    // DB should be usable
    const result = client.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = result[0].values.map(v => v[0]);
    expect(tableNames).toContain('teams');
    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('stories');

    // File should NOT be written yet (no auto-save on init)
    expect(existsSync(dbPath)).toBe(false);

    client.db.close();
  });

  it('should load an existing valid database', async () => {
    const dbPath = join(testDir, 'existing.db');

    // Create and populate a DB file first
    const client1 = await createDatabase(dbPath);
    client1.db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('t1', 'https://example.com', '/path', 'Test')"
    );
    client1.save();
    client1.db.close();

    // Reload it
    const client2 = await createDatabase(dbPath);
    const result = client2.db.exec("SELECT COUNT(*) FROM teams");
    expect(Number(result[0].values[0][0])).toBe(1);
    client2.db.close();
  });

  it('should throw on corrupt buffer when SqlJs.Database constructor fails', async () => {
    const dbPath = join(testDir, 'corrupt.db');
    // Write garbage data that sql.js cannot parse
    writeFileSync(dbPath, Buffer.from('this is not a valid sqlite database'));

    await expect(createDatabase(dbPath)).rejects.toThrow(/Failed to load database/);
  });

  it('should throw when large file loads as empty database (data wipe protection)', async () => {
    const dbPath = join(testDir, 'wiped.db');

    // Simulate the real scenario: a valid sqlite DB that has the core table schemas
    // but zero rows in teams/agents/stories, yet is >50KB (e.g. from a blob table).
    // This mimics what happens when sql.js silently returns an empty DB from a corrupt buffer.
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        repo_url TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        team_id TEXT,
        status TEXT DEFAULT 'idle',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS _padding (
        id INTEGER PRIMARY KEY,
        data BLOB
      );
    `);
    db.run("INSERT INTO migrations (name) VALUES ('001-initial.sql')");
    // Insert blob data to push file size over 50KB, but leave core tables empty
    db.run("INSERT INTO _padding (id, data) VALUES (1, zeroblob(60000))");

    const data = db.export();
    const buffer = Buffer.from(data);
    db.close();

    expect(buffer.length).toBeGreaterThan(50 * 1024);
    writeFileSync(dbPath, buffer);

    await expect(createDatabase(dbPath)).rejects.toThrow(/integrity check failed/);
  });

  it('should write backup before saving', async () => {
    const dbPath = join(testDir, 'backup-test.db');
    const bakPath = dbPath + '.bak';

    // Create initial DB
    const client1 = await createDatabase(dbPath);
    client1.db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('t1', 'https://example.com', '/path', 'Team1')"
    );
    client1.save();
    client1.db.close();

    // Reload and modify
    const client2 = await createDatabase(dbPath);
    client2.db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('t2', 'https://example.com', '/path2', 'Team2')"
    );
    client2.save();

    // Backup file should exist and contain the original data (1 team)
    expect(existsSync(bakPath)).toBe(true);

    const SQL = await initSqlJs();
    const bakBuffer = readFileSync(bakPath);
    const bakDb = new SQL.Database(bakBuffer);
    const result = bakDb.exec('SELECT COUNT(*) FROM teams');
    expect(Number(result[0].values[0][0])).toBe(1);
    bakDb.close();

    // Current DB should have 2 teams
    const result2 = client2.db.exec('SELECT COUNT(*) FROM teams');
    expect(Number(result2[0].values[0][0])).toBe(2);
    client2.db.close();
  });

  it('should not auto-save on init for existing databases', async () => {
    const dbPath = join(testDir, 'no-autosave.db');

    // Create a DB with data
    const client1 = await createDatabase(dbPath);
    client1.db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('t1', 'https://example.com', '/path', 'Team1')"
    );
    client1.save();
    const originalData = readFileSync(dbPath);
    client1.db.close();

    // Reload - should NOT overwrite the file
    const client2 = await createDatabase(dbPath);
    const afterLoadData = readFileSync(dbPath);

    // File should be unchanged (no auto-save on init)
    expect(Buffer.compare(originalData, afterLoadData)).toBe(0);
    client2.db.close();
  });

  it('should allow small databases with no data (fresh setup)', async () => {
    const dbPath = join(testDir, 'small-empty.db');

    // Create a small empty DB file (<50KB threshold)
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const data = db.export();
    const buffer = Buffer.from(data);
    db.close();

    // Should be well under 50KB
    expect(buffer.length).toBeLessThan(50 * 1024);
    writeFileSync(dbPath, buffer);

    // Should NOT throw - small files are allowed to be empty
    const client = await createDatabase(dbPath);
    expect(client.db).toBeDefined();
    client.db.close();
  });
});
