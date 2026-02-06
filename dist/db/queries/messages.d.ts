import type { Database } from 'sql.js';
export interface MessageRow {
    id: string;
    from_session: string;
    to_session: string;
    subject: string | null;
    body: string;
    reply: string | null;
    status: 'pending' | 'read' | 'replied';
    created_at: string;
    replied_at: string | null;
}
export declare function getUnreadMessages(db: Database, toSession: string): MessageRow[];
export declare function markMessageRead(db: Database, messageId: string): void;
export declare function markMessagesRead(db: Database, messageIds: string[]): void;
export declare function getMessageById(db: Database, id: string): MessageRow | undefined;
export declare function getAllPendingMessages(db: Database): MessageRow[];
//# sourceMappingURL=messages.d.ts.map