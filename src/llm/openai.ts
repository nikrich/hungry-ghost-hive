import OpenAI from 'openai';
import type { LLMProvider, Message, CompletionOptions, CompletionResult } from './provider.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;
  private model: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(options: {
    apiKey?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
    });
    this.model = options.model || 'gpt-4o-mini';
    this.defaultMaxTokens = options.maxTokens || 4000;
    this.defaultTemperature = options.temperature ?? 0.2;
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      temperature: options?.temperature ?? this.defaultTemperature,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stop: options?.stopSequences,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content || '',
      stopReason: this.mapStopReason(choice.finish_reason),
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }

  async *streamComplete(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      temperature: options?.temperature ?? this.defaultTemperature,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stop: options?.stopSequences,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  private mapStopReason(reason: string | null): CompletionResult['stopReason'] {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'length':
        return 'max_tokens';
      default:
        return 'error';
    }
  }
}
