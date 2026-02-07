// Licensed under the Hungry Ghost Hive License. See LICENSE.

import Anthropic from '@anthropic-ai/sdk';
import { withTimeout } from '../utils/timeout.js';
import type { CompletionOptions, CompletionResult, LLMProvider, Message } from './provider.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;
  private model: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(
    options: {
      apiKey?: string;
      model?: string;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ) {
    this.client = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = options.model || 'claude-sonnet-4-20250514';
    this.defaultMaxTokens = options.maxTokens || 8000;
    this.defaultTemperature = options.temperature ?? 0.5;
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    // Extract system message if present
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const apiCall = async () => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
        temperature: options?.temperature ?? this.defaultTemperature,
        system: systemMessage?.content,
        messages: conversationMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        stop_sequences: options?.stopSequences,
      });

      const content = response.content[0];
      const textContent = content.type === 'text' ? content.text : '';

      return {
        content: textContent,
        stopReason: this.mapStopReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    };

    // Apply timeout if specified
    if (options?.timeoutMs) {
      return withTimeout(
        apiCall(),
        options.timeoutMs,
        `Anthropic API call timed out after ${options.timeoutMs}ms`
      );
    }

    return apiCall();
  }

  async *streamComplete(messages: Message[], options?: CompletionOptions): AsyncIterable<string> {
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');
    // Capture instance properties to avoid 'this' binding issues in generator
    const client = this.client;
    const model = this.model;
    const defaultMaxTokens = this.defaultMaxTokens;
    const defaultTemperature = this.defaultTemperature;

    const streamGenerator = async function* () {
      const stream = client.messages.stream({
        model: model,
        max_tokens: options?.maxTokens ?? defaultMaxTokens,
        temperature: options?.temperature ?? defaultTemperature,
        system: systemMessage?.content,
        messages: conversationMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        stop_sequences: options?.stopSequences,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
    };

    // Apply timeout if specified
    if (options?.timeoutMs) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Anthropic streaming API call timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      });

      const generator = streamGenerator();

      while (true) {
        const result = await Promise.race([generator.next(), timeoutPromise]);

        if (result.done) break;
        yield result.value;
      }
    } else {
      yield* streamGenerator();
    }
  }

  private mapStopReason(reason: string | null): CompletionResult['stopReason'] {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'max_tokens':
        return 'max_tokens';
      case 'stop_sequence':
        return 'stop_sequence';
      default:
        return 'error';
    }
  }
}
