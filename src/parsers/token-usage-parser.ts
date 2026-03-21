// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Token Usage Parser for CLI Agent Sessions
 *
 * Parses token usage information from CLI tool output captured from tmux panes.
 * Supports Claude Code, Codex, and Gemini output formats.
 * Also reads token usage directly from Claude Code's JSONL conversation logs.
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { homedir, userInfo } from 'os';
import { join, resolve } from 'path';

export interface ParsedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number;
}

/**
 * Parse a number string that may contain commas (e.g. "12,345" -> 12345)
 */
function parseNumberWithCommas(str: string): number {
  return parseInt(str.replace(/,/g, ''), 10);
}

/**
 * Parse a cost string (e.g. "$1.23" or "1.23" -> 1.23)
 */
function parseCost(str: string): number {
  return parseFloat(str.replace(/[$,]/g, ''));
}

// --- Claude Code patterns ---
// Claude Code session summary formats:
//   "Total input tokens: 12,345"
//   "Total output tokens: 7,890"
//   "Total tokens: 20,235"
//   "Input: 5,000 / Output: 7,345"
//   "Total cost: $1.23"
//   "Cost: $0.45"

const CLAUDE_INPUT_TOKENS = /(?:total\s+)?input\s*(?:tokens)?[:\s]+([0-9,]+)/i;
const CLAUDE_OUTPUT_TOKENS = /(?:total\s+)?output\s*(?:tokens)?[:\s]+([0-9,]+)/i;
const CLAUDE_TOTAL_TOKENS = /total\s+tokens[:\s]+([0-9,]+)/i;
const CLAUDE_INPUT_OUTPUT_INLINE = /input[:\s]+([0-9,]+)\s*[/|]\s*output[:\s]+([0-9,]+)/i;
const CLAUDE_COST = /(?:total\s+)?cost[:\s]+\$([0-9,.]+)/i;

function parseClaudeTokens(output: string): ParsedTokenUsage | null {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let totalTokens: number | null = null;
  let cost: number | undefined;

  // Try inline format first: "Input: 5,000 / Output: 7,345"
  const inlineMatch = output.match(CLAUDE_INPUT_OUTPUT_INLINE);
  if (inlineMatch) {
    inputTokens = parseNumberWithCommas(inlineMatch[1]);
    outputTokens = parseNumberWithCommas(inlineMatch[2]);
  }

  // Try individual field patterns (may override inline if more specific)
  const inputMatch = output.match(CLAUDE_INPUT_TOKENS);
  const outputMatch = output.match(CLAUDE_OUTPUT_TOKENS);

  if (inputMatch && !inlineMatch) {
    inputTokens = parseNumberWithCommas(inputMatch[1]);
  }
  if (outputMatch && !inlineMatch) {
    outputTokens = parseNumberWithCommas(outputMatch[1]);
  }

  const totalMatch = output.match(CLAUDE_TOTAL_TOKENS);
  if (totalMatch) {
    totalTokens = parseNumberWithCommas(totalMatch[1]);
  }

  const costMatch = output.match(CLAUDE_COST);
  if (costMatch) {
    cost = parseCost(costMatch[1]);
  }

  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }

  // Compute missing values
  inputTokens = inputTokens ?? 0;
  outputTokens = outputTokens ?? 0;
  totalTokens = totalTokens ?? inputTokens + outputTokens;

  return { inputTokens, outputTokens, totalTokens, cost };
}

// --- Codex patterns ---
// Codex session summary formats:
//   "Tokens used: 15,000 (input: 8,000, output: 7,000)"
//   "Token usage - Input: 8,000 Output: 7,000 Total: 15,000"
//   "tokens: 15000"

const CODEX_TOKENS_USED =
  /tokens\s+used[:\s]+([0-9,]+)\s*\(\s*input[:\s]+([0-9,]+)[,\s]+output[:\s]+([0-9,]+)\s*\)/i;
const CODEX_TOKEN_USAGE =
  /token\s+usage\s*[-–]\s*input[:\s]+([0-9,]+)\s+output[:\s]+([0-9,]+)\s+total[:\s]+([0-9,]+)/i;
const CODEX_SIMPLE_TOKENS = /tokens[:\s]+([0-9,]+)\s*$/im;

function parseCodexTokens(output: string): ParsedTokenUsage | null {
  const usedMatch = output.match(CODEX_TOKENS_USED);
  if (usedMatch) {
    return {
      inputTokens: parseNumberWithCommas(usedMatch[2]),
      outputTokens: parseNumberWithCommas(usedMatch[3]),
      totalTokens: parseNumberWithCommas(usedMatch[1]),
    };
  }

  const usageMatch = output.match(CODEX_TOKEN_USAGE);
  if (usageMatch) {
    return {
      inputTokens: parseNumberWithCommas(usageMatch[1]),
      outputTokens: parseNumberWithCommas(usageMatch[2]),
      totalTokens: parseNumberWithCommas(usageMatch[3]),
    };
  }

  const simpleMatch = output.match(CODEX_SIMPLE_TOKENS);
  if (simpleMatch) {
    const total = parseNumberWithCommas(simpleMatch[1]);
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: total,
    };
  }

  return null;
}

// --- Gemini patterns ---
// Gemini session summary formats:
//   "Token count: input=5000, output=3000, total=8000"
//   "Tokens: 8,000 total (5,000 input, 3,000 output)"
//   "Usage: 5000 input tokens, 3000 output tokens"

