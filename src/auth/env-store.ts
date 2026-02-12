// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { findHiveRoot } from '../utils/paths.js';

/**
 * Parse a .env file into a key-value record.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Serialize a key-value record into .env file content.
 */
export function serializeEnvFile(entries: Record<string, string>): string {
  const lines = Object.entries(entries).map(([key, value]) => `${key}=${value}`);
  return lines.join('\n') + '\n';
}

/**
 * Get the path to the .env file in the hive directory.
 */
export function getEnvFilePath(rootDir?: string): string {
  const root = rootDir ?? findHiveRoot();
  if (!root) {
    throw new Error('Not inside a Hive workspace. Run "hive init" first.');
  }
  return join(root, '.hive', '.env');
}

/**
 * Read all entries from the .env file.
 */
export function readEnvFile(rootDir?: string): Record<string, string> {
  const envPath = getEnvFilePath(rootDir);
  if (!existsSync(envPath)) {
    return {};
  }
  const content = readFileSync(envPath, 'utf-8');
  return parseEnvFile(content);
}

/**
 * Write or update entries in the .env file (merge with existing).
 */
export function writeEnvEntries(entries: Record<string, string>, rootDir?: string): void {
  const envPath = getEnvFilePath(rootDir);
  const existing = readEnvFile(rootDir);
  const merged = { ...existing, ...entries };
  writeFileSync(envPath, serializeEnvFile(merged), 'utf-8');
}

/**
 * Get a single value from the .env file.
 */
export function getEnvValue(key: string, rootDir?: string): string | undefined {
  const entries = readEnvFile(rootDir);
  return entries[key];
}

/**
 * Load .env entries into process.env (without overwriting existing values).
 * Silently returns if no Hive workspace is found (e.g., in CI or tests).
 */
export function loadEnvIntoProcess(rootDir?: string): void {
  let entries: Record<string, string>;
  try {
    entries = readEnvFile(rootDir);
  } catch {
    // Not inside a Hive workspace — nothing to load
    return;
  }
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
