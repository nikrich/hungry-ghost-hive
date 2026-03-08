// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies so we can exercise the session-routing logic
// without a real filesystem, database, or tmux.

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
    (cb: (ctx: { root: string; paths: { hiveDir: string }; db: { db: object } }) => unknown) =>
      cb({ root: '/tmp/hive', paths: { hiveDir: '/tmp/hive/.hive' }, db: { db: {} } })
  ),
}));

vi.mock('../dashboard/index.js', () => ({
  startDashboard: vi.fn(),
}));

// ora returns a chainable spinner stub
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
import { reqCommand } from './req.js';

describe('req command - tech lead session routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tmuxManager.isTmuxAvailable).mockResolvedValue(true);
  });

  it('spawns a new session when no session is running', async () => {
    vi.mocked(tmuxManager.isTmuxSessionRunning).mockResolvedValue(false);

    await reqCommand.parseAsync(['node', 'req', 'Build a new feature', '--target-branch', 'main'], {
      from: 'user',
    });

    expect(tmuxManager.spawnTmuxSession).toHaveBeenCalledOnce();
    expect(tmuxManager.sendToTmuxSession).not.toHaveBeenCalled();
  });

  it('sends prompt to existing session when session is already running', async () => {
    vi.mocked(tmuxManager.isTmuxSessionRunning).mockResolvedValue(true);

    await reqCommand.parseAsync(['node', 'req', 'Add another feature', '--target-branch', 'main'], {
      from: 'user',
    });

    expect(tmuxManager.sendToTmuxSession).toHaveBeenCalledOnce();
    expect(tmuxManager.spawnTmuxSession).not.toHaveBeenCalled();
  });

  it('sends prompt to existing session with the correct session name', async () => {
    vi.mocked(tmuxManager.isTmuxSessionRunning).mockResolvedValue(true);

    await reqCommand.parseAsync(['node', 'req', 'Fix the scheduler', '--target-branch', 'main'], {
      from: 'user',
    });

    expect(tmuxManager.sendToTmuxSession).toHaveBeenCalledWith(
      'hive-tech-lead',
      expect.any(String)
    );
  });

  it('spawns session with correct session name when session is not running', async () => {
    vi.mocked(tmuxManager.isTmuxSessionRunning).mockResolvedValue(false);

    await reqCommand.parseAsync(['node', 'req', 'Fix the scheduler', '--target-branch', 'main'], {
      from: 'user',
    });

    expect(tmuxManager.spawnTmuxSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionName: 'hive-tech-lead' })
    );
  });
});
