export class GeminiRuntimeBuilder {
    buildSpawnCommand(model) {
        return [
            'gemini',
            '--model',
            model,
            '--sandbox',
            'none',
        ];
    }
    buildResumeCommand(model, sessionId) {
        return [
            'gemini',
            '--model',
            model,
            '--sandbox',
            'none',
            '--resume',
            sessionId,
        ];
    }
    getAutoApprovalFlag() {
        return '--sandbox';
    }
    getModelFlag() {
        return '--model';
    }
}
//# sourceMappingURL=gemini.js.map