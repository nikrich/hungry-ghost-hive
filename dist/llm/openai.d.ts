import type { LLMProvider, Message, CompletionOptions, CompletionResult } from './provider.js';
export declare class OpenAIProvider implements LLMProvider {
    name: string;
    private client;
    private model;
    private defaultMaxTokens;
    private defaultTemperature;
    constructor(options?: {
        apiKey?: string;
        model?: string;
        maxTokens?: number;
        temperature?: number;
    });
    complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;
    streamComplete(messages: Message[], options?: CompletionOptions): AsyncIterable<string>;
    private mapStopReason;
}
//# sourceMappingURL=openai.d.ts.map