// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '../../../db/queries/agents.js';
import { createEscalation } from '../../../db/queries/escalations.js';
import { createTeam } from '../../../db/queries/teams.js';
import { createTestDatabase } from '../../../db/queries/test-helpers.js';
import { updateEscalationsPanel } from './escalations.js';

function createMockList() {
  const calls: string[] = [];
  return {
    calls,
    clearItems: vi.fn(() => calls.push('clearItems')),
    setItems: vi.fn((_items: string[]) => calls.push('setItems')),
  };
}

describe('updateEscalationsPanel', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  it('should call clearItems before setItems when there are escalations', async () => {
    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'repos/test-repo',
      name: 'test-team',
    });
    const agent = createAgent(db, { type: 'senior', teamId: team.id });
    createEscalation(db, {
      fromAgentId: agent.id,
      reason: 'Need help with this task',
    });

    const mockList = createMockList();
    await updateEscalationsPanel(mockList as never, db);

    expect(mockList.calls).toEqual(['clearItems', 'setItems']);
  });

  it('should call clearItems before setItems when there are no escalations', async () => {
    const mockList = createMockList();
    await updateEscalationsPanel(mockList as never, db);

    expect(mockList.calls).toEqual(['clearItems', 'setItems']);
  });
});
