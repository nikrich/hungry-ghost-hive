// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import { JiraClient } from '../../integrations/jira/client.js';
import { postComment } from '../../integrations/jira/comments.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'approach-test-'));
  tempDirs.push(dir);
  return dir;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
  vi.restoreAllMocks();
});

describe('approach_posted comment', () => {
  it('should post approach comment with ADF formatting', async () => {
    const dir = createTempDir();
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'JIRA_ACCESS_TOKEN=test-token\nJIRA_CLOUD_ID=cloud-test\n', 'utf-8');
    const store = new TokenStore(envPath);
    await store.loadFromEnv(envPath);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({}),
    } as Response);

    const client = new JiraClient({
      tokenStore: store,
      clientId: 'cid',
      clientSecret: 'csecret',
    });

    const result = await postComment(client, 'PROJ-123', 'approach_posted', {
      agentName: 'hive-senior-team',
      approachText:
        'Will modify src/auth/login.ts to add OAuth flow.\n\nRisks: token refresh edge case.',
    });

    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/issue/PROJ-123/comment'),
      expect.objectContaining({
        method: 'POST',
      })
    );

    // Verify the body contains approach content
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const textContent = JSON.stringify(body.body);

    expect(textContent).toContain('Implementation approach');
    expect(textContent).toContain('hive-senior-team');
    expect(textContent).toContain('src/auth/login.ts');
    expect(textContent).toContain('token refresh edge case');
  });

  it('should handle approach with no text gracefully', async () => {
    const dir = createTempDir();
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'JIRA_ACCESS_TOKEN=test-token\nJIRA_CLOUD_ID=cloud-test\n', 'utf-8');
    const store = new TokenStore(envPath);
    await store.loadFromEnv(envPath);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({}),
    } as Response);

    const client = new JiraClient({
      tokenStore: store,
      clientId: 'cid',
      clientSecret: 'csecret',
    });

    const result = await postComment(client, 'PROJ-123', 'approach_posted', {
      agentName: 'hive-senior-team',
    });

    expect(result).toBe(true);
  });

  it('should return false on API failure', async () => {
    const dir = createTempDir();
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'JIRA_ACCESS_TOKEN=test-token\nJIRA_CLOUD_ID=cloud-test\n', 'utf-8');
    const store = new TokenStore(envPath);
    await store.loadFromEnv(envPath);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    const client = new JiraClient({
      tokenStore: store,
      clientId: 'cid',
      clientSecret: 'csecret',
    });

    const result = await postComment(client, 'PROJ-123', 'approach_posted', {
      agentName: 'hive-senior-team',
      approachText: 'My approach',
    });

    expect(result).toBe(false);
  });
});

describe('prompt templates include approach step', () => {
  it('should include hive approach command in senior prompt', async () => {
    const { generateSeniorPrompt } = await import('../../orchestrator/prompt-templates.js');
    const prompt = generateSeniorPrompt('team1', 'https://github.com/repo', '/path/to/repo', []);
    expect(prompt).toContain('hive approach');
    expect(prompt).toContain('Post your approach');
  });

  it('should include hive approach command in intermediate prompt', async () => {
    const { generateIntermediatePrompt } = await import('../../orchestrator/prompt-templates.js');
    const prompt = generateIntermediatePrompt(
      'team1',
      'https://github.com/repo',
      '/path/to/repo',
      'hive-intermediate-team1'
    );
    expect(prompt).toContain('hive approach');
    expect(prompt).toContain('Post your approach');
  });

  it('should include hive approach command in junior prompt', async () => {
    const { generateJuniorPrompt } = await import('../../orchestrator/prompt-templates.js');
    const prompt = generateJuniorPrompt(
      'team1',
      'https://github.com/repo',
      '/path/to/repo',
      'hive-junior-team1'
    );
    expect(prompt).toContain('hive approach');
    expect(prompt).toContain('Post your approach');
  });
});
