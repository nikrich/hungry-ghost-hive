export interface TmuxSessionOptions {
    sessionName: string;
    workDir: string;
    command: string;
    env?: Record<string, string>;
}
export interface TmuxSession {
    name: string;
    windows: number;
    created: string;
    attached: boolean;
}
export declare function isTmuxAvailable(): Promise<boolean>;
export declare function isTmuxSessionRunning(sessionName: string): Promise<boolean>;
export declare function listTmuxSessions(): Promise<TmuxSession[]>;
export declare function getHiveSessions(): Promise<TmuxSession[]>;
export declare function spawnTmuxSession(options: TmuxSessionOptions): Promise<void>;
export declare function killTmuxSession(sessionName: string): Promise<void>;
export declare function killAllHiveSessions(): Promise<number>;
export declare function sendToTmuxSession(sessionName: string, text: string, clearFirst?: boolean): Promise<void>;
export declare function sendEnterToTmuxSession(sessionName: string): Promise<void>;
export declare function captureTmuxPane(sessionName: string, lines?: number): Promise<string>;
/**
 * Waits for a tmux session to be ready by detecting Claude CLI initialization.
 * Claude is considered ready when the prompt appears in the pane output.
 * @param sessionName - The tmux session name
 * @param maxWaitMs - Maximum time to wait in milliseconds (default 15000ms)
 * @param pollIntervalMs - Interval between checks in milliseconds (default 200ms)
 * @returns true if ready, false on timeout
 */
export declare function waitForTmuxSessionReady(sessionName: string, maxWaitMs?: number, pollIntervalMs?: number): Promise<boolean>;
export declare function generateSessionName(agentType: string, teamName?: string, index?: number): string;
export declare function isManagerRunning(): Promise<boolean>;
export declare function startManager(interval?: number): Promise<boolean>;
export declare function stopManager(): Promise<boolean>;
//# sourceMappingURL=manager.d.ts.map