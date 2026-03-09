// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import type {
  MembershipJoinResponse,
  MembershipLeaveResponse,
} from '../../cluster/cluster-http-server.js';
import {
  fetchClusterStatusFromUrl,
  fetchLocalClusterEvents,
  fetchLocalClusterStatus,
  fetchReplicationLag,
  postToLocalCluster,
  postToPeerCluster,
} from '../../cluster/runtime.js';
import { loadConfig } from '../../config/loader.js';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';

interface PeerStatus {
  id: string;
  url: string;
  reachable: boolean;
  status: Awaited<ReturnType<typeof fetchLocalClusterStatus>>;
}

interface PeerHealth {
  id: string;
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  role: string | null;
  term: number | null;
}

export const clusterCommand = new Command('cluster').description('Distributed cluster operations');

clusterCommand
  .command('status')
  .description('Show local and peer cluster status')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    if (!config.cluster.enabled) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              enabled: false,
              message:
                'Cluster mode is disabled (set cluster.enabled=true in .hive/hive.config.yaml).',
            },
            null,
            2
          )
        );
      } else {
        console.log(chalk.yellow('Cluster mode is disabled.'));
        console.log(
          chalk.gray('Set `cluster.enabled: true` in `.hive/hive.config.yaml` to enable.')
        );
      }
      return;
    }

    const local = await fetchLocalClusterStatus(config.cluster);
    const peerStatuses: PeerStatus[] = await Promise.all(
      config.cluster.peers.map(async peer => {
        const status = await fetchClusterStatusFromUrl(
          `${peer.url.replace(/\/$/, '')}/cluster/v1/status`,
          {
            authToken: config.cluster.auth_token,
            timeoutMs: config.cluster.request_timeout_ms,
          }
        );

        return {
          id: peer.id,
          url: peer.url,
          reachable: status !== null,
          status,
        };
      })
    );

    const payload = {
      enabled: true,
      quorum: Math.floor((config.cluster.peers.length + 1) / 2) + 1,
      local,
      peers: peerStatuses,
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(chalk.bold('\nCluster Status\n'));
    console.log(chalk.gray(`Node ID: ${config.cluster.node_id}`));
    console.log(chalk.gray(`Public URL: ${config.cluster.public_url}`));
    console.log(chalk.gray(`Quorum: ${payload.quorum}`));

    if (!local) {
      console.log(chalk.red('\nLocal runtime: unavailable'));
      console.log(chalk.gray('Start it with: hive manager start'));
    } else {
      const roleColor = local.is_leader ? chalk.green : chalk.yellow;
      console.log(chalk.bold('\nLocal Runtime'));
      console.log(
        `${roleColor(local.role.toUpperCase())} term=${local.term} leader=${local.leader_id || 'unknown'} voted_for=${local.voted_for || '-'}`
      );
      console.log(
        chalk.gray(
          `Raft: commit=${local.raft_commit_index} applied=${local.raft_last_applied} last_log=${local.raft_last_log_index}`
        )
      );
    }

    console.log(chalk.bold('\nPeers'));
    if (peerStatuses.length === 0) {
      console.log(chalk.gray('No peers configured.'));
      return;
    }

    for (const peer of peerStatuses) {
      if (!peer.reachable || !peer.status) {
        console.log(`${chalk.red('UNREACHABLE')} ${peer.id} ${chalk.gray(peer.url)}`);
        continue;
      }

      const marker = peer.status.is_leader ? chalk.green('LEADER') : chalk.yellow(peer.status.role);
      console.log(
        `${marker} ${peer.id} term=${peer.status.term} leader=${peer.status.leader_id || 'unknown'} ${chalk.gray(peer.url)}`
      );
    }

    // Fetch and display replication lag
    const lagSummary = await fetchReplicationLag(config.cluster);
    if (lagSummary && lagSummary.peers.length > 0) {
      console.log(chalk.bold('\nReplication Lag'));
      if (lagSummary.last_sync_at) {
        console.log(chalk.gray(`Last sync: ${lagSummary.last_sync_at}`));
      }

      for (const peer of lagSummary.peers) {
        if (!peer.reachable) {
          console.log(
            `  ${chalk.red('UNREACHABLE')} ${peer.peer_id} ${chalk.gray(`(last sync: ${peer.last_sync_at || 'never'})`)}`
          );
          continue;
        }

        const lagColor =
          peer.events_behind === 0
            ? chalk.green
            : peer.events_behind > 100
              ? chalk.red
              : chalk.yellow;
        const lagLabel =
          peer.events_behind === 0 ? 'IN_SYNC' : `${peer.events_behind} events behind`;
        const duration =
          peer.last_sync_duration_ms !== null ? ` ${peer.last_sync_duration_ms}ms` : '';
        console.log(
          `  ${lagColor(lagLabel)} ${peer.peer_id} applied=${peer.last_sync_events_applied}${duration}`
        );
      }
    }

    console.log();
  });

