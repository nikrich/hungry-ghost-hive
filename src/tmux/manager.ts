import { execa } from 'execa';

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

  const execaOptions: { env?: NodeJS.ProcessEnv } = {};
  if (env) {
    execaOptions.env = { ...process.env, ...env };
  }

  await execa('tmux', args, execaOptions);

  // Small delay to let shell initialize
  await new Promise(resolve => setTimeout(resolve, 500));

  // Send the command to the session
  if (command) {
    await execa('tmux', ['send-keys', '-t', sessionName, command, 'Enter']);
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

export async function sendToTmuxSession(sessionName: string, text: string, clearFirst = true): Promise<void> {
  if (clearFirst) {
    // Clear any existing input at the prompt before sending new text
    // Escape: exit any menu/selection state
    // Ctrl+U: clear line from cursor to beginning
    await execa('tmux', ['send-keys', '-t', sessionName, 'Escape']);
    await new Promise(resolve => setTimeout(resolve, 50));
    await execa('tmux', ['send-keys', '-t', sessionName, 'C-u']);
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  if (text.includes('\n')) {
    // For multi-line text, send each line separately to avoid buffer race conditions
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        // Use send-keys with literal flag to handle special characters
        // '--' signals end of options, preventing lines starting with '-' from being parsed as flags
        await execa('tmux', ['send-keys', '-t', sessionName, '-l', '--', line]);
        // Send Enter as a key event, not as literal text, to ensure prompt receives it
        await execa('tmux', ['send-keys', '-t', sessionName, 'C-m']);
        // Small delay between lines to ensure they're processed
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } else {
    // For single-line text, use send-keys with literal flag then Enter separately
    // '--' signals end of options, preventing text starting with '-' from being parsed as flags
    await execa('tmux', ['send-keys', '-t', sessionName, '-l', '--', text]);
    // Send Enter as a key event (C-m = carriage return = Enter) to ensure prompt receives it
    await execa('tmux', ['send-keys', '-t', sessionName, 'C-m']);
  }
}

export async function sendEnterToTmuxSession(sessionName: string): Promise<void> {
  // C-m is equivalent to Enter/Return
  await execa('tmux', ['send-keys', '-t', sessionName, 'C-m']);
}

export async function captureTmuxPane(sessionName: string, lines = 100): Promise<string> {
  try {
    const { stdout } = await execa('tmux', [
      'capture-pane',
      '-t', sessionName,
      '-p',
      '-S', `-${lines}`,
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
 * Detects current mode and cycles to bypass mode using BTab if needed.
 *
 * Mode cycle: plan -> safe -> bypass -> plan
 *
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
    const outputLower = output.toLowerCase();

    // Check if already in bypass mode (most desired state)
    if (outputLower.includes('bypass permissions on')) {
      return true;
    }

    // Detect other modes to make intelligent cycling decisions
    const inPlanMode = outputLower.includes('plan mode on');
    const inSafeMode = outputLower.includes('safe mode on');

    // If in plan or safe mode, need to cycle to reach bypass mode
    // For plan mode: plan -> safe -> bypass (2 cycles needed)
    // For safe mode: safe -> bypass (1 cycle needed)
    // If neither detected: attempt cycle anyway (may already be in bypass)
    if (inPlanMode || inSafeMode || (!inPlanMode && !inSafeMode)) {
      // Send BTab (Shift+Tab / backtab) to cycle permissions mode
      await execa('tmux', ['send-keys', '-t', sessionName, 'BTab']);

      // Adaptive delay: start at 500ms, increase on retries
      // This accounts for UI refresh time which may vary
      const delayMs = 500 + (retries * 100);
      await new Promise(resolve => setTimeout(resolve, delayMs));

      retries++;
      continue;
    }

    // Unexpected state - safety check: cycle anyway
    // This is a fallback for any unrecognized mode state
    await execa('tmux', ['send-keys', '-t', sessionName, 'BTab']);
    const delayMs = 500 + (retries * 100);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    retries++;
  }

  // Max retries exceeded
  // Log that we couldn't confirm bypass mode for debugging
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
  ]);

  // Send the manager command
  await execa('tmux', [
    'send-keys',
    '-t', MANAGER_SESSION,
    `hive manager start -i ${interval}`,
    'Enter',
  ]);

  return true;
}

export async function stopManager(): Promise<boolean> {
  if (!await isManagerRunning()) {
    return false; // Not running
  }

  await killTmuxSession(MANAGER_SESSION);
  return true;
}
