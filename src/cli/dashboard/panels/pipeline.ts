import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { getStoryCounts } from '../../../db/queries/stories.js';

export function createPipelinePanel(screen: Widgets.Screen, db: Database): Widgets.BoxElement {

  const box = blessed.box({
    parent: screen,
    top: '55%',
    left: 0,
    width: '100%',
    height: 5,
    border: { type: 'line' },
    label: ' Story Pipeline ',
    style: {
      border: { fg: 'cyan' },
    },
    tags: true,
  });

  updatePipelinePanel(box, db).catch(err => console.error('Failed to update pipeline panel:', err));

  return box;
}

export async function updatePipelinePanel(box: Widgets.BoxElement, db: Database): Promise<void> {
  const counts = getStoryCounts(db);

  const stages = [
    { name: 'Planned', count: counts.planned, color: 'white' },
    { name: 'In Prog', count: counts.in_progress, color: 'yellow' },
    { name: 'Review', count: counts.review, color: 'blue' },
    { name: 'QA', count: counts.qa, color: 'cyan' },
    { name: 'Failed', count: counts.qa_failed, color: 'red' },
    { name: 'PR', count: counts.pr_submitted, color: 'magenta' },
    { name: 'Merged', count: counts.merged, color: 'green' },
  ];

  const width = Math.floor(100 / stages.length);
  let content = '';

  // Top row: stage names
  for (const stage of stages) {
    const name = stage.name.padStart(Math.floor((width + stage.name.length) / 2)).padEnd(width);
    content += `{${stage.color}-fg}${name}{/}`;
  }
  content += '\n';

  // Middle row: counts
  for (const stage of stages) {
    const count = stage.count.toString().padStart(Math.floor((width + stage.count.toString().length) / 2)).padEnd(width);
    content += `{${stage.color}-fg}${count}{/}`;
  }
  content += '\n';

  // Bottom row: bar visualization
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  for (const stage of stages) {
    const filled = Math.round((stage.count / total) * (width - 2)) || 0;
    const bar = '█'.repeat(filled) + '░'.repeat(width - 2 - filled);
    content += `{${stage.color}-fg}[${bar}]{/}`;
  }

  box.setContent(content);
}
