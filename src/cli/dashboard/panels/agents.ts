// Licensed under the Hungry Ghost Hive License. See LICENSE.

import blessed, { type Widgets } from 'blessed';
import { spawnSync } from 'child_process';
import { appendFileSync } from 'fs';
import type { Database } from 'sql.js';
import { loadConfig } from '../../../config/loader.js';
import type { ModelsConfig } from '../../../config/schema.js';
import { getActiveAgents, type AgentRow } from '../../../db/queries/agents.js';
import { getTeamById } from '../../../db/queries/teams.js';
import { getHiveSessions } from '../../../tmux/manager.js';
import { findHiveRoot, getHivePaths } from '../../../utils/paths.js';
import type { DashboardContext } from '../index.js';

function debugLog(msg: string) {
  appendFileSync('/tmp/hive-dashboard-debug.log', `${new Date().toISOString()} ${msg}\n`);
}

// Store agents for selection lookup
let currentAgents: AgentRow[] = [];

export function createAgentsPanel(screen: Widgets.Screen, ctx: DashboardContext): Widgets.ListElement {
  const list = blessed.list({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: '30%',
    border: { type: 'line' },
    label: ' Agents [↑↓: Navigate, Enter: Attach] ',
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    scrollbar: {
      ch: '█',
      style: { fg: 'cyan' },
    },
    style: {
      fg: 'white',
      selected: { bg: 'blue', fg: 'white', bold: true },
      border: { fg: 'cyan' },
      focus: { border: { fg: 'yellow' } },
    },
    tags: true,
  });

  // Handle Enter key to attach to tmux session
  list.key(['enter'], async () => {
    const selectedIndex = (list as unknown as { selected: number }).selected;
    // Index 0 is the header, so subtract 1 for agent index
    const agentIndex = selectedIndex - 1;

    debugLog(
      `Enter pressed, selectedIndex=${selectedIndex}, agentIndex=${agentIndex}, agents=${currentAgents.length}`
    );

    if (agentIndex >= 0 && agentIndex < currentAgents.length) {
      const agent = currentAgents[agentIndex];
      debugLog(`Selected agent: ${agent.id}, tmux: ${agent.tmux_session}`);
      if (agent.tmux_session) {
        // Pause the refresh timer so it cannot race with the post-detach update.
        ctx.pauseRefresh();
        // Temporarily suspend blessed while attached to tmux.
        const resumeScreen = screen.program.pause();

        try {
          // Attach to the tmux session (blocks until user detaches with Ctrl+B, D)
          spawnSync('tmux', ['attach', '-t', agent.tmux_session], {
            stdio: 'inherit',
          });
        } finally {
          // Restore dashboard in the same process (do not spawn nested dashboards).
          resumeScreen();
          // Force full redraw — after tmux detach the terminal buffer is clobbered.
          // Use realloc() (dirty=true) so every cell is marked for redraw, preventing
          // partial-update artifacts from blessed's incremental renderer.
          screen.realloc();
          try {
            // Use ctx.getDb() to get the current database — the original `db`
            // reference captured at panel creation time may have been closed and
            // replaced during a DB reload while tmux was attached.
            await updateAgentsPanel(list, ctx.getDb());
          } catch (err) {
            debugLog(`Failed to refresh agents panel after tmux detach: ${err}`);
          }
          screen.render();
          // Resume the refresh timer now that the UI is restored.
          ctx.resumeRefresh();
        }

        return;
      }
    }
  });

  // Initial data
  updateAgentsPanel(list, ctx.getDb());

  return list;
}

// Extended agent with repo info for display
interface DisplayAgent extends AgentRow {
  repo?: string;
}

