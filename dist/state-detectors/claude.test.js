import { describe, it, expect } from 'vitest';
import { ClaudeStateDetector } from './claude.js';
import { AgentState } from './types.js';
describe('ClaudeStateDetector', () => {
    const detector = new ClaudeStateDetector();
    describe('detectState', () => {
        it('should detect THINKING state', () => {
            const result = detector.detectState('(thinking) about the problem');
            expect(result.state).toBe(AgentState.THINKING);
            expect(result.confidence).toBe(0.9);
            expect(result.isWaiting).toBe(false);
            expect(result.needsHuman).toBe(false);
        });
        it('should detect THINKING state with action words', () => {
            const result = detector.detectState('Analyzing the code structure...');
            expect(result.state).toBe(AgentState.THINKING);
        });
        it('should detect TOOL_RUNNING state', () => {
            const result = detector.detectState('Running tests... (esc to interrupt)');
            expect(result.state).toBe(AgentState.TOOL_RUNNING);
            expect(result.isWaiting).toBe(false);
            expect(result.needsHuman).toBe(false);
        });
        it('should detect TOOL_RUNNING with progress bar', () => {
            const result = detector.detectState('[=====>    ] 50%');
            expect(result.state).toBe(AgentState.TOOL_RUNNING);
        });
        it('should detect PROCESSING state', () => {
            const result = detector.detectState('Processing your request...');
            expect(result.state).toBe(AgentState.PROCESSING);
            expect(result.isWaiting).toBe(false);
        });
        it('should detect AWAITING_SELECTION state', () => {
            const result = detector.detectState('Enter to select ↑/↓ to navigate');
            expect(result.state).toBe(AgentState.AWAITING_SELECTION);
            expect(result.isWaiting).toBe(true);
            expect(result.needsHuman).toBe(true);
        });
        it('should detect ASKING_QUESTION state', () => {
            const result = detector.detectState('Would you like to continue?');
            expect(result.state).toBe(AgentState.ASKING_QUESTION);
            expect(result.needsHuman).toBe(true);
        });
        it('should detect ASKING_QUESTION with question mark', () => {
            const result = detector.detectState('Should I proceed with this change?');
            expect(result.state).toBe(AgentState.ASKING_QUESTION);
        });
        it('should detect PLAN_APPROVAL state', () => {
            const result = detector.detectState('Please review the plan and approve');
            expect(result.state).toBe(AgentState.PLAN_APPROVAL);
            expect(result.needsHuman).toBe(true);
        });
        it('should detect PERMISSION_REQUIRED state', () => {
            const result = detector.detectState('Permission required: Allow access [y/n]');
            expect(result.state).toBe(AgentState.PERMISSION_REQUIRED);
            expect(result.needsHuman).toBe(true);
        });
        it('should detect USER_DECLINED state', () => {
            const result = detector.detectState('User declined the operation');
            expect(result.state).toBe(AgentState.USER_DECLINED);
            expect(result.needsHuman).toBe(true);
        });
        it('should detect WORK_COMPLETE state', () => {
            const result = detector.detectState('Task completed successfully');
            expect(result.state).toBe(AgentState.WORK_COMPLETE);
            expect(result.isWaiting).toBe(true);
            expect(result.needsHuman).toBe(false);
        });
        it('should detect IDLE_AT_PROMPT state', () => {
            const result = detector.detectState('>\n');
            expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
            expect(result.isWaiting).toBe(true);
            expect(result.needsHuman).toBe(false);
        });
        it('should return UNKNOWN for unclear output', () => {
            const result = detector.detectState('Some random text');
            expect(result.state).toBe(AgentState.UNKNOWN);
            expect(result.confidence).toBe(0.3);
        });
        it('should prioritize higher priority patterns', () => {
            // TOOL_RUNNING (priority 100) should win over PROCESSING (priority 90)
            const result = detector.detectState('Executing and Processing');
            expect(result.state).toBe(AgentState.TOOL_RUNNING);
        });
    });
    describe('getStateDescription', () => {
        it('should return description for THINKING', () => {
            const desc = detector.getStateDescription(AgentState.THINKING);
            expect(desc).toBe('Claude is thinking');
        });
        it('should return description for PERMISSION_REQUIRED', () => {
            const desc = detector.getStateDescription(AgentState.PERMISSION_REQUIRED);
            expect(desc).toBe('Permission required');
        });
        it('should return description for UNKNOWN', () => {
            const desc = detector.getStateDescription(AgentState.UNKNOWN);
            expect(desc).toBe('Unknown state');
        });
    });
    describe('isActiveState', () => {
        it('should return true for active states', () => {
            expect(detector.isActiveState(AgentState.THINKING)).toBe(true);
            expect(detector.isActiveState(AgentState.TOOL_RUNNING)).toBe(true);
            expect(detector.isActiveState(AgentState.PROCESSING)).toBe(true);
        });
        it('should return false for non-active states', () => {
            expect(detector.isActiveState(AgentState.IDLE_AT_PROMPT)).toBe(false);
            expect(detector.isActiveState(AgentState.ASKING_QUESTION)).toBe(false);
            expect(detector.isActiveState(AgentState.UNKNOWN)).toBe(false);
        });
    });
    describe('isBlockedState', () => {
        it('should return true for blocked states', () => {
            expect(detector.isBlockedState(AgentState.ASKING_QUESTION)).toBe(true);
            expect(detector.isBlockedState(AgentState.AWAITING_SELECTION)).toBe(true);
            expect(detector.isBlockedState(AgentState.PLAN_APPROVAL)).toBe(true);
            expect(detector.isBlockedState(AgentState.PERMISSION_REQUIRED)).toBe(true);
            expect(detector.isBlockedState(AgentState.USER_DECLINED)).toBe(true);
        });
        it('should return false for non-blocked states', () => {
            expect(detector.isBlockedState(AgentState.THINKING)).toBe(false);
            expect(detector.isBlockedState(AgentState.IDLE_AT_PROMPT)).toBe(false);
            expect(detector.isBlockedState(AgentState.WORK_COMPLETE)).toBe(false);
        });
    });
});
//# sourceMappingURL=claude.test.js.map