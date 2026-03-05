// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRequirement, updateRequirement } from '../../db/queries/requirements.js';
import { createTestDatabase } from '../../db/queries/test-helpers.js';
import { isGodmodeActive, type DashboardContext } from './index.js';

describe('isGodmodeActive', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  it('should return false when no requirements exist', () => {
    expect(isGodmodeActive(db)).toBe(false);
  });

  it('should return false when no requirements have godmode enabled', () => {
    createRequirement(db, {
      title: 'Normal Feature',
      description: 'A normal feature request',
    });

    expect(isGodmodeActive(db)).toBe(false);
  });

  it('should return true when a pending requirement has godmode enabled', () => {
    createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });

    expect(isGodmodeActive(db)).toBe(true);
  });

  it('should return true when an in_progress requirement has godmode enabled', () => {
    const req = createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });
    updateRequirement(db, req.id, { status: 'in_progress' });

    expect(isGodmodeActive(db)).toBe(true);
  });

  it('should return false when godmode requirement is completed', () => {
    const req = createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });
    updateRequirement(db, req.id, { status: 'completed' });

    expect(isGodmodeActive(db)).toBe(false);
  });

  it('should return true when at least one active requirement has godmode', () => {
    createRequirement(db, {
      title: 'Normal Feature',
      description: 'A normal feature request',
    });

    createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });

    expect(isGodmodeActive(db)).toBe(true);
  });

  it('should return false when godmode is explicitly set to false', () => {
    createRequirement(db, {
      title: 'Feature',
      description: 'A feature request',
      godmode: false,
    });

    expect(isGodmodeActive(db)).toBe(false);
  });

  it('should return true for planning status with godmode', () => {
    const req = createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });
    updateRequirement(db, req.id, { status: 'planning' });

    expect(isGodmodeActive(db)).toBe(true);
  });

  it('should return true for planned status with godmode', () => {
    const req = createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });
    updateRequirement(db, req.id, { status: 'planned' });

    expect(isGodmodeActive(db)).toBe(true);
  });
});

describe('DashboardContext', () => {
  it('getDb should always return the current database after replacement', async () => {
    const db1 = await createTestDatabase();
    const db2 = await createTestDatabase();

    // Simulate how startDashboard creates the context with a mutable db ref
    let currentDb = db1;
    const ctx: DashboardContext = {
      getDb: () => currentDb,
      pauseRefresh: () => {},
      resumeRefresh: () => {},
    };

    // Initially returns db1
    expect(ctx.getDb()).toBe(db1);

    // After "reload", returns db2 — not the stale db1
    currentDb = db2;
    expect(ctx.getDb()).toBe(db2);
    expect(ctx.getDb()).not.toBe(db1);
  });

  it('pauseRefresh and resumeRefresh should toggle refresh state', () => {
    let paused = false;
    const ctx: DashboardContext = {
      getDb: () => null as unknown as Database,
      pauseRefresh: () => {
        paused = true;
      },
      resumeRefresh: () => {
        paused = false;
      },
    };

    expect(paused).toBe(false);
    ctx.pauseRefresh();
    expect(paused).toBe(true);
    ctx.resumeRefresh();
    expect(paused).toBe(false);
  });
});
