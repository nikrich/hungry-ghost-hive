// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenStore } from './token-store.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'token-store-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe('TokenStore', () => {
  describe('constructor and initialization', () => {
    it('should initialize with default .env path', () => {
      const store = new TokenStore();
      expect(store).toBeDefined();
    });

    it('should initialize with custom path', () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env.test');
      const store = new TokenStore(envPath);
      expect(store).toBeDefined();
    });
  });

  describe('loadFromEnv', () => {
    it('should load tokens from .env file', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const envContent = `ANTHROPIC_API_KEY=sk-ant-test123\nOPENAI_API_KEY=sk-test456\n`;
      writeFileSync(envPath, envContent, 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      expect(store.getToken('anthropic')).toBe('sk-ant-test123');
      expect(store.getToken('openai')).toBe('sk-test456');
    });

    it('should handle missing .env file gracefully', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env.nonexistent');
      const store = new TokenStore(envPath);

      // Should not throw
      await expect(store.loadFromEnv(envPath)).resolves.toBeUndefined();
      expect(store.getToken('anthropic')).toBeUndefined();
    });

    it('should handle .env file with comments', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const envContent = `# This is a comment
ANTHROPIC_API_KEY=sk-ant-test123
# Another comment
OPENAI_API_KEY=sk-test456
`;
      writeFileSync(envPath, envContent, 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      expect(store.getToken('anthropic')).toBe('sk-ant-test123');
      expect(store.getToken('openai')).toBe('sk-test456');
    });

    it('should handle .env file with quoted values', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const envContent = `ANTHROPIC_API_KEY="sk-ant-test123"
OPENAI_API_KEY='sk-test456'
GITHUB_TOKEN=ghp_test789
`;
      writeFileSync(envPath, envContent, 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      expect(store.getToken('anthropic')).toBe('sk-ant-test123');
      expect(store.getToken('openai')).toBe('sk-test456');
      expect(store.getToken('github')).toBe('ghp_test789');
    });

    it('should handle .env file with whitespace', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const envContent = `  ANTHROPIC_API_KEY  =  sk-ant-test123
OPENAI_API_KEY=sk-test456

GITHUB_TOKEN=ghp_test789
`;
      writeFileSync(envPath, envContent, 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      expect(store.getToken('anthropic')).toBe('sk-ant-test123');
      expect(store.getToken('openai')).toBe('sk-test456');
      expect(store.getToken('github')).toBe('ghp_test789');
    });

    it('should ignore non-token keys in .env file', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const envContent = `ANTHROPIC_API_KEY=sk-ant-test123
SOME_OTHER_VAR=value123
OPENAI_API_KEY=sk-test456
`;
      writeFileSync(envPath, envContent, 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      expect(store.getToken('anthropic')).toBe('sk-ant-test123');
      expect(store.getToken('openai')).toBe('sk-test456');
      // getAllTokens should only contain token keys
      const allTokens = store.getAllTokens();
      expect('SOME_OTHER_VAR' in allTokens).toBe(false);
    });
  });

  describe('getToken', () => {
    it('should return token for valid provider', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const envContent = `ANTHROPIC_API_KEY=sk-ant-test123\n`;
      writeFileSync(envPath, envContent, 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      expect(store.getToken('anthropic')).toBe('sk-ant-test123');
    });

    it('should return undefined for missing token', async () => {
      const store = new TokenStore();
      expect(store.getToken('anthropic')).toBeUndefined();
      expect(store.getToken('openai')).toBeUndefined();
    });

    it('should return token for all supported providers', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const envContent = `ANTHROPIC_API_KEY=sk-ant-123
OPENAI_API_KEY=sk-openai-123
GITHUB_TOKEN=ghp_123
`;
      writeFileSync(envPath, envContent, 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      expect(store.getToken('anthropic')).toBe('sk-ant-123');
      expect(store.getToken('openai')).toBe('sk-openai-123');
      expect(store.getToken('github')).toBe('ghp_123');
    });
  });

  describe('setToken', () => {
    it('should save token to .env file', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');

      const store = new TokenStore(envPath);
      await store.setToken('anthropic', 'sk-ant-test123');

      // Verify file was created
      const content = readFileSync(envPath, 'utf-8');
      expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-test123');

      // Verify token can be retrieved
      expect(store.getToken('anthropic')).toBe('sk-ant-test123');
    });

    it('should create parent directories', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, 'nested', 'path', '.env');

      const store = new TokenStore(envPath);
      await store.setToken('openai', 'sk-test456');

      const content = readFileSync(envPath, 'utf-8');
      expect(content).toContain('OPENAI_API_KEY=sk-test456');
    });

    it('should update existing token', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      writeFileSync(envPath, 'ANTHROPIC_API_KEY=old-key\n', 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);
      expect(store.getToken('anthropic')).toBe('old-key');

      await store.setToken('anthropic', 'new-key');
      expect(store.getToken('anthropic')).toBe('new-key');

      const content = readFileSync(envPath, 'utf-8');
      expect(content).toContain('ANTHROPIC_API_KEY=new-key');
      expect(content).not.toContain('old-key');
    });

    it('should preserve other variables in .env file', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      writeFileSync(envPath, 'OTHER_VAR=value123\nANTHROPIC_API_KEY=old-key\n', 'utf-8');

      const store = new TokenStore(envPath);
      await store.setToken('anthropic', 'new-key');

      const content = readFileSync(envPath, 'utf-8');
      expect(content).toContain('OTHER_VAR=value123');
      expect(content).toContain('ANTHROPIC_API_KEY=new-key');
    });

    it('should throw error for empty token', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const store = new TokenStore(envPath);

      await expect(store.setToken('anthropic', '')).rejects.toThrow('Token cannot be empty');
    });

    it('should handle multiple token updates', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');

      const store = new TokenStore(envPath);
      await store.setToken('anthropic', 'sk-ant-123');
      await store.setToken('openai', 'sk-openai-456');
      await store.setToken('github', 'ghp_789');

      const content = readFileSync(envPath, 'utf-8');
      expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-123');
      expect(content).toContain('OPENAI_API_KEY=sk-openai-456');
      expect(content).toContain('GITHUB_TOKEN=ghp_789');

      expect(store.getToken('anthropic')).toBe('sk-ant-123');
      expect(store.getToken('openai')).toBe('sk-openai-456');
      expect(store.getToken('github')).toBe('ghp_789');
    });
  });

  describe('getAllTokens', () => {
    it('should return all loaded tokens', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      const envContent = `ANTHROPIC_API_KEY=sk-ant-123
OPENAI_API_KEY=sk-openai-456
`;
      writeFileSync(envPath, envContent, 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      const allTokens = store.getAllTokens();
      expect(allTokens).toEqual({
        ANTHROPIC_API_KEY: 'sk-ant-123',
        OPENAI_API_KEY: 'sk-openai-456',
      });
    });

    it('should return copy, not reference', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-123\n', 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      const tokens1 = store.getAllTokens();
      tokens1.ANTHROPIC_API_KEY = 'modified';

      const tokens2 = store.getAllTokens();
      expect(tokens2.ANTHROPIC_API_KEY).toBe('sk-ant-123');
    });
  });

  describe('loadFromEnvVars', () => {
    it('should load tokens from process.env', () => {
      const originalEnv = { ...process.env };
      try {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env';
        process.env.OPENAI_API_KEY = 'sk-openai-from-env';

        const store = new TokenStore();
        store.loadFromEnvVars();

        expect(store.getToken('anthropic')).toBe('sk-ant-from-env');
        expect(store.getToken('openai')).toBe('sk-openai-from-env');
      } finally {
        process.env = originalEnv;
      }
    });

    it('should skip missing environment variables', () => {
      const store = new TokenStore();
      // Should not throw even if env vars don't exist
      expect(() => store.loadFromEnvVars()).not.toThrow();
    });
  });

  describe('validateTokens', () => {
    it('should return empty array when all tokens present', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      writeFileSync(
        envPath,
        'ANTHROPIC_API_KEY=sk-ant-123\nOPENAI_API_KEY=sk-openai-456\n',
        'utf-8'
      );

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      const missing = store.validateTokens(['anthropic', 'openai']);
      expect(missing).toEqual([]);
    });

    it('should return missing provider names', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-123\n', 'utf-8');

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      const missing = store.validateTokens(['anthropic', 'openai', 'github']);
      expect(missing).toContain('openai');
      expect(missing).toContain('github');
      expect(missing).not.toContain('anthropic');
    });

    it('should handle empty requirement list', () => {
      const store = new TokenStore();
      const missing = store.validateTokens([]);
      expect(missing).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all tokens', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      writeFileSync(
        envPath,
        'ANTHROPIC_API_KEY=sk-ant-123\nOPENAI_API_KEY=sk-openai-456\n',
        'utf-8'
      );

      const store = new TokenStore(envPath);
      await store.loadFromEnv(envPath);

      expect(store.getToken('anthropic')).toBe('sk-ant-123');
      expect(store.getToken('openai')).toBe('sk-openai-456');

      store.clear();

      expect(store.getToken('anthropic')).toBeUndefined();
      expect(store.getToken('openai')).toBeUndefined();
    });
  });

  describe('atomic operations', () => {
    it('should atomically write multiple tokens sequentially', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');

      const store = new TokenStore(envPath);

      // Execute setToken calls sequentially
      await store.setToken('anthropic', 'sk-ant-123');
      await store.setToken('openai', 'sk-openai-456');
      await store.setToken('github', 'ghp_789');

      const content = readFileSync(envPath, 'utf-8');
      expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-123');
      expect(content).toContain('OPENAI_API_KEY=sk-openai-456');
      expect(content).toContain('GITHUB_TOKEN=ghp_789');
    });

    it('should load file after atomic write', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');

      const store1 = new TokenStore(envPath);
      await store1.setToken('anthropic', 'sk-ant-123');

      const store2 = new TokenStore(envPath);
      await store2.loadFromEnv(envPath);

      expect(store2.getToken('anthropic')).toBe('sk-ant-123');
    });
  });
});
