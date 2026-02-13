// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeRuntimeBuilder,
  CodexRuntimeBuilder,
  GeminiRuntimeBuilder,
  getCliRuntimeBuilder,
  resolveRuntimeModelForCli,
  selectCompatibleModelForCli,
  validateCliBinary,
  validateCliRuntime,
  validateModelCliCompatibility,
} from './index.js';

vi.mock('execa');

describe('CLI Runtime Builders', () => {
  describe('ClaudeRuntimeBuilder', () => {
    it('should build unsafe spawn command with bypass flag', () => {
      const builder = new ClaudeRuntimeBuilder();
      const command = builder.buildSpawnCommand('claude-sonnet-4-20250514', 'unsafe');

      expect(command).toEqual([
        'claude',
        '--dangerously-skip-permissions',
        '--model',
        'claude-sonnet-4-20250514',
      ]);
    });

    it('should build safe spawn command without bypass flag', () => {
      const builder = new ClaudeRuntimeBuilder();
      const command = builder.buildSpawnCommand('claude-sonnet-4-20250514', 'safe');

      expect(command).toEqual(['claude', '--model', 'claude-sonnet-4-20250514']);
    });

    it('should build unsafe resume command with session ID', () => {
      const builder = new ClaudeRuntimeBuilder();
      const command = builder.buildResumeCommand(
        'claude-sonnet-4-20250514',
        'session-123',
        'unsafe'
      );

      expect(command).toEqual([
        'claude',
        '--dangerously-skip-permissions',
        '--model',
        'claude-sonnet-4-20250514',
        '--resume',
        'session-123',
      ]);
    });

    it('should build safe resume command without bypass flag', () => {
      const builder = new ClaudeRuntimeBuilder();
      const command = builder.buildResumeCommand('claude-sonnet-4-20250514', 'session-123', 'safe');

      expect(command).toEqual([
        'claude',
        '--model',
        'claude-sonnet-4-20250514',
        '--resume',
        'session-123',
      ]);
    });

    it('should return correct auto-approval flag for unsafe mode', () => {
      const builder = new ClaudeRuntimeBuilder();
      expect(builder.getAutoApprovalFlag('unsafe')).toBe('--dangerously-skip-permissions');
    });

    it('should return empty auto-approval flag for safe mode', () => {
      const builder = new ClaudeRuntimeBuilder();
      expect(builder.getAutoApprovalFlag('safe')).toBe('');
    });

    it('should return correct model flag', () => {
      const builder = new ClaudeRuntimeBuilder();
      expect(builder.getModelFlag()).toBe('--model');
    });
  });

  describe('CodexRuntimeBuilder', () => {
    it('should build unsafe spawn command with never-approve policy', () => {
      const builder = new CodexRuntimeBuilder();
      const command = builder.buildSpawnCommand('gpt-4o-mini', 'unsafe');

      expect(command).toEqual([
        'codex',
        '--ask-for-approval',
        'never',
        '--sandbox',
        'workspace-write',
        '--model',
        'gpt-4o-mini',
      ]);
    });

    it('should build safe spawn command with on-request policy', () => {
      const builder = new CodexRuntimeBuilder();
      const command = builder.buildSpawnCommand('gpt-4o-mini', 'safe');

      expect(command).toEqual([
        'codex',
        '--ask-for-approval',
        'on-request',
        '--sandbox',
        'workspace-write',
        '--model',
        'gpt-4o-mini',
      ]);
    });

    it('should build unsafe resume command with session ID', () => {
      const builder = new CodexRuntimeBuilder();
      const command = builder.buildResumeCommand('gpt-4o-mini', 'session-456', 'unsafe');

      expect(command).toEqual([
        'codex',
        'resume',
        '--ask-for-approval',
        'never',
        '--sandbox',
        'workspace-write',
        '--model',
        'gpt-4o-mini',
        'session-456',
      ]);
    });

    it('should build safe resume command with session ID', () => {
      const builder = new CodexRuntimeBuilder();
      const command = builder.buildResumeCommand('gpt-4o-mini', 'session-456', 'safe');

      expect(command).toEqual([
        'codex',
        'resume',
        '--ask-for-approval',
        'on-request',
        '--sandbox',
        'workspace-write',
        '--model',
        'gpt-4o-mini',
        'session-456',
      ]);
    });

    it('should return correct auto-approval flag for unsafe mode', () => {
      const builder = new CodexRuntimeBuilder();
      expect(builder.getAutoApprovalFlag('unsafe')).toBe('--ask-for-approval never');
    });

    it('should return correct auto-approval flag for safe mode', () => {
      const builder = new CodexRuntimeBuilder();
      expect(builder.getAutoApprovalFlag('safe')).toBe('--ask-for-approval on-request');
    });

    it('should return correct model flag', () => {
      const builder = new CodexRuntimeBuilder();
      expect(builder.getModelFlag()).toBe('--model');
    });
  });

  describe('GeminiRuntimeBuilder', () => {
    it('should build unsafe spawn command with unrestricted sandbox', () => {
      const builder = new GeminiRuntimeBuilder();
      const command = builder.buildSpawnCommand('gemini-2.0-flash-exp', 'unsafe');

      expect(command).toEqual(['gemini', '--model', 'gemini-2.0-flash-exp', '--sandbox', 'none']);
    });

    it('should build safe spawn command with workspace sandbox', () => {
      const builder = new GeminiRuntimeBuilder();
      const command = builder.buildSpawnCommand('gemini-2.0-flash-exp', 'safe');

      expect(command).toEqual([
        'gemini',
        '--model',
        'gemini-2.0-flash-exp',
        '--sandbox',
        'workspace-write',
      ]);
    });

    it('should build unsafe resume command with session ID', () => {
      const builder = new GeminiRuntimeBuilder();
      const command = builder.buildResumeCommand('gemini-2.0-flash-exp', 'session-789', 'unsafe');

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

    it('should build safe resume command with session ID', () => {
      const builder = new GeminiRuntimeBuilder();
      const command = builder.buildResumeCommand('gemini-2.0-flash-exp', 'session-789', 'safe');

      expect(command).toEqual([
        'gemini',
        '--model',
        'gemini-2.0-flash-exp',
        '--sandbox',
        'workspace-write',
        '--resume',
        'session-789',
      ]);
    });

    it('should return correct sandbox flag for unsafe mode', () => {
      const builder = new GeminiRuntimeBuilder();
      expect(builder.getAutoApprovalFlag('unsafe')).toBe('--sandbox none');
    });

    it('should return correct sandbox flag for safe mode', () => {
      const builder = new GeminiRuntimeBuilder();
      expect(builder.getAutoApprovalFlag('safe')).toBe('--sandbox workspace-write');
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

  describe('resolveRuntimeModelForCli', () => {
    it('should resolve Claude model families to shorthand aliases', () => {
      expect(resolveRuntimeModelForCli('claude-sonnet-4-5-20250929', 'claude')).toBe('sonnet');
      expect(resolveRuntimeModelForCli('claude-opus-4-6', 'claude')).toBe('opus');
      expect(resolveRuntimeModelForCli('claude-haiku-4-5-20251001', 'claude')).toBe('haiku');
    });

    it('should preserve unknown Claude model IDs', () => {
      expect(resolveRuntimeModelForCli('claude-custom-model', 'claude')).toBe(
        'claude-custom-model'
      );
    });

    it('should normalize legacy Codex model shorthands', () => {
      expect(resolveRuntimeModelForCli('gpt4o', 'codex')).toBe('gpt-4o');
      expect(resolveRuntimeModelForCli('gpt4o-mini', 'codex')).toBe('gpt-4o-mini');
    });

    it('should preserve configured model IDs for codex and gemini', () => {
      expect(resolveRuntimeModelForCli('gpt-4o-mini', 'codex')).toBe('gpt-4o-mini');
      expect(resolveRuntimeModelForCli('gemini-2.5-pro', 'gemini')).toBe('gemini-2.5-pro');
    });
  });

  describe('selectCompatibleModelForCli', () => {
    it('should prefer persisted model when compatible', () => {
      const selected = selectCompatibleModelForCli('codex', 'gpt-4o-mini', 'gpt-4o');
      expect(selected).toBe('gpt-4o-mini');
    });

    it('should fall back to configured model when persisted model is incompatible', () => {
      const selected = selectCompatibleModelForCli('codex', 'claude-opus-4-6', 'gpt-4o-mini');
      expect(selected).toBe('gpt-4o-mini');
    });

    it('should validate and return configured model when persisted model is missing', () => {
      const selected = selectCompatibleModelForCli('claude', null, 'claude-sonnet-4-5-20250929');
      expect(selected).toBe('claude-sonnet-4-5-20250929');
    });
  });
});
