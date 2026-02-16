import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseCorruptionError } from '../errors/index.js';
import { createDatabase, withTransaction, withTransactionAndSave } from './client.js';

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
      type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa', 'feature_test')),
      team_id TEXT REFERENCES teams(id), tmux_session TEXT, model TEXT,
      status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'blocked', 'terminated')),
      current_story_id TEXT, memory_state TEXT, last_seen TIMESTAMP, worktree_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      submitted_by TEXT DEFAULT 'human',
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'planned', 'in_progress', 'completed', 'sign_off', 'sign_off_failed', 'sign_off_passed')),
      godmode BOOLEAN DEFAULT 0, feature_branch TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    const data = await createValidDbBuffer({
      withData: false,
      withPadding: true,
      withMigrations: false,
    });
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
    const data = await createValidDbBuffer({
      withData: false,
      withPadding: true,
      withMigrations: true,
    });
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
      const corruptData = await createValidDbBuffer({
        withData: false,
        withPadding: true,
        withMigrations: false,
      });
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
      const corruptData = await createValidDbBuffer({
        withData: false,
        withPadding: true,
        withMigrations: false,
      });
      writeFileSync(dbPath, Buffer.from(corruptData));

      // File stays corrupt — all 3 retries should fail
      await expect(createDatabase(dbPath)).rejects.toThrow(DatabaseCorruptionError);
      await expect(createDatabase(dbPath)).rejects.toThrow('zero rows in core tables');
    });
  });

  describe('withTransaction saveFn', () => {
    it('should call saveFn after successful commit', async () => {
      const dbPath = join(tempDir, 'txn-save.db');
      const client = await createDatabase(dbPath);
      let saveCalled = false;

      await withTransaction(
        client.db,
        () => {
          client.db.run("INSERT INTO migrations (name) VALUES ('test-txn')");
        },
        () => {
          saveCalled = true;
        }
      );

      expect(saveCalled).toBe(true);
      client.close();
    });

    it('should NOT call saveFn on rollback', async () => {
      const dbPath = join(tempDir, 'txn-no-save.db');
      const client = await createDatabase(dbPath);
      let saveCalled = false;

      await expect(
        withTransaction(
          client.db,
          () => {
            throw new Error('deliberate failure');
          },
          () => {
            saveCalled = true;
          }
        )
      ).rejects.toThrow('deliberate failure');

      expect(saveCalled).toBe(false);
      client.close();
    });

    it('should work without saveFn (backward compatible)', async () => {
      const dbPath = join(tempDir, 'txn-no-savefn.db');
      const client = await createDatabase(dbPath);

      const result = await withTransaction(client.db, () => {
        client.db.run("INSERT INTO migrations (name) VALUES ('test-compat')");
        return 42;
      });

      expect(result).toBe(42);
      client.close();
    });
  });

  describe('withTransactionAndSave', () => {
    it('should auto-save after successful commit', async () => {
      const dbPath = join(tempDir, 'txn-and-save.db');
      const client = await createDatabase(dbPath);
      let saveCalled = false;

      await withTransactionAndSave(
        client.db,
        () => {
          saveCalled = true;
        },
        () => {
          client.db.run("INSERT INTO migrations (name) VALUES ('test-and-save')");
        }
      );

      expect(saveCalled).toBe(true);
      client.close();
    });

    it('should NOT save on error', async () => {
      const dbPath = join(tempDir, 'txn-and-save-err.db');
      const client = await createDatabase(dbPath);
      let saveCalled = false;

      await expect(
        withTransactionAndSave(
          client.db,
          () => {
            saveCalled = true;
          },
          () => {
            throw new Error('transaction error');
          }
        )
      ).rejects.toThrow('transaction error');

      expect(saveCalled).toBe(false);
      client.close();
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

  describe('auto-merge flow persistence', () => {
    it('should persist PR status change to disk when saveFn is passed to withTransaction', async () => {
      const dbPath = join(tempDir, 'auto-merge-persist.db');
      const client = await createDatabase(dbPath);
      client.save(); // initial save to create file

      // Setup: Insert a team, story, and pull request
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status) VALUES ('s1', 't1', 'Test Story', 'desc', 'in_progress')"
      );
      client.db.run(
        "INSERT INTO pull_requests (id, story_id, team_id, branch_name, github_pr_number, status) VALUES ('pr1', 's1', 't1', 'feature/test', 100, 'approved')"
      );
      client.save();

      // Simulate auto-merge claim: atomically change PR status from approved to queued
      await withTransaction(
        client.db,
        () => {
          const currentPR = client.db.exec("SELECT status FROM pull_requests WHERE id = 'pr1'");
          expect(currentPR[0].values[0][0]).toBe('approved');
          client.db.run("UPDATE pull_requests SET status = 'queued' WHERE id = 'pr1'");
        },
        () => client.save()
      );

      // Verify the status persisted to disk by reading the file back
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);
      const result = diskDb.exec("SELECT status FROM pull_requests WHERE id = 'pr1'");
      expect(result[0].values[0][0]).toBe('queued');
      diskDb.close();

      client.close();
    });

    it('should persist merged status and story update atomically after successful merge', async () => {
      const dbPath = join(tempDir, 'auto-merge-merged.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status) VALUES ('s1', 't1', 'Test Story', 'desc', 'pr_submitted')"
      );
      client.db.run(
        "INSERT INTO pull_requests (id, story_id, team_id, branch_name, github_pr_number, status) VALUES ('pr1', 's1', 't1', 'feature/test', 100, 'queued')"
      );
      client.save();

      // Simulate merge completion: update PR and story atomically with disk persistence
      await withTransaction(
        client.db,
        () => {
          client.db.run("UPDATE pull_requests SET status = 'merged' WHERE id = 'pr1'");
          client.db.run("UPDATE stories SET status = 'merged' WHERE id = 's1'");
        },
        () => client.save()
      );

      // Verify both changes persisted to disk
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);

      const prResult = diskDb.exec("SELECT status FROM pull_requests WHERE id = 'pr1'");
      expect(prResult[0].values[0][0]).toBe('merged');

      const storyResult = diskDb.exec("SELECT status FROM stories WHERE id = 's1'");
      expect(storyResult[0].values[0][0]).toBe('merged');

      diskDb.close();
      client.close();
    });

    it('should NOT persist claim when merge fails and transaction rolls back', async () => {
      const dbPath = join(tempDir, 'auto-merge-rollback.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup: Create an approved PR
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO pull_requests (id, team_id, branch_name, github_pr_number, status) VALUES ('pr1', 't1', 'feature/test', 100, 'approved')"
      );
      client.save();

      let saveCallCount = 0;

      // Simulate a failed transaction: claim + merge in one transaction that throws
      await expect(
        withTransaction(
          client.db,
          () => {
            client.db.run("UPDATE pull_requests SET status = 'merged' WHERE id = 'pr1'");
            throw new Error('gh pr merge failed');
          },
          () => {
            saveCallCount++;
          }
        )
      ).rejects.toThrow('gh pr merge failed');

      // saveFn should NOT have been called
      expect(saveCallCount).toBe(0);

      // In-memory DB should have rolled back (PR still approved)
      const memResult = client.db.exec("SELECT status FROM pull_requests WHERE id = 'pr1'");
      expect(memResult[0].values[0][0]).toBe('approved');

      // Disk should still show approved (no save was called)
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);
      const diskResult = diskDb.exec("SELECT status FROM pull_requests WHERE id = 'pr1'");
      expect(diskResult[0].values[0][0]).toBe('approved');
      diskDb.close();

      client.close();
    });
  });

  describe('manager daemon persistence', () => {
    it('should persist escalation resolution via withTransaction + saveFn', async () => {
      const dbPath = join(tempDir, 'manager-escalation.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup: Create an escalation
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO agents (id, type, team_id, status) VALUES ('a1', 'senior', 't1', 'working')"
      );
      client.db.run(
        "INSERT INTO escalations (id, from_agent_id, reason, status) VALUES ('e1', 'a1', 'blocked on review', 'pending')"
      );
      client.save();

      // Simulate manager resolving stale escalations (as in manager/index.ts)
      await withTransaction(
        client.db,
        () => {
          client.db.run(
            "UPDATE escalations SET status = 'resolved', resolution = 'auto-resolved: stale' WHERE id = 'e1'"
          );
        },
        () => client.save()
      );

      // Verify persisted to disk
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);
      const result = diskDb.exec("SELECT status, resolution FROM escalations WHERE id = 'e1'");
      expect(result[0].values[0][0]).toBe('resolved');
      expect(result[0].values[0][1]).toBe('auto-resolved: stale');
      diskDb.close();

      client.close();
    });

    it('should persist QA story recovery via withTransaction + saveFn', async () => {
      const dbPath = join(tempDir, 'manager-qa-recovery.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup: Create stories in qa_failed state without assigned agents
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status, assigned_agent_id) VALUES ('s1', 't1', 'Fix bug', 'desc', 'qa_failed', NULL)"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status, assigned_agent_id) VALUES ('s2', 't1', 'Add feature', 'desc', 'qa_failed', NULL)"
      );
      client.save();

      // Simulate manager recovering unassigned qa_failed stories
      await withTransaction(
        client.db,
        () => {
          client.db.run(
            "UPDATE stories SET status = 'planned', assigned_agent_id = NULL WHERE id = 's1'"
          );
          client.db.run(
            "UPDATE stories SET status = 'planned', assigned_agent_id = NULL WHERE id = 's2'"
          );
        },
        () => client.save()
      );

      // Verify both stories were persisted as planned on disk
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);
      const result = diskDb.exec(
        "SELECT id, status FROM stories WHERE id IN ('s1', 's2') ORDER BY id"
      );
      expect(result[0].values).toHaveLength(2);
      expect(result[0].values[0][1]).toBe('planned');
      expect(result[0].values[1][1]).toBe('planned');
      diskDb.close();

      client.close();
    });

    it('should persist multiple sequential transactions each with their own save', async () => {
      const dbPath = join(tempDir, 'manager-sequential.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status) VALUES ('s1', 't1', 'Story 1', 'desc', 'draft')"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status) VALUES ('s2', 't1', 'Story 2', 'desc', 'draft')"
      );
      client.save();

      let saveCount = 0;
      const saveFn = () => {
        saveCount++;
        client.save();
      };

      // First transaction: update story 1
      await withTransaction(
        client.db,
        () => {
          client.db.run("UPDATE stories SET status = 'planned' WHERE id = 's1'");
        },
        saveFn
      );

      expect(saveCount).toBe(1);

      // Second transaction: update story 2
      await withTransaction(
        client.db,
        () => {
          client.db.run("UPDATE stories SET status = 'in_progress' WHERE id = 's2'");
        },
        saveFn
      );

      expect(saveCount).toBe(2);

      // Verify both changes persisted
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);
      const s1 = diskDb.exec("SELECT status FROM stories WHERE id = 's1'");
      const s2 = diskDb.exec("SELECT status FROM stories WHERE id = 's2'");
      expect(s1[0].values[0][0]).toBe('planned');
      expect(s2[0].values[0][0]).toBe('in_progress');
      diskDb.close();

      client.close();
    });
  });

  describe('scheduler atomicity', () => {
    it('should persist story assignment and agent status atomically via saveFn', async () => {
      const dbPath = join(tempDir, 'scheduler-assign.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup: Create team, agent, and planned story
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO agents (id, type, team_id, status, current_story_id) VALUES ('a1', 'senior', 't1', 'idle', NULL)"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status, assigned_agent_id) VALUES ('s1', 't1', 'Implement feature', 'desc', 'planned', NULL)"
      );
      client.save();

      // Simulate scheduler's assignStories pattern: update story + agent atomically
      await withTransaction(
        client.db,
        () => {
          client.db.run(
            "UPDATE stories SET assigned_agent_id = 'a1', status = 'in_progress' WHERE id = 's1'"
          );
          client.db.run(
            "UPDATE agents SET status = 'working', current_story_id = 's1' WHERE id = 'a1'"
          );
        },
        () => client.save()
      );

      // Verify both changes persisted atomically to disk
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);

      const storyResult = diskDb.exec(
        "SELECT status, assigned_agent_id FROM stories WHERE id = 's1'"
      );
      expect(storyResult[0].values[0][0]).toBe('in_progress');
      expect(storyResult[0].values[0][1]).toBe('a1');

      const agentResult = diskDb.exec(
        "SELECT status, current_story_id FROM agents WHERE id = 'a1'"
      );
      expect(agentResult[0].values[0][0]).toBe('working');
      expect(agentResult[0].values[0][1]).toBe('s1');

      diskDb.close();
      client.close();
    });

    it('should roll back both story and agent changes on error (no disk write)', async () => {
      const dbPath = join(tempDir, 'scheduler-rollback.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO agents (id, type, team_id, status, current_story_id) VALUES ('a1', 'senior', 't1', 'idle', NULL)"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status, assigned_agent_id) VALUES ('s1', 't1', 'Test Story', 'desc', 'planned', NULL)"
      );
      client.save();

      let saveCalled = false;

      // Simulate a failed assignment (e.g., agent spawn failure after DB update)
      await expect(
        withTransaction(
          client.db,
          () => {
            client.db.run(
              "UPDATE stories SET assigned_agent_id = 'a1', status = 'in_progress' WHERE id = 's1'"
            );
            client.db.run(
              "UPDATE agents SET status = 'working', current_story_id = 's1' WHERE id = 'a1'"
            );
            throw new Error('agent spawn failed');
          },
          () => {
            saveCalled = true;
          }
        )
      ).rejects.toThrow('agent spawn failed');

      expect(saveCalled).toBe(false);

      // In-memory should be rolled back
      const memStory = client.db.exec(
        "SELECT status, assigned_agent_id FROM stories WHERE id = 's1'"
      );
      expect(memStory[0].values[0][0]).toBe('planned');
      expect(memStory[0].values[0][1]).toBeNull();

      const memAgent = client.db.exec(
        "SELECT status, current_story_id FROM agents WHERE id = 'a1'"
      );
      expect(memAgent[0].values[0][0]).toBe('idle');
      expect(memAgent[0].values[0][1]).toBeNull();

      // Disk should still show original state
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);
      const diskStory = diskDb.exec("SELECT status FROM stories WHERE id = 's1'");
      expect(diskStory[0].values[0][0]).toBe('planned');
      diskDb.close();

      client.close();
    });

    it('should support withTransactionAndSave for scheduler-style operations', async () => {
      const dbPath = join(tempDir, 'scheduler-and-save.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO agents (id, type, team_id, status) VALUES ('a1', 'senior', 't1', 'idle')"
      );
      client.db.run(
        "INSERT INTO stories (id, team_id, title, description, status) VALUES ('s1', 't1', 'Story', 'desc', 'planned')"
      );
      client.save();

      // Use withTransactionAndSave (convenience wrapper)
      await withTransactionAndSave(
        client.db,
        () => client.save(),
        () => {
          client.db.run(
            "UPDATE stories SET assigned_agent_id = 'a1', status = 'in_progress' WHERE id = 's1'"
          );
          client.db.run(
            "UPDATE agents SET status = 'working', current_story_id = 's1' WHERE id = 'a1'"
          );
        }
      );

      // Verify persisted to disk
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);

      const storyResult = diskDb.exec("SELECT status FROM stories WHERE id = 's1'");
      expect(storyResult[0].values[0][0]).toBe('in_progress');

      const agentResult = diskDb.exec("SELECT status FROM agents WHERE id = 'a1'");
      expect(agentResult[0].values[0][0]).toBe('working');

      diskDb.close();
      client.close();
    });

    it('should handle concurrent-safe optimistic locking pattern', async () => {
      const dbPath = join(tempDir, 'scheduler-optimistic.db');
      const client = await createDatabase(dbPath);
      client.save();

      // Setup: PR in approved state
      client.db.run(
        "INSERT INTO teams VALUES ('t1', 'https://github.com/test/repo.git', '/tmp/repo', 'Test', datetime('now'))"
      );
      client.db.run(
        "INSERT INTO pull_requests (id, team_id, branch_name, github_pr_number, status) VALUES ('pr1', 't1', 'feature/test', 100, 'approved')"
      );
      client.save();

      // Simulate optimistic locking: re-fetch status within transaction before updating
      let claimed = false;
      await withTransaction(
        client.db,
        () => {
          const currentPR = client.db.exec("SELECT status FROM pull_requests WHERE id = 'pr1'");
          if (currentPR[0].values[0][0] === 'approved') {
            client.db.run("UPDATE pull_requests SET status = 'queued' WHERE id = 'pr1'");
            claimed = true;
          }
        },
        () => client.save()
      );

      expect(claimed).toBe(true);

      // Second attempt should not claim (status is now queued)
      let claimedAgain = false;
      await withTransaction(
        client.db,
        () => {
          const currentPR = client.db.exec("SELECT status FROM pull_requests WHERE id = 'pr1'");
          if (currentPR[0].values[0][0] === 'approved') {
            client.db.run("UPDATE pull_requests SET status = 'queued' WHERE id = 'pr1'");
            claimedAgain = true;
          }
        },
        () => client.save()
      );

      expect(claimedAgain).toBe(false);

      // Verify disk still shows queued from first claim
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const diskDb = new SQL.Database(buffer);
      const result = diskDb.exec("SELECT status FROM pull_requests WHERE id = 'pr1'");
      expect(result[0].values[0][0]).toBe('queued');
      diskDb.close();

      client.close();
    });
  });
});
