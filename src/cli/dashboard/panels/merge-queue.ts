import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { getMergeQueue, type PullRequestRow } from '../../../db/queries/pull-requests.js';

export function createMergeQueuePanel(screen: Widgets.Screen, db: Database): Widgets.ListTableElement {
  const table = blessed.listtable({
    parent: screen,
    top: '55%+5',
    left: '50%',
    width: '25%',
    height: '35%',
    border: { type: 'line' },
    label: ' Merge Queue ',
    keys: true,
    vi: true,
    mouse: true,
    style: {
      header: { bold: true, fg: 'cyan' },
      cell: { fg: 'white' },
      selected: { bg: 'blue' },
      border: { fg: 'magenta' },
    },
    align: 'left',
    tags: true,
  });

  updateMergeQueuePanel(table, db).catch(err => console.error('Failed to update merge queue panel:', err));
  return table;
}

export async function updateMergeQueuePanel(table: Widgets.ListTableElement, db: Database): Promise<void> {
  const queue = getMergeQueue(db);

  const headers = ['#', 'Branch', 'Status'];

  if (queue.length === 0) {
    table.setData([headers, ['-', '{green-fg}Queue empty{/}', '']]);
    return;
  }

  const rows = queue.map((pr: PullRequestRow, index: number) => [
    String(index + 1),
    pr.branch_name.substring(0, 18),
    formatStatus(pr.status),
  ]);

  table.setData([headers, ...rows]);
}

function formatStatus(status: string): string {
  switch (status) {
    case 'queued':
      return '{blue-fg}QUEUED{/}';
    case 'reviewing':
      return '{yellow-fg}REVIEWING{/}';
    case 'approved':
      return '{green-fg}APPROVED{/}';
    case 'rejected':
      return '{red-fg}REJECTED{/}';
    case 'merged':
      return '{green-fg}MERGED{/}';
    default:
      return status;
  }
}