clusterCommand
  .command('replication-lag')
  .description('Show per-peer replication lag details')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    if (!config.cluster.enabled) {
      if (options.json) {
        console.log(JSON.stringify({ enabled: false }, null, 2));
      } else {
        console.log(chalk.yellow('Cluster mode is disabled.'));
      }
      return;
    }

    const lagSummary = await fetchReplicationLag(config.cluster);

    if (!lagSummary) {
      if (options.json) {
        console.log(
          JSON.stringify({ error: 'Unable to fetch replication lag from local runtime' }, null, 2)
        );
      } else {
        console.log(chalk.red('Unable to fetch replication lag from local runtime.'));
        console.log(chalk.gray('Start it with: hive manager start'));
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(lagSummary, null, 2));
      return;
    }

    console.log(chalk.bold('\nReplication Lag Summary\n'));
    console.log(chalk.gray(`Node: ${lagSummary.node_id}`));
    console.log(chalk.gray(`Local events: ${lagSummary.total_local_events}`));
    console.log(chalk.gray(`Last sync: ${lagSummary.last_sync_at || 'never'}`));

    if (Object.keys(lagSummary.version_vector).length > 0) {
      console.log(chalk.bold('\nVersion Vector'));
      for (const [actor, counter] of Object.entries(lagSummary.version_vector)) {
        console.log(chalk.gray(`  ${actor}: ${counter}`));
      }
    }

    console.log(chalk.bold('\nPeer Lag'));
    if (lagSummary.peers.length === 0) {
      console.log(chalk.gray('  No peers configured.'));
    } else {
      for (const peer of lagSummary.peers) {
        if (!peer.reachable) {
          console.log(`  ${chalk.red('UNREACHABLE')} ${peer.peer_id} ${chalk.gray(peer.peer_url)}`);
          console.log(chalk.gray(`    Last sync: ${peer.last_sync_at || 'never'}`));
          continue;
        }

        const lagColor =
          peer.events_behind === 0
            ? chalk.green
            : peer.events_behind > 100
              ? chalk.red
              : chalk.yellow;
        const lagLabel =
          peer.events_behind === 0 ? 'IN_SYNC' : `${peer.events_behind} events behind`;
        console.log(`  ${lagColor(lagLabel)} ${peer.peer_id} ${chalk.gray(peer.peer_url)}`);
        console.log(
          chalk.gray(
            `    applied=${peer.last_sync_events_applied} duration=${peer.last_sync_duration_ms ?? '-'}ms last_sync=${peer.last_sync_at || 'never'}`
          )
        );
      }
    }

    console.log();
  });

