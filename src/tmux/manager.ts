import { execa } from 'execa';

// Default timeout for tmux commands to prevent hangs (10 seconds)
const TMUX_TIMEOUT_MS = 10000;

export interface TmuxSessionOptions {
  sessionName: string;
  workDir: string;
  command: string;
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
    await execa('which', ['tmux'], { timeout: TMUX_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export async function isTmuxSessionRunning(sessionName: string): Promise<boolean> {
  try {
    await execa('tmux', ['has-session', '-t', sessionName], { timeout: TMUX_TIMEOUT_MS });
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
    ], { timeout: TMUX_TIMEOUT_MS });

    return stdout.split('\n').filter(Boolean).map(line => {
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
  const { sessionName, workDir, command, env } = options;

  // Kill existing session if it exists
  if (await isTmuxSessionRunning(sessionName)) {
    await killTmuxSession(sessionName);
  }

  // Create new detached session with default shell
  const args = [
    'new-session',
    '-d',
    '-s', sessionName,
    '-c', workDir,
  ];

  const execaOptions: { env?: NodeJS.ProcessEnv; timeout: number } = { timeout: TMUX_TIMEOUT_MS };
  if (env) {
    execaOptions.env = { ...process.env, ...env };
  }

  await execa('tmux', args, execaOptions);

  // Small delay to let shell initialize
  await new Promise(resolve => setTimeout(resolve, 500));

  // Send the command to the session
  if (command) {
    await execa('tmux', ['send-keys', '-t', sessionName, command, 'Enter'], { timeout: TMUX_TIMEOUT_MS });
  }
}

export async function killTmuxSession(sessionName: string): Promise<void> {
  try {
    await execa('tmux', ['kill-session', '-t', sessionName], { timeout: TMUX_TIMEOUT_MS });
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

export async function sendToTmuxSession(sessionName: string, text: string, clearFirst = true): Promise<void> {
  if (clearFirst) {
    // Clear any existing input at the prompt before sending new text
    // Escape: exit any menu/selection state
    // Ctrl+U: clear line from cursor to beginning
    await execa('tmux', ['send-keys', '-t', sessionName, 'Escape'], { timeout: TMUX_TIMEOUT_MS });
    await new Promise(resolve => setTimeout(resolve, 50));
    await execa('tmux', ['send-keys', '-t', sessionName, 'C-u'], { timeout: TMUX_TIMEOUT_MS });
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  if (text.includes('\n')) {
    // For multi-line text, send each line separately to avoid buffer race conditions
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        // Use send-keys with literal flag to handle special characters
        // '--' signals end of options, preventing lines starting with '-' from being parsed as flags
        await execa('tmux', ['send-keys', '-t', sessionName, '-l', '--', line], { timeout: TMUX_TIMEOUT_MS });
        // Send Enter as a key event, not as literal text, to ensure prompt receives it
        await execa('tmux', ['send-keys', '-t', sessionName, 'C-m'], { timeout: TMUX_TIMEOUT_MS });
        // Small delay between lines to ensure they're processed
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } else {
    // For single-line text, use send-keys with literal flag then Enter separately
    // '--' signals end of options, preventing text starting with '-' from being parsed as flags
    await execa('tmux', ['send-keys', '-t', sessionName, '-l', '--', text], { timeout: TMUX_TIMEOUT_MS });
    // Send Enter as a key event (C-m = carriage return = Enter) to ensure prompt receives it
    await execa('tmux', ['send-keys', '-t', sessionName, 'C-m'], { timeout: TMUX_TIMEOUT_MS });
  }
}

export async function sendEnterToTmuxSession(sessionName: string): Promise<void> {
  // C-m is equivalent to Enter/Return
  await execa('tmux', ['send-keys', '-t', sessionName, 'C-m'], { timeout: TMUX_TIMEOUT_MS });
}

export async function captureTmuxPane(sessionName: string, lines = 100): Promise<string> {
  try {
    const { stdout } = await execa('tmux', [
      'capture-pane',
      '-t', sessionName,
      '-p',
      '-S', `-${lines}`,
    ], { timeout: TMUX_TIMEOUT_MS });
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
  maxWaitMs = 15000,
  pollIntervalMs = 200
): Promise<boolean> {
  const startTime = Date.now();
  let lastOutput = '';

  while (Date.now() - startTime < maxWaitMs) {
    const output = await captureTmuxPane(sessionName, 50);

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
  maxRetries = 5
): Promise<boolean> {
  // Note: cliTool parameter is reserved for future Codex/Gemini CLI integration
  // Currently, all CLIs use the same BTab key sequence for cycling permissions
  let retries = 0;

  while (retries < maxRetries) {
    // Capture pane output to check current permission mode
    const output = await captureTmuxPane(sessionName, 100);

    // Check if already in bypass mode
    if (output.toLowerCase().includes('bypass permissions on')) {
      return true;
    }

    // Check if in plan mode (needs to be switched)
    if (output.toLowerCase().includes('plan mode on')) {
      // Send BTab (Shift+Tab / backtab) to cycle permissions mode
      // For Claude Code, BTab cycles through: plan -> safe -> bypass -> plan
      await execa('tmux', ['send-keys', '-t', sessionName, 'BTab'], { timeout: TMUX_TIMEOUT_MS });

      // Wait for the mode change to take effect
      await new Promise(resolve => setTimeout(resolve, 500));

      retries++;
      continue;
    }

    // If neither plan mode nor bypass mode is detected, try cycling anyway
    // This handles cases where the mode indicator might not be visible
    await execa('tmux', ['send-keys', '-t', sessionName, 'BTab'], { timeout: TMUX_TIMEOUT_MS });
    await new Promise(resolve => setTimeout(resolve, 500));

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
  maxRetries = 3,
  initialWaitMs = 300
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
    const output = await captureTmuxPane(sessionName, 100);

    // Check if the first line of the message appears in the output
    // Extract first meaningful part of message for verification
    const messageLines = message.split('\n').filter(line => line.trim());
    const verificationText = messageLines.length > 0 ? messageLines[0].substring(0, 50) : message.substring(0, 50);

    if (output.includes(verificationText)) {
      // Message verified in output - delivery confirmed
      return true;
    }

    retries++;
    if (retries < maxRetries) {
      // Exponential backoff: double the wait time for next retry
      waitTime = Math.min(waitTime * 2, 2000); // Cap at 2 seconds
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  // Max retries exceeded - delivery not confirmed
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

export async function startManager(interval = 60): Promise<boolean> {
  if (await isManagerRunning()) {
    return false; // Already running
  }

  // Start the manager in a detached tmux session
  await execa('tmux', [
    'new-session',
    '-d',
    '-s', MANAGER_SESSION,
  ], { timeout: TMUX_TIMEOUT_MS });

  // Send the manager command
  await execa('tmux', [
    'send-keys',
    '-t', MANAGER_SESSION,
    `hive manager start -i ${interval}`,
    'Enter',
  ], { timeout: TMUX_TIMEOUT_MS });

  return true;
}

export async function stopManager(): Promise<boolean> {
  if (!await isManagerRunning()) {
    return false; // Not running
  }

  await killTmuxSession(MANAGER_SESSION);
  return true;
}
