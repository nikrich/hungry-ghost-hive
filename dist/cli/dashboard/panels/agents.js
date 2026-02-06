import blessed from 'blessed';
import { appendFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { getActiveAgents, getAllAgents, updateAgent } from '../../../db/queries/agents.js';
import { getTeamById } from '../../../db/queries/teams.js';
import { getHiveSessions } from '../../../tmux/manager.js';
import { loadConfig } from '../../../config/loader.js';
import { findHiveRoot, getHivePaths } from '../../../utils/paths.js';
function debugLog(msg) {
    appendFileSync('/tmp/hive-dashboard-debug.log', `${new Date().toISOString()} ${msg}\n`);
}
// Store agents for selection lookup
let currentAgents = [];
export function createAgentsPanel(screen, db) {
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
        const selectedIndex = list.selected;
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
export async function updateAgentsPanel(list, db) {
    // Preserve current selection before updating
    const currentSelection = list.selected;
    // Sync agent status with actual tmux sessions before reading from DB
    await syncAgentStatusWithTmux(db);
    const agents = getActiveAgents(db);
    debugLog(`updateAgentsPanel called, found ${agents.length} agents, currentSelection=${currentSelection}`);
    // Load config to get model version info
    const versionMap = {};
    try {
        const root = findHiveRoot();
        if (root) {
            const paths = getHivePaths(root);
            const config = loadConfig(paths.hiveDir);
            const modelKeys = Object.keys(config.models);
            for (const key of modelKeys) {
                versionMap[key] = config.models[key].model;
            }
        }
    }
    catch (err) {
        debugLog(`Failed to load config for version info: ${err}`);
    }
    // Check for manager session (not in DB)
    const hiveSessions = await getHiveSessions();
    const managerSession = hiveSessions.find(s => s.name === 'hive-manager');
    // Build combined list - manager first if running
    const displayAgents = [];
    if (managerSession) {
        // Add manager as a pseudo-agent
        displayAgents.push({
            id: 'manager',
            type: 'manager',
            team_id: null,
            tmux_session: 'hive-manager',
            model: '-',
            status: 'working',
            current_story_id: null,
            memory_state: null,
            created_at: '',
            updated_at: '',
            repo: '(all)',
        });
    }
    // Add regular agents with repo info
    for (const agent of agents) {
        const displayAgent = { ...agent };
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
    const header = formatRow('TYPE', 'MODEL', 'VERSION', 'REPO', 'STATUS', 'STORY', 'TMUX SESSION', true);
    if (displayAgents.length === 0) {
        currentAgents = [];
        debugLog('Setting empty data');
        list.setItems([header, '{gray-fg}(no active agents){/}']);
        return;
    }
    const rows = displayAgents.map((agent) => {
        const model = agent.model || '-';
        const version = agent.type === 'manager'
            ? '-'
            : versionMap[agent.type] || '-';
        return formatRow(agent.type.toUpperCase(), model, version, agent.repo || '-', agent.status, agent.current_story_id || '-', agent.tmux_session || '-', false);
    });
    debugLog(`Setting data with ${rows.length} rows`);
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
/**
 * Sync agent status in DB with actual tmux sessions.
 * If an agent has a tmux_session that no longer exists, mark it as terminated.
 */
async function syncAgentStatusWithTmux(db) {
    try {
        // Get all agents (including terminated ones, to check if they need updating)
        const allAgents = getAllAgents(db);
        // Get currently running tmux sessions
        const hiveSessions = await getHiveSessions();
        const runningSessionNames = new Set(hiveSessions.map(s => s.name));
        debugLog(`syncAgentStatusWithTmux: found ${runningSessionNames.size} running sessions`);
        // Check each agent's tmux session
        for (const agent of allAgents) {
            if (agent.tmux_session && agent.status !== 'terminated') {
                const sessionExists = runningSessionNames.has(agent.tmux_session);
                if (!sessionExists) {
                    // Tmux session no longer exists but agent is not marked as terminated
                    debugLog(`Agent ${agent.id} tmux session ${agent.tmux_session} not found, marking as terminated`);
                    updateAgent(db, agent.id, { status: 'terminated' });
                }
            }
        }
    }
    catch (err) {
        debugLog(`syncAgentStatusWithTmux error: ${err}`);
    }
}
function formatRow(type, model, version, repo, status, story, tmux, isHeader) {
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
    const modelDisplay = model.length > COL_MODEL - 1 ? model.substring(0, COL_MODEL - 2) + '…' : model;
    const versionDisplay = version.length > COL_VERSION - 1 ? version.substring(0, COL_VERSION - 2) + '…' : version;
    const repoDisplay = repo.length > COL_REPO - 1 ? repo.substring(0, COL_REPO - 2) + '…' : repo;
    const storyDisplay = story.length > COL_STORY - 1 ? story.substring(0, COL_STORY - 2) + '…' : story;
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
function colorizeStatus(status, paddedText) {
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
//# sourceMappingURL=agents.js.map