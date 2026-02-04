import blessed from 'blessed';
import { getDatabase } from '../../db/client.js';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { createAgentsPanel, updateAgentsPanel } from './panels/agents.js';
import { createPipelinePanel, updatePipelinePanel } from './panels/pipeline.js';
import { createActivityPanel, updateActivityPanel } from './panels/activity.js';
import { createEscalationsPanel, updateEscalationsPanel } from './panels/escalations.js';
export async function startDashboard(options = {}) {
    const root = findHiveRoot();
    if (!root) {
        console.error('Not in a Hive workspace. Run "hive init" first.');
        process.exit(1);
    }
    const paths = getHivePaths(root);
    let db = await getDatabase(paths.hiveDir);
    const refreshInterval = options.refreshInterval || 5000;
    // Create screen
    const screen = blessed.screen({
        smartCSR: true,
        title: 'Hive Orchestrator Dashboard',
    });
    // Header
    blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: 1,
        content: ' {bold}HIVE ORCHESTRATOR{/bold}                                    [R]efresh [Q]uit',
        style: {
            bg: 'blue',
            fg: 'white',
        },
        tags: true,
    });
    // Create panels
    const agentsPanel = createAgentsPanel(screen, db.db);
    const pipelinePanel = createPipelinePanel(screen, db.db);
    const activityPanel = createActivityPanel(screen, db.db);
    const escalationsPanel = createEscalationsPanel(screen, db.db);
    // Footer
    blessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 1,
        content: ' Tab: Switch panels | Enter: Expand | /: Search | Arrow keys: Navigate',
        style: {
            bg: 'blue',
            fg: 'white',
        },
    });
    // Focus management
    const panels = [agentsPanel, activityPanel, escalationsPanel];
    let focusIndex = 0;
    panels[focusIndex].focus();
    // Refresh function - reloads database from disk to see changes from other processes
    const refresh = async () => {
        // Close old connection and reload from disk
        db.db.close();
        db = await getDatabase(paths.hiveDir);
        updateAgentsPanel(agentsPanel, db.db);
        updatePipelinePanel(pipelinePanel, db.db);
        updateActivityPanel(activityPanel, db.db);
        updateEscalationsPanel(escalationsPanel, db.db);
        screen.render();
    };
    // Auto-refresh
    const timer = setInterval(refresh, refreshInterval);
    // Key bindings
    screen.key(['q', 'C-c'], () => {
        clearInterval(timer);
        db.db.close();
        screen.destroy();
        process.exit(0);
    });
    screen.key(['r'], () => {
        refresh();
    });
    screen.key(['tab'], () => {
        focusIndex = (focusIndex + 1) % panels.length;
        panels[focusIndex].focus();
        screen.render();
    });
    screen.key(['S-tab'], () => {
        focusIndex = (focusIndex - 1 + panels.length) % panels.length;
        panels[focusIndex].focus();
        screen.render();
    });
    // Initial render
    screen.render();
}
//# sourceMappingURL=index.js.map