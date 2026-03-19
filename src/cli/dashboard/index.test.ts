// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteProvider } from '../../db/provider.js';
import { createRequirement, updateRequirement } from '../../db/queries/requirements.js';
import { createTestDatabase } from '../../db/queries/test-helpers.js';
import { isGodmodeActive } from './index.js';

describe('isGodmodeActive', () => {
  let db: SqliteProvider;

  beforeEach(async () => {
    const rawDb = await createTestDatabase();
    db = new SqliteProvider(rawDb);
  });

  it('should return false when no requirements exist', async () => {
    expect(await isGodmodeActive(db)).toBe(false);
  });

  it('should return false when no requirements have godmode enabled', async () => {
    await createRequirement(db, {
      title: 'Normal Feature',
      description: 'A normal feature request',
    });

    expect(await isGodmodeActive(db)).toBe(false);
  });

  it('should return true when a pending requirement has godmode enabled', async () => {
    await createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });

    expect(await isGodmodeActive(db)).toBe(true);
  });

  it('should return true when an in_progress requirement has godmode enabled', async () => {
    const req = await createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });
    await updateRequirement(db, req.id, { status: 'in_progress' });

    expect(await isGodmodeActive(db)).toBe(true);
  });

  it('should return false when godmode requirement is completed', async () => {
    const req = await createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });
    await updateRequirement(db, req.id, { status: 'completed' });

    expect(await isGodmodeActive(db)).toBe(false);
  });

  it('should return true when at least one active requirement has godmode', async () => {
    await createRequirement(db, {
      title: 'Normal Feature',
      description: 'A normal feature request',
    });

    await createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });

    expect(await isGodmodeActive(db)).toBe(true);
  });

  it('should return false when godmode is explicitly set to false', async () => {
    await createRequirement(db, {
      title: 'Feature',
      description: 'A feature request',
      godmode: false,
    });

    expect(await isGodmodeActive(db)).toBe(false);
  });

  it('should return true for planning status with godmode', async () => {
    const req = await createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });
    await updateRequirement(db, req.id, { status: 'planning' });

    expect(await isGodmodeActive(db)).toBe(true);
  });

  it('should return true for planned status with godmode', async () => {
    const req = await createRequirement(db, {
      title: 'Godmode Feature',
      description: 'A godmode feature request',
      godmode: true,
    });
    await updateRequirement(db, req.id, { status: 'planned' });

    expect(await isGodmodeActive(db)).toBe(true);
  });
});
