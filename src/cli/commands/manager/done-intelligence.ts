// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { createHash } from 'crypto';
import { readFile, rm, writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execa } from 'execa';
import type { HiveConfig } from '../../../config/schema.js';
import type { CLITool } from '../../../utils/cli-commands.js';

const COMPLETION_ANALYSIS_WINDOW_LINES = 180;
const COMPLETION_AI_CACHE_MS = 5 * 60 * 1000;

const COMPLETION_CANDIDATE_PATTERNS = [
  /worked for \d+/i,
  /testing:\s*(?:not run|pass|fail)/i,
  /next steps:/i,
  /implementation complete/i,
  /ready for review/i,
  /summary/i,
  /pull request|pr submitted/i,
  /all requested code changes.*(?:done|complete|finished)/i,
  /(?:implementation|templates?|tests?).*(?:done|complete|finished).*(?:locally)?/i,
  /pending.*(?:pr submission|submit(?:ting)? (?:a )?pr)/i,
  /(?:story|task).*(?:still|remains)\s+in[_ -]?progress.*(?:done|complete|ready)/i,
];

const NON_COMPLETION_PATTERNS = [
  /if stuck/i,
  /need help/i,
  /blocked/i,
  /awaiting/i,
  /cannot proceed/i,
  /no other work can proceed/i,
  /missing .*proto/i,
  /waiting for .*files?/i,
  /needs? .*restored/i,
  /\b(?:choose|select|approve|deny)\b/i,
  /\?\s*$/,
];

export interface CompletionAssessment {
  done: boolean;
  confidence: number;
  reason: string;
  usedAi: boolean;
}

interface AssessmentCacheEntry {
  expiresAtMs: number;
  fingerprint: string;
  assessment: CompletionAssessment;
}

const completionAssessmentCache = new Map<string, AssessmentCacheEntry>();

function getRecentOutput(output: string): string {
  return output.split('\n').slice(-COMPLETION_ANALYSIS_WINDOW_LINES).join('\n');
}

function buildFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function isCompletionCandidateOutput(output: string): boolean {
  const recent = getRecentOutput(output);
  const hasCandidateSignal = COMPLETION_CANDIDATE_PATTERNS.some(pattern => pattern.test(recent));
  if (!hasCandidateSignal) return false;

  const hasStrongNonCompletionSignal = NON_COMPLETION_PATTERNS.some(pattern =>
    pattern.test(recent)
  );
  return !hasStrongNonCompletionSignal;
}

function assessCompletionHeuristically(output: string): CompletionAssessment {
  const recent = getRecentOutput(output);
  const hasCandidateSignal = COMPLETION_CANDIDATE_PATTERNS.some(pattern => pattern.test(recent));
  const hasStrongNonCompletionSignal = NON_COMPLETION_PATTERNS.some(pattern =>
    pattern.test(recent)
  );

  // Strong signal: implementation appears done locally but agent is looping on "pending PR/tests".
  const doneLocallyPendingSubmit =
    /(?:implementation|code changes|requested changes).*(?:done|complete|finished)/i.test(recent) &&
    /pending.*(?:pr submission|submit(?:ting)? (?:a )?pr)|next.*(?:hive pr submit|mark .*complete)/i.test(
      recent
    );

  if (doneLocallyPendingSubmit && !hasStrongNonCompletionSignal) {
    return {
      done: true,
      confidence: 0.84,
      reason: 'Heuristic: implementation appears complete and stalled at PR-submission workflow',
      usedAi: false,
    };
  }

  if (hasStrongNonCompletionSignal && !hasCandidateSignal) {
    return {
      done: false,
      confidence: 0,
      reason: 'Heuristic: blocked/incomplete signals detected',
      usedAi: false,
    };
  }

  if (!hasCandidateSignal) {
    return {
      done: false,
      confidence: 0,
      reason: 'No completion-candidate signals in output',
      usedAi: false,
    };
  }

  return {
    done: false,
    confidence: 0.35,
    reason: 'Heuristic: candidate signals found; awaiting AI semantic classification',
    usedAi: false,
  };
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseAssessmentJson(rawContent: string): CompletionAssessment | null {
  const jsonBlockMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonBlockMatch) return null;

  try {
    const parsed = JSON.parse(jsonBlockMatch[0]) as {
      done?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    return {
      done: parsed.done === true,
      confidence: normalizeConfidence(parsed.confidence),
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
      usedAi: true,
    };
  } catch {
    return null;
  }
}

function buildCompletionClassifierPrompt(
  sessionName: string,
  storyId: string,
  output: string
): { system: string; user: string } {
  return {
    system:
      'You are a strict classifier for engineering agent terminal output. ' +
      'Decide if the agent has already finished implementation and is now at post-work summary state. ' +
      'Return JSON only.',
    user:
      `Session: ${sessionName}\n` +
      `Story: ${storyId}\n` +
      'Classify whether the agent is done and should move to PR submission workflow.\n' +
      'Rules:\n' +
      '- done=true only when output indicates completed implementation summary/final report.\n' +
      '- done=false if output is planning, blocked, asking for approval, or still executing.\n' +
      '- Confidence must be between 0 and 1.\n' +
      'Respond with exactly:\n' +
      '{"done": boolean, "confidence": number, "reason": string}\n' +
      '\nOUTPUT:\n' +
      '<<<\n' +
      output +
      '\n>>>',
  };
}

const COMPLETION_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' },
  },
  required: ['done', 'confidence', 'reason'],
  additionalProperties: false,
} as const;

