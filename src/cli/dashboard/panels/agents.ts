import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { appendFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { getActiveAgents, type AgentRow } from '../../../db/queries/agents.js';

function debugLog(msg: string) {
  appendFileSync('/tmp/hive-dashboard-debug.log', `${new Date().toISOString()} ${msg}\n`);
}

// Store agents for selection lookup
let currentAgents: AgentRow[] = [];

export function createAgentsPanel(screen: Widgets.Screen, db: Database): Widgets.ListTableElement {

  const table = blessed.listtable({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: '30%',
    border: { type: 'line' },
    label: ' Agents [↑↓: Navigate, Enter: Attach to session] ',
    keys: true,
    vi: true,
    mouse: true,
    interactive: true,
    scrollable: true,
    scrollbar: {
      ch: '█',
      style: { fg: 'cyan' },
    },
    style: {
      header: { bold: true, fg: 'cyan' },
      cell: { fg: 'white' },
      selected: { bg: 'magenta', fg: 'white', bold: true },
      border: { fg: 'cyan' },
      focus: { border: { fg: 'yellow' } },
    },
    align: 'left',
    tags: true,
  });

  // Handle Enter key to attach to tmux session
  table.key(['enter'], () => {
    const selectedIndex = (table as unknown as { selected: number }).selected;
    // selected index 0 is the header row, so subtract 1
    const agentIndex = selectedIndex - 1;

    if (agentIndex >= 0 && agentIndex < currentAgents.length) {
      const agent = currentAgents[agentIndex];
      if (agent.tmux_session) {
        // Temporarily leave blessed to attach to tmux
        screen.destroy();

        // Attach to the tmux session (blocks until user detaches with Ctrl+B, D)
        spawnSync('tmux', ['attach', '-t', agent.tmux_session], {
          stdio: 'inherit',
        });

        // When user detaches, restart the dashboard
        console.log('\nReturning to dashboard... (run "hive dashboard" to reopen)');
        process.exit(0);
      }
    }
  });

  // Initial data
  updateAgentsPanel(table, db);

  return table;
}

export function updateAgentsPanel(table: Widgets.ListTableElement, db: Database): void {
  const agents = getActiveAgents(db);
  currentAgents = agents; // Store for selection lookup
  debugLog(`updateAgentsPanel called, found ${agents.length} agents`);

  const headers = ['Type', 'Model', 'Status', 'Story', 'Tmux Session'];

  if (agents.length === 0) {
    currentAgents = [];
    debugLog('Setting empty data');
    table.setData([headers, ['(no active agents)', '', '', '', '']]);
    return;
  }

  const rows = agents.map((agent: AgentRow) => [
    agent.type.toUpperCase(),
    agent.model || '-',
    formatStatus(agent.status),
    agent.current_story_id || '-',
    agent.tmux_session || '-',
  ]);

  debugLog(`Setting data with ${rows.length} rows`);
  table.setData([headers, ...rows]);

  // Select first agent row (index 1, since 0 is the header)
  if (rows.length > 0) {
    table.select(1);
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'working':
      return '{yellow-fg}WORKING{/}';
    case 'idle':
      return '{gray-fg}IDLE{/}';
    case 'blocked':
      return '{red-fg}BLOCKED{/}';
    default:
      return status;
  }
}