const GEMINI_TOKEN_COUNT =
  /token\s+count[:\s]+input\s*=\s*([0-9,]+)[,\s]+output\s*=\s*([0-9,]+)[,\s]+total\s*=\s*([0-9,]+)/i;
const GEMINI_TOKENS_TOTAL =
  /tokens[:\s]+([0-9,]+)\s+total\s*\(\s*([0-9,]+)\s+input[,\s]+([0-9,]+)\s+output\s*\)/i;
const GEMINI_USAGE = /usage[:\s]+([0-9,]+)\s+input\s+tokens[,\s]+([0-9,]+)\s+output\s+tokens/i;

function parseGeminiTokens(output: string): ParsedTokenUsage | null {
  const countMatch = output.match(GEMINI_TOKEN_COUNT);
  if (countMatch) {
    return {
      inputTokens: parseNumberWithCommas(countMatch[1]),
      outputTokens: parseNumberWithCommas(countMatch[2]),
      totalTokens: parseNumberWithCommas(countMatch[3]),
    };
  }

  const totalMatch = output.match(GEMINI_TOKENS_TOTAL);
  if (totalMatch) {
    return {
      inputTokens: parseNumberWithCommas(totalMatch[2]),
      outputTokens: parseNumberWithCommas(totalMatch[3]),
      totalTokens: parseNumberWithCommas(totalMatch[1]),
    };
  }

  const usageMatch = output.match(GEMINI_USAGE);
  if (usageMatch) {
    const input = parseNumberWithCommas(usageMatch[1]);
    const output_tokens = parseNumberWithCommas(usageMatch[2]);
    return {
      inputTokens: input,
      outputTokens: output_tokens,
      totalTokens: input + output_tokens,
    };
  }

  return null;
}

/**
 * Parse token usage from CLI agent tmux pane output.
 * Tries Claude Code, Codex, and Gemini formats in order.
 * Returns null if no token information is found.
 */
export function parseTokenUsage(output: string): ParsedTokenUsage | null {
  if (!output || output.trim().length === 0) {
    return null;
  }

  // Try each parser in order - Claude Code is most common
  return parseClaudeTokens(output) ?? parseCodexTokens(output) ?? parseGeminiTokens(output);
}

// --- JSONL-based token reading (Claude Code session logs) ---

/**
 * Convert an absolute directory path to the Claude Code project directory name.
 * Claude Code escapes paths by replacing '/' with '-'.
 */
export function pathToClaudeProjectDir(absolutePath: string): string {
  return absolutePath.replace(/\//g, '-');
}

/**
 * Parse token usage from a Claude Code JSONL session file.
 * Sums up usage across all assistant messages in the conversation,
 * including cache_creation_input_tokens and cache_read_input_tokens
 * which make up the bulk of real input token usage.
 */
export function parseTokenUsageFromJsonl(filePath: string): ParsedTokenUsage | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const usage = entry?.message?.usage;
        if (usage) {
          inputTokens += usage.input_tokens || 0;
          outputTokens += usage.output_tokens || 0;
          cacheCreationTokens += usage.cache_creation_input_tokens || 0;
          cacheReadTokens += usage.cache_read_input_tokens || 0;
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Total input includes direct input + cache creation + cache read tokens
    const totalInput = inputTokens + cacheCreationTokens + cacheReadTokens;
    const totalTokens = totalInput + outputTokens;
    if (totalTokens === 0) return null;

    return { inputTokens: totalInput, outputTokens, totalTokens };
  } catch {
    return null;
  }
}

/**
 * Get token usage for a Claude Code agent by its working directory.
 * Sums usage across all JSONL session files for the agent.
 */
export function getTokenUsageForAgent(workDir: string): ParsedTokenUsage | null {
  const sessionFiles = findAllSessionFiles(workDir);
  if (sessionFiles.length === 0) return null;

  let totalInput = 0;
  let totalOutput = 0;

  for (const file of sessionFiles) {
    const usage = parseTokenUsageFromJsonl(file);
    if (usage) {
      totalInput += usage.inputTokens;
      totalOutput += usage.outputTokens;
    }
  }

  const totalTokens = totalInput + totalOutput;
  if (totalTokens === 0) return null;

  return { inputTokens: totalInput, outputTokens: totalOutput, totalTokens };
}

/**
 * Resolve the home directory for the OS user that owns a given path.
 * Falls back to the current process's homedir() if detection fails.
 */
function resolveHomeDirForPath(dirPath: string): string {
  try {
    const stat = statSync(dirPath);
    const currentUid = userInfo().uid;

    // If the directory is owned by the current user, just use homedir()
    if (stat.uid === currentUid) {
      return homedir();
    }

    // Look up the owning user's home directory via getent (POSIX)
    const passwd = execSync(`getent passwd ${stat.uid}`, { encoding: 'utf-8' }).trim();
    const fields = passwd.split(':');
    if (fields.length >= 6 && fields[5]) {
      return fields[5];
    }
  } catch {
    // Fall through to default
  }

  return homedir();
}

/**
 * Find all JSONL session files for a given working directory.
 * Resolves the Claude config directory from the user that owns the workDir,
 * so the manager can read JSONL logs even when running as a different user.
 */
function findAllSessionFiles(workDir: string): string[] {
  const resolvedWorkDir = resolve(workDir);
  const projectDir = pathToClaudeProjectDir(resolvedWorkDir);
  const home = resolveHomeDirForPath(resolvedWorkDir);
  const claudeProjectsDir = join(home, '.claude', 'projects', projectDir);

  try {
    return readdirSync(claudeProjectsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => join(claudeProjectsDir, f));
  } catch {
    return [];
  }
}
