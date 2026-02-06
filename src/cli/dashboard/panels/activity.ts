import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { getRecentLogs } from '../../../db/queries/logs.js';

export function createActivityPanel(screen: Widgets.Screen, db: Database): Widgets.BoxElement {
  const box = blessed.box({
    parent: screen,
    top: '55%+5',
    left: 0,
    width: '50%',
    height: '35%',
    border: { type: 'line' },
    label: ' Recent Activity ',
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    style: {
      border: { fg: 'cyan' },
    },
    tags: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { bg: 'white' },
    },
  });

  updateActivityPanel(box, db).catch((err) =>
    console.error('Failed to update activity panel:', err)
  );

  return box;
}

export async function updateActivityPanel(box: Widgets.BoxElement, db: Database): Promise<void> {
  const logs = getRecentLogs(db, 50);

  const lines: string[] = [];

  for (const entry of logs.reverse()) {
    const time = formatTimestamp(entry.timestamp);
    const agent = entry.agent_id.padEnd(15).substring(0, 15);
    const event = formatEventType(entry.event_type);
    const message = entry.message ? `: ${entry.message.substring(0, 40)}` : '';

    lines.push(`{gray-fg}${time}{/} {cyan-fg}${agent}{/} ${event}${message}`);
  }

  box.setContent(lines.join('\n'));

  // Always scroll to the latest (bottom) entries
  box.setScrollPerc(100);
}

function formatTimestamp(timestamp: string): string {
  return timestamp.substring(11, 19);
}

function formatEventType(event: string): string {
  const colors: Record<string, string> = {
    AGENT_SPAWNED: 'green',
    AGENT_TERMINATED: 'red',
    AGENT_RESUMED: 'yellow',
    STORY_STARTED: 'blue',
    STORY_COMPLETED: 'green',
    STORY_QA_PASSED: 'green',
    STORY_QA_FAILED: 'red',
    STORY_PR_CREATED: 'magenta',
    ESCALATION_CREATED: 'red',
    BUILD_PASSED: 'green',
    BUILD_FAILED: 'red',
  };

  const color = colors[event] || 'white';
  return `{${color}-fg}${event}{/}`;
}
