import OpenAI from 'openai';
export class OpenAIProvider {
    name = 'openai';
    client;
    model;
    defaultMaxTokens;
    defaultTemperature;
    constructor(options = {}) {
        this.client = new OpenAI({
            apiKey: options.apiKey || process.env.OPENAI_API_KEY,
        });
        this.model = options.model || 'gpt-4o-mini';
        this.defaultMaxTokens = options.maxTokens || 4000;
        this.defaultTemperature = options.temperature ?? 0.2;
    }
    async complete(messages, options) {
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
    async *streamComplete(messages, options) {
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
    mapStopReason(reason) {
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
//# sourceMappingURL=openai.js.map