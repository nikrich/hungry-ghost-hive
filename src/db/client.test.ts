import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseCorruptionError, ReadOnlyAccessError } from '../errors/index.js';
import { createDatabase, createReadOnlyDatabase } from './client.js';

/**
 * Helper to create a valid SQLite database buffer with the core schema
 * that is compatible with runMigrations().
 */
async function createValidDbBuffer(
  opts: { withData?: boolean; withPadding?: boolean; withMigrations?: boolean } = {}
): Promise<Uint8Array> {
  const withMigrations = opts.withMigrations !== false; // default true
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Use a schema that matches the initial migration so runMigrations works
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY, repo_url TEXT NOT NULL, repo_path TEXT NOT NULL,
      name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa')),
      team_id TEXT REFERENCES teams(id), tmux_session TEXT, model TEXT,
      status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'blocked', 'terminated')),
      current_story_id TEXT, memory_state TEXT, last_seen TIMESTAMP, worktree_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      submitted_by TEXT DEFAULT 'human',
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'planned', 'in_progress', 'completed')),
      godmode BOOLEAN DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY, requirement_id TEXT REFERENCES requirements(id),
      team_id TEXT REFERENCES teams(id), title TEXT NOT NULL, description TEXT NOT NULL,
      acceptance_criteria TEXT,
      complexity_score INTEGER CHECK (complexity_score BETWEEN 1 AND 13),
      story_points INTEGER,
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','estimated','planned','in_progress','review','qa','qa_failed','pr_submitted','merged')),
      assigned_agent_id TEXT REFERENCES agents(id), branch_name TEXT, pr_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS story_dependencies (
      story_id TEXT REFERENCES stories(id), depends_on_story_id TEXT REFERENCES stories(id),
      PRIMARY KEY (story_id, depends_on_story_id)
    );
    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL REFERENCES agents(id),
      story_id TEXT REFERENCES stories(id), event_type TEXT NOT NULL, status TEXT,
      message TEXT, metadata TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_story ON agent_logs(story_id);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(timestamp);
    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY, story_id TEXT REFERENCES stories(id),
      from_agent_id TEXT REFERENCES agents(id), to_agent_id TEXT REFERENCES agents(id),
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved')),
      resolution TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, resolved_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pull_requests (
      id TEXT PRIMARY KEY, story_id TEXT REFERENCES stories(id), team_id TEXT REFERENCES teams(id),
      branch_name TEXT NOT NULL, github_pr_number INTEGER, github_pr_url TEXT,
      submitted_by TEXT, reviewed_by TEXT,
      status TEXT DEFAULT 'queued' CHECK (status IN ('queued','reviewing','approved','merged','rejected','closed')),
      review_notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, from_session TEXT NOT NULL, to_session TEXT NOT NULL,
      subject TEXT, body TEXT NOT NULL, reply TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'replied')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, replied_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (withMigrations) {
    db.run(`
      INSERT INTO migrations (name) VALUES ('001-initial.sql');
      INSERT INTO migrations (name) VALUES ('002-add-agent-model.sql');
      INSERT INTO migrations (name) VALUES ('003-fix-pull-requests.sql');
      INSERT INTO migrations (name) VALUES ('004-add-messages.sql');
      INSERT INTO migrations (name) VALUES ('005-add-agent-last-seen.sql');
      INSERT INTO migrations (name) VALUES ('006-add-agent-worktree.sql');
      INSERT INTO migrations (name) VALUES ('007-add-indexes.sql');
      INSERT INTO migrations (name) VALUES ('008-add-godmode.sql');
      INSERT INTO migrations (name) VALUES ('009-add-pr-sync-indexes.sql');
    `);
  }

  if (opts.withData) {
    db.run(
      "INSERT INTO teams VALUES ('t1', 'https://example.com', '/tmp/repo', 'Test Team', datetime('now'))"
    );
  }

  if (opts.withPadding) {
    db.run('CREATE TABLE IF NOT EXISTS padding (id INTEGER PRIMARY KEY, data TEXT)');
    for (let i = 0; i < 500; i++) {
      db.run('INSERT INTO padding VALUES (?, ?)', [i, 'x'.repeat(100)]);
    }
  }

  const data = db.export();
  db.close();
  return data;
}

