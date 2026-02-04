export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface CompletionResult {
  content: string;
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  name: string;
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;
  streamComplete?(messages: Message[], options?: CompletionOptions): AsyncIterable<string>;
}

export type ProviderType = 'anthropic' | 'openai';

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export function getProviderApiKey(provider: ProviderType): string | undefined {
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
    default:
      return undefined;
  }
}

export function validateProviderConfig(config: ProviderConfig): void {
  const apiKey = getProviderApiKey(config.provider);
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${config.provider}. Set ${config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} environment variable.`
    );
  }
}
