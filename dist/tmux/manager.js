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
export async function sendToTmuxSession(sessionName, text) {
    if (text.includes('\n')) {
        // For multi-line text, use tmux buffer to paste correctly
        // Load text into a tmux buffer
        await execa('tmux', ['load-buffer', '-'], { input: text });
        // Paste the buffer into the session
        await execa('tmux', ['paste-buffer', '-t', sessionName]);
        // Send Enter to submit
        await execa('tmux', ['send-keys', '-t', sessionName, 'Enter']);
    }
    else {
        // For single-line text, use send-keys directly
        await execa('tmux', ['send-keys', '-t', sessionName, text, 'Enter']);
    }
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
//# sourceMappingURL=manager.js.map