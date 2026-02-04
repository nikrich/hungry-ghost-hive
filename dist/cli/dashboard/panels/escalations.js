import blessed from 'blessed';
import { getPendingEscalations } from '../../../db/queries/escalations.js';
export function createEscalationsPanel(screen, db) {
    const list = blessed.list({
        parent: screen,
        top: '55%+5',
        left: '70%',
        width: '30%',
        height: '35%',
        border: { type: 'line' },
        label: ' Escalations ',
        keys: true,
        vi: true,
        mouse: true,
        style: {
            selected: { bg: 'blue' },
            border: { fg: 'yellow' },
        },
        tags: true,
        scrollbar: {
            ch: ' ',
            track: { bg: 'gray' },
            style: { bg: 'white' },
        },
    });
    updateEscalationsPanel(list, db);
    return list;
}
export function updateEscalationsPanel(list, db) {
    const escalations = getPendingEscalations(db);
    if (escalations.length === 0) {
        list.setItems(['{green-fg}No pending escalations{/}']);
        return;
    }
    const items = escalations.map((esc) => {
        const icon = esc.to_agent_id ? '{yellow-fg}!{/}' : '{red-fg}!!{/}';
        const target = esc.to_agent_id || 'HUMAN';
        return `${icon} ${esc.id}\n   ${target}\n   ${esc.reason.substring(0, 25)}...`;
    });
    list.setItems(items);
}
//# sourceMappingURL=escalations.js.map