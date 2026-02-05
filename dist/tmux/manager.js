import { execa } from 'execa';
export async function isTmuxAvailable() {
    try {
        await execa('which', ['tmux']);
        return true;
    }
    catch {
        return false;
    }
}
export async function isTmuxSessionRunning(sessionName) {
    try {
        await execa('tmux', ['has-session', '-t', sessionName]);
        return true;
    }
    catch {
        return false;
    }
}
export async function listTmuxSessions() {
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
    }
    catch {
        return [];
    }
}
export async function getHiveSessions() {
    const sessions = await listTmuxSessions();
    return sessions.filter(s => s.name.startsWith('hive-'));
}
export async function spawnTmuxSession(options) {
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
    const execaOptions = {};
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
export async function killTmuxSession(sessionName) {
    try {
        await execa('tmux', ['kill-session', '-t', sessionName]);
    }
    catch {
        // Session might not exist, ignore error
    }
}
export async function killAllHiveSessions() {
    const sessions = await getHiveSessions();
    let killed = 0;
    for (const session of sessions) {
        try {
            await killTmuxSession(session.name);
            killed++;
        }
        catch {
            // Ignore errors
        }
    }
    return killed;
}
export async function sendToTmuxSession(sessionName, text, clearFirst = true) {
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
                await execa('tmux', ['send-keys', '-t', sessionName, '-l', line]);
                await execa('tmux', ['send-keys', '-t', sessionName, 'Enter']);
                // Small delay between lines to ensure they're processed
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }
    else {
        // For single-line text, use send-keys with literal flag then Enter separately
        await execa('tmux', ['send-keys', '-t', sessionName, '-l', text]);
        await execa('tmux', ['send-keys', '-t', sessionName, 'Enter']);
    }
}
export async function sendEnterToTmuxSession(sessionName) {
    // C-m is equivalent to Enter/Return
    await execa('tmux', ['send-keys', '-t', sessionName, 'C-m']);
}
export async function captureTmuxPane(sessionName, lines = 100) {
    try {
        const { stdout } = await execa('tmux', [
            'capture-pane',
            '-t', sessionName,
            '-p',
            '-S', `-${lines}`,
        ]);
        return stdout;
    }
    catch {
        return '';
    }
}
export function generateSessionName(agentType, teamName, index) {
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
export async function isManagerRunning() {
    return isTmuxSessionRunning(MANAGER_SESSION);
}
export async function startManager(interval = 60) {
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
export async function stopManager() {
    if (!await isManagerRunning()) {
        return false; // Not running
    }
    await killTmuxSession(MANAGER_SESSION);
    return true;
}
//# sourceMappingURL=manager.js.map