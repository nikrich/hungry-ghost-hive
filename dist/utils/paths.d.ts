export declare const HIVE_DIR_NAME = ".hive";
export declare const REPOS_DIR_NAME = "repos";
export declare const AGENTS_DIR_NAME = "agents";
export declare const LOGS_DIR_NAME = "logs";
export interface HivePaths {
    root: string;
    hiveDir: string;
    dbPath: string;
    configPath: string;
    agentsDir: string;
    logsDir: string;
    reposDir: string;
}
export declare function findHiveRoot(startDir?: string): string | null;
export declare function getHivePaths(rootDir: string): HivePaths;
export declare function isHiveWorkspace(dir: string): boolean;
//# sourceMappingURL=paths.d.ts.map