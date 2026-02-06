/**
 * Context File Content Generator
 *
 * Generates the actual content for context files based on CLI tool type
 */
import type { ContextFileOptions } from './index.js';
import type { StoryRow } from '../db/queries/stories.js';
/**
 * Generate context file content for the specified CLI tool
 */
export declare function generateContextFileContent(options: ContextFileOptions): string;
/**
 * Format stories for display in context files
 */
export declare function formatStoriesForContext(stories: StoryRow[]): string;
/**
 * Format quality check commands for display
 */
export declare function formatQualityChecks(commands: string[]): string;
/**
 * Format agent role description
 */
export declare function getAgentRoleDescription(agentType: string): string;
/**
 * Format hive msg command examples
 */
export declare function formatHiveMsgCommands(agentId?: string): string;
/**
 * Format git workflow instructions
 */
export declare function formatGitWorkflow(): string;
//# sourceMappingURL=generator.d.ts.map