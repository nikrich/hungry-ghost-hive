import { describe, expect, it } from 'vitest';
import { BaseStateDetector, StateIndicator } from './base.js';
import { AgentState } from './types.js';

/**
 * Concrete test implementation of BaseStateDetector
 */
class TestStateDetector extends BaseStateDetector {
  constructor(
    private indicators: StateIndicator[],
    name = 'Test',
    confidence = 0.9
  ) {
    super(name, confidence);
  }

  protected getIndicators(): StateIndicator[] {
    return this.indicators;
  }

  getStateDescription(state: AgentState): string {
    switch (state) {
      case AgentState.THINKING:
        return 'Test is thinking';
      case AgentState.IDLE_AT_PROMPT:
        return 'Idle';
      default:
        return 'Unknown';
    }
  }
}

describe('BaseStateDetector', () => {
  describe('detectState', () => {
    it('should match patterns by priority order', () => {
      const indicators: StateIndicator[] = [
        { state: AgentState.PROCESSING, patterns: [/working/i], priority: 50 },
        { state: AgentState.THINKING, patterns: [/working/i], priority: 100 },
      ];
      const detector = new TestStateDetector(indicators);

      const result = detector.detectState('working on something');
      expect(result.state).toBe(AgentState.THINKING);
    });

    it('should use the configured confidence value', () => {
      const indicators: StateIndicator[] = [
        { state: AgentState.THINKING, patterns: [/hello/i], priority: 100 },
      ];
      const detector = new TestStateDetector(indicators, 'Custom', 0.75);

      const result = detector.detectState('hello world');
      expect(result.confidence).toBe(0.75);
    });

    it('should include CLI name in reason', () => {
      const indicators: StateIndicator[] = [
        { state: AgentState.THINKING, patterns: [/hello/i], priority: 100 },
      ];
      const detector = new TestStateDetector(indicators, 'MyCLI', 0.9);

      const result = detector.detectState('hello world');
      expect(result.reason).toContain('MyCLI');
    });

    it('should return UNKNOWN with low confidence when no patterns match', () => {
      const detector = new TestStateDetector([]);

      const result = detector.detectState('nothing matches');
      expect(result.state).toBe(AgentState.UNKNOWN);
      expect(result.confidence).toBe(0.3);
      expect(result.isWaiting).toBe(false);
      expect(result.needsHuman).toBe(false);
    });

    it('should include CLI name in unknown reason', () => {
      const detector = new TestStateDetector([], 'MyCLI', 0.9);

      const result = detector.detectState('nothing matches');
      expect(result.reason).toContain('MyCLI');
    });

    it('should set correct waiting status for active states', () => {
      const indicators: StateIndicator[] = [
        { state: AgentState.THINKING, patterns: [/think/i], priority: 100 },
        { state: AgentState.TOOL_RUNNING, patterns: [/run/i], priority: 100 },
        { state: AgentState.PROCESSING, patterns: [/process/i], priority: 90 },
      ];
      const detector = new TestStateDetector(indicators);

      expect(detector.detectState('think').isWaiting).toBe(false);
      expect(detector.detectState('think').needsHuman).toBe(false);
      expect(detector.detectState('run').isWaiting).toBe(false);
      expect(detector.detectState('process').isWaiting).toBe(false);
    });

    it('should set correct waiting status for idle states', () => {
      const indicators: StateIndicator[] = [
        { state: AgentState.IDLE_AT_PROMPT, patterns: [/idle/i], priority: 40 },
        { state: AgentState.WORK_COMPLETE, patterns: [/done/i], priority: 50 },
      ];
      const detector = new TestStateDetector(indicators);

      const idleResult = detector.detectState('idle');
      expect(idleResult.isWaiting).toBe(true);
      expect(idleResult.needsHuman).toBe(false);

      const doneResult = detector.detectState('done');
      expect(doneResult.isWaiting).toBe(true);
      expect(doneResult.needsHuman).toBe(false);
    });

    it('should set correct waiting status for blocked states', () => {
      const indicators: StateIndicator[] = [
        { state: AgentState.ASKING_QUESTION, patterns: [/question/i], priority: 85 },
        { state: AgentState.PERMISSION_REQUIRED, patterns: [/perm/i], priority: 90 },
      ];
      const detector = new TestStateDetector(indicators);

      const questionResult = detector.detectState('question');
      expect(questionResult.isWaiting).toBe(true);
      expect(questionResult.needsHuman).toBe(true);

      const permResult = detector.detectState('perm');
      expect(permResult.isWaiting).toBe(true);
      expect(permResult.needsHuman).toBe(true);
    });
  });

  describe('isActiveState', () => {
    const detector = new TestStateDetector([]);

    it('should return true for active states', () => {
      expect(detector.isActiveState(AgentState.THINKING)).toBe(true);
      expect(detector.isActiveState(AgentState.TOOL_RUNNING)).toBe(true);
      expect(detector.isActiveState(AgentState.PROCESSING)).toBe(true);
    });

    it('should return false for non-active states', () => {
      expect(detector.isActiveState(AgentState.IDLE_AT_PROMPT)).toBe(false);
      expect(detector.isActiveState(AgentState.ASKING_QUESTION)).toBe(false);
      expect(detector.isActiveState(AgentState.WORK_COMPLETE)).toBe(false);
      expect(detector.isActiveState(AgentState.UNKNOWN)).toBe(false);
    });
  });

  describe('isBlockedState', () => {
    const detector = new TestStateDetector([]);

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
      expect(detector.isBlockedState(AgentState.UNKNOWN)).toBe(false);
    });
  });
});
