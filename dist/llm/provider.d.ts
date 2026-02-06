export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}
export interface CompletionOptions {
    maxTokens?: number;
    temperature?: number;
    stopSequences?: string[];
    /**
     * Timeout in milliseconds for this completion request.
     * If the LLM call doesn't complete within this time, it will be cancelled
     * and a TimeoutError will be thrown.
     */
    timeoutMs?: number;
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
export declare function getProviderApiKey(provider: ProviderType): string | undefined;
export declare function validateProviderConfig(config: ProviderConfig): void;
//# sourceMappingURL=provider.d.ts.map