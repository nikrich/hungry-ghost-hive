import type { StoryRow } from '../db/client.js';
/**
 * Generates the initial prompt for a Senior Developer agent.
 * Includes context about their responsibilities, workflow, and available stories.
 */
export declare function generateSeniorPrompt(teamName: string, repoUrl: string, repoPath: string, stories: StoryRow[]): string;
/**
 * Generates the initial prompt for an Intermediate Developer agent.
 * Includes context about implementing moderate-complexity stories.
 */
export declare function generateIntermediatePrompt(teamName: string, repoUrl: string, repoPath: string, sessionName: string): string;
/**
 * Generates the initial prompt for a Junior Developer agent.
 * Includes context about implementing simple, well-defined stories.
 */
export declare function generateJuniorPrompt(teamName: string, repoUrl: string, repoPath: string, sessionName: string): string;
/**
 * Generates the initial prompt for a QA Engineer agent.
 * Includes context about reviewing PRs and managing the merge queue.
 */
export declare function generateQAPrompt(teamName: string, repoUrl: string, repoPath: string, sessionName: string): string;
//# sourceMappingURL=prompts.d.ts.map