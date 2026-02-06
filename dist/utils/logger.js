import chalk from 'chalk';
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
let currentLevel = 'info';
export function setLogLevel(level) {
    currentLevel = level;
}
export function getLogLevel() {
    return currentLevel;
}
function shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}
function formatTimestamp() {
    return new Date().toISOString().substring(11, 19);
}
export function debug(message, ...args) {
    if (shouldLog('debug')) {
        console.log(chalk.gray(`[${formatTimestamp()}] DEBUG:`), message, ...args);
    }
}
export function info(message, ...args) {
    if (shouldLog('info')) {
        console.log(chalk.blue(`[${formatTimestamp()}]`), message, ...args);
    }
}
export function success(message, ...args) {
    if (shouldLog('info')) {
        console.log(chalk.green(`[${formatTimestamp()}] ✓`), message, ...args);
    }
}
export function warn(message, ...args) {
    if (shouldLog('warn')) {
        console.log(chalk.yellow(`[${formatTimestamp()}] ⚠`), message, ...args);
    }
}
export function error(message, ...args) {
    if (shouldLog('error')) {
        console.error(chalk.red(`[${formatTimestamp()}] ✗`), message, ...args);
    }
}
// Formatting helpers
export function highlight(text) {
    return chalk.cyan(text);
}
export function dim(text) {
    return chalk.gray(text);
}
export function bold(text) {
    return chalk.bold(text);
}
export function statusColor(status) {
    switch (status.toLowerCase()) {
        case 'idle':
            return chalk.gray(status);
        case 'working':
        case 'in_progress':
            return chalk.yellow(status);
        case 'blocked':
        case 'qa_failed':
            return chalk.red(status);
        case 'completed':
        case 'merged':
        case 'qa':
            return chalk.green(status);
        case 'review':
        case 'pr_submitted':
            return chalk.blue(status);
        default:
            return status;
    }
}
//# sourceMappingURL=logger.js.map