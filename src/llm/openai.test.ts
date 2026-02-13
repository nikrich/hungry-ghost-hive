// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai.js';
import type { Message } from './provider.js';

// Mock OpenAI SDK
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: { content: 'Mock response from GPT' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 60,
          },
        }),
      },
    },
  }));

  return { default: MockOpenAI };
});

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      provider = new OpenAIProvider();
      expect(provider.name).toBe('openai');
    });

    it('should accept custom API key', () => {
      provider = new OpenAIProvider({ apiKey: 'custom-key' });
      expect(provider).toBeDefined();
    });

    it('should accept custom model', () => {
      provider = new OpenAIProvider({ model: 'gpt-4o' });
      expect(provider).toBeDefined();
    });

    it('should accept custom maxTokens', () => {
      provider = new OpenAIProvider({ maxTokens: 2000 });
      expect(provider).toBeDefined();
    });

    it('should accept custom temperature', () => {
      provider = new OpenAIProvider({ temperature: 0.3 });
      expect(provider).toBeDefined();
    });

    it('should accept all options together', () => {
      provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
        maxTokens: 2000,
        temperature: 0.5,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('complete', () => {
    beforeEach(() => {
      provider = new OpenAIProvider({ apiKey: 'test-key' });
    });

    it('should complete messages and return response', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = await provider.complete(messages);

      expect(result.content).toBe('Mock response from GPT');
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage.inputTokens).toBe(120);
      expect(result.usage.outputTokens).toBe(60);
    });

    it('should pass all messages including system messages', async () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ];

      await provider.complete(messages);

      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();
      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Hello' },
          ],
        })
      );
    });

    it('should use provided completion options', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      await provider.complete(messages, {
        maxTokens: 1000,
        temperature: 0.8,
        stopSequences: ['END'],
      });

      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();
      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1000,
          temperature: 0.8,
          stop: ['END'],
        })
      );
    });

    it('should use default options when not provided', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      await provider.complete(messages);

      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();
      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4000,
          temperature: 0.2,
        })
      );
    });

    it('should map stop reasons correctly', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();

      // Test stop -> end_turn
      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      } as any);

      let result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.stopReason).toBe('end_turn');

      // Test length -> max_tokens
      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      } as any);

      result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.stopReason).toBe('max_tokens');

      // Test unknown -> error
      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' }, finish_reason: 'unknown' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      } as any);

      result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.stopReason).toBe('error');
    });

    it('should handle timeout option', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      // Mock a slow response
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();
      vi.mocked(mockClient.chat.completions.create).mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(
              () =>
                resolve({
                  choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 100, completion_tokens: 50 },
                } as any),
              200
            )
          )
      );

      await expect(
        provider.complete(messages, { timeoutMs: 100 })
      ).rejects.toThrow('timed out');
    });

    it('should handle null content', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();
      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce({
        choices: [{ message: { content: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      } as any);

      const result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.content).toBe('');
    });

    it('should handle missing usage', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();
      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: undefined,
      } as any);

      const result = await provider.complete([{ role: 'user', content: 'Test' }]);
      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });
  });

  describe('streamComplete', () => {
    beforeEach(() => {
      provider = new OpenAIProvider({ apiKey: 'test-key' });
    });

    it('should stream completion chunks', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();

      // Mock streaming response
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { content: ' world' } }] };
          yield { choices: [{ delta: {} }] }; // No content
        },
      };

      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce(mockStream as any);

      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const chunks: string[] = [];
      for await (const chunk of provider.streamComplete!(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('should use provided options in streaming', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Test' } }] };
        },
      };

      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce(mockStream as any);

      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      const chunks: string[] = [];
      for await (const chunk of provider.streamComplete!(messages, {
        maxTokens: 1000,
        temperature: 0.7,
      })) {
        chunks.push(chunk);
      }

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1000,
          temperature: 0.7,
          stream: true,
        })
      );
    });

    it('should handle timeout in streaming', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          await new Promise(resolve => setTimeout(resolve, 200));
          yield { choices: [{ delta: { content: 'Test' } }] };
        },
      };

      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce(mockStream as any);

      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      const chunks: string[] = [];
      try {
        for await (const chunk of provider.streamComplete!(messages, { timeoutMs: 100 })) {
          chunks.push(chunk);
        }
        expect.fail('Should have thrown timeout error');
      } catch (error) {
        expect((error as Error).message).toContain('timed out');
      }
    });

    it('should skip chunks without content delta', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { role: 'assistant' } }] }; // No content
          yield { choices: [{ delta: { content: ' world' } }] };
        },
      };

      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce(mockStream as any);

      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      const chunks: string[] = [];
      for await (const chunk of provider.streamComplete!(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' world']);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      provider = new OpenAIProvider({ apiKey: 'test-key' });
    });

    it('should handle API errors', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();
      vi.mocked(mockClient.chat.completions.create).mockRejectedValueOnce(
        new Error('API Error')
      );

      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      await expect(provider.complete(messages)).rejects.toThrow('API Error');
    });

    it('should handle missing choices', async () => {
      const OpenAI = (await import('openai')).default;
      const mockClient = new OpenAI();
      vi.mocked(mockClient.chat.completions.create).mockResolvedValueOnce({
        choices: [],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      } as any);

      const messages: Message[] = [{ role: 'user', content: 'Test' }];

      await expect(provider.complete(messages)).rejects.toThrow();
    });
  });
});
