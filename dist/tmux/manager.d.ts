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
export declare function sendToTmuxSession(sessionName: string, text: string): Promise<void>;
export declare function captureTmuxPane(sessionName: string, lines?: number): Promise<string>;
export declare function generateSessionName(agentType: string, teamName?: string, index?: number): string;
//# sourceMappingURL=manager.d.ts.map