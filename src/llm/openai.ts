import OpenAI from 'openai';
import type { LLMProvider, Message, CompletionOptions, CompletionResult } from './provider.js';
import { withTimeout } from '../utils/timeout.js';

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
    const apiCall = async () => {
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
    };

    // Apply timeout if specified
    if (options?.timeoutMs) {
      return withTimeout(
        apiCall(),
        options.timeoutMs,
        `OpenAI API call timed out after ${options.timeoutMs}ms`
      );
    }

    return apiCall();
  }

  async *streamComplete(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    // Capture instance properties to avoid 'this' binding issues in generator
    const client = this.client;
    const model = this.model;
    const defaultMaxTokens = this.defaultMaxTokens;
    const defaultTemperature = this.defaultTemperature;

    const streamGenerator = async function* () {
      const stream = await client.chat.completions.create({
        model: model,
        max_tokens: options?.maxTokens ?? defaultMaxTokens,
        temperature: options?.temperature ?? defaultTemperature,
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
    };

    // Apply timeout if specified
    if (options?.timeoutMs) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`OpenAI streaming API call timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      });

      const generator = streamGenerator();

      while (true) {
        const result = await Promise.race([
          generator.next(),
          timeoutPromise
        ]);

        if (result.done) break;
        yield result.value;
      }
    } else {
      yield* streamGenerator();
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
