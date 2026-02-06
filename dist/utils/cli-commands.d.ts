/**
 * CLI Command Builders for Multi-CLI Agent Support
 * Provides CLI-aware command generation for manager communication with agents
 */
export type CLITool = 'claude' | 'codex' | 'gemini';
/**
 * Get available commands for a specific CLI tool
 */
export declare function getAvailableCommands(cliTool: CLITool): {
    getMyStories: (sessionName: string, includeAll?: boolean) => string;
    claimStory: (storyId: string, sessionName: string) => string;
    completeStory: (storyId: string) => string;
    submitPR: (branch: string, storyId: string, sessionName: string, prUrl?: string) => string;
    queueCheck: () => string;
    msgSend: (recipient: string, message: string, sessionName: string) => string;
    msgReply: (msgId: string, message: string, sessionName: string) => string;
};
/**
 * Format a command as a tmux-compatible comment for Claude Code agents
 * Claude Code agents read comments in the tmux pane and execute them
 */
export declare function formatCommandForAgent(command: string): string;
/**
 * Build a reminder message for stuck agents
 */
export declare function buildAutoRecoveryReminder(sessionName: string, cliTool: CLITool): string;
//# sourceMappingURL=cli-commands.d.ts.map