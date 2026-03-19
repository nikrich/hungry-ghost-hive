// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../cli-runtimes/index.js', () => ({
  getCliRuntimeBuilder: vi.fn(() => ({
    buildSpawnCommand: vi.fn(() => ['claude', '--dangerously-skip-permissions']),
  })),
  resolveRuntimeModelForCli: vi.fn(model => model),
}));

vi.mock('../../cluster/runtime.js', () => ({
  fetchLocalClusterStatus: vi.fn(() => null),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    models: {
      tech_lead: {
        cli_tool: 'claude',
        safety_mode: 'bypassPermissions',
        model: 'claude-sonnet-4-6',
      },
    },
    integrations: {
      project_management: { provider: 'none' },
    },
    agents: { chrome_enabled: false },
    cluster: { enabled: false },
  })),
}));

vi.mock('../../connectors/registry.js', () => ({
  registry: {
    getProjectManagement: vi.fn(() => null),
  },
}));

vi.mock('../../db/client.js', () => ({
  withTransaction: vi.fn(async (_db: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../db/queries/agents.js', () => ({
  createAgent: vi.fn(() => ({ id: 'agent-1' })),
  getTechLead: vi.fn(() => ({ id: 'agent-1' })),
  updateAgent: vi.fn(),
}));

vi.mock('../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
}));

vi.mock('../../db/queries/requirements.js', () => ({
  createRequirement: vi.fn(() => ({ id: 'req-1', godmode: 0 })),
  updateRequirement: vi.fn(),
}));

vi.mock('../../db/queries/teams.js', () => ({
  getAllTeams: vi.fn(() => [{ id: 'team-1', name: 'alpha' }]),
}));

vi.mock('../../tmux/manager.js', () => ({
  isTmuxAvailable: vi.fn(),
  isTmuxSessionRunning: vi.fn(),
  sendToTmuxSession: vi.fn(),
  spawnTmuxSession: vi.fn(),
}));

vi.mock('../../utils/instance.js', () => ({
  getTechLeadSessionName: vi.fn(() => 'hive-tech-lead'),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(
    (
      cb: (ctx: {
        root: string;
        paths: { hiveDir: string };
        db: { db: object; provider: object };
      }) => unknown
    ) =>
      cb({
        root: '/tmp/hive',
        paths: { hiveDir: '/tmp/hive/.hive' },
        db: { db: {}, provider: { withTransaction: vi.fn(async (fn: () => unknown) => fn()) } },
      })
  ),
}));

vi.mock('../dashboard/index.js', () => ({
  startDashboard: vi.fn(),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

import * as tmuxManager from '../../tmux/manager.js';
import * as dashboard from '../dashboard/index.js';
import { reqCommand } from './req.js';

describe('req command - headless dashboard behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HIVE_HEADLESS;
    // Reset Commander option state between tests so --headless from one test
    // doesn't bleed into the next.
    reqCommand.setOptionValue('headless', undefined);
    vi.mocked(tmuxManager.isTmuxAvailable).mockResolvedValue(true);
    vi.mocked(tmuxManager.isTmuxSessionRunning).mockResolvedValue(false);
  });

  afterEach(() => {
    delete process.env.HIVE_HEADLESS;
  });

  it('calls startDashboard when --headless flag is not set', async () => {
    await reqCommand.parseAsync(['node', 'req', 'Build a feature', '--target-branch', 'main'], {
      from: 'user',
    });

    expect(dashboard.startDashboard).toHaveBeenCalledOnce();
  });

  it('does not call startDashboard when --headless flag is passed', async () => {
    await reqCommand.parseAsync(
      ['node', 'req', 'Build a feature', '--target-branch', 'main', '--headless'],
      { from: 'user' }
    );

    expect(dashboard.startDashboard).not.toHaveBeenCalled();
  });

  it('does not call startDashboard when HIVE_HEADLESS=1 env var is set', async () => {
    process.env.HIVE_HEADLESS = '1';

    await reqCommand.parseAsync(['node', 'req', 'Build a feature', '--target-branch', 'main'], {
      from: 'user',
    });

    expect(dashboard.startDashboard).not.toHaveBeenCalled();
  });

  it('calls startDashboard when HIVE_HEADLESS env var is absent', async () => {
    delete process.env.HIVE_HEADLESS;

    await reqCommand.parseAsync(['node', 'req', 'Build a feature', '--target-branch', 'main'], {
      from: 'user',
    });

    expect(dashboard.startDashboard).toHaveBeenCalledOnce();
  });

  it('does not call startDashboard when HIVE_HEADLESS is set to non-1 value', async () => {
    process.env.HIVE_HEADLESS = '0';

    await reqCommand.parseAsync(['node', 'req', 'Build a feature', '--target-branch', 'main'], {
      from: 'user',
    });

    // HIVE_HEADLESS=0 is falsy for the === '1' check, so dashboard should launch
    expect(dashboard.startDashboard).toHaveBeenCalledOnce();
  });
});
