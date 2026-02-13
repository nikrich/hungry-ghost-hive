// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ConfigurationError } from '../errors/index.js';
import { getProviderApiKey, validateProviderConfig, type ProviderConfig } from './provider.js';

describe('provider module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getProviderApiKey', () => {
    it('should return ANTHROPIC_API_KEY for anthropic provider', () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      const key = getProviderApiKey('anthropic');
      expect(key).toBe('test-anthropic-key');
    });

    it('should return OPENAI_API_KEY for openai provider', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const key = getProviderApiKey('openai');
      expect(key).toBe('test-openai-key');
    });

    it('should return undefined when API key is not set', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const key = getProviderApiKey('anthropic');
      expect(key).toBeUndefined();
    });

    it('should return undefined for unknown provider', () => {
      const key = getProviderApiKey('unknown' as any);
      expect(key).toBeUndefined();
    });

    it('should handle empty string environment variables', () => {
      process.env.ANTHROPIC_API_KEY = '';
      const key = getProviderApiKey('anthropic');
      expect(key).toBe('');
    });
  });

  describe('validateProviderConfig', () => {
    it('should validate anthropic provider with API key', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      };

      expect(() => validateProviderConfig(config)).not.toThrow();
    });

    it('should validate openai provider with API key', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const config: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
      };

      expect(() => validateProviderConfig(config)).not.toThrow();
    });

    it('should throw ConfigurationError for anthropic without API key', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      };

      expect(() => validateProviderConfig(config)).toThrow(ConfigurationError);
      expect(() => validateProviderConfig(config)).toThrow('ANTHROPIC_API_KEY');
    });

    it('should throw ConfigurationError for openai without API key', () => {
      delete process.env.OPENAI_API_KEY;
      const config: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
      };

      expect(() => validateProviderConfig(config)).toThrow(ConfigurationError);
      expect(() => validateProviderConfig(config)).toThrow('OPENAI_API_KEY');
    });

    it('should provide helpful error message with provider name', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      };

      try {
        validateProviderConfig(config);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as Error).message).toContain('Missing API key for anthropic');
      }
    });

    it('should accept config with optional parameters', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4000,
        temperature: 0.7,
      };

      expect(() => validateProviderConfig(config)).not.toThrow();
    });

    it('should validate with empty string API key (for testing error paths)', () => {
      process.env.ANTHROPIC_API_KEY = '';
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      };

      // Empty string is falsy, should throw
      expect(() => validateProviderConfig(config)).toThrow(ConfigurationError);
    });
  });

  describe('ProviderConfig type', () => {
    it('should accept valid provider types', () => {
      const config1: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      };

      const config2: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
      };

      expect(config1.provider).toBe('anthropic');
      expect(config2.provider).toBe('openai');
    });

    it('should accept optional maxTokens parameter', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 8000,
      };

      expect(config.maxTokens).toBe(8000);
    });

    it('should accept optional temperature parameter', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        temperature: 0.5,
      };

      expect(config.temperature).toBe(0.5);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple providers with different keys', () => {
      process.env.ANTHROPIC_API_KEY = 'anthropic-key';
      process.env.OPENAI_API_KEY = 'openai-key';

      const anthropicKey = getProviderApiKey('anthropic');
      const openaiKey = getProviderApiKey('openai');

      expect(anthropicKey).toBe('anthropic-key');
      expect(openaiKey).toBe('openai-key');
    });

    it('should validate different providers independently', () => {
      process.env.ANTHROPIC_API_KEY = 'anthropic-key';
      delete process.env.OPENAI_API_KEY;

      const anthropicConfig: ProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      };

      const openaiConfig: ProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
      };

      expect(() => validateProviderConfig(anthropicConfig)).not.toThrow();
      expect(() => validateProviderConfig(openaiConfig)).toThrow(ConfigurationError);
    });
  });
});
