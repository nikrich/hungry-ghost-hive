import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse, stringify } from 'yaml';
import { HiveConfigSchema, generateDefaultConfigYaml } from './schema.js';
export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
export function loadConfig(hiveDir) {
    const configPath = join(hiveDir, 'hive.config.yaml');
    if (!existsSync(configPath)) {
        throw new ConfigError(`Config file not found: ${configPath}`);
    }
    const content = readFileSync(configPath, 'utf-8');
    const rawConfig = parse(content);
    const result = HiveConfigSchema.safeParse(rawConfig);
    if (!result.success) {
        const errors = result.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
        throw new ConfigError(`Invalid configuration:\n${errors}`);
    }
    return result.data;
}
export function saveConfig(hiveDir, config) {
    const configPath = join(hiveDir, 'hive.config.yaml');
    const content = stringify(config, { indent: 2 });
    writeFileSync(configPath, content, 'utf-8');
}
export function createDefaultConfig(hiveDir) {
    const configPath = join(hiveDir, 'hive.config.yaml');
    const content = generateDefaultConfigYaml();
    writeFileSync(configPath, content, 'utf-8');
    return loadConfig(hiveDir);
}
export function configExists(hiveDir) {
    const configPath = join(hiveDir, 'hive.config.yaml');
    return existsSync(configPath);
}
export function getConfigValue(config, path) {
    const parts = path.split('.');
    let current = config;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        current = current[part];
    }
    return current;
}
export function setConfigValue(config, path, value) {
    const parts = path.split('.');
    const newConfig = JSON.parse(JSON.stringify(config));
    let current = newConfig;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] === undefined || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part];
    }
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
    // Validate the new config
    const result = HiveConfigSchema.safeParse(newConfig);
    if (!result.success) {
        const errors = result.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
        throw new ConfigError(`Invalid configuration after update:\n${errors}`);
    }
    return result.data;
}
//# sourceMappingURL=loader.js.map