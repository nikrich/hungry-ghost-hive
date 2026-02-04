import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { getActiveAgents, type AgentRow } from '../../../db/queries/agents.js';

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

  const headers = ['ID', 'Type', 'Team', 'Status', 'Current Story'];
  const rows = agents.map((agent: AgentRow) => [
    agent.id.substring(0, 20),
    agent.type.toUpperCase(),
    agent.team_id?.substring(0, 10) || '-',
    formatStatus(agent.status),
    agent.current_story_id || '-',
  ]);

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
