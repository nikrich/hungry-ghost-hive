// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getEnvValue,
  parseEnvFile,
  readEnvFile,
  serializeEnvFile,
  writeEnvEntries,
} from './env-store.js';

describe('env-store', () => {
  let tempDir: string;
  let hiveDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hive-env-test-'));
    hiveDir = join(tempDir, '.hive');
    mkdirSync(hiveDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseEnvFile', () => {
    it('should parse simple key=value pairs', () => {
      const result = parseEnvFile('FOO=bar\nBAZ=qux');
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should skip comments and empty lines', () => {
      const result = parseEnvFile('# comment\n\nFOO=bar\n  \n# another comment');
      expect(result).toEqual({ FOO: 'bar' });
    });

    it('should strip double quotes from values', () => {
      const result = parseEnvFile('FOO="bar baz"');
      expect(result).toEqual({ FOO: 'bar baz' });
    });

    it('should strip single quotes from values', () => {
      const result = parseEnvFile("FOO='bar baz'");
      expect(result).toEqual({ FOO: 'bar baz' });
    });

    it('should handle values with equals signs', () => {
      const result = parseEnvFile('FOO=bar=baz=qux');
      expect(result).toEqual({ FOO: 'bar=baz=qux' });
    });

    it('should handle empty values', () => {
      const result = parseEnvFile('FOO=');
      expect(result).toEqual({ FOO: '' });
    });

    it('should skip lines without equals sign', () => {
      const result = parseEnvFile('INVALID_LINE\nFOO=bar');
      expect(result).toEqual({ FOO: 'bar' });
    });
  });

  describe('serializeEnvFile', () => {
    it('should serialize entries into key=value format', () => {
      const result = serializeEnvFile({ FOO: 'bar', BAZ: 'qux' });
      expect(result).toBe('FOO=bar\nBAZ=qux\n');
    });

    it('should handle empty entries', () => {
      const result = serializeEnvFile({});
      expect(result).toBe('\n');
    });
  });

  describe('writeEnvEntries', () => {
    it('should create .env file with entries', () => {
      writeEnvEntries({ FOO: 'bar', BAZ: 'qux' }, tempDir);
      const content = readFileSync(join(hiveDir, '.env'), 'utf-8');
      expect(content).toContain('FOO=bar');
      expect(content).toContain('BAZ=qux');
    });

    it('should merge with existing entries', () => {
      writeEnvEntries({ FOO: 'bar' }, tempDir);
      writeEnvEntries({ BAZ: 'qux' }, tempDir);
      const content = readFileSync(join(hiveDir, '.env'), 'utf-8');
      expect(content).toContain('FOO=bar');
      expect(content).toContain('BAZ=qux');
    });

    it('should overwrite existing keys', () => {
      writeEnvEntries({ FOO: 'bar' }, tempDir);
      writeEnvEntries({ FOO: 'updated' }, tempDir);
      const entries = readEnvFile(tempDir);
      expect(entries.FOO).toBe('updated');
    });
  });

  describe('readEnvFile', () => {
    it('should return empty object when no .env file exists', () => {
      const result = readEnvFile(tempDir);
      expect(result).toEqual({});
    });

    it('should return entries from existing .env file', () => {
      writeEnvEntries({ GITHUB_TOKEN: 'ghp_test123' }, tempDir);
      const result = readEnvFile(tempDir);
      expect(result.GITHUB_TOKEN).toBe('ghp_test123');
    });
  });

  describe('getEnvValue', () => {
    it('should return value for existing key', () => {
      writeEnvEntries({ MY_KEY: 'my_value' }, tempDir);
      expect(getEnvValue('MY_KEY', tempDir)).toBe('my_value');
    });

    it('should return undefined for missing key', () => {
      writeEnvEntries({ OTHER: 'val' }, tempDir);
      expect(getEnvValue('MISSING', tempDir)).toBeUndefined();
    });
  });
});
