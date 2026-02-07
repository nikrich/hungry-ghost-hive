// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * CLI Command Builders for Multi-CLI Agent Support
 * Provides CLI-aware command generation for manager communication with agents
 */

export type CLITool = 'claude' | 'codex' | 'gemini';

/**
 * Get available commands for a specific CLI tool
 */
export function getAvailableCommands(cliTool: CLITool): {
  getMyStories: (sessionName: string, includeAll?: boolean) => string;
  claimStory: (storyId: string, sessionName: string) => string;
  completeStory: (storyId: string) => string;
  submitPR: (branch: string, storyId: string, sessionName: string, prUrl?: string) => string;
  queueCheck: () => string;
  msgSend: (recipient: string, message: string, sessionName: string) => string;
  msgReply: (msgId: string, message: string, sessionName: string) => string;
} {
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
    getMyStories: (sessionName: string, includeAll?: boolean) => {
      const suffix = includeAll ? ' --all' : '';
      return `hive my-stories ${sessionName}${suffix}`;
    },
    claimStory: (storyId: string, sessionName: string) => {
      return `hive my-stories claim ${storyId} --session ${sessionName}`;
    },
    completeStory: (storyId: string) => {
      return `hive my-stories complete ${storyId}`;
    },
    submitPR: (branch: string, storyId: string, sessionName: string, prUrl?: string) => {
      const prUrlPart = prUrl ? ` --pr-url ${prUrl}` : '';
      return `hive pr submit -b ${branch} -s ${storyId} --from ${sessionName}${prUrlPart}`;
    },
    queueCheck: () => {
      return 'hive pr queue';
    },
    msgSend: (recipient: string, message: string, sessionName: string) => {
      return `hive msg send ${recipient} "${message}" --from ${sessionName}`;
    },
    msgReply: (msgId: string, message: string, sessionName: string) => {
      return `hive msg reply ${msgId} "${message}" --from ${sessionName}`;
    },
  };
}

/**
 * Format a command as a tmux-compatible comment for Claude Code agents
 * Claude Code agents read comments in the tmux pane and execute them
 */
export function formatCommandForAgent(command: string): string {
  // All CLI tools use comment format for agent communication
  return `# ${command}`;
}

/**
 * Build a reminder message for stuck agents
 */
export function buildAutoRecoveryReminder(sessionName: string, cliTool: CLITool): string {
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
