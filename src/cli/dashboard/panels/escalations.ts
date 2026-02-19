// Licensed under the Hungry Ghost Hive License. See LICENSE.

import blessed, { type Widgets } from 'blessed';
import { spawnSync } from 'child_process';
import type { Database } from 'sql.js';
import { getPendingEscalations, type EscalationRow } from '../../../db/queries/escalations.js';

// Store escalations for selection lookup
let currentEscalations: EscalationRow[] = [];

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.substring(0, Math.max(0, max - 3)) + '...';
}

function summarizeEscalationReason(reason: string): string {
  const actionMatch = reason.match(/Action:\s*(.+)$/i);
  if (actionMatch?.[1]) {
    return `ACTION: ${truncate(actionMatch[1], 38)}`;
  }
  return truncate(reason, 38);
}

export function createEscalationsPanel(screen: Widgets.Screen, db: Database): Widgets.ListElement {
  const list = blessed.list({
    parent: screen,
    top: '55%+5',
    left: '75%',
    width: '25%',
    height: '35%',
    border: { type: 'line' },
    label: ' Escalations [Enter: Open] ',
    keys: true,
    vi: true,
    mouse: true,
    style: {
      selected: { bg: 'blue' },
      border: { fg: 'yellow' },
      focus: { border: { fg: 'white' } },
    },
    tags: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { bg: 'white' },
    },
  });

  // Handle Enter key to open escalation details
  list.key(['enter'], async () => {
    const selectedIndex = (list as unknown as { selected: number }).selected;

    if (selectedIndex >= 0 && selectedIndex < currentEscalations.length) {
      const escalation = currentEscalations[selectedIndex];

      // Temporarily suspend blessed while handling escalation.
      const resumeScreen = screen.program.pause();

      try {
        // Show escalation details and prompt for resolution
        console.log('\n');
        console.log('═'.repeat(60));
        console.log(`  ESCALATION: ${escalation.id}`);
        console.log('═'.repeat(60));
        console.log(`  From:    ${escalation.from_agent_id || '-'}`);
        console.log(`  To:      ${escalation.to_agent_id || 'HUMAN'}`);
        console.log(`  Story:   ${escalation.story_id || '-'}`);
        console.log(`  Status:  ${escalation.status}`);
        console.log(`  Created: ${escalation.created_at}`);
        console.log('─'.repeat(60));
        console.log('  Reason:');
        console.log(`  ${escalation.reason}`);
        console.log('─'.repeat(60));

        if (escalation.from_agent_id) {
          console.log(`\n  To attach to the agent's session:`);
          console.log(`    tmux attach -t ${escalation.from_agent_id}`);
        }
        console.log(`\n  To resolve this escalation:`);
        console.log(`    hive escalations resolve ${escalation.id} -m "your guidance here"`);
        console.log(`\n  To acknowledge (mark as being worked on):`);
        console.log(`    hive escalations acknowledge ${escalation.id}`);
        console.log('\n');

        // Attach to the agent's session if available
        if (escalation.from_agent_id) {
          console.log('Attaching to agent session... (Ctrl+B, D to detach)\n');
          spawnSync('tmux', ['attach', '-t', escalation.from_agent_id], {
            stdio: 'inherit',
          });
        }
      } finally {
        // Restore dashboard in the same process (do not spawn nested dashboards).
        resumeScreen();
        // Force full redraw — after tmux detach the terminal buffer is clobbered.
        // Use realloc() (dirty=true) so every cell is marked for redraw, preventing
        // partial-update artifacts from blessed's incremental renderer.
        screen.realloc();
        try {
          await updateEscalationsPanel(list, db);
        } catch (err) {
          console.error('Failed to update escalations panel:', err);
        }
        screen.render();
      }

      return;
    }
  });

  updateEscalationsPanel(list, db).catch(err =>
    console.error('Failed to update escalations panel:', err)
  );

  return list;
}

export async function updateEscalationsPanel(
  list: Widgets.ListElement,
  db: Database
): Promise<void> {
  const escalations = getPendingEscalations(db);
  currentEscalations = escalations; // Store for selection lookup

  if (escalations.length === 0) {
    currentEscalations = [];
    list.setItems(['{green-fg}No pending escalations{/}']);
    return;
  }

  const items = escalations.map((esc: EscalationRow) => {
    const icon = esc.to_agent_id ? '{yellow-fg}!{/}' : '{red-fg}!!{/}';
    const target = esc.to_agent_id || 'HUMAN';
    const summary = summarizeEscalationReason(esc.reason);
    return `${icon} ${esc.id}\n   ${target}\n   ${summary}`;
  });

  list.setItems(items);
}
