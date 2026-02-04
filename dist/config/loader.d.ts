import { type HiveConfig } from './schema.js';
export declare class ConfigError extends Error {
    constructor(message: string);
}
export declare function loadConfig(hiveDir: string): HiveConfig;
export declare function saveConfig(hiveDir: string, config: HiveConfig): void;
export declare function createDefaultConfig(hiveDir: string): HiveConfig;
export declare function configExists(hiveDir: string): boolean;
export declare function getConfigValue(config: HiveConfig, path: string): unknown;
export declare function setConfigValue(config: HiveConfig, path: string, value: unknown): HiveConfig;
//# sourceMappingURL=loader.d.ts.map