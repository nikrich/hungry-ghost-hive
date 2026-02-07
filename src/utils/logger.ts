// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString().substring(11, 19);
}

export function debug(message: string, ...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.log(chalk.gray(`[${formatTimestamp()}] DEBUG:`), message, ...args);
  }
}

export function info(message: string, ...args: unknown[]): void {
  if (shouldLog('info')) {
    console.log(chalk.blue(`[${formatTimestamp()}]`), message, ...args);
  }
}

export function success(message: string, ...args: unknown[]): void {
  if (shouldLog('info')) {
    console.log(chalk.green(`[${formatTimestamp()}] ✓`), message, ...args);
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (shouldLog('warn')) {
    console.log(chalk.yellow(`[${formatTimestamp()}] ⚠`), message, ...args);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (shouldLog('error')) {
    console.error(chalk.red(`[${formatTimestamp()}] ✗`), message, ...args);
  }
}

// Formatting helpers
export function highlight(text: string): string {
  return chalk.cyan(text);
}

export function dim(text: string): string {
  return chalk.gray(text);
}

export function bold(text: string): string {
  return chalk.bold(text);
}

export function statusColor(status: string): string {
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
