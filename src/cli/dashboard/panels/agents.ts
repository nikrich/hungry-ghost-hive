import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { appendFileSync } from 'fs';
import { getActiveAgents, type AgentRow } from '../../../db/queries/agents.js';

function debugLog(msg: string) {
  appendFileSync('/tmp/hive-dashboard-debug.log', `${new Date().toISOString()} ${msg}\n`);
}

export function createAgentsPanel(screen: Widgets.Screen, db: Database): Widgets.ListTableElement {

  const table = blessed.listtable({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: '30%',
    border: { type: 'line' },
    label: ' Agents ',
    keys: true,
    vi: true,
    mouse: true,
    style: {
      header: { bold: true, fg: 'cyan' },
      cell: { fg: 'white' },
      selected: { bg: 'blue' },
      border: { fg: 'cyan' },
    },
    align: 'left',
    tags: true,
  });

  // Initial data
  updateAgentsPanel(table, db);

  return table;
}

export function updateAgentsPanel(table: Widgets.ListTableElement, db: Database): void {
  const agents = getActiveAgents(db);
  debugLog(`updateAgentsPanel called, found ${agents.length} agents`);

  const headers = ['Type', 'Model', 'Status', 'Story', 'Tmux Session'];

  if (agents.length === 0) {
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