clusterCommand
  .command('health')
  .description('Check connectivity and latency to all cluster peers')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    if (!config.cluster.enabled) {
      if (options.json) {
        console.log(JSON.stringify({ enabled: false }, null, 2));
      } else {
        console.log(chalk.yellow('Cluster mode is disabled.'));
      }
      return;
    }

    const peerHealthResults: PeerHealth[] = await Promise.all(
      config.cluster.peers.map(async peer => {
        const start = Date.now();
        const status = await fetchClusterStatusFromUrl(
          `${peer.url.replace(/\/$/, '')}/cluster/v1/status`,
          {
            authToken: config.cluster.auth_token,
            timeoutMs: config.cluster.request_timeout_ms,
          }
        );
        const latencyMs = status ? Date.now() - start : null;

        return {
          id: peer.id,
          url: peer.url,
          reachable: status !== null,
          latencyMs,
          role: status?.role ?? null,
          term: status?.term ?? null,
        };
      })
    );

    // Also check self
    const selfStart = Date.now();
    const selfStatus = await fetchLocalClusterStatus(config.cluster);
    const selfLatencyMs = selfStatus ? Date.now() - selfStart : null;

    const selfHealth: PeerHealth = {
      id: config.cluster.node_id,
      url: config.cluster.public_url,
      reachable: selfStatus !== null,
      latencyMs: selfLatencyMs,
      role: selfStatus?.role ?? null,
      term: selfStatus?.term ?? null,
    };

    const allNodes = [selfHealth, ...peerHealthResults];
    const reachableCount = allNodes.filter(n => n.reachable).length;

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            enabled: true,
            total_nodes: allNodes.length,
            reachable: reachableCount,
            nodes: allNodes,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(chalk.bold('\nCluster Health\n'));
    console.log(chalk.gray(`${reachableCount}/${allNodes.length} nodes reachable`));

    for (const node of allNodes) {
      const isSelf = node.id === config.cluster.node_id;
      const label = isSelf ? chalk.cyan('(self)') : '';

      if (!node.reachable) {
        console.log(`  ${chalk.red('✗')} ${node.id} ${label} ${chalk.gray(node.url)}`);
        console.log(`    ${chalk.red('UNREACHABLE')}`);
      } else {
        const latency = node.latencyMs !== null ? `${node.latencyMs}ms` : '?';
        const roleLabel = node.role?.toUpperCase() ?? 'UNKNOWN';
        console.log(`  ${chalk.green('✓')} ${node.id} ${label} ${chalk.gray(node.url)}`);
        console.log(
          `    ${chalk.gray(roleLabel)} term=${node.term ?? '?'} latency=${chalk.cyan(latency)}`
        );
      }
    }

    console.log();
  });

clusterCommand
  .command('events')
  .description('Show recent cluster replication events')
  .option('--limit <n>', 'Maximum number of events to show', '50')
  .option('--table <name>', 'Filter by table name')
  .option('--json', 'Output as JSON')
  .action(async (options: { limit?: string; table?: string; json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    if (!config.cluster.enabled) {
      if (options.json) {
        console.log(JSON.stringify({ enabled: false, events: [] }, null, 2));
      } else {
        console.log(chalk.yellow('Cluster mode is disabled.'));
      }
      return;
    }

    const limit = Math.max(1, Math.min(1000, parseInt(options.limit ?? '50', 10) || 50));
    const events = await fetchLocalClusterEvents(config.cluster, limit);

    if (!events) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'Local cluster runtime is not reachable.' }, null, 2));
      } else {
        console.error(chalk.red('Local cluster runtime is not reachable.'));
        console.log(chalk.gray('Start it with: hive manager start'));
      }
      process.exit(1);
    }

    const filtered = options.table ? events.filter(e => e.table_name === options.table) : events;

    if (options.json) {
      console.log(
        JSON.stringify({ enabled: true, total: filtered.length, events: filtered }, null, 2)
      );
      return;
    }

    console.log(chalk.bold(`\nCluster Events (${filtered.length})\n`));

    if (filtered.length === 0) {
      console.log(chalk.gray('No events found.'));
      console.log();
      return;
    }

    for (const event of filtered) {
      const opColor = event.op === 'upsert' ? chalk.green : chalk.red;
      const ts = new Date(event.created_at).toLocaleString();
      console.log(
        `${chalk.gray(ts)} ${opColor(event.op.toUpperCase())} ${chalk.cyan(event.table_name)} ${event.row_id}`
      );
      console.log(
        chalk.gray(
          `  actor=${event.version.actor_id} counter=${event.version.actor_counter} logical_ts=${event.version.logical_ts}`
        )
      );
    }

    console.log();
  });

