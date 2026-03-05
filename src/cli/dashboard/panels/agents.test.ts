// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '../../../db/queries/agents.js';
import { createTeam } from '../../../db/queries/teams.js';
import { createTestDatabase } from '../../../db/queries/test-helpers.js';
import { updateAgentsPanel } from './agents.js';

// Mock getHiveSessions to avoid tmux dependency in tests
vi.mock('../../../tmux/manager.js', () => ({
  getHiveSessions: vi.fn().mockResolvedValue([]),
}));

// Mock config loader to avoid filesystem dependency
vi.mock('../../../config/loader.js', () => ({
  loadConfig: vi.fn().mockReturnValue({ models: {} }),
}));

// Mock paths to avoid filesystem dependency
vi.mock('../../../utils/paths.js', () => ({
  findHiveRoot: vi.fn().mockReturnValue('/fake/root'),
  getHivePaths: vi.fn().mockReturnValue({ hiveDir: '/fake/root/.hive' }),
}));

function createMockList() {
  const calls: string[] = [];
  const items: string[] = [];
  return {
    calls,
    items,
    clearItems: vi.fn(() => {
      calls.push('clearItems');
      items.length = 0;
    }),
    setItems: vi.fn((newItems: string[]) => {
      calls.push('setItems');
      items.length = 0;
      items.push(...newItems);
    }),
    select: vi.fn(),
    selected: 0,
  };
}

describe('updateAgentsPanel', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  it('should call clearItems before setItems when there are agents', async () => {
    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'repos/test-repo',
      name: 'test-team',
    });
    createAgent(db, { type: 'senior', teamId: team.id, tmuxSession: 'hive-senior-1' });

    const mockList = createMockList();
    await updateAgentsPanel(mockList as never, db);

    // Verify clearItems is called before setItems
    expect(mockList.calls).toEqual(['clearItems', 'setItems']);
  });

  it('should call clearItems before setItems when there are no agents', async () => {
    const mockList = createMockList();
    await updateAgentsPanel(mockList as never, db);

    // Even with no agents, clearItems should be called before setItems
    expect(mockList.calls).toEqual(['clearItems', 'setItems']);
  });

  it('should restore selection position after update', async () => {
    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'repos/test-repo',
      name: 'test-team',
    });
    createAgent(db, { type: 'senior', teamId: team.id, tmuxSession: 'hive-senior-1' });
    createAgent(db, { type: 'intermediate', teamId: team.id, tmuxSession: 'hive-intermediate-1' });

    const mockList = createMockList();
    mockList.selected = 2; // Simulate user has selected 2nd row
    await updateAgentsPanel(mockList as never, db);

    // Should restore selection to index 2 (clamped to valid range)
    expect(mockList.select).toHaveBeenCalledWith(2);
  });

  it('should clamp selection to valid range when agents shrink', async () => {
    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'repos/test-repo',
      name: 'test-team',
    });
    createAgent(db, { type: 'senior', teamId: team.id, tmuxSession: 'hive-senior-1' });

    const mockList = createMockList();
    mockList.selected = 5; // Previous selection beyond current range
    await updateAgentsPanel(mockList as never, db);

    // Should clamp to max valid index (1 agent = index 1, since 0 is header)
    expect(mockList.select).toHaveBeenCalledWith(1);
  });
});
