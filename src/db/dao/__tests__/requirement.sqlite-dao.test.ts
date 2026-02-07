import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteRequirementDao } from '../sqlite/requirement.sqlite-dao.js';
import { createTestDb } from './helpers.js';

describe('SqliteRequirementDao', () => {
  let db: Database;
  let dao: SqliteRequirementDao;

  beforeEach(async () => {
    db = await createTestDb();
    dao = new SqliteRequirementDao(db);
  });

  afterEach(() => {
    db.close();
  });

  it('requirement.sqlite-dao case 1', async () => {
    const req = await dao.createRequirement({
      title: 'Add login page',
      description: 'Implement OAuth login',
    });

    expect(req.id).toMatch(/^REQ-/);
    expect(req.title).toBe('Add login page');
    expect(req.description).toBe('Implement OAuth login');
    expect(req.submitted_by).toBe('human');
    expect(req.status).toBe('pending');
  });

  it('requirement.sqlite-dao case 2', async () => {
    const req = await dao.createRequirement({
      title: 'Test',
      description: 'Desc',
      submittedBy: 'tech-lead',
    });
    expect(req.submitted_by).toBe('tech-lead');
  });

  it('requirement.sqlite-dao case 3', async () => {
    const created = await dao.createRequirement({ title: 'Test', description: 'Desc' });
    const found = await dao.getRequirementById(created.id);
    expect(found).toEqual(created);
  });

  it('requirement.sqlite-dao case 4', async () => {
    expect(await dao.getRequirementById('REQ-NOPE')).toBeUndefined();
  });

  it('requirement.sqlite-dao case 5', async () => {
    await dao.createRequirement({ title: 'First', description: 'Desc1' });
    await dao.createRequirement({ title: 'Second', description: 'Desc2' });

    const all = await dao.getAllRequirements();
    expect(all).toHaveLength(2);
    // DESC order: Second first
    expect(all[0].title).toBe('Second');
    expect(all[1].title).toBe('First');
  });

  it('requirement.sqlite-dao case 6', async () => {
    const req = await dao.createRequirement({ title: 'Test', description: 'Desc' });
    await dao.updateRequirement(req.id, { status: 'planned' });

    const planned = await dao.getRequirementsByStatus('planned');
    expect(planned).toHaveLength(1);
    expect(planned[0].status).toBe('planned');
  });

  it('requirement.sqlite-dao case 7', async () => {
    const r1 = await dao.createRequirement({ title: 'R1', description: 'D1' });
    const r2 = await dao.createRequirement({ title: 'R2', description: 'D2' });
    const r3 = await dao.createRequirement({ title: 'R3', description: 'D3' });
    await dao.createRequirement({ title: 'R4', description: 'D4' });

    await dao.updateRequirement(r1.id, { status: 'pending' });
    await dao.updateRequirement(r2.id, { status: 'planning' });
    await dao.updateRequirement(r3.id, { status: 'in_progress' });
    // r4 stays pending

    const pending = await dao.getPendingRequirements();
    expect(pending).toHaveLength(4);
  });

  it('requirement.sqlite-dao case 8', async () => {
    const r1 = await dao.createRequirement({ title: 'R1', description: 'D1' });
    const r2 = await dao.createRequirement({ title: 'R2', description: 'D2' });

    await dao.updateRequirement(r1.id, { status: 'completed' });
    await dao.updateRequirement(r2.id, { status: 'planned' });

    const pending = await dao.getPendingRequirements();
    expect(pending).toHaveLength(0);
  });

  it('requirement.sqlite-dao case 9', async () => {
    const req = await dao.createRequirement({ title: 'Original', description: 'Original desc' });
    const updated = await dao.updateRequirement(req.id, {
      title: 'Updated',
      status: 'planning',
    });

    expect(updated!.title).toBe('Updated');
    expect(updated!.status).toBe('planning');
    expect(updated!.description).toBe('Original desc');
  });

  it('requirement.sqlite-dao case 10', async () => {
    const req = await dao.createRequirement({ title: 'Test', description: 'Desc' });
    const unchanged = await dao.updateRequirement(req.id, {});
    expect(unchanged).toEqual(req);
  });

  it('requirement.sqlite-dao case 11', async () => {
    const req = await dao.createRequirement({ title: 'Delete me', description: 'Desc' });
    await dao.deleteRequirement(req.id);
    expect(await dao.getRequirementById(req.id)).toBeUndefined();
  });

  it('requirement.sqlite-dao case 12 - godmode enabled', async () => {
    const req = await dao.createRequirement({
      title: 'Godmode req',
      description: 'Test godmode',
      godmode: true,
    });

    expect(req.godmode).toBe(1);
  });

  it('requirement.sqlite-dao case 13 - godmode defaults to 0', async () => {
    const req = await dao.createRequirement({
      title: 'Normal req',
      description: 'Test without godmode',
    });

    expect(req.godmode).toBe(0);
  });

  it('requirement.sqlite-dao case 14 - update godmode', async () => {
    const req = await dao.createRequirement({
      title: 'Test',
      description: 'Desc',
      godmode: false,
    });

    expect(req.godmode).toBe(0);

    const updated = await dao.updateRequirement(req.id, { godmode: true });
    expect(updated!.godmode).toBe(1);
  });
});
