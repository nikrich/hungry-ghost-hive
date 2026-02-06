import type { Database } from 'sql.js';
import blessed, { type Widgets } from 'blessed';
import { spawnSync } from 'child_process';
import { getPendingEscalations, type EscalationRow } from '../../../db/queries/escalations.js';

// Store escalations for selection lookup
let currentEscalations: EscalationRow[] = [];

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
  list.key(['enter'], () => {
    const selectedIndex = (list as unknown as { selected: number }).selected;

    if (selectedIndex >= 0 && selectedIndex < currentEscalations.length) {
      const escalation = currentEscalations[selectedIndex];

      // Temporarily leave blessed to handle escalation
      screen.destroy();

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

      // Restart dashboard when done
      console.log('\nReturning to dashboard...');
      spawnSync('hive', ['dashboard'], {
        stdio: 'inherit',
      });
      process.exit(0);
    }
  });

  updateEscalationsPanel(list, db).catch(err => console.error('Failed to update escalations panel:', err));

  return list;
}

export async function updateEscalationsPanel(list: Widgets.ListElement, db: Database): Promise<void> {
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
    return `${icon} ${esc.id}\n   ${target}\n   ${esc.reason.substring(0, 25)}...`;
  });

  list.setItems(items);
}
