import chalk from 'chalk';
import { Command } from 'commander';
import { fetchClusterStatusFromUrl, fetchLocalClusterStatus } from '../../cluster/runtime.js';
import { loadConfig } from '../../config/loader.js';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';

interface PeerStatus {
  id: string;
  url: string;
  reachable: boolean;
  status: Awaited<ReturnType<typeof fetchLocalClusterStatus>>;
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
              message: 'Cluster mode is disabled (set cluster.enabled=true in .hive/hive.config.yaml).',
            },
            null,
            2
          )
        );
      } else {
        console.log(chalk.yellow('Cluster mode is disabled.'));
        console.log(chalk.gray('Set `cluster.enabled: true` in `.hive/hive.config.yaml` to enable.'));
      }
      return;
    }

    const local = await fetchLocalClusterStatus(config.cluster);
    const peerStatuses: PeerStatus[] = await Promise.all(
      config.cluster.peers.map(async peer => {
        const status = await fetchClusterStatusFromUrl(`${peer.url.replace(/\/$/, '')}/cluster/v1/status`, {
          authToken: config.cluster.auth_token,
          timeoutMs: config.cluster.request_timeout_ms,
        });

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

    console.log();
  });
