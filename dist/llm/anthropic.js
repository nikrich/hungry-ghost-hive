import Anthropic from '@anthropic-ai/sdk';
export class AnthropicProvider {
    name = 'anthropic';
    client;
    model;
    defaultMaxTokens;
    defaultTemperature;
    constructor(options = {}) {
        this.client = new Anthropic({
            apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
        });
        this.model = options.model || 'claude-sonnet-4-20250514';
        this.defaultMaxTokens = options.maxTokens || 8000;
        this.defaultTemperature = options.temperature ?? 0.5;
    }
    async complete(messages, options) {
        // Extract system message if present
        const systemMessage = messages.find(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');
        const response = await this.client.messages.create({
            model: this.model,
            max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
            temperature: options?.temperature ?? this.defaultTemperature,
            system: systemMessage?.content,
            messages: conversationMessages.map(m => ({
                role: m.role,
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
    }
    async *streamComplete(messages, options) {
        const systemMessage = messages.find(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');
        const stream = this.client.messages.stream({
            model: this.model,
            max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
            temperature: options?.temperature ?? this.defaultTemperature,
            system: systemMessage?.content,
            messages: conversationMessages.map(m => ({
                role: m.role,
                content: m.content,
            })),
            stop_sequences: options?.stopSequences,
        });
        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                yield event.delta.text;
            }
        }
    }
    mapStopReason(reason) {
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
//# sourceMappingURL=anthropic.js.map