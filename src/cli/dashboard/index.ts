import blessed from 'blessed';
import { appendFileSync } from 'fs';
import { getDatabase, type DatabaseClient } from '../../db/client.js';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';

function debugLog(msg: string) {
  appendFileSync('/tmp/hive-dashboard-debug.log', `${new Date().toISOString()} ${msg}\n`);
}
import { createAgentsPanel, updateAgentsPanel } from './panels/agents.js';
import { createStoriesPanel, updateStoriesPanel } from './panels/stories.js';
import { createPipelinePanel, updatePipelinePanel } from './panels/pipeline.js';
import { createActivityPanel, updateActivityPanel } from './panels/activity.js';
import { createMergeQueuePanel, updateMergeQueuePanel } from './panels/merge-queue.js';
import { createEscalationsPanel, updateEscalationsPanel } from './panels/escalations.js';

export interface DashboardOptions {
  refreshInterval?: number;
}

export async function startDashboard(options: DashboardOptions = {}): Promise<void> {
  const root = findHiveRoot();
  if (!root) {
    console.error('Not in a Hive workspace. Run "hive init" first.');
    process.exit(1);
  }

  const paths = getHivePaths(root);
  debugLog(`Dashboard starting - root: ${root}, hiveDir: ${paths.hiveDir}`);
  let db: DatabaseClient = await getDatabase(paths.hiveDir);
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
  const storiesPanel = createStoriesPanel(screen, db.db);
  const pipelinePanel = createPipelinePanel(screen, db.db);
  const activityPanel = createActivityPanel(screen, db.db);
  const mergeQueuePanel = createMergeQueuePanel(screen, db.db);
  const escalationsPanel = createEscalationsPanel(screen, db.db);

  // Footer
  blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: ' Tab: Switch panels | ↑↓: Navigate | Enter: Attach to tmux | Ctrl+B,D: Detach | Q: Quit',
    style: {
      bg: 'blue',
      fg: 'white',
    },
  });

  // Focus management
  const panels = [agentsPanel, storiesPanel, activityPanel, mergeQueuePanel, escalationsPanel];
  let focusIndex = 0;
  panels[focusIndex].focus();

  // Refresh function - reloads database from disk to see changes from other processes
  const refresh = async () => {
    debugLog(`Refresh called - reloading from ${paths.hiveDir}`);
    try {
      // Get new database connection first, then close old one
      const newDb = await getDatabase(paths.hiveDir);
      try { db.db.close(); } catch { /* ignore close errors */ }
      db = newDb;

      updateAgentsPanel(agentsPanel, db.db);
      updateStoriesPanel(storiesPanel, db.db);
      updatePipelinePanel(pipelinePanel, db.db);
      updateActivityPanel(activityPanel, db.db);
      updateMergeQueuePanel(mergeQueuePanel, db.db);
      updateEscalationsPanel(escalationsPanel, db.db);
      screen.render();
      debugLog('Refresh complete');
    } catch (err) {
      debugLog(`Refresh error: ${err}`);
      process.stderr.write(`Dashboard refresh error: ${err}\n`);
    }
  };

  // Auto-refresh - wrap in arrow function to handle async properly
  const timer = setInterval(() => { refresh(); }, refreshInterval);

  // Key bindings
  screen.key(['q', 'C-c', 'escape'], () => {
    clearInterval(timer);
    try { db.db.close(); } catch { /* ignore */ }
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

  // Initial refresh and render
  await refresh();
  screen.render();
}
