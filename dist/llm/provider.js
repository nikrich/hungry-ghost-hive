export function getProviderApiKey(provider) {
    switch (provider) {
        case 'anthropic':
            return process.env.ANTHROPIC_API_KEY;
        case 'openai':
            return process.env.OPENAI_API_KEY;
        default:
            return undefined;
    }
}
export function validateProviderConfig(config) {
    const apiKey = getProviderApiKey(config.provider);
    if (!apiKey) {
        throw new Error(`Missing API key for ${config.provider}. Set ${config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} environment variable.`);
    }
}
//# sourceMappingURL=provider.js.map