export async function updateAgentsPanel(list: Widgets.ListElement, db: Database): Promise<void> {
  // Preserve current selection before updating
  const currentSelection = (list as unknown as { selected: number }).selected;

  const agents = getActiveAgents(db);
  debugLog(
    `updateAgentsPanel called, found ${agents.length} agents, currentSelection=${currentSelection}`
  );

  // Load config to get model version info
  const versionMap: Record<string, string> = {};
  try {
    const root = findHiveRoot();
    if (root) {
      const paths = getHivePaths(root);
      const config = loadConfig(paths.hiveDir);
      const modelKeys = Object.keys(config.models) as (keyof ModelsConfig)[];
      for (const key of modelKeys) {
        versionMap[key] = config.models[key].model;
      }
    }
  } catch (err) {
    debugLog(`Failed to load config for version info: ${err}`);
  }

  // Check for manager session (not in DB)
  const hiveSessions = await getHiveSessions();
  const managerSession = hiveSessions.find(s => s.name === 'hive-manager');

  // Build combined list - manager first if running
  const displayAgents: DisplayAgent[] = [];

  if (managerSession) {
    // Add manager as a pseudo-agent
    displayAgents.push({
      id: 'manager',
      type: 'manager' as AgentRow['type'],
      team_id: null,
      tmux_session: 'hive-manager',
      model: '-',
      status: 'working',
      current_story_id: null,
      memory_state: null,
      created_at: '',
      updated_at: '',
      repo: '(all)',
    } as DisplayAgent);
  }

  // Add regular agents with repo info
  for (const agent of agents) {
    const displayAgent: DisplayAgent = { ...agent };
    if (agent.team_id) {
      const team = getTeamById(db, agent.team_id);
      if (team?.repo_path) {
        // Extract repo name from path (e.g., "repos/my-service" -> "my-service")
        displayAgent.repo = team.repo_path.replace(/^repos\//, '');
      }
    }
    if (!displayAgent.repo && agent.type === 'tech_lead') {
      displayAgent.repo = '(all)';
    }
    displayAgents.push(displayAgent);
  }

  currentAgents = displayAgents; // Store for selection lookup

  // Format header
  const header = formatRow(
    'TYPE',
    'MODEL',
    'VERSION',
    'REPO',
    'STATUS',
    'STORY',
    'TMUX SESSION',
    true
  );

  if (displayAgents.length === 0) {
    currentAgents = [];
    debugLog('Setting empty data');
    // Clear items first to prevent blessed from leaving stale rows after
    // screen pause/resume cycles (tmux attach/detach).
    list.clearItems();
    list.setItems([header, '{gray-fg}(no active agents){/}']);
    return;
  }

  const rows = displayAgents.map((agent: DisplayAgent) => {
    const model = agent.model || '-';
    const version =
      agent.type === ('manager' as AgentRow['type']) ? '-' : versionMap[agent.type] || '-';
    return formatRow(
      agent.type.toUpperCase(),
      model,
      version,
      agent.repo || '-',
      agent.status,
      agent.current_story_id || '-',
      agent.tmux_session || '-',
      false
    );
  });

  debugLog(`Setting data with ${rows.length} rows`);
  // Clear items first to prevent blessed from leaving stale rows after
  // screen pause/resume cycles (tmux attach/detach).
  list.clearItems();
  list.setItems([header, ...rows]);

  // Restore selection position (clamped to valid range)
  // Index 0 is header, so valid agent indices are 1 to rows.length
  if (rows.length > 0) {
    const maxIndex = rows.length; // header + rows, so max selectable is rows.length
    const restoredIndex = Math.max(1, Math.min(currentSelection, maxIndex));
    list.select(restoredIndex);
    debugLog(`Restored selection to ${restoredIndex}`);
  }
}

function formatRow(
  type: string,
  model: string,
  version: string,
  repo: string,
  status: string,
  story: string,
  tmux: string,
  isHeader: boolean
): string {
  // Fixed column widths
  const COL_TYPE = 14;
  const COL_MODEL = 10;
  const COL_VERSION = 16;
  const COL_REPO = 18;
  const COL_STATUS = 12;
  const COL_STORY = 14;

  // Format status with color (pad first, then wrap with color)
  const statusText = status.toUpperCase().padEnd(COL_STATUS);
  const coloredStatus = colorizeStatus(status, statusText);

  // Truncate long values
  const modelDisplay =
    model.length > COL_MODEL - 1 ? model.substring(0, COL_MODEL - 2) + '…' : model;
  const versionDisplay =
    version.length > COL_VERSION - 1 ? version.substring(0, COL_VERSION - 2) + '…' : version;
  const repoDisplay = repo.length > COL_REPO - 1 ? repo.substring(0, COL_REPO - 2) + '…' : repo;
  const storyDisplay =
    story.length > COL_STORY - 1 ? story.substring(0, COL_STORY - 2) + '…' : story;

  const cols = [
    type.padEnd(COL_TYPE),
    modelDisplay.padEnd(COL_MODEL),
    versionDisplay.padEnd(COL_VERSION),
    repoDisplay.padEnd(COL_REPO),
    coloredStatus,
    storyDisplay.padEnd(COL_STORY),
    tmux,
  ];

  if (isHeader) {
    return `{cyan-fg}{bold}${type.padEnd(COL_TYPE)}${model.padEnd(COL_MODEL)}${version.padEnd(COL_VERSION)}${repo.padEnd(COL_REPO)}${status.toUpperCase().padEnd(COL_STATUS)}${story.padEnd(COL_STORY)}${tmux}{/}`;
  }
  return cols.join('');
}

function colorizeStatus(status: string, paddedText: string): string {
  switch (status) {
    case 'working':
      return `{yellow-fg}${paddedText}{/yellow-fg}`;
    case 'idle':
      return `{gray-fg}${paddedText}{/gray-fg}`;
    case 'blocked':
      return `{red-fg}${paddedText}{/red-fg}`;
    case 'terminated':
      return `{red-fg}${paddedText}{/red-fg}`;
    default:
      return paddedText;
  }
}
