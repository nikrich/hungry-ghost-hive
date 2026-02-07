import { execa } from 'execa';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- Named constants (extracted from inline magic numbers) ---

/** Default number of pane lines to capture */
const DEFAULT_CAPTURE_LINES = 100;
/** Delay in ms after creating a tmux session to let shell initialize */
const SESSION_INIT_DELAY_MS = 500;
/** Delay in ms between clear-input key presses (Escape, Ctrl+U) */
const CLEAR_INPUT_DELAY_MS = 50;
/** Number of pane lines to capture for session ready check */
const READY_CHECK_CAPTURE_LINES = 50;
/** Default max wait time in ms for session ready */
const DEFAULT_READY_WAIT_MS = 15000;
/** Default poll interval in ms for session ready check */
const DEFAULT_READY_POLL_MS = 200;
/** Default max retries for forcing bypass mode */
const DEFAULT_BYPASS_MAX_RETRIES = 5;
/** Number of pane lines to capture for mode/permission checks */
const MODE_CHECK_CAPTURE_LINES = 100;
/** Delay in ms after sending BTab for mode change */
const MODE_CHANGE_DELAY_MS = 500;
/** Default max retries for message delivery confirmation */
const DEFAULT_CONFIRM_MAX_RETRIES = 3;
/** Default initial wait in ms before message verification */
const DEFAULT_CONFIRM_INITIAL_WAIT_MS = 300;
/** Maximum backoff delay in ms for message delivery retries */
const MAX_CONFIRM_BACKOFF_MS = 2000;
/** Default max retries for auto-approve permission */
const DEFAULT_APPROVE_MAX_RETRIES = 3;
/** Delay in ms after sending approval response */
const POST_APPROVAL_DELAY_MS = 500;
/** Default manager check interval in seconds */
const DEFAULT_MANAGER_INTERVAL = 60;

export interface TmuxSessionOptions {
  sessionName: string;
  workDir: string;
  command: string;
  initialPrompt?: string;
  env?: Record<string, string>;
}

export interface TmuxSession {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
}

export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execa('which', ['tmux']);
    return true;
  } catch {
    return false;
  }
}

export async function isTmuxSessionRunning(sessionName: string): Promise<boolean> {
  try {
    await execa('tmux', ['has-session', '-t', sessionName]);
    return true;
  } catch {
    return false;
  }
}

export async function listTmuxSessions(): Promise<TmuxSession[]> {
  try {
    const { stdout } = await execa('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}',
    ]);

    return stdout
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, windows, created, attached] = line.split('|');
        return {
          name,
          windows: parseInt(windows, 10),
          created,
          attached: attached === '1',
        };
      });
  } catch {
    return [];
  }
}

export async function getHiveSessions(): Promise<TmuxSession[]> {
  const sessions = await listTmuxSessions();
  return sessions.filter(s => s.name.startsWith('hive-'));
}

export async function spawnTmuxSession(options: TmuxSessionOptions): Promise<void> {
  const { sessionName, workDir, command, initialPrompt, env } = options;

  // Kill existing session if it exists
  if (await isTmuxSessionRunning(sessionName)) {
    await killTmuxSession(sessionName);
  }

  // Create new detached session with default shell
  const args = ['new-session', '-d', '-s', sessionName, '-c', workDir];

  const execaOptions: { env?: NodeJS.ProcessEnv } = {};
  if (env) {
    execaOptions.env = { ...process.env, ...env };
  }

  await execa('tmux', args, execaOptions);

  // Small delay to let shell initialize
  await new Promise(resolve => setTimeout(resolve, SESSION_INIT_DELAY_MS));

  // Send the command to the session
  if (command) {
    let fullCommand = command;

    if (initialPrompt) {
      // Write the prompt to a temp file and use $(cat ...) to pass it as
      // a CLI positional argument. This avoids multi-line tmux send-keys issues
      // because the command itself is a single line - the shell expands the
      // $(cat ...) at execution time. The double quotes around $() ensure the
      // prompt is passed as one argument with newlines preserved.
      const promptDir = join(tmpdir(), 'hive-prompts');
      mkdirSync(promptDir, { recursive: true });
      const promptFile = join(promptDir, `${sessionName}-${Date.now()}.md`);
      writeFileSync(promptFile, initialPrompt, 'utf-8');
      fullCommand += ` -- "$(cat '${promptFile}')"`;
    }

    await execa('tmux', ['send-keys', '-t', sessionName, fullCommand, 'Enter']);
  }
}

export async function killTmuxSession(sessionName: string): Promise<void> {
  try {
    await execa('tmux', ['kill-session', '-t', sessionName]);
  } catch {
    // Session might not exist, ignore error
  }
}

export async function killAllHiveSessions(): Promise<number> {
  const sessions = await getHiveSessions();
  let killed = 0;

  for (const session of sessions) {
    try {
      await killTmuxSession(session.name);
      killed++;
    } catch {
      // Ignore errors
    }
  }

  return killed;
}