async function runCodexClassifier(
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 'hive-manager-classifier-'));
  const schemaPath = join(workDir, 'completion-schema.json');
  const outputPath = join(workDir, 'completion-output.json');
  await writeFile(schemaPath, JSON.stringify(COMPLETION_RESULT_SCHEMA), 'utf-8');

  try {
    await execa(
      'codex',
      [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--ask-for-approval',
        'never',
        '--ephemeral',
        '--model',
        model,
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '-',
      ],
      {
        input: prompt,
        timeout: timeoutMs,
      }
    );

    return await readFile(outputPath, 'utf-8');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runClaudeClassifier(
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const result = await execa(
    'claude',
    [
      '--print',
      '--model',
      model,
      '--tools',
      '',
      '--output-format',
      'text',
      '--json-schema',
      JSON.stringify(COMPLETION_RESULT_SCHEMA),
      prompt,
    ],
    {
      timeout: timeoutMs,
    }
  );

  return result.stdout;
}

async function runGeminiClassifier(
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const result = await execa(
    'gemini',
    ['--model', model, '--output-format', 'json', '--sandbox', 'false', prompt],
    {
      timeout: timeoutMs,
    }
  );

  return result.stdout;
}

async function runLocalCompletionClassifier(config: HiveConfig, prompt: string): Promise<string> {
  const classifierConfig = config.manager.completion_classifier;
  const cliTool = classifierConfig.cli_tool as CLITool;
  const model = classifierConfig.model;
  const timeoutMs = classifierConfig.timeout_ms;

  switch (cliTool) {
    case 'codex':
      return runCodexClassifier(model, prompt, timeoutMs);
    case 'claude':
      return runClaudeClassifier(model, prompt, timeoutMs);
    case 'gemini':
      return runGeminiClassifier(model, prompt, timeoutMs);
    default:
      return runCodexClassifier(model, prompt, timeoutMs);
  }
}

export async function assessCompletionFromOutput(
  config: HiveConfig,
  sessionName: string,
  storyId: string,
  output: string
): Promise<CompletionAssessment> {
  const recentOutput = getRecentOutput(output);
  const heuristicAssessment = assessCompletionHeuristically(recentOutput);

  const cacheKey = `${sessionName}:${storyId}`;
  const nowMs = Date.now();
  const fingerprint = buildFingerprint(recentOutput);
  const cached = completionAssessmentCache.get(cacheKey);
  if (cached && cached.fingerprint === fingerprint && cached.expiresAtMs > nowMs) {
    return cached.assessment;
  }

  try {
    const prompt = buildCompletionClassifierPrompt(sessionName, storyId, recentOutput);
    const responseContent = await runLocalCompletionClassifier(
      config,
      `${prompt.system}\n\n${prompt.user}`
    );

    const parsed = parseAssessmentJson(responseContent);
    const assessment: CompletionAssessment =
      parsed ||
      ({
        done: false,
        confidence: 0,
        reason: 'Could not parse local CLI classifier response as JSON',
        usedAi: true,
      } satisfies CompletionAssessment);

    completionAssessmentCache.set(cacheKey, {
      fingerprint,
      assessment,
      expiresAtMs: nowMs + COMPLETION_AI_CACHE_MS,
    });
    return assessment;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Fall back to heuristic classification when local CLI classifier is unavailable.
    const fallbackAssessment: CompletionAssessment = {
      ...heuristicAssessment,
      reason: heuristicAssessment.done
        ? `${heuristicAssessment.reason}; local classifier unavailable: ${message}`
        : `Local classifier unavailable: ${message}`,
      usedAi: false,
    };
    completionAssessmentCache.set(cacheKey, {
      fingerprint,
      assessment: fallbackAssessment,
      expiresAtMs: nowMs + COMPLETION_AI_CACHE_MS,
    });
    return fallbackAssessment;
  }
}

export function clearCompletionAssessmentCache(): void {
  completionAssessmentCache.clear();
}
