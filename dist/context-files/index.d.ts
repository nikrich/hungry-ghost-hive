/**
 * Context File Management
 *
 * Generates and manages CLI-specific context files (CLAUDE.md, AGENTS.md, GEMINI.md)
 * that provide Hive workflow context to AI agents.
 */
import { generateContextFileContent } from './generator.js';
import type { TeamRow } from '../db/queries/teams.js';
import type { StoryRow } from '../db/queries/stories.js';
import type { HiveConfig } from '../config/schema.js';
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
export declare function getContextFileName(cliTool: CLITool): string;
/**
 * Get the context file path in a repository
 */
export declare function getContextFilePath(repoPath: string, cliTool: CLITool): string;
/**
 * Check if a context file exists in a repository
 */
export declare function contextFileExists(repoPath: string, cliTool: CLITool): boolean;
/**
 * Generate and write context file to a repository
 * If file exists, only updates the HIVE-managed section (between markers)
 */
export declare function generateContextFile(options: ContextFileOptions): void;
export { generateContextFileContent };
//# sourceMappingURL=index.d.ts.map