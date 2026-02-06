export class ClaudeRuntimeBuilder {
    buildSpawnCommand(model) {
        return [
            'claude',
            '--dangerously-skip-permissions',
            '--model',
            model,
        ];
    }
    buildResumeCommand(model, sessionId) {
        return [
            'claude',
            '--dangerously-skip-permissions',
            '--model',
            model,
            '--resume',
            sessionId,
        ];
    }
    getAutoApprovalFlag() {
        return '--dangerously-skip-permissions';
    }
    getModelFlag() {
        return '--model';
    }
}
//# sourceMappingURL=claude.js.map