// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Context File Management
 *
 * Generates and manages CLI-specific context files (CLAUDE.md, AGENTS.md, GEMINI.md)
 * that provide Hive workflow context to AI agents.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { HiveConfig } from '../config/schema.js';
import type { StoryRow } from '../db/queries/stories.js';
import type { TeamRow } from '../db/queries/teams.js';
import { generateContextFileContent } from './generator.js';

export type CLITool = 'claude-code' | 'codex' | 'gemini';

export interface ContextFileOptions {
  cliTool: CLITool;
  team: TeamRow;
  stories: StoryRow[];
  agentType: 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa';
  config: HiveConfig;
  agentId?: string;
}

/**
 * Get the context file name for a given CLI tool
 */
export function getContextFileName(cliTool: CLITool): string {
  switch (cliTool) {
    case 'claude-code':
      return 'CLAUDE.md';
    case 'codex':
      return 'AGENTS.md';
    case 'gemini':
      return 'GEMINI.md';
  }
}

/**
 * Get the context file path in a repository
 */
export function getContextFilePath(repoPath: string, cliTool: CLITool): string {
  return `${repoPath}/${getContextFileName(cliTool)}`;
}

/**
 * Check if a context file exists in a repository
 */
export function contextFileExists(repoPath: string, cliTool: CLITool): boolean {
  return existsSync(getContextFilePath(repoPath, cliTool));
}

/**
 * Generate and write context file to a repository
 * If file exists, only updates the HIVE-managed section (between markers)
 */
export function generateContextFile(options: ContextFileOptions): void {
  const filePath = getContextFilePath(options.team.repo_path, options.cliTool);
  const newContent = generateContextFileContent(options);

  // If file doesn't exist, write it entirely
  if (!existsSync(filePath)) {
    // Create directory if it doesn't exist
    const dirPath = dirname(filePath);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    writeFileSync(filePath, newContent, 'utf-8');
    return;
  }

  // If file exists, merge content using markers
  const existingContent = readFileSync(filePath, 'utf-8');
  const mergedContent = mergeContextFileContent(existingContent, newContent);
  writeFileSync(filePath, mergedContent, 'utf-8');
}

/**
 * Merge new Hive content into existing file using markers
 */
function mergeContextFileContent(existingContent: string, newContent: string): string {
  const hiveStartMarker = '<!-- HIVE:START -->';
  const hiveEndMarker = '<!-- HIVE:END -->';

  const startIdx = existingContent.indexOf(hiveStartMarker);
  const endIdx = existingContent.indexOf(hiveEndMarker);

  // If markers don't exist, append Hive section at the end
  if (startIdx === -1 || endIdx === -1) {
    return existingContent + '\n\n' + newContent;
  }

  // Replace content between markers
  const beforeMarker = existingContent.substring(0, startIdx);
  const afterMarker = existingContent.substring(endIdx + hiveEndMarker.length);

  return beforeMarker + newContent + afterMarker;
}

export { generateContextFileContent };
