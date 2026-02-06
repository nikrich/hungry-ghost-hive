import { describe, it, expect } from 'vitest';
import { GeminiStateDetector } from './gemini';
import { AgentState } from './types';

describe('GeminiStateDetector', () => {
  const detector = new GeminiStateDetector();

  describe('detectState', () => {
    it('should detect THINKING state', () => {
      const result = detector.detectState('thinking...');
      expect(result.state).toBe(AgentState.THINKING);
      expect(result.confidence).toBe(0.85);
    });

    it('should detect THINKING with generating pattern', () => {
      const result = detector.detectState('Generating response...');
      expect(result.state).toBe(AgentState.THINKING);
    });

    it('should detect TOOL_RUNNING state', () => {
      const result = detector.detectState('Executing tool: search');
      expect(result.state).toBe(AgentState.TOOL_RUNNING);
      expect(result.isWaiting).toBe(false);
    });

    it('should detect TOOL_RUNNING with progress', () => {
      const result = detector.detectState('Progress: 3/10');
      expect(result.state).toBe(AgentState.TOOL_RUNNING);
    });

    it('should detect PROCESSING state', () => {
      const result = detector.detectState('Processing your query...');
      expect(result.state).toBe(AgentState.PROCESSING);
    });

    it('should detect AWAITING_SELECTION state', () => {
      const result = detector.detectState('Select an option: [1] First [2] Second');
      expect(result.state).toBe(AgentState.AWAITING_SELECTION);
      expect(result.needsHuman).toBe(true);
    });

    it('should detect ASKING_QUESTION state', () => {
      const result = detector.detectState('Shall I proceed with this action?');
      expect(result.state).toBe(AgentState.ASKING_QUESTION);
      expect(result.needsHuman).toBe(true);
    });

    it('should detect PERMISSION_REQUIRED state', () => {
      const result = detector.detectState('Authorization required (y/n)');
      expect(result.state).toBe(AgentState.PERMISSION_REQUIRED);
    });

    it('should detect USER_DECLINED state', () => {
      const result = detector.detectState('Request rejected by user');
      expect(result.state).toBe(AgentState.USER_DECLINED);
    });

    it('should detect WORK_COMPLETE state', () => {
      const result = detector.detectState('Task complete!');
      expect(result.state).toBe(AgentState.WORK_COMPLETE);
      expect(result.isWaiting).toBe(true);
      expect(result.needsHuman).toBe(false);
    });

    it('should detect IDLE_AT_PROMPT state', () => {
      const result = detector.detectState('gemini> ');
      expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
    });

    it('should detect IDLE_AT_PROMPT with ready message', () => {
      const result = detector.detectState('How can I help you today?');
      expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
    });

    it('should return UNKNOWN for unclear output', () => {
      const result = detector.detectState('Some arbitrary text');
      expect(result.state).toBe(AgentState.UNKNOWN);
      expect(result.confidence).toBe(0.3);
    });
  });

  describe('getStateDescription', () => {
    it('should return Gemini-specific description for THINKING', () => {
      const desc = detector.getStateDescription(AgentState.THINKING);
      expect(desc).toBe('Gemini is thinking');
    });

    it('should return description for TOOL_RUNNING', () => {
      const desc = detector.getStateDescription(AgentState.TOOL_RUNNING);
      expect(desc).toBe('Running tool');
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