describe('createDatabase', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-db-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create a new database when no file exists', async () => {
    const dbPath = join(tempDir, 'new.db');
    const client = await createDatabase(dbPath);

    expect(client.db).toBeDefined();
    // New database should not auto-save to disk
    expect(existsSync(dbPath)).toBe(false);

    client.close();
  });

  it('should load an existing valid database file', async () => {
    const dbPath = join(tempDir, 'existing.db');

    const data = await createValidDbBuffer({ withData: true });
    writeFileSync(dbPath, Buffer.from(data));

    const client = await createDatabase(dbPath);
    const result = client.db.exec('SELECT COUNT(*) FROM teams');
    expect(result[0].values[0][0]).toBe(1);

    client.close();
  });

  it('should throw DatabaseCorruptionError when sql.js fails to parse buffer', async () => {
    const dbPath = join(tempDir, 'corrupt.db');

    // Write garbage data that is not valid SQLite
    const garbageBuffer = Buffer.alloc(100);
    garbageBuffer.write('NOT_A_SQLITE_DATABASE', 0);
    writeFileSync(dbPath, garbageBuffer);

    await expect(createDatabase(dbPath)).rejects.toThrow(DatabaseCorruptionError);
    await expect(createDatabase(dbPath)).rejects.toThrow('Failed to load database file');
  });

  it('should detect corruption when large file loads with empty core tables', async () => {
    const dbPath = join(tempDir, 'wiped.db');

    // Create a large database with padding but NO data in core tables and NO migrations
    // This simulates true corruption where sql.js loaded a partial file
    const data = await createValidDbBuffer({ withData: false, withPadding: true, withMigrations: false });
    writeFileSync(dbPath, Buffer.from(data));

    // Verify the file is >50KB
    expect(Buffer.from(data).length).toBeGreaterThan(50 * 1024);

    await expect(createDatabase(dbPath)).rejects.toThrow(DatabaseCorruptionError);
    await expect(createDatabase(dbPath)).rejects.toThrow('zero rows in core tables');
  });

  it('should NOT flag corruption when file is small (<50KB)', async () => {
    const dbPath = join(tempDir, 'small-empty.db');

    // Create an empty database (no tables yet — migrations will handle it)
    const SQL = await initSqlJs();
    const smallDb = new SQL.Database();
    const data = smallDb.export();
    smallDb.close();
    writeFileSync(dbPath, Buffer.from(data));

    // Verify the file is <50KB
    expect(Buffer.from(data).length).toBeLessThan(50 * 1024);

    // Should pass — small file skips corruption check, migrations create schema
    const client = await createDatabase(dbPath);
    expect(client.db).toBeDefined();
    client.close();
  });

  it('should NOT flag corruption when large file has migrations but no user data (fresh init)', async () => {
    const dbPath = join(tempDir, 'large-fresh.db');

    // Simulates hive init → add-repo: DB has schema + migrations but no teams/stories yet
    const data = await createValidDbBuffer({ withData: false, withPadding: true, withMigrations: true });
    writeFileSync(dbPath, Buffer.from(data));

    expect(Buffer.from(data).length).toBeGreaterThan(50 * 1024);

    // Should pass — migrations exist, so DB is properly initialized (just empty)
    const client = await createDatabase(dbPath);
    expect(client.db).toBeDefined();
    client.close();
  });

  it('should NOT flag corruption when large file has data in core tables', async () => {
    const dbPath = join(tempDir, 'large-valid.db');

    // Create a large database WITH data in core tables
    const data = await createValidDbBuffer({ withData: true, withPadding: true });
    writeFileSync(dbPath, Buffer.from(data));

    expect(Buffer.from(data).length).toBeGreaterThan(50 * 1024);

    // Should pass — core table has data
    const client = await createDatabase(dbPath);
    expect(client.db).toBeDefined();
    client.close();
  });

  describe('save() backup behavior', () => {
    it('should create a backup file before saving', async () => {
      const dbPath = join(tempDir, 'backup-test.db');
      const backupPath = dbPath + '.bak';

      const client = await createDatabase(dbPath);
      client.save(); // First save — creates the file, no prior file to back up

      expect(existsSync(dbPath)).toBe(true);

      // Save again — now a backup should be created from the existing file
      client.save();
      expect(existsSync(backupPath)).toBe(true);

      client.close();
    });

    it('should preserve backup content from the previous version', async () => {
      const dbPath = join(tempDir, 'backup-content.db');
      const backupPath = dbPath + '.bak';

      const client = await createDatabase(dbPath);
      client.db.run('CREATE TABLE IF NOT EXISTS test_data (val TEXT)');
      client.save(); // version 1

      const firstSaveContent = readFileSync(dbPath);

      // Modify and save again — version 2
      client.db.run("INSERT INTO test_data VALUES ('version2')");
      client.save();

      // Backup should contain version 1's content
      const backupContent = readFileSync(backupPath);
      expect(backupContent).toEqual(firstSaveContent);

      client.close();
    });

    it('should use atomic write (no leftover .tmp file after save)', async () => {
      const dbPath = join(tempDir, 'atomic-test.db');
      const tmpPath = dbPath + '.tmp';

      const client = await createDatabase(dbPath);
      client.save();

      // The temp file should not remain after save — it gets renamed to the target
      expect(existsSync(dbPath)).toBe(true);
      expect(existsSync(tmpPath)).toBe(false);

      client.close();
    });
  });

  describe('read-side retry on corruption', () => {
    it('should retry loading when file appears corrupted mid-write', async () => {
      const dbPath = join(tempDir, 'retry-test.db');

      // Write a large file with no core table data and no migrations — triggers corruption error
      const corruptData = await createValidDbBuffer({ withData: false, withPadding: true, withMigrations: false });
      writeFileSync(dbPath, Buffer.from(corruptData));

      // Schedule replacement with valid data before the retry fires (~100ms delay)
      const validData = await createValidDbBuffer({ withData: true, withPadding: true });
      setTimeout(() => {
        writeFileSync(dbPath, Buffer.from(validData));
      }, 50);

      // createDatabase should fail on first attempt, then succeed on retry
      const client = await createDatabase(dbPath);
      expect(client.db).toBeDefined();

      const result = client.db.exec('SELECT COUNT(*) FROM teams');
      expect(result[0].values[0][0]).toBe(1);

      client.close();
    });

    it('should throw after exhausting all retries', async () => {
      const dbPath = join(tempDir, 'retry-exhaust.db');

      // Write a persistently corrupt file (large but empty core tables and no migrations)
      const corruptData = await createValidDbBuffer({ withData: false, withPadding: true, withMigrations: false });
      writeFileSync(dbPath, Buffer.from(corruptData));

      // File stays corrupt — all 3 retries should fail
      await expect(createDatabase(dbPath)).rejects.toThrow(DatabaseCorruptionError);
      await expect(createDatabase(dbPath)).rejects.toThrow('zero rows in core tables');
    });
  });

  describe('auto-save removal', () => {
    it('should NOT auto-save after initialization of a new database', async () => {
      const dbPath = join(tempDir, 'no-autosave.db');

      await createDatabase(dbPath);

      // File should NOT exist because we removed the auto-save on init
      expect(existsSync(dbPath)).toBe(false);
    });

    it('should NOT auto-save when loading an existing database', async () => {
      const dbPath = join(tempDir, 'no-autosave-existing.db');

      const data = await createValidDbBuffer({ withData: true });
      writeFileSync(dbPath, Buffer.from(data));

      const originalContent = readFileSync(dbPath);

      // Loading should not modify the file on disk
      const client = await createDatabase(dbPath);

      const afterLoadContent = readFileSync(dbPath);
      expect(afterLoadContent).toEqual(originalContent);

      client.close();
    });
  });
});

