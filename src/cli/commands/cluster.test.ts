// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../cluster/runtime.js', () => ({
  fetchClusterStatusFromUrl: vi.fn(),
  fetchLocalClusterStatus: vi.fn(),
  fetchLocalClusterEvents: vi.fn(),
  postToLocalCluster: vi.fn(),
  postToPeerCluster: vi.fn(),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    cluster: {
      enabled: false,
      node_id: 'node-test',
      public_url: 'http://127.0.0.1:8787',
      peers: [],
      auth_token: undefined,
      request_timeout_ms: 500,
    },
  })),
}));

vi.mock('../../utils/paths.js', () => ({
  findHiveRoot: vi.fn(() => '/tmp'),
  getHivePaths: vi.fn(() => ({ hiveDir: '/tmp/.hive' })),
}));

import * as runtimeModule from '../../cluster/runtime.js';
import * as configModule from '../../config/loader.js';
import { clusterCommand } from './cluster.js';

const mockFetchLocal = runtimeModule.fetchLocalClusterStatus as ReturnType<typeof vi.fn>;
const mockFetchFromUrl = runtimeModule.fetchClusterStatusFromUrl as ReturnType<typeof vi.fn>;
const mockFetchEvents = runtimeModule.fetchLocalClusterEvents as ReturnType<typeof vi.fn>;
const mockPostLocal = runtimeModule.postToLocalCluster as ReturnType<typeof vi.fn>;
const mockPostPeer = runtimeModule.postToPeerCluster as ReturnType<typeof vi.fn>;
const mockLoadConfig = configModule.loadConfig as ReturnType<typeof vi.fn>;

function makeClusterConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    node_id: 'node-test',
    public_url: 'http://127.0.0.1:8787',
    peers: [],
    auth_token: undefined,
    request_timeout_ms: 500,
    ...overrides,
  };
}

function makeStatus(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    node_id: 'node-test',
    role: 'leader',
    term: 1,
    voted_for: null,
    is_leader: true,
    leader_id: 'node-test',
    leader_url: null,
    fencing_token: 1,
    leader_lease_valid: true,
    leader_lease_duration_ms: 300,
    raft_commit_index: 0,
    raft_last_applied: 0,
    raft_last_log_index: 0,
    peers: [],
    is_catching_up: false,
    ...overrides,
  };
}

