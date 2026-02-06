import blessed from 'blessed';
import { appendFileSync, statSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { getDatabase, type DatabaseClient } from '../../db/client.js';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';

const DEBUG_LOG_PATH = '/tmp/hive-dashboard-debug.log';
const DEBUG_LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB

function debugLog(msg: string) {
  try {
    // Check if log file exists and is too large, rotate if needed
    if (existsSync(DEBUG_LOG_PATH)) {
      const stats = statSync(DEBUG_LOG_PATH);
      if (stats.size > DEBUG_LOG_MAX_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = `/tmp/hive-dashboard-debug.${timestamp}.log`;
        renameSync(DEBUG_LOG_PATH, rotatedPath);
      }
    }
    appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // Silently fail if we can't write to debug log
  }
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
  const dbPath = join(paths.hiveDir, 'hive.db');
  debugLog(`Dashboard starting - root: ${root}, hiveDir: ${paths.hiveDir}`);
  let db: DatabaseClient = await getDatabase(paths.hiveDir);
  let lastDbMtime = statSync(dbPath).mtimeMs;
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

  // Refresh function - only reloads database when file has changed
  const refresh = async () => {
    try {
      // Check if database file has been modified
      const currentMtime = statSync(dbPath).mtimeMs;
      if (currentMtime !== lastDbMtime) {
        debugLog(`Database changed - reloading from ${paths.hiveDir}`);
        lastDbMtime = currentMtime;

        // Get new database connection first, then close old one
        const newDb = await getDatabase(paths.hiveDir);
        try { db.db.close(); } catch { /* ignore close errors */ }
        db = newDb;
      }

      await updateAgentsPanel(agentsPanel, db.db);
      await updateStoriesPanel(storiesPanel, db.db);
      await updatePipelinePanel(pipelinePanel, db.db);
      await updateActivityPanel(activityPanel, db.db);
      await updateMergeQueuePanel(mergeQueuePanel, db.db);
      await updateEscalationsPanel(escalationsPanel, db.db);
      screen.render();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      debugLog(`Refresh error: ${errMsg}`);
      process.stderr.write(`Dashboard refresh error: ${errMsg}\n`);
    }
  };

  // Auto-refresh using recursive setTimeout to prevent overlapping refreshes
  let currentTimeout: NodeJS.Timeout | null = null;
  const scheduleRefresh = () => {
    currentTimeout = setTimeout(async () => {
      await refresh();
      scheduleRefresh();
    }, refreshInterval);
  };
  scheduleRefresh();

  // Key bindings
  screen.key(['q', 'C-c', 'escape'], () => {
    if (currentTimeout) clearTimeout(currentTimeout);
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