describe('createReadOnlyDatabase', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-ro-db-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should load an existing database for reading', async () => {
    const dbPath = join(tempDir, 'readonly.db');
    const data = await createValidDbBuffer({ withData: true });
    writeFileSync(dbPath, Buffer.from(data));

    const client = await createReadOnlyDatabase(dbPath);
    const result = client.db.exec('SELECT COUNT(*) FROM teams');
    expect(result[0].values[0][0]).toBe(1);

    client.close();
  });

  it('should allow read queries via prepare/exec', async () => {
    const dbPath = join(tempDir, 'readonly-query.db');
    const data = await createValidDbBuffer({ withData: true });
    writeFileSync(dbPath, Buffer.from(data));

    const client = await createReadOnlyDatabase(dbPath);

    // exec should work for reads
    const result = client.db.exec('SELECT name FROM teams');
    expect(result[0].values[0][0]).toBe('Test Team');

    // prepare should work for reads
    const stmt = client.db.prepare('SELECT COUNT(*) as cnt FROM teams');
    stmt.step();
    const row = stmt.getAsObject();
    expect(row.cnt).toBe(1);
    stmt.free();

    client.close();
  });

  it('should throw ReadOnlyAccessError on db.run()', async () => {
    const dbPath = join(tempDir, 'readonly-run.db');
    const data = await createValidDbBuffer({ withData: true });
    writeFileSync(dbPath, Buffer.from(data));

    const client = await createReadOnlyDatabase(dbPath);

    expect(() => {
      client.db.run("INSERT INTO teams VALUES ('t2', 'url', '/path', 'Team2', datetime('now'))");
    }).toThrow(ReadOnlyAccessError);

    client.close();
  });

  it('should throw ReadOnlyAccessError on save()', async () => {
    const dbPath = join(tempDir, 'readonly-save.db');
    const data = await createValidDbBuffer({ withData: true });
    writeFileSync(dbPath, Buffer.from(data));

    const client = await createReadOnlyDatabase(dbPath);

    expect(() => client.save()).toThrow(ReadOnlyAccessError);

    client.close();
  });

  it('should throw ReadOnlyAccessError on runMigrations()', async () => {
    const dbPath = join(tempDir, 'readonly-migrations.db');
    const data = await createValidDbBuffer({ withData: true });
    writeFileSync(dbPath, Buffer.from(data));

    const client = await createReadOnlyDatabase(dbPath);

    expect(() => client.runMigrations()).toThrow(ReadOnlyAccessError);

    client.close();
  });

  it('should not modify the file on disk', async () => {
    const dbPath = join(tempDir, 'readonly-nowrite.db');
    const data = await createValidDbBuffer({ withData: true });
    writeFileSync(dbPath, Buffer.from(data));

    const originalContent = readFileSync(dbPath);

    const client = await createReadOnlyDatabase(dbPath);
    client.db.exec('SELECT * FROM teams');
    client.close();

    const afterContent = readFileSync(dbPath);
    expect(afterContent).toEqual(originalContent);
  });

  it('should create empty database when file does not exist', async () => {
    const dbPath = join(tempDir, 'nonexistent.db');
    const client = await createReadOnlyDatabase(dbPath);

    expect(client.db).toBeDefined();

    client.close();
  });

  it('should detect corruption same as createDatabase', async () => {
    const dbPath = join(tempDir, 'readonly-corrupt.db');
    const garbageBuffer = Buffer.alloc(100);
    garbageBuffer.write('NOT_A_SQLITE_DATABASE', 0);
    writeFileSync(dbPath, garbageBuffer);

    await expect(createReadOnlyDatabase(dbPath)).rejects.toThrow(DatabaseCorruptionError);
  });
});