clusterCommand
  .command('join')
  .description('Join this node to an existing cluster via a peer URL')
  .argument('<peer-url>', 'URL of an existing cluster node (e.g. http://10.0.0.2:8787)')
  .option('--json', 'Output as JSON')
  .action(async (peerUrl: string, options: { json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    if (!config.cluster.enabled) {
      console.error(chalk.red('Cluster mode is disabled.'));
      console.log(chalk.gray('Set `cluster.enabled: true` in `.hive/hive.config.yaml` to enable.'));
      process.exit(1);
    }

    const response = await postToPeerCluster<MembershipJoinResponse>(
      peerUrl,
      '/cluster/v1/membership/join',
      { node_id: config.cluster.node_id, url: config.cluster.public_url },
      { authToken: config.cluster.auth_token, timeoutMs: config.cluster.request_timeout_ms }
    );

    if (!response) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: 'Peer unreachable.' }, null, 2));
      } else {
        console.error(chalk.red(`Failed to reach peer at ${peerUrl}.`));
      }
      process.exit(1);
    }

    if (!response.success && response.leader_url) {
      // Peer redirected us to the leader
      const leaderResponse = await postToPeerCluster<MembershipJoinResponse>(
        response.leader_url,
        '/cluster/v1/membership/join',
        { node_id: config.cluster.node_id, url: config.cluster.public_url },
        { authToken: config.cluster.auth_token, timeoutMs: config.cluster.request_timeout_ms }
      );

      if (options.json) {
        console.log(
          JSON.stringify(
            leaderResponse ?? { success: false, error: 'Leader unreachable.' },
            null,
            2
          )
        );
      } else if (leaderResponse?.success) {
        console.log(chalk.green(`✓ Joined cluster via leader ${response.leader_id ?? 'unknown'}.`));
        console.log(chalk.gray(`Peers: ${leaderResponse.peers.map(p => p.id).join(', ')}`));
      } else {
        console.error(chalk.red('Failed to join cluster via leader.'));
        process.exit(1);
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    if (response.success) {
      console.log(chalk.green(`✓ Joined cluster.`));
      console.log(chalk.gray(`Leader: ${response.leader_id ?? 'unknown'}`));
      console.log(chalk.gray(`Peers: ${response.peers.map(p => p.id).join(', ')}`));
    } else {
      console.error(chalk.red('Failed to join cluster (node not leader and no leader available).'));
      process.exit(1);
    }
  });

clusterCommand
  .command('leave')
  .description('Gracefully remove this node from the cluster')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    if (!config.cluster.enabled) {
      console.error(chalk.red('Cluster mode is disabled.'));
      process.exit(1);
    }

    // First get local status to find the leader
    const localStatus = await fetchLocalClusterStatus(config.cluster);

    if (!localStatus) {
      if (options.json) {
        console.log(
          JSON.stringify(
            { success: false, error: 'Local cluster runtime is not reachable.' },
            null,
            2
          )
        );
      } else {
        console.error(chalk.red('Local cluster runtime is not reachable.'));
        console.log(chalk.gray('Start it with: hive manager start'));
      }
      process.exit(1);
    }

    // If we are the leader, cannot leave (would need to transfer leadership first)
    if (localStatus.is_leader) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: 'This node is the leader. Transfer leadership before leaving.',
            },
            null,
            2
          )
        );
      } else {
        console.error(chalk.red('This node is the current leader and cannot leave directly.'));
        console.log(chalk.gray('Wait for a new leader to be elected, then retry.'));
      }
      process.exit(1);
    }

    // POST leave to the local runtime (which will forward to leader or handle directly)
    const response = await postToLocalCluster<MembershipLeaveResponse>(
      config.cluster,
      '/cluster/v1/membership/leave',
      { node_id: config.cluster.node_id }
    );

    if (!response) {
      if (options.json) {
        console.log(
          JSON.stringify(
            { success: false, error: 'Failed to contact local cluster runtime.' },
            null,
            2
          )
        );
      } else {
        console.error(chalk.red('Failed to contact local cluster runtime.'));
      }
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    if (response.success) {
      console.log(chalk.green(`✓ Left cluster successfully.`));
      console.log(
        chalk.gray(`Remaining peers: ${response.peers.map(p => p.id).join(', ') || 'none'}`)
      );
    } else {
      console.error(chalk.red('Failed to leave cluster.'));
      process.exit(1);
    }
  });
