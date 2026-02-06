import type { LLMProvider, ProviderConfig } from './provider.js';
export * from './provider.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export declare function createProvider(config: ProviderConfig): LLMProvider;
//# sourceMappingURL=index.d.ts.map