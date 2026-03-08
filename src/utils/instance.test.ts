// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildInstanceSessionName,
  getInstanceId,
  getInstancePrefix,
  getManagerLockPath,
  getManagerSessionName,
  getTechLeadSessionName,
} from './instance.js';

describe('instance', () => {
  let testHiveDir: string;

  beforeEach(() => {
    testHiveDir = join(tmpdir(), `hive-test-instance-${Date.now()}`);
    mkdirSync(testHiveDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testHiveDir, { recursive: true, force: true });
  });

  describe('getInstanceId', () => {
    it('should return null if hive directory does not exist', () => {
      const result = getInstanceId('/nonexistent/path/.hive');
      expect(result).toBeNull();
    });

    it('should create and persist an instance ID', () => {
      const id = getInstanceId(testHiveDir);
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
      expect(id!.length).toBe(6);

      // Should be persisted
      const fileContent = readFileSync(join(testHiveDir, 'instance.id'), 'utf-8').trim();
      expect(fileContent).toBe(id);
    });

    it('should return the same ID on subsequent calls', () => {
      const id1 = getInstanceId(testHiveDir);
      const id2 = getInstanceId(testHiveDir);
      expect(id1).toBe(id2);
    });

    it('should read existing instance ID from file', () => {
      writeFileSync(join(testHiveDir, 'instance.id'), 'testid', 'utf-8');
      const id = getInstanceId(testHiveDir);
      expect(id).toBe('testid');
    });
  });

  describe('getInstancePrefix', () => {
    it('should return hive-<instanceId> when hive dir exists', () => {
      writeFileSync(join(testHiveDir, 'instance.id'), 'abc123', 'utf-8');
      const prefix = getInstancePrefix(testHiveDir);
      expect(prefix).toBe('hive-abc123');
    });

    it('should fall back to hive when hive dir does not exist', () => {
      const prefix = getInstancePrefix('/nonexistent/path/.hive');
      expect(prefix).toBe('hive');
    });
  });

  describe('buildInstanceSessionName', () => {
    it('should build instance-scoped session name', () => {
      writeFileSync(join(testHiveDir, 'instance.id'), 'abc123', 'utf-8');
      const name = buildInstanceSessionName(testHiveDir, 'senior', 'my-team');
      expect(name).toBe('hive-abc123-senior-my-team');
    });

    it('should include index when > 1', () => {
      writeFileSync(join(testHiveDir, 'instance.id'), 'abc123', 'utf-8');
      const name = buildInstanceSessionName(testHiveDir, 'senior', 'my-team', 3);
      expect(name).toBe('hive-abc123-senior-my-team-3');
    });

    it('should omit index when 1', () => {
      writeFileSync(join(testHiveDir, 'instance.id'), 'abc123', 'utf-8');
      const name = buildInstanceSessionName(testHiveDir, 'senior', 'my-team', 1);
      expect(name).toBe('hive-abc123-senior-my-team');
    });

    it('should fall back to old format when no hive dir', () => {
      const name = buildInstanceSessionName('/nonexistent', 'senior', 'my-team');
      expect(name).toBe('hive-senior-my-team');
    });
  });

  describe('getTechLeadSessionName', () => {
    it('should return instance-scoped tech lead session name', () => {
      writeFileSync(join(testHiveDir, 'instance.id'), 'xyz789', 'utf-8');
      const name = getTechLeadSessionName(testHiveDir);
      expect(name).toBe('hive-xyz789-tech-lead');
    });

    it('should fall back to hive-tech-lead when no instance', () => {
      const name = getTechLeadSessionName('/nonexistent');
      expect(name).toBe('hive-tech-lead');
    });
  });

  describe('getManagerSessionName', () => {
    it('should return instance-scoped manager session name', () => {
      writeFileSync(join(testHiveDir, 'instance.id'), 'xyz789', 'utf-8');
      const name = getManagerSessionName(testHiveDir);
      expect(name).toBe('hive-xyz789-manager');
    });
  });

  describe('getManagerLockPath', () => {
    it('should return instance-scoped lock path', () => {
      writeFileSync(join(testHiveDir, 'instance.id'), 'xyz789', 'utf-8');
      const lockPath = getManagerLockPath(testHiveDir);
      expect(lockPath).toBe(join(testHiveDir, 'manager-xyz789.lock'));
    });

    it('should fall back to default lock path when no instance', () => {
      const lockPath = getManagerLockPath('/nonexistent');
      expect(lockPath).toBe(join('/nonexistent', 'manager.lock'));
    });
  });
});
