import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
export * from './provider.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export function createProvider(config) {
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
            throw new Error(`Unknown provider: ${config.provider}`);
    }
}
//# sourceMappingURL=index.js.map