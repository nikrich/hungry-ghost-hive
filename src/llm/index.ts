// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { UnsupportedFeatureError } from '../errors/index.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider, ProviderConfig } from './provider.js';

export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export * from './provider.js';

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider({
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
      });
    case 'openai':
      return new OpenAIProvider({
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
      });
    default:
      throw new UnsupportedFeatureError(`Unknown provider: ${config.provider}`);
  }
}
