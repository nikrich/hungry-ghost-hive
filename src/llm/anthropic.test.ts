// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import type { Message } from './provider.js';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock response from Claude' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 150,
          output_tokens: 75,
        },
      }),
      stream: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
        },
      }),
    },
  }));

  return { default: MockAnthropic };
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      provider = new AnthropicProvider();
      expect(provider.name).toBe('anthropic');
    });

    it('should accept custom API key', () => {
      provider = new AnthropicProvider({ apiKey: 'custom-key' });
      expect(provider).toBeDefined();
    });

    it('should accept custom model', () => {
      provider = new AnthropicProvider({ model: 'claude-opus-4-20250514' });
      expect(provider).toBeDefined();
    });

    it('should accept custom maxTokens', () => {
      provider = new AnthropicProvider({ maxTokens: 4000 });
      expect(provider).toBeDefined();
    });

    it('should accept custom temperature', () => {
      provider = new AnthropicProvider({ temperature: 0.7 });
      expect(provider).toBeDefined();
    });

    it('should accept all options together', () => {
      provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-opus-4-20250514',
        maxTokens: 4000,
        temperature: 0.8,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('complete', () => {
    beforeEach(() => {
      provider = new AnthropicProvider({ apiKey: 'test-key' });
    });

    it('should complete messages and return response', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = await provider.complete(messages);

      expect(result.content).toBe('Mock response from Claude');
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage.inputTokens).toBe(150);
      expect(result.usage.outputTokens).toBe(75);
    });

    it('should handle system messages separately', async () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ];

      await provider.complete(messages);

      // System message should be passed as system parameter, not in messages array
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockClient = new Anthropic();
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a helpful assistant',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      );
    });

    it('should use provided completion options', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      await provider.complete(messages, {
        maxTokens: 2000,
        temperature: 0.9,
        stopSequences: ['STOP'],
      });

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockClient = new Anthropic();
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
          temperature: 0.9,
          stop_sequences: ['STOP'],
        })
      );
    });

    it('should use default options when not provided', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      await provider.complete(messages);

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockClient = new Anthropic();
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 8000,
          temperature: 0.5,
        })
      );
    });

    it('should map stop reasons correctly', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockClient = new Anthropic();

      // Test end_turn
      vi.mocked(mockClient.messages.create).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      } as any);

      let result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.stopReason).toBe('end_turn');

      // Test max_tokens
      vi.mocked(mockClient.messages.create).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 100, output_tokens: 50 },
      } as any);

      result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.stopReason).toBe('max_tokens');

      // Test stop_sequence
      vi.mocked(mockClient.messages.create).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'stop_sequence',
        usage: { input_tokens: 100, output_tokens: 50 },
      } as any);

      result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.stopReason).toBe('stop_sequence');

      // Test unknown (maps to error)
      vi.mocked(mockClient.messages.create).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'unknown',
        usage: { input_tokens: 100, output_tokens: 50 },
      } as any);

      result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.stopReason).toBe('error');
    });

    it('should handle timeout option', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      // Mock a slow response
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockClient = new Anthropic();
      vi.mocked(mockClient.messages.create).mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(
              () =>
                resolve({
                  content: [{ type: 'text', text: 'Response' }],
                  stop_reason: 'end_turn',
                  usage: { input_tokens: 100, output_tokens: 50 },
                } as any),
              200
            )
          )
      );

      await expect(
        provider.complete(messages, { timeoutMs: 100 })
      ).rejects.toThrow('timed out');
    });
  });

  describe('streamComplete', () => {
    beforeEach(() => {
      provider = new AnthropicProvider({ apiKey: 'test-key' });
    });

    it('should stream completion chunks', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const chunks: string[] = [];
      for await (const chunk of provider.streamComplete!(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('should handle system messages in streaming', async () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Test' },
      ];

      const chunks: string[] = [];
      for await (const chunk of provider.streamComplete!(messages)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should use provided options in streaming', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      const chunks: string[] = [];
      for await (const chunk of provider.streamComplete!(messages, {
        maxTokens: 1000,
        temperature: 0.8,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      provider = new AnthropicProvider({ apiKey: 'test-key' });
    });

    it('should handle API errors', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockClient = new Anthropic();
      vi.mocked(mockClient.messages.create).mockRejectedValueOnce(new Error('API Error'));

      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      await expect(provider.complete(messages)).rejects.toThrow('API Error');
    });

    it('should handle non-text content gracefully', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const mockClient = new Anthropic();
      vi.mocked(mockClient.messages.create).mockResolvedValueOnce({
        content: [{ type: 'image' as any }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      } as any);

      const messages: Message[] = [{ role: 'user', content: 'Test' }];
      const result = await provider.complete(messages);

      expect(result.content).toBe('');
    });
  });
});
