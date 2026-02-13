// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import type { Message } from './provider.js';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock response from Claude' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 150, output_tokens: 75 },
      }),
    },
  }));
  return { default: MockAnthropic };
});

describe('AnthropicProvider', () => {
  describe('constructor', () => {
    it('should initialize with default values', () => {
      const provider = new AnthropicProvider();
      expect(provider.name).toBe('anthropic');
    });

    it('should accept custom API key', () => {
      const provider = new AnthropicProvider({ apiKey: 'custom-key' });
      expect(provider).toBeDefined();
    });

    it('should accept custom model', () => {
      const provider = new AnthropicProvider({ model: 'claude-opus-4-20250514' });
      expect(provider).toBeDefined();
    });

    it('should accept custom maxTokens', () => {
      const provider = new AnthropicProvider({ maxTokens: 4000 });
      expect(provider).toBeDefined();
    });

    it('should accept custom temperature', () => {
      const provider = new AnthropicProvider({ temperature: 0.7 });
      expect(provider).toBeDefined();
    });

    it('should accept all options together', () => {
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-opus-4-20250514',
        maxTokens: 4000,
        temperature: 0.8,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('complete', () => {
    it('should complete messages and return response', async () => {
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
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
  });

  describe('name property', () => {
    it('should return "anthropic"', () => {
      const provider = new AnthropicProvider();
      expect(provider.name).toBe('anthropic');
    });
  });
});