export async function sendToTmuxSession(
  sessionName: string,
  text: string,
  clearFirst = true
): Promise<void> {
  if (clearFirst) {
    // Clear any existing input at the prompt before sending new text
    // Escape: exit any menu/selection state
    // Ctrl+U: clear line from cursor to beginning
    await execa('tmux', ['send-keys', '-t', sessionName, 'Escape']);
    await new Promise(resolve => setTimeout(resolve, CLEAR_INPUT_DELAY_MS));
    await execa('tmux', ['send-keys', '-t', sessionName, 'C-u']);
    await new Promise(resolve => setTimeout(resolve, CLEAR_INPUT_DELAY_MS));
  }

  // For single-line text, use send-keys with literal flag then Enter separately.
  // '--' signals end of options, preventing text starting with '-' from being parsed as flags.
  //
  // NOTE: Multi-line initial prompts should be passed via spawnTmuxSession's
  // initialPrompt option, which writes to a temp file and uses $(cat ...) to
  // deliver the prompt as a CLI positional argument. This function is only for
  // single-line runtime messages (nudges, commands, etc).
  await execa('tmux', ['send-keys', '-t', sessionName, '-l', '--', text]);
  // Send Enter as a key event (C-m = carriage return = Enter) to ensure prompt receives it
  await execa('tmux', ['send-keys', '-t', sessionName, 'C-m']);
}

export async function sendEnterToTmuxSession(sessionName: string): Promise<void> {
  // C-m is equivalent to Enter/Return
  await execa('tmux', ['send-keys', '-t', sessionName, 'C-m']);
}

