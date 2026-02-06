import type { Database } from 'sql.js';
import { type Widgets } from 'blessed';
export declare function createAgentsPanel(screen: Widgets.Screen, db: Database): Widgets.ListElement;
export declare function updateAgentsPanel(list: Widgets.ListElement, db: Database): Promise<void>;
//# sourceMappingURL=agents.d.ts.map