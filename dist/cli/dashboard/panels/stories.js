import blessed from 'blessed';
import { queryAll } from '../../../db/client.js';
export function createStoriesPanel(screen, db) {
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
    updateStoriesPanel(table, db);
    return table;
}
export function updateStoriesPanel(table, db) {
    const stories = queryAll(db, `
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
    const rows = stories.map((story) => [
        story.id,
        (story.title || '').substring(0, 30),
        formatStatus(story.status),
        story.complexity_score?.toString() || '-',
        story.assigned_agent_id?.substring(0, 15) || '-',
    ]);
    table.setData([headers, ...rows]);
}
function formatStatus(status) {
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
//# sourceMappingURL=stories.js.map