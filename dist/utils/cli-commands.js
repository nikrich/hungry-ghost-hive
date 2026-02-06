/**
 * CLI Command Builders for Multi-CLI Agent Support
 * Provides CLI-aware command generation for manager communication with agents
 */
/**
 * Get available commands for a specific CLI tool
 */
export function getAvailableCommands(cliTool) {
    switch (cliTool) {
        case 'claude':
        case 'codex':
        case 'gemini':
        default:
            return buildClaudeCommands();
    }
}
/**
 * Build Claude/Hive CLI commands
 */
function buildClaudeCommands() {
    return {
        getMyStories: (sessionName, includeAll) => {
            const suffix = includeAll ? ' --all' : '';
            return `hive my-stories ${sessionName}${suffix}`;
        },
        claimStory: (storyId, sessionName) => {
            return `hive my-stories claim ${storyId} --session ${sessionName}`;
        },
        completeStory: (storyId) => {
            return `hive my-stories complete ${storyId}`;
        },
        submitPR: (branch, storyId, sessionName, prUrl) => {
            const prUrlPart = prUrl ? ` --pr-url ${prUrl}` : '';
            return `hive pr submit -b ${branch} -s ${storyId} --from ${sessionName}${prUrlPart}`;
        },
        queueCheck: () => {
            return 'hive pr queue';
        },
        msgSend: (recipient, message, sessionName) => {
            return `hive msg send ${recipient} "${message}" --from ${sessionName}`;
        },
        msgReply: (msgId, message, sessionName) => {
            return `hive msg reply ${msgId} "${message}" --from ${sessionName}`;
        },
    };
}
/**
 * Format a command as a tmux-compatible comment for Claude Code agents
 * Claude Code agents read comments in the tmux pane and execute them
 */
export function formatCommandForAgent(command) {
    // All CLI tools use comment format for agent communication
    return `# ${command}`;
}
/**
 * Build a reminder message for stuck agents
 */
export function buildAutoRecoveryReminder(sessionName, cliTool) {
    const commands = getAvailableCommands(cliTool);
    const reminder = `# REMINDER: You are an autonomous agent. Don't wait for instructions.
# If you completed your task, check for more work:
${formatCommandForAgent(commands.getMyStories(sessionName))}
# If no stories, check available work:
${formatCommandForAgent(commands.getMyStories(sessionName, true))}
# If you created a PR, make sure to submit it:
# ${commands.submitPR('<branch>', '<story-id>', sessionName)}`;
    return reminder;
}
//# sourceMappingURL=cli-commands.js.map