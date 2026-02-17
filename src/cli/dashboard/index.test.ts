// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRequirement, updateRequirement } from '../../db/queries/requirements.js';
import { createTestDatabase } from '../../db/queries/test-helpers.js';
import { isGodmodeActive } from './index.js';

describe('isGodmodeActive', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDatabase();
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
