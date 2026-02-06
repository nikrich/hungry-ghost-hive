import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeRuntimeBuilder,
  CodexRuntimeBuilder,
  GeminiRuntimeBuilder,
  getCliRuntimeBuilder,
  validateCliBinary,
  validateCliRuntime,
  validateModelCliCompatibility,
} from './index.js';

vi.mock('execa');

describe('CLI Runtime Builders', () => {
  describe('ClaudeRuntimeBuilder', () => {
    it('should build spawn command with correct flags', () => {
      const builder = new ClaudeRuntimeBuilder();
      const command = builder.buildSpawnCommand('claude-sonnet-4-20250514');

      expect(command).toEqual([
        'claude',
        '--dangerously-skip-permissions',
        '--model',
        'claude-sonnet-4-20250514',
      ]);
    });

    it('should build resume command with session ID', () => {
      const builder = new ClaudeRuntimeBuilder();
      const command = builder.buildResumeCommand('claude-sonnet-4-20250514', 'session-123');

      expect(command).toEqual([
        'claude',
        '--dangerously-skip-permissions',
        '--model',
        'claude-sonnet-4-20250514',
        '--resume',
        'session-123',
      ]);
    });

    it('should return correct auto-approval flag', () => {
      const builder = new ClaudeRuntimeBuilder();
      expect(builder.getAutoApprovalFlag()).toBe('--dangerously-skip-permissions');
    });

    it('should return correct model flag', () => {
      const builder = new ClaudeRuntimeBuilder();
      expect(builder.getModelFlag()).toBe('--model');
    });
  });

  describe('CodexRuntimeBuilder', () => {
    it('should build spawn command with correct flags', () => {
      const builder = new CodexRuntimeBuilder();
      const command = builder.buildSpawnCommand('gpt-4o-mini');

      expect(command).toEqual(['codex', '--full-auto', '--model', 'gpt-4o-mini']);
    });

    it('should build resume command with session ID', () => {
      const builder = new CodexRuntimeBuilder();
      const command = builder.buildResumeCommand('gpt-4o-mini', 'session-456');

      expect(command).toEqual([
        'codex',
        '--full-auto',
        '--model',
        'gpt-4o-mini',
        '--resume',
        'session-456',
      ]);
    });

    it('should return correct auto-approval flag', () => {
      const builder = new CodexRuntimeBuilder();
      expect(builder.getAutoApprovalFlag()).toBe('--full-auto');
    });

    it('should return correct model flag', () => {
      const builder = new CodexRuntimeBuilder();
      expect(builder.getModelFlag()).toBe('--model');
    });
  });

  describe('GeminiRuntimeBuilder', () => {
    it('should build spawn command with correct flags', () => {
      const builder = new GeminiRuntimeBuilder();
      const command = builder.buildSpawnCommand('gemini-2.0-flash-exp');

      expect(command).toEqual(['gemini', '--model', 'gemini-2.0-flash-exp', '--sandbox', 'none']);
    });

    it('should build resume command with session ID', () => {
      const builder = new GeminiRuntimeBuilder();
      const command = builder.buildResumeCommand('gemini-2.0-flash-exp', 'session-789');

      expect(command).toEqual([
        'gemini',
        '--model',
        'gemini-2.0-flash-exp',
        '--sandbox',
        'none',
        '--resume',
        'session-789',
      ]);
    });

    it('should return correct auto-approval flag', () => {
      const builder = new GeminiRuntimeBuilder();
      expect(builder.getAutoApprovalFlag()).toBe('--sandbox');
    });

    it('should return correct model flag', () => {
      const builder = new GeminiRuntimeBuilder();
      expect(builder.getModelFlag()).toBe('--model');
    });
  });

  describe('getCliRuntimeBuilder', () => {
    it('should return ClaudeRuntimeBuilder for claude type', () => {
      const builder = getCliRuntimeBuilder('claude');
      expect(builder).toBeInstanceOf(ClaudeRuntimeBuilder);
    });

    it('should return CodexRuntimeBuilder for codex type', () => {
      const builder = getCliRuntimeBuilder('codex');
      expect(builder).toBeInstanceOf(CodexRuntimeBuilder);
    });

    it('should return GeminiRuntimeBuilder for gemini type', () => {
      const builder = getCliRuntimeBuilder('gemini');
      expect(builder).toBeInstanceOf(GeminiRuntimeBuilder);
    });

    it('should throw error for unknown runtime type', () => {
      expect(() => {
        // @ts-expect-error Testing invalid input
        getCliRuntimeBuilder('unknown');
      }).toThrow('Unknown CLI runtime type: unknown');
    });
  });

  describe('validateCliBinary', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true when binary exists', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        stdout: '/usr/local/bin/claude',
        stderr: '',
        exitCode: 0,
        command: 'which claude',
        escapedCommand: 'which claude',
        failed: false,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      const result = await validateCliBinary('claude');
      expect(result).toBe(true);
    });

    it('should return false when binary does not exist', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Command failed'));

      const result = await validateCliBinary('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('validateCliRuntime', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should validate claude runtime', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        stdout: '/usr/local/bin/claude',
        stderr: '',
        exitCode: 0,
        command: 'which claude',
        escapedCommand: 'which claude',
        failed: false,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      const result = await validateCliRuntime('claude');
      expect(result).toBe(true);
    });

    it('should validate codex runtime', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        stdout: '/usr/local/bin/codex',
        stderr: '',
        exitCode: 0,
        command: 'which codex',
        escapedCommand: 'which codex',
        failed: false,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      const result = await validateCliRuntime('codex');
      expect(result).toBe(true);
    });

    it('should validate gemini runtime', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        stdout: '/usr/local/bin/gemini',
        stderr: '',
        exitCode: 0,
        command: 'which gemini',
        escapedCommand: 'which gemini',
        failed: false,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      const result = await validateCliRuntime('gemini');
      expect(result).toBe(true);
    });

    it('should return false for missing runtime binary', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Command failed'));

      const result = await validateCliRuntime('claude');
      expect(result).toBe(false);
    });
  });

  describe('validateModelCliCompatibility', () => {
    describe('Claude CLI validation', () => {
      it('should accept Claude models with claude CLI', () => {
        expect(() => {
          validateModelCliCompatibility('claude-opus-4-6', 'claude');
        }).not.toThrow();

        expect(() => {
          validateModelCliCompatibility('claude-sonnet-4-5-20250929', 'claude');
        }).not.toThrow();

        expect(() => {
          validateModelCliCompatibility('claude-haiku-4-5-20251001', 'claude');
        }).not.toThrow();
      });

      it('should reject OpenAI models with claude CLI', () => {
        expect(() => {
          validateModelCliCompatibility('gpt-4o-mini', 'claude');
        }).toThrow(/incompatible with CLI tool "claude"/);

        expect(() => {
          validateModelCliCompatibility('gpt-4-turbo', 'claude');
        }).toThrow(/incompatible with CLI tool "claude"/);
      });

      it('should reject Gemini models with claude CLI', () => {
        expect(() => {
          validateModelCliCompatibility('gemini-2.0-flash-exp', 'claude');
        }).toThrow(/incompatible with CLI tool "claude"/);
      });
    });

    describe('Codex CLI validation', () => {
      it('should accept OpenAI models with codex CLI', () => {
        expect(() => {
          validateModelCliCompatibility('gpt-4o-mini', 'codex');
        }).not.toThrow();

        expect(() => {
          validateModelCliCompatibility('gpt-4-turbo', 'codex');
        }).not.toThrow();
      });

      it('should reject Claude models with codex CLI', () => {
        expect(() => {
          validateModelCliCompatibility('claude-opus-4-6', 'codex');
        }).toThrow(/incompatible with CLI tool "codex"/);

        expect(() => {
          validateModelCliCompatibility('claude-sonnet-4-5-20250929', 'codex');
        }).toThrow(/incompatible with CLI tool "codex"/);
      });

      it('should reject Gemini models with codex CLI', () => {
        expect(() => {
          validateModelCliCompatibility('gemini-2.0-flash-exp', 'codex');
        }).toThrow(/incompatible with CLI tool "codex"/);
      });
    });

    describe('Gemini CLI validation', () => {
      it('should accept Gemini models with gemini CLI', () => {
        expect(() => {
          validateModelCliCompatibility('gemini-2.0-flash-exp', 'gemini');
        }).not.toThrow();

        expect(() => {
          validateModelCliCompatibility('gemini-pro', 'gemini');
        }).not.toThrow();
      });

      it('should reject Claude models with gemini CLI', () => {
        expect(() => {
          validateModelCliCompatibility('claude-opus-4-6', 'gemini');
        }).toThrow(/incompatible with CLI tool "gemini"/);
      });

      it('should reject OpenAI models with gemini CLI', () => {
        expect(() => {
          validateModelCliCompatibility('gpt-4o-mini', 'gemini');
        }).toThrow(/incompatible with CLI tool "gemini"/);
      });
    });

    describe('Error messages', () => {
      it('should provide helpful error message with suggestions', () => {
        expect(() => {
          validateModelCliCompatibility('gpt-4o-mini', 'claude');
        }).toThrow("For OpenAI models, use cli_tool: 'codex'");

        expect(() => {
          validateModelCliCompatibility('claude-sonnet-4-5-20250929', 'codex');
        }).toThrow("For Claude models, use cli_tool: 'claude'");

        expect(() => {
          validateModelCliCompatibility('gemini-pro', 'claude');
        }).toThrow("For Google Gemini models, use cli_tool: 'gemini'");
      });
    });
  });
});
