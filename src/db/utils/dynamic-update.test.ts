// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { addDualWrite, buildDynamicUpdate, type DualWritePair } from './dynamic-update.js';

describe('buildDynamicUpdate', () => {
  it('should build updates from simple string field mappings', () => {
    const input = { name: 'Alice', status: 'active' };
    const fieldMap = { name: 'name', status: 'status' };

    const result = buildDynamicUpdate(input, fieldMap);

    expect(result.updates).toEqual(['name = ?', 'status = ?']);
    expect(result.values).toEqual(['Alice', 'active']);
  });

  it('should skip undefined fields', () => {
    const input = { name: 'Alice', status: undefined };
    const fieldMap = { name: 'name', status: 'status' };

    const result = buildDynamicUpdate(input, fieldMap);

    expect(result.updates).toEqual(['name = ?']);
    expect(result.values).toEqual(['Alice']);
  });

  it('should include null values (not undefined)', () => {
    const input = { name: null };
    const fieldMap = { name: 'name' };

    const result = buildDynamicUpdate(input, fieldMap);

    expect(result.updates).toEqual(['name = ?']);
    expect(result.values).toEqual([null]);
  });

  it('should apply transform functions', () => {
    const input = { tags: ['a', 'b'], active: true };
    const fieldMap = {
      tags: { column: 'tags', transform: (v: unknown) => JSON.stringify(v) },
      active: { column: 'is_active', transform: (v: unknown) => (v ? 1 : 0) },
    };

    const result = buildDynamicUpdate(input, fieldMap);

    expect(result.updates).toEqual(['tags = ?', 'is_active = ?']);
    expect(result.values).toEqual(['["a","b"]', 1]);
  });

  it('should prepend updated_at when includeUpdatedAt is true', () => {
    const input = { name: 'Alice' };
    const fieldMap = { name: 'name' };

    const result = buildDynamicUpdate(input, fieldMap, { includeUpdatedAt: true });

    expect(result.updates[0]).toBe('updated_at = ?');
    expect(typeof result.values[0]).toBe('string');
    expect(result.updates[1]).toBe('name = ?');
    expect(result.values[1]).toBe('Alice');
  });

  it('should return only updated_at when no fields match', () => {
    const result = buildDynamicUpdate({}, { name: 'name' }, { includeUpdatedAt: true });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toBe('updated_at = ?');
  });

  it('should return empty arrays when no fields match and no updated_at', () => {
    const result = buildDynamicUpdate({}, { name: 'name' });

    expect(result.updates).toEqual([]);
    expect(result.values).toEqual([]);
  });

  it('should handle transform returning null for falsy input', () => {
    const input = { criteria: null };
    const fieldMap = {
      criteria: { column: 'criteria', transform: (v: unknown) => (v ? JSON.stringify(v) : null) },
    };

    const result = buildDynamicUpdate(input, fieldMap);

    expect(result.values).toEqual([null]);
  });
});

describe('addDualWrite', () => {
  const pairs: DualWritePair[] = [
    {
      current: 'externalKey',
      legacy: 'jiraKey',
      currentColumn: 'external_key',
      legacyColumn: 'jira_key',
    },
  ];

  it('should add both columns when current field is set', () => {
    const result = { updates: [] as string[], values: [] as unknown[] };
    addDualWrite(result, { externalKey: 'EXT-1' }, pairs);

    expect(result.updates).toEqual(['jira_key = ?', 'external_key = ?']);
    expect(result.values).toEqual(['EXT-1', 'EXT-1']);
  });

  it('should fall back to legacy field when current is undefined', () => {
    const result = { updates: [] as string[], values: [] as unknown[] };
    addDualWrite(result, { jiraKey: 'JIRA-1' }, pairs);

    expect(result.updates).toEqual(['jira_key = ?', 'external_key = ?']);
    expect(result.values).toEqual(['JIRA-1', 'JIRA-1']);
  });

  it('should prefer current over legacy when both are set', () => {
    const result = { updates: [] as string[], values: [] as unknown[] };
    addDualWrite(result, { externalKey: 'EXT-1', jiraKey: 'JIRA-1' }, pairs);

    expect(result.values).toEqual(['EXT-1', 'EXT-1']);
  });

  it('should skip when neither field is set', () => {
    const result = { updates: [] as string[], values: [] as unknown[] };
    addDualWrite(result, {}, pairs);

    expect(result.updates).toEqual([]);
    expect(result.values).toEqual([]);
  });

  it('should handle null values for dual-write', () => {
    const result = { updates: [] as string[], values: [] as unknown[] };
    addDualWrite(result, { externalKey: null }, pairs);

    expect(result.updates).toEqual(['jira_key = ?', 'external_key = ?']);
    expect(result.values).toEqual([null, null]);
  });

  it('should handle multiple pairs', () => {
    const multiPairs: DualWritePair[] = [
      { current: 'extA', legacy: 'legA', currentColumn: 'ext_a', legacyColumn: 'leg_a' },
      { current: 'extB', legacy: 'legB', currentColumn: 'ext_b', legacyColumn: 'leg_b' },
    ];

    const result = { updates: [] as string[], values: [] as unknown[] };
    addDualWrite(result, { extA: 'A', legB: 'B' }, multiPairs);

    expect(result.updates).toEqual(['leg_a = ?', 'ext_a = ?', 'leg_b = ?', 'ext_b = ?']);
    expect(result.values).toEqual(['A', 'A', 'B', 'B']);
  });
});
