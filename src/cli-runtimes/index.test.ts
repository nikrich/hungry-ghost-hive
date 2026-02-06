import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCliRuntime, ClaudeRuntime, CodexRuntime, GeminiRuntime } from './index.js';

// Mock execSync to avoid actually running system commands
vi.mock('child_process', () => ({
  execSync: vi.fn((cmd) => {
    // Simulate 'which' command for available CLIs
    if (cmd === 'which claude') return '/usr/local/bin/claude';
    if (cmd === 'which codex') return '/usr/local/bin/codex';
    if (cmd === 'which gemini') return '/usr/local/bin/gemini';
    throw new Error('command not found');
  }),
}));

describe('CliRuntimes', () => {
  describe('ClaudeRuntime', () => {
    let runtime: ClaudeRuntime;

    beforeEach(() => {
      runtime = new ClaudeRuntime();
    });

    it('should build a spawn command with model flag', () => {
      const cmd = runtime.buildSpawnCommand('claude-opus-4-20250514');
      expect(cmd).toBe('claude --dangerously-skip-permissions --model claude-opus-4-20250514');
    });

    it('should build a resume command with session ID', () => {
      const cmd = runtime.buildResumeCommand('my-session-123');
      expect(cmd).toBe('claude --resume my-session-123');
    });

    it('should return model flag in correct format', () => {
      const flag = runtime.getModelFlag('test-model');
      expect(flag).toBe('--model test-model');
    });

    it('should return empty string for auto-approval flag', () => {
      const flag = runtime.getAutoApprovalFlag();
      expect(flag).toBe('');
    });

    it('should include auto-approve in spawn command when specified', () => {
      const cmd = runtime.buildSpawnCommand('claude-opus', { autoApprove: true });
      // auto-approve flag is empty, so command should be the same
      expect(cmd).toBe('claude --dangerously-skip-permissions --model claude-opus');
    });
  });

  describe('CodexRuntime', () => {
    let runtime: CodexRuntime;

    beforeEach(() => {
      runtime = new CodexRuntime();
    });

    it('should build a spawn command with --full-auto flag', () => {
      const cmd = runtime.buildSpawnCommand('gpt-4');
      expect(cmd).toBe('codex --full-auto --model gpt-4');
    });

    it('should build a resume command with --full-auto', () => {
      const cmd = runtime.buildResumeCommand('my-session-456');
      expect(cmd).toBe('codex --full-auto --resume my-session-456');
    });

    it('should return --full-auto as auto-approval flag', () => {
      const flag = runtime.getAutoApprovalFlag();
      expect(flag).toBe('--full-auto');
    });

    it('should return model flag in correct format', () => {
      const flag = runtime.getModelFlag('gpt-4-turbo');
      expect(flag).toBe('--model gpt-4-turbo');
    });

    it('should include --full-auto in spawn command when autoApprove specified', () => {
      const cmd = runtime.buildSpawnCommand('gpt-4', { autoApprove: true });
      expect(cmd).toBe('codex --full-auto --model gpt-4');
    });
  });

  describe('GeminiRuntime', () => {
    let runtime: GeminiRuntime;

    beforeEach(() => {
      runtime = new GeminiRuntime();
    });

    it('should build a spawn command with model flag', () => {
      const cmd = runtime.buildSpawnCommand('gemini-2.0-flash');
      expect(cmd).toBe('gemini --model gemini-2.0-flash');
    });

    it('should build a resume command with session ID', () => {
      const cmd = runtime.buildResumeCommand('my-session-789');
      expect(cmd).toBe('gemini --resume my-session-789');
    });

    it('should return --auto-approve flag', () => {
      const flag = runtime.getAutoApprovalFlag();
      expect(flag).toBe('--auto-approve');
    });

    it('should return model flag in correct format', () => {
      const flag = runtime.getModelFlag('gemini-1.5-pro');
      expect(flag).toBe('--model gemini-1.5-pro');
    });

    it('should include --auto-approve in spawn command when specified', () => {
      const cmd = runtime.buildSpawnCommand('gemini-2.0-flash', { autoApprove: true });
      expect(cmd).toBe('gemini --model gemini-2.0-flash --auto-approve');
    });
  });

  describe('getCliRuntime factory', () => {
    it('should return ClaudeRuntime for claude', () => {
      const runtime = getCliRuntime('claude');
      expect(runtime).toBeInstanceOf(ClaudeRuntime);
    });

    it('should return CodexRuntime for codex', () => {
      const runtime = getCliRuntime('codex');
      expect(runtime).toBeInstanceOf(CodexRuntime);
    });

    it('should return GeminiRuntime for gemini', () => {
      const runtime = getCliRuntime('gemini');
      expect(runtime).toBeInstanceOf(GeminiRuntime);
    });

    it('should throw error for unsupported CLI tool', () => {
      expect(() => {
        getCliRuntime('invalid' as any);
      }).toThrow('Unsupported CLI tool: invalid');
    });

    it('should throw error if binary is not found', () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => {
        throw new Error('command not found');
      });

      expect(() => {
        getCliRuntime('claude');
      }).toThrow(/CLI binary 'claude' not found in PATH/);
    });
  });
});