describe('cluster command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({ cluster: makeClusterConfig() });
  });

  describe('command structure', () => {
    it('has cluster command with correct name', () => {
      expect(clusterCommand.name()).toBe('cluster');
    });

    it('has description', () => {
      expect(clusterCommand.description()).toContain('cluster');
    });

    it('has status subcommand', () => {
      const cmd = clusterCommand.commands.find(c => c.name() === 'status');
      expect(cmd).toBeDefined();
    });

    it('has health subcommand', () => {
      const cmd = clusterCommand.commands.find(c => c.name() === 'health');
      expect(cmd).toBeDefined();
    });

    it('has events subcommand', () => {
      const cmd = clusterCommand.commands.find(c => c.name() === 'events');
      expect(cmd).toBeDefined();
    });

    it('has join subcommand', () => {
      const cmd = clusterCommand.commands.find(c => c.name() === 'join');
      expect(cmd).toBeDefined();
    });

    it('has leave subcommand', () => {
      const cmd = clusterCommand.commands.find(c => c.name() === 'leave');
      expect(cmd).toBeDefined();
    });
  });

  describe('--json option presence', () => {
    for (const name of ['status', 'health', 'events', 'join', 'leave']) {
      it(`${name} has --json option`, () => {
        const cmd = clusterCommand.commands.find(c => c.name() === name);
        const jsonOpt = cmd?.options.find(o => o.long === '--json');
        expect(jsonOpt).toBeDefined();
      });
    }
  });

  describe('status subcommand', () => {
    it('outputs disabled message in json when cluster disabled', async () => {
      mockLoadConfig.mockReturnValue({ cluster: makeClusterConfig({ enabled: false }) });
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'status', '--json']);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.enabled).toBe(false);
    });

    it('includes local and peers in json output when enabled', async () => {
      mockFetchLocal.mockResolvedValue(makeStatus());
      mockFetchFromUrl.mockResolvedValue(
        makeStatus({ node_id: 'node-b', role: 'follower', is_leader: false })
      );
      mockLoadConfig.mockReturnValue({
        cluster: makeClusterConfig({ peers: [{ id: 'node-b', url: 'http://10.0.0.2:8787' }] }),
      });

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'status', '--json']);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.enabled).toBe(true);
      expect(parsed.local).toBeDefined();
      expect(parsed.peers).toHaveLength(1);
    });
  });

  describe('health subcommand', () => {
    it('outputs disabled message in json when cluster disabled', async () => {
      mockLoadConfig.mockReturnValue({ cluster: makeClusterConfig({ enabled: false }) });
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'health', '--json']);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.enabled).toBe(false);
    });

    it('reports latency and reachability for all nodes', async () => {
      mockFetchLocal.mockResolvedValue(makeStatus());
      mockFetchFromUrl.mockResolvedValue(
        makeStatus({ node_id: 'node-b', role: 'follower', is_leader: false })
      );
      mockLoadConfig.mockReturnValue({
        cluster: makeClusterConfig({ peers: [{ id: 'node-b', url: 'http://10.0.0.2:8787' }] }),
      });

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'health', '--json']);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.total_nodes).toBe(2);
      expect(parsed.reachable).toBe(2);
      expect(parsed.nodes[0].reachable).toBe(true);
      expect(typeof parsed.nodes[0].latencyMs).toBe('number');
    });

    it('marks unreachable nodes correctly', async () => {
      mockFetchLocal.mockResolvedValue(makeStatus());
      mockFetchFromUrl.mockResolvedValue(null);
      mockLoadConfig.mockReturnValue({
        cluster: makeClusterConfig({ peers: [{ id: 'node-b', url: 'http://10.0.0.2:8787' }] }),
      });

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'health', '--json']);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.reachable).toBe(1);
      const peerNode = parsed.nodes.find((n: { id: string }) => n.id === 'node-b');
      expect(peerNode.reachable).toBe(false);
      expect(peerNode.latencyMs).toBeNull();
    });
  });

  describe('events subcommand', () => {
    it('returns disabled message when cluster disabled', async () => {
      mockLoadConfig.mockReturnValue({ cluster: makeClusterConfig({ enabled: false }) });
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'events', '--json']);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.enabled).toBe(false);
    });

    it('returns events list from local runtime', async () => {
      const fakeEvent = {
        event_id: 'evt-1',
        table_name: 'stories',
        row_id: 'STORY-1',
        op: 'upsert',
        payload: {},
        version: { actor_id: 'node-test', actor_counter: 1, logical_ts: 100 },
        created_at: new Date().toISOString(),
      };
      mockFetchEvents.mockResolvedValue([fakeEvent]);

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'events', '--json']);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.total).toBe(1);
      expect(parsed.events[0].event_id).toBe('evt-1');
    });

    it('filters events by table name', async () => {
      const events = [
        {
          event_id: 'e1',
          table_name: 'stories',
          row_id: 'S1',
          op: 'upsert',
          payload: {},
          version: { actor_id: 'n', actor_counter: 1, logical_ts: 1 },
          created_at: new Date().toISOString(),
        },
        {
          event_id: 'e2',
          table_name: 'agents',
          row_id: 'A1',
          op: 'upsert',
          payload: {},
          version: { actor_id: 'n', actor_counter: 2, logical_ts: 2 },
          created_at: new Date().toISOString(),
        },
      ];
      mockFetchEvents.mockResolvedValue(events);

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync([
        'node',
        'cluster',
        'events',
        '--table',
        'stories',
        '--json',
      ]);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.total).toBe(1);
      expect(parsed.events[0].table_name).toBe('stories');
    });

    it('passes limit to fetchLocalClusterEvents', async () => {
      mockFetchEvents.mockResolvedValue([]);
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'events', '--limit', '10', '--json']);

      expect(mockFetchEvents).toHaveBeenCalledWith(expect.anything(), 10);
    });
  });

  describe('join subcommand', () => {
    it('posts join request to peer and reports success', async () => {
      mockPostPeer.mockResolvedValue({
        success: true,
        leader_id: 'node-b',
        leader_url: 'http://10.0.0.2:8787',
        peers: [
          { id: 'node-test', url: 'http://127.0.0.1:8787' },
          { id: 'node-b', url: 'http://10.0.0.2:8787' },
        ],
        term: 2,
      });

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync([
        'node',
        'cluster',
        'join',
        'http://10.0.0.2:8787',
        '--json',
      ]);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.success).toBe(true);
    });

    it('follows redirect to leader when peer is not leader', async () => {
      // First call: peer returns not-leader redirect
      mockPostPeer
        .mockResolvedValueOnce({
          success: false,
          leader_id: 'node-leader',
          leader_url: 'http://10.0.0.3:8787',
          peers: [],
          term: 3,
        })
        // Second call: leader accepts
        .mockResolvedValueOnce({
          success: true,
          leader_id: 'node-leader',
          leader_url: 'http://10.0.0.3:8787',
          peers: [{ id: 'node-test', url: 'http://127.0.0.1:8787' }],
          term: 3,
        });

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync([
        'node',
        'cluster',
        'join',
        'http://10.0.0.2:8787',
        '--json',
      ]);

      expect(mockPostPeer).toHaveBeenCalledTimes(2);
      const parsed = JSON.parse(logs[0]);
      expect(parsed.success).toBe(true);
    });

    it('exits non-zero when peer unreachable', async () => {
      mockPostPeer.mockResolvedValue(null);

      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(
        clusterCommand.parseAsync(['node', 'cluster', 'join', 'http://bad:8787'])
      ).rejects.toThrow();

      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

  describe('leave subcommand', () => {
    it('posts leave request and reports success', async () => {
      mockFetchLocal.mockResolvedValue(makeStatus({ role: 'follower', is_leader: false }));
      mockPostLocal.mockResolvedValue({
        success: true,
        peers: [{ id: 'node-b', url: 'http://10.0.0.2:8787' }],
      });

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      await clusterCommand.parseAsync(['node', 'cluster', 'leave', '--json']);

      const parsed = JSON.parse(logs[0]);
      expect(parsed.success).toBe(true);
    });

    it('rejects leave when this node is the leader', async () => {
      mockFetchLocal.mockResolvedValue(makeStatus({ role: 'leader', is_leader: true }));

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(
        clusterCommand.parseAsync(['node', 'cluster', 'leave', '--json'])
      ).rejects.toThrow();

      expect(exitSpy).toHaveBeenCalledWith(1);
      const parsed = JSON.parse(logs[0]);
      expect(parsed.success).toBe(false);

      exitSpy.mockRestore();
    });

    it('exits non-zero when local runtime unavailable', async () => {
      mockFetchLocal.mockResolvedValue(null);

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(clusterCommand.parseAsync(['node', 'cluster', 'leave'])).rejects.toThrow();

      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });
});
