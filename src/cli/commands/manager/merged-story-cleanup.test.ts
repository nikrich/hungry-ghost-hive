// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { run } from '../../../db/client.js';
import { SqliteProvider } from '../../../db/provider.js';
import { createAgent, getAgentById, updateAgent } from '../../../db/queries/agents.js';
import { createTestDatabase } from '../../../db/queries/test-helpers.js';
import { cleanupAgentsReferencingMergedStory } from './merged-story-cleanup.js';

function insertStoryRow(
  db: SqliteProvider,
  input: {
    id: string;
    status: string;
    assignedAgentId?: string | null;
  }
): void {
  const now = new Date().toISOString();
  run(
    db.db,
    `
      INSERT INTO stories (id, title, description, status, assigned_agent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      `title-${input.id}`,
      `description-${input.id}`,
      input.status,
      input.assignedAgentId ?? null,
      now,
      now,
    ]
  );
}

describe('cleanupAgentsReferencingMergedStory', () => {
  it('clears stale merged-story pointers and reassigns to another active assigned story', async () => {
    const rawDb = await createTestDatabase();
    const db = new SqliteProvider(rawDb);

    const seniorA = await createAgent(db, { type: 'senior', tmuxSession: 'hive-senior-a' });
    const seniorB = await createAgent(db, { type: 'senior', tmuxSession: 'hive-senior-b' });
    const seniorTerminated = await createAgent(db, {
      type: 'senior',
      tmuxSession: 'hive-senior-c',
    });

    await updateAgent(db, seniorA.id, { status: 'working', currentStoryId: 'STORY-MERGED' });
    await updateAgent(db, seniorB.id, { status: 'working', currentStoryId: 'STORY-MERGED' });
    await updateAgent(db, seniorTerminated.id, {
      status: 'terminated',
      currentStoryId: 'STORY-MERGED',
    });

    insertStoryRow(db, { id: 'STORY-MERGED', status: 'merged' });
    insertStoryRow(db, {
      id: 'STORY-REVIEW',
      status: 'review',
      assignedAgentId: seniorA.id,
    });
    insertStoryRow(db, {
      id: 'STORY-PLANNED',
      status: 'planned',
      assignedAgentId: seniorA.id,
    });

    const result = await cleanupAgentsReferencingMergedStory(db, 'STORY-MERGED');

    expect(result).toEqual({ cleared: 2, reassigned: 1 });
    expect((await getAgentById(db, seniorA.id))?.current_story_id).toBe('STORY-REVIEW');
    expect((await getAgentById(db, seniorA.id))?.status).toBe('working');
    expect((await getAgentById(db, seniorB.id))?.current_story_id).toBeNull();
    expect((await getAgentById(db, seniorB.id))?.status).toBe('idle');
    expect((await getAgentById(db, seniorTerminated.id))?.current_story_id).toBe('STORY-MERGED');

    await db.close();
  });

  it('is a no-op when no non-terminated agent references the merged story', async () => {
    const rawDb = await createTestDatabase();
    const db = new SqliteProvider(rawDb);
    insertStoryRow(db, { id: 'STORY-MERGED', status: 'merged' });

    const result = await cleanupAgentsReferencingMergedStory(db, 'STORY-MERGED');

    expect(result).toEqual({ cleared: 0, reassigned: 0 });
    await db.close();
  });
});
