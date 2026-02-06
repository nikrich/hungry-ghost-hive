export class CodexRuntimeBuilder {
    buildSpawnCommand(model) {
        return [
            'codex',
            '--full-auto',
            '--model',
            model,
        ];
    }
    buildResumeCommand(model, sessionId) {
        return [
            'codex',
            '--full-auto',
            '--model',
            model,
            '--resume',
            sessionId,
        ];
    }
    getAutoApprovalFlag() {
        return '--full-auto';
    }
    getModelFlag() {
        return '--model';
    }
}
//# sourceMappingURL=codex.js.map