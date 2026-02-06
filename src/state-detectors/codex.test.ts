import { describe, it, expect } from 'vitest';
import { CodexStateDetector } from './codex';
import { AgentState } from './types';

describe('CodexStateDetector', () => {
  const detector = new CodexStateDetector();

  describe('detectState', () => {
    it('should detect THINKING state', () => {
      const result = detector.detectState('thinking...');
      expect(result.state).toBe(AgentState.THINKING);
      expect(result.confidence).toBe(0.85);
    });

    it('should detect TOOL_RUNNING state', () => {
      const result = detector.detectState('Executing command...');
      expect(result.state).toBe(AgentState.TOOL_RUNNING);
      expect(result.isWaiting).toBe(false);
    });

    it('should detect TOOL_RUNNING with progress', () => {
      const result = detector.detectState('50% complete');
      expect(result.state).toBe(AgentState.TOOL_RUNNING);
    });

    it('should detect PROCESSING state', () => {
      const result = detector.detectState('Processing your request...');
      expect(result.state).toBe(AgentState.PROCESSING);
    });

    it('should detect AWAITING_SELECTION state', () => {
      const result = detector.detectState('Select an option: [1] Option A [2] Option B');
      expect(result.state).toBe(AgentState.AWAITING_SELECTION);
      expect(result.needsHuman).toBe(true);
    });

    it('should detect ASKING_QUESTION state', () => {
      const result = detector.detectState('Do you want to continue?');
      expect(result.state).toBe(AgentState.ASKING_QUESTION);
      expect(result.needsHuman).toBe(true);
    });

    it('should detect PERMISSION_REQUIRED state', () => {
      const result = detector.detectState('Permission required [y/n]');
      expect(result.state).toBe(AgentState.PERMISSION_REQUIRED);
    });

    it('should detect USER_DECLINED state', () => {
      const result = detector.detectState('Operation cancelled by user');
      expect(result.state).toBe(AgentState.USER_DECLINED);
    });

    it('should detect WORK_COMPLETE state', () => {
      const result = detector.detectState('Successfully completed the task');
      expect(result.state).toBe(AgentState.WORK_COMPLETE);
      expect(result.isWaiting).toBe(true);
      expect(result.needsHuman).toBe(false);
    });

    it('should detect IDLE_AT_PROMPT state', () => {
      const result = detector.detectState('codex> ');
      expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
    });

    it('should return UNKNOWN for unclear output', () => {
      const result = detector.detectState('Random output text');
      expect(result.state).toBe(AgentState.UNKNOWN);
      expect(result.confidence).toBe(0.3);
    });
  });

  describe('getStateDescription', () => {
    it('should return Codex-specific description for THINKING', () => {
      const desc = detector.getStateDescription(AgentState.THINKING);
      expect(desc).toBe('Codex is thinking');
    });

    it('should return description for TOOL_RUNNING', () => {
      const desc = detector.getStateDescription(AgentState.TOOL_RUNNING);
      expect(desc).toBe('Running command');
    });
  });

  describe('isActiveState', () => {
    it('should identify active states correctly', () => {
      expect(detector.isActiveState(AgentState.THINKING)).toBe(true);
      expect(detector.isActiveState(AgentState.TOOL_RUNNING)).toBe(true);
      expect(detector.isActiveState(AgentState.PROCESSING)).toBe(true);
      expect(detector.isActiveState(AgentState.IDLE_AT_PROMPT)).toBe(false);
    });
  });

  describe('isBlockedState', () => {
    it('should identify blocked states correctly', () => {
      expect(detector.isBlockedState(AgentState.ASKING_QUESTION)).toBe(true);
      expect(detector.isBlockedState(AgentState.PERMISSION_REQUIRED)).toBe(true);
      expect(detector.isBlockedState(AgentState.THINKING)).toBe(false);
    });
  });
});
