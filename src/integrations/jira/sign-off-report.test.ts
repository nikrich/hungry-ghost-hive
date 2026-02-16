// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import { JiraClient } from './client.js';
import {
  buildSignOffReportAdf,
  postSignOffReport,
  type SignOffReportData,
} from './sign-off-report.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sign-off-report-test-'));
  tempDirs.push(dir);
  return dir;
}

function createTokenStore(tokens: Record<string, string>): { store: TokenStore; envPath: string } {
  const dir = createTempDir();
  const envPath = join(dir, '.env');
  const content = Object.entries(tokens)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  writeFileSync(envPath, content + '\n', 'utf-8');
  const store = new TokenStore(envPath);
  return { store, envPath };
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
      // Ignore cleanup errors
    }
  }
});

function makeReportData(overrides: Partial<SignOffReportData> = {}): SignOffReportData {
  return {
    requirementId: 'REQ-ABC123',
    requirementTitle: 'User authentication feature',
    featureBranch: 'feature/REQ-ABC123',
    passed: true,
    totalTests: 10,
    passedTests: 10,
    failedTests: 0,
    storiesMerged: 3,
    teamNames: ['team-alpha'],
    ...overrides,
  };
}

async function createTestClient(): Promise<{
  client: JiraClient;
  store: TokenStore;
}> {
  const { store, envPath } = createTokenStore({
    JIRA_ACCESS_TOKEN: 'test-access-token',
    JIRA_CLOUD_ID: 'test-cloud-id',
  });
  await store.loadFromEnv(envPath);
  const client = new JiraClient({
    tokenStore: store,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  });
  return { client, store };
}

describe('buildSignOffReportAdf', () => {
  it('should build a passing report with correct structure', () => {
    const data = makeReportData();
    const adf = buildSignOffReportAdf(data);

    expect(adf.version).toBe(1);
    expect(adf.type).toBe('doc');
    expect(adf.content.length).toBeGreaterThan(0);

    // Check header contains PASSED
    const heading = adf.content[0];
    expect(heading.type).toBe('heading');
    const headingText = heading.content?.find((n: any) => n.type === 'text');
    expect(headingText?.text).toContain('PASSED');
  });

  it('should build a failing report with FAILED status', () => {
    const data = makeReportData({
      passed: false,
      failedTests: 2,
      passedTests: 8,
    });
    const adf = buildSignOffReportAdf(data);

    const heading = adf.content[0];
    const headingText = heading.content?.find((n: any) => n.type === 'text');
    expect(headingText?.text).toContain('FAILED');
  });

  it('should include requirement info', () => {
    const data = makeReportData();
    const adf = buildSignOffReportAdf(data);

    const allText = JSON.stringify(adf);
    expect(allText).toContain('REQ-ABC123');
    expect(allText).toContain('User authentication feature');
    expect(allText).toContain('feature/REQ-ABC123');
  });

  it('should include test results in a table', () => {
    const data = makeReportData({ totalTests: 15, passedTests: 12, failedTests: 3 });
    const adf = buildSignOffReportAdf(data);

    const table = adf.content.find((n: any) => n.type === 'table');
    expect(table).toBeDefined();

    const allText = JSON.stringify(table);
    expect(allText).toContain('15');
    expect(allText).toContain('12');
    expect(allText).toContain('3');
  });

  it('should include duration when provided', () => {
    const data = makeReportData({ duration: '2m 30s' });
    const adf = buildSignOffReportAdf(data);

    const allText = JSON.stringify(adf);
    expect(allText).toContain('2m 30s');
  });

  it('should omit duration row when not provided', () => {
    const data = makeReportData({ duration: undefined });
    const adf = buildSignOffReportAdf(data);

    const table = adf.content.find((n: any) => n.type === 'table');
    const allText = JSON.stringify(table);
    expect(allText).not.toContain('Duration');
  });

  it('should include failed test names for failed reports', () => {
    const data = makeReportData({
      passed: false,
      failedTests: 2,
      passedTests: 8,
      failedTestNames: ['test_login_flow', 'test_signup_validation'],
    });
    const adf = buildSignOffReportAdf(data);

    const allText = JSON.stringify(adf);
    expect(allText).toContain('test_login_flow');
    expect(allText).toContain('test_signup_validation');
    expect(allText).toContain('Failed Tests');
  });

  it('should not include failed test section for passing reports', () => {
    const data = makeReportData({ passed: true });
    const adf = buildSignOffReportAdf(data);

    const allText = JSON.stringify(adf);
    expect(allText).not.toContain('Failed Tests');
  });

  it('should include error summary for failed reports', () => {
    const data = makeReportData({
      passed: false,
      failedTests: 1,
      passedTests: 9,
      errorSummary: 'AssertionError: expected 200 but got 500',
    });
    const adf = buildSignOffReportAdf(data);

    const allText = JSON.stringify(adf);
    expect(allText).toContain('Error Summary');
    expect(allText).toContain('AssertionError: expected 200 but got 500');
  });

  it('should not include error summary for passing reports', () => {
    const data = makeReportData({
      passed: true,
      errorSummary: 'should not appear',
    });
    const adf = buildSignOffReportAdf(data);

    const allText = JSON.stringify(adf);
    expect(allText).not.toContain('Error Summary');
  });

  it('should include stories merged and team names', () => {
    const data = makeReportData({
      storiesMerged: 5,
      teamNames: ['team-alpha', 'team-beta'],
    });
    const adf = buildSignOffReportAdf(data);

    const allText = JSON.stringify(adf);
    expect(allText).toContain('5');
    expect(allText).toContain('team-alpha, team-beta');
  });

  it('should include footer', () => {
    const data = makeReportData();
    const adf = buildSignOffReportAdf(data);

    const lastNode = adf.content[adf.content.length - 1];
    const allText = JSON.stringify(lastNode);
    expect(allText).toContain('Generated by Hive Manager');
  });
});

describe('postSignOffReport', () => {
  it('should post the report as a comment to the Jira epic', async () => {
    const { client } = await createTestClient();
    const data = makeReportData();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ id: '12345' }),
    } as Response);

    const result = await postSignOffReport(client, 'PROJ-123', data);

    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain('/issue/PROJ-123/comment');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.body.version).toBe(1);
    expect(body.body.type).toBe('doc');
  });

  it('should return false when the API call fails', async () => {
    const { client } = await createTestClient();
    const data = makeReportData();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    const result = await postSignOffReport(client, 'PROJ-123', data);
    expect(result).toBe(false);
  });

  it('should return false when fetch throws', async () => {
    const { client } = await createTestClient();
    const data = makeReportData();

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await postSignOffReport(client, 'PROJ-123', data);
    expect(result).toBe(false);
  });

  it('should encode epic key in the URL', async () => {
    const { client } = await createTestClient();
    const data = makeReportData();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ id: '12345' }),
    } as Response);

    await postSignOffReport(client, 'PROJ-123', data);

    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain('/issue/PROJ-123/comment');
  });
});
