export interface SubmoduleInfo {
    path: string;
    url: string;
    branch?: string;
    commit: string;
}
/**
 * Add a git submodule
 */
export declare function addSubmodule(rootDir: string, url: string, path: string, branch?: string): Promise<void>;
/**
 * Initialize submodules
 */
export declare function initSubmodules(rootDir: string): Promise<void>;
/**
 * Update submodules
 */
export declare function updateSubmodules(rootDir: string, recursive?: boolean): Promise<void>;
/**
 * Initialize and update submodules
 */
export declare function initAndUpdateSubmodules(rootDir: string): Promise<void>;
/**
 * Remove a submodule
 */
export declare function removeSubmodule(rootDir: string, path: string): Promise<void>;
/**
 * List all submodules
 */
export declare function listSubmodules(rootDir: string): Promise<SubmoduleInfo[]>;
/**
 * Get the URL of a submodule
 */
export declare function getSubmoduleUrl(rootDir: string, path: string): Promise<string>;
/**
 * Check if a path is a submodule
 */
export declare function isSubmodule(rootDir: string, path: string): Promise<boolean>;
/**
 * Sync submodule URLs
 */
export declare function syncSubmodules(rootDir: string): Promise<void>;
/**
 * Fetch updates for all submodules
 */
export declare function fetchSubmodules(rootDir: string): Promise<void>;
//# sourceMappingURL=submodules.d.ts.map