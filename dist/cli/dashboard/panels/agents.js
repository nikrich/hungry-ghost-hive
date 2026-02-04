import blessed from 'blessed';
import { appendFileSync } from 'fs';
import { getActiveAgents } from '../../../db/queries/agents.js';
function debugLog(msg) {
    appendFileSync('/tmp/hive-dashboard-debug.log', `${new Date().toISOString()} ${msg}\n`);
}
export function createAgentsPanel(screen, db) {
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
export function updateAgentsPanel(table, db) {
    const agents = getActiveAgents(db);
    debugLog(`updateAgentsPanel called, found ${agents.length} agents`);
    const headers = ['Type', 'Model', 'Status', 'Story', 'Tmux Session'];
    if (agents.length === 0) {
        debugLog('Setting empty data');
        table.setData([headers, ['(no active agents)', '', '', '', '']]);
        return;
    }
    const rows = agents.map((agent) => [
        agent.type.toUpperCase(),
        agent.model || '-',
        formatStatus(agent.status),
        agent.current_story_id || '-',
        agent.tmux_session || '-',
    ]);
    debugLog(`Setting data with ${rows.length} rows`);
    table.setData([headers, ...rows]);
}
function formatStatus(status) {
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
//# sourceMappingURL=agents.js.map