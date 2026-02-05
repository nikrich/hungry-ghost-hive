import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { appendFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { getActiveAgents, type AgentRow } from '../../../db/queries/agents.js';
import { getTeamById } from '../../../db/queries/teams.js';
import { getHiveSessions } from '../../../tmux/manager.js';

function debugLog(msg: string) {
  appendFileSync('/tmp/hive-dashboard-debug.log', `${new Date().toISOString()} ${msg}\n`);
}

// Store agents for selection lookup
let currentAgents: AgentRow[] = [];

export function createAgentsPanel(screen: Widgets.Screen, db: Database): Widgets.ListElement {

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
  list.key(['enter'], () => {
    const selectedIndex = (list as unknown as { selected: number }).selected;
    // Index 0 is the header, so subtract 1 for agent index
    const agentIndex = selectedIndex - 1;

    debugLog(`Enter pressed, selectedIndex=${selectedIndex}, agentIndex=${agentIndex}, agents=${currentAgents.length}`);

    if (agentIndex >= 0 && agentIndex < currentAgents.length) {
      const agent = currentAgents[agentIndex];
      debugLog(`Selected agent: ${agent.id}, tmux: ${agent.tmux_session}`);
      if (agent.tmux_session) {
        // Temporarily leave blessed to attach to tmux
        screen.destroy();

        // Attach to the tmux session (blocks until user detaches with Ctrl+B, D)
        spawnSync('tmux', ['attach', '-t', agent.tmux_session], {
          stdio: 'inherit',
        });

        // When user detaches, restart the dashboard
        console.log('\nReturning to dashboard...');
        spawnSync('hive', ['dashboard'], {
          stdio: 'inherit',
        });
        process.exit(0);
      }
    }
  });

  // Initial data
  updateAgentsPanel(list, db);

  return list;
}

// Extended agent with repo info for display
interface DisplayAgent extends AgentRow {
  repo?: string;
}

export async function updateAgentsPanel(list: Widgets.ListElement, db: Database): Promise<void> {
  const agents = getActiveAgents(db);
  debugLog(`updateAgentsPanel called, found ${agents.length} agents`);

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
  const header = formatRow('TYPE', 'REPO', 'STATUS', 'STORY', 'TMUX SESSION', true);

  if (displayAgents.length === 0) {
    currentAgents = [];
    debugLog('Setting empty data');
    list.setItems([header, '{gray-fg}(no active agents){/}']);
    return;
  }

  const rows = displayAgents.map((agent: DisplayAgent) =>
    formatRow(
      agent.type.toUpperCase(),
      agent.repo || '-',
      agent.status,
      agent.current_story_id || '-',
      agent.tmux_session || '-',
      false
    )
  );

  debugLog(`Setting data with ${rows.length} rows`);
  list.setItems([header, ...rows]);

  // Select first agent row (index 1, since 0 is the header)
  if (rows.length > 0) {
    list.select(1);
  }
}

function formatRow(type: string, repo: string, status: string, story: string, tmux: string, isHeader: boolean): string {
  // Fixed column widths
  const COL_TYPE = 14;
  const COL_REPO = 18;
  const COL_STATUS = 12;
  const COL_STORY = 14;

  // Format status with color (pad first, then wrap with color)
  const statusText = status.toUpperCase().padEnd(COL_STATUS);
  const coloredStatus = colorizeStatus(status, statusText);

  // Truncate long values
  const repoDisplay = repo.length > COL_REPO - 1 ? repo.substring(0, COL_REPO - 2) + '…' : repo;
  const storyDisplay = story.length > COL_STORY - 1 ? story.substring(0, COL_STORY - 2) + '…' : story;

  const cols = [
    type.padEnd(COL_TYPE),
    repoDisplay.padEnd(COL_REPO),
    coloredStatus,
    storyDisplay.padEnd(COL_STORY),
    tmux,
  ];

  if (isHeader) {
    return `{cyan-fg}{bold}${type.padEnd(COL_TYPE)}${repo.padEnd(COL_REPO)}${status.toUpperCase().padEnd(COL_STATUS)}${story.padEnd(COL_STORY)}${tmux}{/}`;
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
