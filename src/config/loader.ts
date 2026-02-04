import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse, stringify } from 'yaml';
import { HiveConfigSchema, type HiveConfig, generateDefaultConfigYaml } from './schema.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(hiveDir: string): HiveConfig {
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

export function saveConfig(hiveDir: string, config: HiveConfig): void {
  const configPath = join(hiveDir, 'hive.config.yaml');
  const content = stringify(config, { indent: 2 });
  writeFileSync(configPath, content, 'utf-8');
}

export function createDefaultConfig(hiveDir: string): HiveConfig {
  const configPath = join(hiveDir, 'hive.config.yaml');
  const content = generateDefaultConfigYaml();
  writeFileSync(configPath, content, 'utf-8');
  return loadConfig(hiveDir);
}

export function configExists(hiveDir: string): boolean {
  const configPath = join(hiveDir, 'hive.config.yaml');
  return existsSync(configPath);
}

export function getConfigValue(config: HiveConfig, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = config;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function setConfigValue(config: HiveConfig, path: string, value: unknown): HiveConfig {
  const parts = path.split('.');
  const newConfig = JSON.parse(JSON.stringify(config)) as HiveConfig;

  let current = newConfig as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
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
