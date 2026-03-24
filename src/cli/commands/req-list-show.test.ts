// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing the command
vi.mock('../../auth/token-store.js', () => ({
  TokenStore: vi.fn().mockImplementation(() => ({
    loadFromEnv: vi.fn(),
  })),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    integrations: {
      project_management: { provider: 'none' },
    },
    cluster: { enabled: false },
    models: {
      tech_lead: { cli_tool: 'claude', model: 'claude-sonnet-4-6', safety_mode: 'default' },
    },
  })),
}));

vi.mock('../../db/queries/requirements.js', () => ({
  createRequirement: vi.fn(),
  getAllRequirements: vi.fn(() => []),
  getRequirementById: vi.fn(),
  getRequirementsByStatus: vi.fn(() => []),
  updateRequirement: vi.fn(),
}));

vi.mock('../../db/queries/stories.js', () => ({
  getStoriesByRequirement: vi.fn(() => []),
}));

vi.mock('../../db/queries/teams.js', () => ({
  getAllTeams: vi.fn(() => []),
}));

vi.mock('../../db/queries/agents.js', () => ({
  createAgent: vi.fn(),
  getTechLead: vi.fn(),
  updateAgent: vi.fn(),
}));

vi.mock('../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
}));

vi.mock('../../connectors/registry.js', () => ({
  registry: {
    getProjectManagement: vi.fn(() => null),
    reset: vi.fn(),
  },
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({ root: '/tmp', db: { db: {}, provider: {} }, paths: { hiveDir: '/tmp' } })
  ),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {}, provider: {} } })),
}));

vi.mock('../../tmux/manager.js', () => ({
  isTmuxAvailable: vi.fn(() => false),
  isTmuxSessionRunning: vi.fn(() => false),
  sendToTmuxSession: vi.fn(),
  spawnTmuxSession: vi.fn(),
}));

vi.mock('../../cluster/runtime.js', () => ({
  fetchLocalClusterStatus: vi.fn(),
}));

vi.mock('../../cli-runtimes/index.js', () => ({
  getCliRuntimeBuilder: vi.fn(() => ({ buildSpawnCommand: vi.fn(() => []) })),
  resolveRuntimeModelForCli: vi.fn(() => 'claude-sonnet-4-6'),
}));

vi.mock('../../utils/instance.js', () => ({
  getTechLeadSessionName: vi.fn(() => 'hive-tech-lead'),
}));

vi.mock('../dashboard/index.js', () => ({
  startDashboard: vi.fn(),
}));

import {
  getAllRequirements,
  getRequirementById,
  getRequirementsByStatus,
} from '../../db/queries/requirements.js';
import { getStoriesByRequirement } from '../../db/queries/stories.js';
import { reqCommand } from './req.js';

const mockRequirements = [
  {
    id: 'REQ-ABC12345',
    title: 'Test requirement',
    description: 'Test description',
    submitted_by: 'human',
    status: 'pending',
    godmode: 0,
    target_branch: 'main',
    feature_branch: null,
    jira_epic_key: null,
    jira_epic_id: null,
    external_epic_key: null,
    external_epic_id: null,
    external_provider: null,
    created_at: '2026-03-24T00:00:00.000Z',
  },
];

const mockStories = [
  {
    id: 'STORY-XYZ-001',
    title: 'Some story',
    status: 'estimated',
    requirement_id: 'REQ-ABC12345',
    team_id: 'team-1',
    description: 'Story description',
    acceptance_criteria: null,
    story_points: 3,
    complexity_score: 3,
    assigned_agent_id: null,
    branch_name: null,
    pr_url: null,
    created_at: '2026-03-24T00:00:00.000Z',
    updated_at: '2026-03-24T00:00:00.000Z',
  },
];

