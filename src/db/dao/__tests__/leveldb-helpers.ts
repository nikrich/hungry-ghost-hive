import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Level } from 'level';

export interface TestLevelDb {
  db: Level<string, unknown>;
  cleanup: () => Promise<void>;
}

export async function createTestLevelDb(): Promise<TestLevelDb> {
  const dir = await mkdtemp(join(tmpdir(), 'hive-leveldb-'));
  const db = new Level<string, unknown>(dir, { valueEncoding: 'json' });
  await db.open();

  return {
    db,
    cleanup: async () => {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
