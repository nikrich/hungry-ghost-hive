import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { queryAll, type StoryRow } from '../../../db/client.js';

export function createStoriesPanel(screen: Widgets.Screen, db: Database): Widgets.ListTableElement {
  const table = blessed.listtable({
    parent: screen,
    top: '30%',
    left: 0,
    width: '100%',
    height: '25%',
    border: { type: 'line' },
    label: ' Stories ',
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

  updateStoriesPanel(table, db).catch(err => console.error('Failed to update stories panel:', err));
  return table;
}

export async function updateStoriesPanel(table: Widgets.ListTableElement, db: Database): Promise<void> {
  const stories = queryAll<StoryRow>(db, `
    SELECT * FROM stories
    ORDER BY
      CASE status
        WHEN 'in_progress' THEN 1
        WHEN 'review' THEN 2
        WHEN 'qa' THEN 3
        WHEN 'planned' THEN 4
        WHEN 'estimated' THEN 5
        WHEN 'draft' THEN 6
        ELSE 7
      END,
      created_at DESC
    LIMIT 20
  `);

  const headers = ['ID', 'Title', 'Status', 'Complexity', 'Assigned To'];

  if (stories.length === 0) {
    table.setData([headers, ['(no stories)', '', '', '', '']]);
    return;
  }

  const rows = stories.map((story: StoryRow) => [
    story.id,
    (story.title || '').substring(0, 30),
    formatStatus(story.status),
    story.complexity_score?.toString() || '-',
    story.assigned_agent_id?.substring(0, 15) || '-',
  ]);

  table.setData([headers, ...rows]);
}

function formatStatus(status: string): string {
  switch (status) {
    case 'in_progress':
      return '{yellow-fg}IN PROGRESS{/}';
    case 'review':
      return '{cyan-fg}REVIEW{/}';
    case 'qa':
      return '{magenta-fg}QA{/}';
    case 'qa_failed':
      return '{red-fg}QA FAILED{/}';
    case 'planned':
      return '{blue-fg}PLANNED{/}';
    case 'estimated':
      return '{gray-fg}ESTIMATED{/}';
    case 'pr_submitted':
      return '{green-fg}PR SUBMITTED{/}';
    case 'merged':
      return '{green-fg}MERGED{/}';
    default:
      return status;
  }
}
