// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Read MCP server configuration from the parent workspace's .claude settings files.
 * Merges settings from both settings.json and settings.local.json.
 *
 * @param rootDir - The hive root directory (parent workspace)
 * @returns JSON string of merged mcpServers config, or null if none found
 */
export function getParentMcpConfig(rootDir: string): string | null {
  const mcpServers: Record<string, unknown> = {};

  for (const filename of ['settings.json', 'settings.local.json']) {
    const settingsPath = join(rootDir, '.claude', filename);
    if (!existsSync(settingsPath)) continue;
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.mcpServers && typeof settings.mcpServers === 'object') {
        Object.assign(mcpServers, settings.mcpServers);
      }
    } catch {
      // Ignore parse errors
    }
  }

  return Object.keys(mcpServers).length > 0 ? JSON.stringify(mcpServers) : null;
}