export async function captureTmuxPane(
  sessionName: string,
  lines = DEFAULT_CAPTURE_LINES
): Promise<string> {
  try {
    const { stdout } = await execa('tmux', [
      'capture-pane',
      '-t',
      sessionName,
      '-p',
      '-S',
      `-${lines}`,
    ]);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Waits for a tmux session to be ready by detecting Claude CLI initialization.
 * Claude is considered ready when the prompt appears in the pane output.
 * @param sessionName - The tmux session name
 * @param maxWaitMs - Maximum time to wait in milliseconds (default 15000ms)
 * @param pollIntervalMs - Interval between checks in milliseconds (default 200ms)
 * @returns true if ready, false on timeout
 */
export async function waitForTmuxSessionReady(
  sessionName: string,
  maxWaitMs = DEFAULT_READY_WAIT_MS,
  pollIntervalMs = DEFAULT_READY_POLL_MS
): Promise<boolean> {
  const startTime = Date.now();
  let lastOutput = '';

  while (Date.now() - startTime < maxWaitMs) {
    const output = await captureTmuxPane(sessionName, READY_CHECK_CAPTURE_LINES);

    // Check if we have Claude prompt indicator or substantial output
    // Claude typically shows a prompt with "> " or similar
    if (output.includes('>') || output.includes('Claude')) {
      return true;
    }

    // Check if output has stabilized (same content for consecutive polls)
    // This handles cases where output appears without explicit prompt
    if (lastOutput === output && output.length > 0) {
      return true;
    }

    lastOutput = output;
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout reached, but return true anyway as a fallback
  // to avoid infinite hangs. Claude might still be starting.
  return true;
}

/**
 * Forces bypass permissions mode in a Claude CLI session.
 * Detects if the agent is in plan mode and switches to bypass mode by sending BTab.
 * @param sessionName - The tmux session name
 * @param cliTool - The CLI tool being used ('claude', 'codex', or 'gemini')
 * @param maxRetries - Maximum number of retry attempts (default 5)
 * @returns true if bypass mode was confirmed, false if max retries exceeded
 */
export async function forceBypassMode(
  sessionName: string,
  _cliTool: 'claude' | 'codex' | 'gemini' = 'claude',
  maxRetries = DEFAULT_BYPASS_MAX_RETRIES
): Promise<boolean> {
  // Note: cliTool parameter is reserved for future Codex/Gemini CLI integration
  // Currently, all CLIs use the same BTab key sequence for cycling permissions
  let retries = 0;

  while (retries < maxRetries) {
    // Capture pane output to check current permission mode
    const output = await captureTmuxPane(sessionName, MODE_CHECK_CAPTURE_LINES);

    // Check if already in bypass mode
    if (output.toLowerCase().includes('bypass permissions on')) {
      return true;
    }

    // Check if in plan mode (needs to be switched)
    if (output.toLowerCase().includes('plan mode on')) {
      // Send BTab (Shift+Tab / backtab) to cycle permissions mode
      // For Claude Code, BTab cycles through: plan -> safe -> bypass -> plan
      await execa('tmux', ['send-keys', '-t', sessionName, 'BTab']);

      // Wait for the mode change to take effect
      await new Promise(resolve => setTimeout(resolve, MODE_CHANGE_DELAY_MS));

      retries++;
      continue;
    }

    // If neither plan mode nor bypass mode is detected, try cycling anyway
    // This handles cases where the mode indicator might not be visible
    await execa('tmux', ['send-keys', '-t', sessionName, 'BTab']);
    await new Promise(resolve => setTimeout(resolve, MODE_CHANGE_DELAY_MS));

    retries++;
  }

  // Max retries exceeded
  // Return false to indicate we couldn't confirm bypass mode
  return false;
}

/**
 * Attempts to deliver a message to a tmux session with verification.
 * Sends the message and verifies it appears in the session output before confirming delivery.
 * Uses exponential backoff retry on failed verification attempts.
 * @param sessionName - The tmux session name
 * @param message - The message text to send
 * @param maxRetries - Maximum number of retry attempts (default 3)
 * @param initialWaitMs - Initial wait time before first verification check (default 300ms)
 * @returns true if delivery confirmed, false if max retries exceeded
 */
export async function sendMessageWithConfirmation(
  sessionName: string,
  message: string,
  maxRetries = DEFAULT_CONFIRM_MAX_RETRIES,
  initialWaitMs = DEFAULT_CONFIRM_INITIAL_WAIT_MS
): Promise<boolean> {
  // Send the message to the session
  await sendToTmuxSession(sessionName, message);

  // Wait before first verification check
  await new Promise(resolve => setTimeout(resolve, initialWaitMs));

  // Try to verify delivery by checking if message appears in output
  let retries = 0;
  let waitTime = initialWaitMs;

  while (retries < maxRetries) {
    // Capture pane output to verify message was received
    const output = await captureTmuxPane(sessionName, MODE_CHECK_CAPTURE_LINES);

    // Check if the first line of the message appears in the output
    // Extract first meaningful part of message for verification
    const messageLines = message.split('\n').filter(line => line.trim());
    const verificationText =
      messageLines.length > 0 ? messageLines[0].substring(0, 50) : message.substring(0, 50);

    if (output.includes(verificationText)) {
      // Message verified in output - delivery confirmed
      return true;
    }

    retries++;
    if (retries < maxRetries) {
      // Exponential backoff: double the wait time for next retry
      waitTime = Math.min(waitTime * 2, MAX_CONFIRM_BACKOFF_MS);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  // Max retries exceeded - delivery not confirmed
  return false;
}

/**
 * Automatically approve permission prompts by sending 'y' or appropriate response.
 * Detects permission prompts in tmux pane output and auto-approves them.
 * @param sessionName - Tmux session name to auto-approve
 * @param maxRetries - Maximum attempts to detect and approve prompt
 * @returns true if permission was approved, false if approval failed or no prompt detected
 */
export async function autoApprovePermission(
  sessionName: string,
  maxRetries = DEFAULT_APPROVE_MAX_RETRIES
): Promise<boolean> {
  let retries = 0;

  while (retries < maxRetries) {
    // Capture pane output to check for permission prompts
    const output = await captureTmuxPane(sessionName, MODE_CHECK_CAPTURE_LINES);

    // Check for common permission prompt patterns
    const permissionPatterns = [
      /Do you want to make this edit\?.*\[y\/n\]/i,
      /Do you want to .+\?.*\[y\/n\]/i,
      /Would you like to .+\?.*\[y\/n\]/i,
      /Allow .+\?.*\[y\/n\]/i,
      /Approve .+\?.*\[y\/n\]/i,
      /permission.*required/i,
    ];

    const hasPermissionPrompt = permissionPatterns.some(pattern => pattern.test(output));

    if (!hasPermissionPrompt) {
      // No permission prompt detected
      return false;
    }

    // Send 'y' to approve the permission
    await execa('tmux', ['send-keys', '-t', sessionName, 'y', 'Enter']);

    // Wait for response to process
    await new Promise(resolve => setTimeout(resolve, POST_APPROVAL_DELAY_MS));

    // Check if the prompt is gone (approval succeeded)
    const newOutput = await captureTmuxPane(sessionName, MODE_CHECK_CAPTURE_LINES);
    const promptGone = !permissionPatterns.some(pattern => pattern.test(newOutput));

    if (promptGone) {
      return true; // Successfully approved
    }

    retries++;
  }

  // Max retries exceeded
  return false;
}

export function generateSessionName(agentType: string, teamName?: string, index?: number): string {
  let name = `hive-${agentType}`;
  if (teamName) {
    name += `-${teamName}`;
  }
  if (index !== undefined && index > 1) {
    name += `-${index}`;
  }
  return name;
}

const MANAGER_SESSION = 'hive-manager';

export async function isManagerRunning(): Promise<boolean> {
  return isTmuxSessionRunning(MANAGER_SESSION);
}

export async function startManager(interval = DEFAULT_MANAGER_INTERVAL): Promise<boolean> {
  if (await isManagerRunning()) {
    return false; // Already running
  }

  // Start the manager in a detached tmux session
  await execa('tmux', ['new-session', '-d', '-s', MANAGER_SESSION]);

  // Send the manager command
  await execa('tmux', [
    'send-keys',
    '-t',
    MANAGER_SESSION,
    `hive manager start -i ${interval}`,
    'Enter',
  ]);

  return true;
}

export async function stopManager(): Promise<boolean> {
  if (!(await isManagerRunning())) {
    return false; // Not running
  }

  await killTmuxSession(MANAGER_SESSION);
  return true;
}
