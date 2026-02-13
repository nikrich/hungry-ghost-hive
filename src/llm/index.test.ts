// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi } from 'vitest';
import { UnsupportedFeatureError } from '../errors/index.js';
import { AnthropicProvider, OpenAIProvider, createProvider, type ProviderConfig } from './index.js';

// Mock the provider classes
vi.mock('./anthropic.js', () => ({
  AnthropicProvider: vi.fn().mockImplementation(function (options) {
    return {
      name: 'anthropic',
      options,
      complete: vi.fn(),
    };
  }),
}));

vi.mock('./openai.js', () => ({
  OpenAIProvider: vi.fn().mockImplementation(function (options) {
    return {
      name: 'openai',
      options,
      complete: vi.fn(),
    };
  }),
}));

describe('llm index module', () => {
  describe('exports', () => {
    it('should export AnthropicProvider', () => {
      expect(AnthropicProvider).toBeDefined();
    });

    it('should export OpenAIProvider', () => {
      expect(OpenAIProvider).toBeDefined();
    });

    it('should export createProvider function', () => {
      expect(createProvider).toBeDefined();
      expect(typeof createProvider).toBe('function');
    });
  });

  describe('createProvider', () => {
    it('should create AnthropicProvider for anthropic config', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      };

      const provider = createProvider(config);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('anthropic');
      expect(AnthropicProvider).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        maxTokens: undefined,
        temperature: undefined,
      });
    });

    it('should create OpenAIProvider for openai config', () => {
      const config: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
      };

      const provider = createProvider(config);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('openai');
      expect(OpenAIProvider).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        maxTokens: undefined,
        temperature: undefined,
      });
    });

    it('should pass maxTokens to provider constructor', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4000,
      };

      createProvider(config);

      expect(AnthropicProvider).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4000,
        temperature: undefined,
      });
    });

    it('should pass temperature to provider constructor', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        temperature: 0.7,
      };

      createProvider(config);

      expect(AnthropicProvider).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        maxTokens: undefined,
        temperature: 0.7,
      });
    });

    it('should pass all options to provider constructor', () => {
      const config: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o',
        maxTokens: 2000,
        temperature: 0.5,
      };

      createProvider(config);

      expect(OpenAIProvider).toHaveBeenCalledWith({
        model: 'gpt-4o',
        maxTokens: 2000,
        temperature: 0.5,
      });
    });

    it('should throw UnsupportedFeatureError for unknown provider', () => {
      const config = {
        provider: 'unknown-provider',
        model: 'some-model',
      } as any;

      expect(() => createProvider(config)).toThrow(UnsupportedFeatureError);
      expect(() => createProvider(config)).toThrow('Unknown provider: unknown-provider');
    });

    it('should create provider with default model for anthropic', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
      };

      const provider = createProvider(config);

      expect(provider).toBeDefined();
      expect(AnthropicProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
        })
      );
    });

    it('should create provider with custom model for openai', () => {
      const config: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o',
      };

      const provider = createProvider(config);

      expect(provider).toBeDefined();
      expect(OpenAIProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
        })
      );
    });

    it('should create provider with zero temperature', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        temperature: 0,
      };

      createProvider(config);

      expect(AnthropicProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        })
      );
    });

    it('should create provider with high token limit', () => {
      const config: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o',
        maxTokens: 16000,
      };

      createProvider(config);

      expect(OpenAIProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 16000,
        })
      );
    });
  });

  describe('provider factory pattern', () => {
    it('should create different providers based on config', () => {
      const anthropicConfig: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      };

      const openaiConfig: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
      };

      const anthropicProvider = createProvider(anthropicConfig);
      const openaiProvider = createProvider(openaiConfig);

      expect(anthropicProvider.name).toBe('anthropic');
      expect(openaiProvider.name).toBe('openai');
    });

    it('should create multiple instances with different configs', () => {
      const config1: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4000,
      };

      const config2: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        maxTokens: 8000,
      };

      const provider1 = createProvider(config1);
      const provider2 = createProvider(config2);

      expect(provider1).toBeDefined();
      expect(provider2).toBeDefined();
    });
  });

  describe('error cases', () => {
    it('should handle invalid provider type', () => {
      const config = {
        provider: 123,
        model: 'some-model',
      } as any;

      expect(() => createProvider(config)).toThrow();
    });

    it('should provide helpful error message for unknown provider', () => {
      const config = {
        provider: 'gemini',
        model: 'gemini-pro',
      } as any;

      try {
        createProvider(config);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedFeatureError);
        expect((error as Error).message).toContain('gemini');
      }
    });
  });

  describe('integration with providers', () => {
    it('should create functional anthropic provider', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4000,
        temperature: 0.5,
      };

      const provider = createProvider(config);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('anthropic');
      expect(typeof provider.complete).toBe('function');
    });

    it('should create functional openai provider', () => {
      const config: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxTokens: 2000,
        temperature: 0.3,
      };

      const provider = createProvider(config);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('openai');
      expect(typeof provider.complete).toBe('function');
    });
  });
});
