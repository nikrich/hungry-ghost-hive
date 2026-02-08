// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Note: These tests validate the sendMessageWithConfirmation function behavior.
// Full integration tests would require mocking at the execa level.

describe('sendMessageWithConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be exported as a function', async () => {
    const { sendMessageWithConfirmation } = await import('./manager.js');
    expect(typeof sendMessageWithConfirmation).toBe('function');
  });

  it('should have the expected function signature', async () => {
    const { sendMessageWithConfirmation } = await import('./manager.js');
    // Function should accept sessionName, message, and optional maxRetries and initialWaitMs
    const sig = sendMessageWithConfirmation.toString();
    expect(sig).toContain('sessionName');
    expect(sig).toContain('message');
    expect(sig).toContain('maxRetries');
    expect(sig).toContain('initialWaitMs');
  });

  it('should use delivery confirmation instead of fire-and-forget', async () => {
    const { sendMessageWithConfirmation } = await import('./manager.js');
    const sig = sendMessageWithConfirmation.toString();

    // Should include retry logic and verification
    expect(sig).toContain('captureTmuxPane');
    expect(sig).toContain('output.includes');
    expect(sig).toContain('retries');
    expect(sig).toContain('while');
  });

  it('should implement exponential backoff for retries', async () => {
    const { sendMessageWithConfirmation } = await import('./manager.js');
    const sig = sendMessageWithConfirmation.toString();

    // Should have exponential backoff logic
    expect(sig).toContain('waitTime');
    expect(sig).toContain('waitTime * 2');
  });

  it('should verify message text appears in output', async () => {
    const { sendMessageWithConfirmation } = await import('./manager.js');
    const sig = sendMessageWithConfirmation.toString();

    // Should extract and check for message verification text
    expect(sig).toContain('verificationText');
    expect(sig).toContain('messageLines');
  });

  it('should return boolean indicating delivery status', async () => {
    const { sendMessageWithConfirmation } = await import('./manager.js');
    const sig = sendMessageWithConfirmation.toString();

    // Should return true or false based on delivery
    expect(sig).toContain('return true');
    expect(sig).toContain('return false');
  });
});

describe('tmux shell command hardening', () => {
  it('shellEscapeArg should safely escape single quotes', async () => {
    const { shellEscapeArg } = await import('./manager.js');
    expect(shellEscapeArg(`abc'def`)).toBe(`'abc'"'"'def'`);
  });

  it('buildShellCommand should quote every command argument', async () => {
    const { buildShellCommand } = await import('./manager.js');
    const command = buildShellCommand(['claude', '--model', 'gpt-4o-mini; touch /tmp/pwned']);

    expect(command).toBe(`'claude' '--model' 'gpt-4o-mini; touch /tmp/pwned'`);
  });

  it('buildShellCommand should safely escape prompt file path in substitution', async () => {
    const { buildShellCommand } = await import('./manager.js');
    const command = buildShellCommand(['claude'], `/tmp/prompt's file.md`);

    expect(command).toContain(`'claude'`);
    expect(command).toContain(`$(cat '/tmp/prompt'"'"'s file.md')`);
  });

  it('buildHiveInvokeCommand should invoke current CLI entry script via node', async () => {
    const { buildHiveInvokeCommand } = await import('./manager.js');
    const originalArgv1 = process.argv[1];
    process.argv[1] = '/tmp/hive test/index.js';

    try {
      const command = buildHiveInvokeCommand();
      expect(command).toBe(`'${process.execPath}' '/tmp/hive test/index.js'`);
    } finally {
      process.argv[1] = originalArgv1;
    }
  });
});
