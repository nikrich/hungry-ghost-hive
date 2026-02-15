// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { AgentState } from '../../../state-detectors/types.js';
import { detectAgentState } from './agent-monitoring.js';

const INTERRUPTION_BANNER = `■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit \`/feedback\` to report the issue.`;
const RATE_LIMIT_BANNER =
  '■ exceeded retry limit, last status: 429 Too Many Requests, request id: abc123';
const ANTHROPIC_RATE_LIMIT =
  'API Error: {"type":"error","error":{"type":"rate_limit_error","message":"Rate limit exceeded"}}';
const GEMINI_RATE_LIMIT =
  'RESOURCE_EXHAUSTED: Quota exceeded for quota metric GenerateContent requests per minute.';
const INTERACTIVE_PROMPT = '› Improve documentation in @filename\n\n  ? for shortcuts';
const INTERACTIVE_PROMPT_WITH_PASTE =
  '› [Pasted Content 1203 chars]\n\n  16% context left';

describe('detectAgentState interruption fallback', () => {
  it('treats interruption banner as blocked for codex sessions', () => {
    const result = detectAgentState(INTERRUPTION_BANNER, 'codex');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(true);
  });

  it('applies interruption fallback for other cli tools', () => {
    const result = detectAgentState(INTERRUPTION_BANNER, 'claude');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.needsHuman).toBe(true);
  });

  it('prioritizes interruption over stale working text in pane history', () => {
    const output = `I'm working through the design.\n${INTERRUPTION_BANNER}`;
    const result = detectAgentState(output, 'codex');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.needsHuman).toBe(true);
  });

  it('treats rate limit prompts as recoverable waiting state', () => {
    const result = detectAgentState(RATE_LIMIT_BANNER, 'codex');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('prioritizes rate-limit fallback over stale question text in pane history', () => {
    const output = `${RATE_LIMIT_BANNER}\n› Write tests for @filename`;
    const result = detectAgentState(output, 'codex');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.needsHuman).toBe(false);
  });

  it('detects anthropic/openai style rate-limit errors', () => {
    const result = detectAgentState(ANTHROPIC_RATE_LIMIT, 'claude');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('detects gemini resource exhausted quota errors', () => {
    const result = detectAgentState(GEMINI_RATE_LIMIT, 'gemini');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('does not treat planning text about rate limits as blocked state', () => {
    const output = 'Plan: add rate limiting middleware and return 429 for burst traffic.';
    const result = detectAgentState(output, 'codex');

    expect(result.state).not.toBe(AgentState.USER_DECLINED);
  });

  it('detects interactive input prompt for codex sessions', () => {
    const result = detectAgentState(INTERACTIVE_PROMPT, 'codex');

    expect(result.state).toBe(AgentState.ASKING_QUESTION);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(true);
  });

  it('detects interactive input prompt across all cli providers', () => {
    const claudeResult = detectAgentState(INTERACTIVE_PROMPT, 'claude');
    const geminiResult = detectAgentState(INTERACTIVE_PROMPT, 'gemini');

    expect(claudeResult.state).toBe(AgentState.ASKING_QUESTION);
    expect(claudeResult.needsHuman).toBe(true);
    expect(geminiResult.state).toBe(AgentState.ASKING_QUESTION);
    expect(geminiResult.needsHuman).toBe(true);
  });

  it('prioritizes interactive prompt over stale processing text', () => {
    const output = `Partition processing now complete.\n${INTERACTIVE_PROMPT}`;
    const result = detectAgentState(output, 'codex');

    expect(result.state).toBe(AgentState.ASKING_QUESTION);
    expect(result.needsHuman).toBe(true);
  });

  it('detects interactive prompt with pasted-content and context-left ui', () => {
    const result = detectAgentState(INTERACTIVE_PROMPT_WITH_PASTE, 'codex');

    expect(result.state).toBe(AgentState.ASKING_QUESTION);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(true);
  });
});
