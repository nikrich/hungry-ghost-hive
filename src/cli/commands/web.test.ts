// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    web: { host: '127.0.0.1', port: 8788, refresh_interval_ms: 3000 },
  })),
}));

vi.mock('../../utils/paths.js', () => ({
  findHiveRoot: vi.fn(() => '/mock/root'),
  getHivePaths: vi.fn(() => ({
    hiveDir: '/mock/root/.hive',
    dbPath: '/mock/root/.hive/hive.db',
  })),
}));

vi.mock('../../web/index.js', () => ({
  WebDashboardServer: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    url: 'http://127.0.0.1:8788',
  })),
}));

vi.mock('../../utils/open-browser.js', () => ({
  openBrowser: vi.fn(),
}));

import { webCommand } from './web.js';

describe('web command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct name', () => {
    expect(webCommand.name()).toBe('web');
  });

  it('should have description', () => {
    expect(webCommand.description()).toBe('Open web dashboard in browser');
  });

  it('should have --port option', () => {
    const opt = webCommand.options.find(o => o.long === '--port');
    expect(opt).toBeDefined();
  });

  it('should have --host option', () => {
    const opt = webCommand.options.find(o => o.long === '--host');
    expect(opt).toBeDefined();
  });

  it('should have --no-open option', () => {
    const opt = webCommand.options.find(o => o.long === '--no-open');
    expect(opt).toBeDefined();
  });
});
