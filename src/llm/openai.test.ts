// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './openai.js';
import type { Message } from './provider.js';

// Mock OpenAI SDK
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            { message: { content: 'Mock response from GPT' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 60 },
        }),
      },
    },
  }));
  return { default: MockOpenAI };
});

describe('OpenAIProvider', () => {
  describe('constructor', () => {
    it('should initialize with default values', () => {
      const provider = new OpenAIProvider();
      expect(provider.name).toBe('openai');
    });

    it('should accept custom API key', () => {
      const provider = new OpenAIProvider({ apiKey: 'custom-key' });
      expect(provider).toBeDefined();
    });

    it('should accept custom model', () => {
      const provider = new OpenAIProvider({ model: 'gpt-4o' });
      expect(provider).toBeDefined();
    });

    it('should accept custom maxTokens', () => {
      const provider = new OpenAIProvider({ maxTokens: 2000 });
      expect(provider).toBeDefined();
    });

    it('should accept custom temperature', () => {
      const provider = new OpenAIProvider({ temperature: 0.3 });
      expect(provider).toBeDefined();
    });

    it('should accept all options together', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
        maxTokens: 2000,
        temperature: 0.5,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('complete', () => {
    it('should complete messages and return response', async () => {
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
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
  });

  describe('name property', () => {
    it('should return "openai"', () => {
      const provider = new OpenAIProvider();
      expect(provider.name).toBe('openai');
    });
  });
});
