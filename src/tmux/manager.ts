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

export async function sendToTmuxSession(sessionName: string, text: string): Promise<void> {
  if (text.includes('\n')) {
    // For multi-line text, use tmux buffer to paste correctly
    // Load text into a tmux buffer
    await execa('tmux', ['load-buffer', '-'], { input: text });
    // Paste the buffer into the session
    await execa('tmux', ['paste-buffer', '-t', sessionName]);
    // Small delay to let paste complete
    await new Promise(resolve => setTimeout(resolve, 200));
    // Send Enter to submit
    await sendEnterToTmuxSession(sessionName);
  } else {
    // For single-line text, use send-keys directly
    await execa('tmux', ['send-keys', '-t', sessionName, text, 'Enter']);
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
