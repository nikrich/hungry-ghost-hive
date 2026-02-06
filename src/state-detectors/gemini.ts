/**
 * Gemini CLI State Detector
 *
 * TODO: Validate patterns against actual Gemini CLI output
 */

import { AgentState, StateDetector, StateDetectionResult } from './types.js';

interface StateIndicator {
  state: AgentState;
  patterns: RegExp[];
  priority: number;
}

const GEMINI_STATE_INDICATORS: StateIndicator[] = [
  { state: AgentState.THINKING, patterns: [/thinking/i, /analyzing/i, /\.\.\./i], priority: 100 },
  { state: AgentState.TOOL_RUNNING, patterns: [/running|executing/i, /function call/i], priority: 100 },
  { state: AgentState.PROCESSING, patterns: [/processing/i, /generating/i], priority: 90 },
  { state: AgentState.AWAITING_SELECTION, patterns: [/select.*option/i, /choose/i], priority: 90 },
  { state: AgentState.ASKING_QUESTION, patterns: [/\?\s*$/m, /confirm/i], priority: 85 },
  { state: AgentState.PERMISSION_REQUIRED, patterns: [/permission/i, /authorize/i], priority: 90 },
  { state: AgentState.WORK_COMPLETE, patterns: [/complete|done/i, /success/i], priority: 50 },
  { state: AgentState.IDLE_AT_PROMPT, patterns: [/^>\s*$/m, /^gemini>/i, /ready/i], priority: 40 },
];

export class GeminiStateDetector implements StateDetector {
  detectState(output: string): StateDetectionResult {
    const sorted = [...GEMINI_STATE_INDICATORS].sort((a, b) => b.priority - a.priority);
    for (const indicator of sorted) {
      for (const pattern of indicator.patterns) {
        if (pattern.test(output)) {
          const result = this.mapState(indicator.state);
          return { ...result, confidence: 0.7, reason: `Detected ${indicator.state} (TODO: validate)` };
        }
      }
    }
    return { state: AgentState.UNKNOWN, confidence: 0.3, reason: 'No indicators found', isWaiting: false, needsHuman: false };
  }

  getStateDescription(state: AgentState): string {
    return `Gemini: ${state.replace(/_/g, ' ')}`;
  }

  isActiveState(state: AgentState): boolean {
    return [AgentState.THINKING, AgentState.TOOL_RUNNING, AgentState.PROCESSING].includes(state);
  }

  isBlockedState(state: AgentState): boolean {
    return [
      AgentState.ASKING_QUESTION,
      AgentState.AWAITING_SELECTION,
      AgentState.PLAN_APPROVAL,
      AgentState.PERMISSION_REQUIRED,
      AgentState.USER_DECLINED,
    ].includes(state);
  }

  private mapState(state: AgentState): Omit<StateDetectionResult, 'confidence' | 'reason'> {
    if (this.isActiveState(state)) return { state, isWaiting: false, needsHuman: false };
    if (this.isBlockedState(state)) return { state, isWaiting: true, needsHuman: true };
    if ([AgentState.IDLE_AT_PROMPT, AgentState.WORK_COMPLETE].includes(state)) {
      return { state, isWaiting: true, needsHuman: false };
    }
    return { state, isWaiting: false, needsHuman: false };
  }
}