describe('req command structure', () => {
  it('should have list subcommand', () => {
    const listCmd = reqCommand.commands.find(cmd => cmd.name() === 'list');
    expect(listCmd).toBeDefined();
    expect(listCmd?.description()).toContain('List');
  });

  it('should have show subcommand', () => {
    const showCmd = reqCommand.commands.find(cmd => cmd.name() === 'show');
    expect(showCmd).toBeDefined();
    expect(showCmd?.description()).toContain('Show');
  });

  describe('list subcommand options', () => {
    it('should have --status option', () => {
      const listCmd = reqCommand.commands.find(cmd => cmd.name() === 'list');
      const statusOpt = listCmd?.options.find(opt => opt.long === '--status');
      expect(statusOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const listCmd = reqCommand.commands.find(cmd => cmd.name() === 'list');
      const jsonOpt = listCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('show subcommand options', () => {
    it('should accept id argument', () => {
      const showCmd = reqCommand.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd?.usage()).toContain('id');
    });

    it('should have --json option', () => {
      const showCmd = reqCommand.commands.find(cmd => cmd.name() === 'show');
      const jsonOpt = showCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });
});

describe('req list subcommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const listCmd = reqCommand.commands.find(cmd => cmd.name() === 'list');
    listCmd?.setOptionValue('status', undefined);
    listCmd?.setOptionValue('json', undefined);
  });

  it('calls getAllRequirements when no status filter', async () => {
    vi.mocked(getAllRequirements).mockResolvedValueOnce(mockRequirements as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await reqCommand.parseAsync(['list'], { from: 'user' });

    expect(getAllRequirements).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('calls getRequirementsByStatus when --status is provided', async () => {
    vi.mocked(getRequirementsByStatus).mockResolvedValueOnce(mockRequirements as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await reqCommand.parseAsync(['list', '--status', 'pending'], { from: 'user' });

    expect(getRequirementsByStatus).toHaveBeenCalledWith(expect.anything(), 'pending');
    consoleSpy.mockRestore();
  });

  it('outputs JSON when --json flag is set', async () => {
    vi.mocked(getAllRequirements).mockResolvedValueOnce(mockRequirements as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await reqCommand.parseAsync(['list', '--json'], { from: 'user' });

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(mockRequirements, null, 2));
    consoleSpy.mockRestore();
  });

  it('shows empty message when no requirements found', async () => {
    vi.mocked(getAllRequirements).mockResolvedValueOnce([]);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await reqCommand.parseAsync(['list'], { from: 'user' });

    const calls = consoleSpy.mock.calls.map(c => String(c[0]));
    expect(calls.some(msg => msg.includes('No requirements found'))).toBe(true);
    consoleSpy.mockRestore();
  });
});

describe('req show subcommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getRequirementById with the provided id', async () => {
    vi.mocked(getRequirementById).mockResolvedValueOnce(mockRequirements[0] as any);
    vi.mocked(getStoriesByRequirement).mockResolvedValueOnce([]);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await reqCommand.parseAsync(['show', 'REQ-ABC12345'], { from: 'user' });

    expect(getRequirementById).toHaveBeenCalledWith(expect.anything(), 'REQ-ABC12345');
    consoleSpy.mockRestore();
  });

  it('fetches associated stories', async () => {
    vi.mocked(getRequirementById).mockResolvedValueOnce(mockRequirements[0] as any);
    vi.mocked(getStoriesByRequirement).mockResolvedValueOnce(mockStories as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await reqCommand.parseAsync(['show', 'REQ-ABC12345'], { from: 'user' });

    expect(getStoriesByRequirement).toHaveBeenCalledWith(expect.anything(), 'REQ-ABC12345');
    consoleSpy.mockRestore();
  });

  it('outputs JSON when --json flag is set', async () => {
    vi.mocked(getRequirementById).mockResolvedValueOnce(mockRequirements[0] as any);
    vi.mocked(getStoriesByRequirement).mockResolvedValueOnce(mockStories as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await reqCommand.parseAsync(['show', 'REQ-ABC12345', '--json'], { from: 'user' });

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({ requirement: mockRequirements[0], stories: mockStories }, null, 2)
    );
    consoleSpy.mockRestore();
  });

  it('exits with error when requirement not found', async () => {
    vi.mocked(getRequirementById).mockResolvedValueOnce(undefined);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await reqCommand.parseAsync(['show', 'REQ-NOTFOUND'], { from: 'user' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
