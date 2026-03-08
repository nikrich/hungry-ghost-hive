// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { nanoid } from 'nanoid';
import { join } from 'path';

const INSTANCE_ID_FILE = 'instance.id';

/**
 * Get or create the instance ID for a hive workspace.
 * The ID is stored in .hive/instance.id.
 * Returns null if the hive directory does not exist.
 * Only creates the file if the .hive directory already exists
 * (i.e., this is a real workspace, not a test environment).
 */
export function getInstanceId(hiveDir: string): string | null {
  if (!existsSync(hiveDir)) {
    return null;
  }

  const instancePath = join(hiveDir, INSTANCE_ID_FILE);

  if (existsSync(instancePath)) {
    const id = readFileSync(instancePath, 'utf-8').trim();
    if (id) return id;
  }

  // Generate a short unique ID for this workspace instance
  const id = nanoid(6);
  try {
    writeFileSync(instancePath, id, 'utf-8');
  } catch {
    // If write fails (e.g., read-only filesystem), use in-memory ID
  }
  return id;
}

/**
 * Get the instance-scoped tmux session prefix.
 * Falls back to 'hive' if no instance ID is available.
 */
export function getInstancePrefix(hiveDir: string): string {
  const instanceId = getInstanceId(hiveDir);
  if (instanceId) {
    return `hive-${instanceId}`;
  }
  return 'hive';
}

/**
 * Build an instance-scoped session name.
 * Pattern: hive-<instanceId>-<agentType>[-<teamName>][-<index>]
 * Falls back to hive-<agentType>[-<teamName>][-<index>] if no instance ID.
 */
export function buildInstanceSessionName(
  hiveDir: string,
  agentType: string,
  teamName?: string,
  index?: number
): string {
  const prefix = getInstancePrefix(hiveDir);
  let name = `${prefix}-${agentType}`;
  if (teamName) {
    name += `-${teamName}`;
  }
  if (index !== undefined && index > 1) {
    name += `-${index}`;
  }
  return name;
}

/**
 * Build the instance-scoped tech lead session name.
 */
export function getTechLeadSessionName(hiveDir: string): string {
  return buildInstanceSessionName(hiveDir, 'tech-lead');
}

/**
 * Build the instance-scoped manager session name.
 */
export function getManagerSessionName(hiveDir: string): string {
  return buildInstanceSessionName(hiveDir, 'manager');
}

/**
 * Build the instance-scoped manager lock path.
 */
export function getManagerLockPath(hiveDir: string): string {
  const instanceId = getInstanceId(hiveDir);
  if (instanceId) {
    return join(hiveDir, `manager-${instanceId}.lock`);
  }
  return join(hiveDir, 'manager.lock');
}
