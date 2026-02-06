/**
 * Claude Code State Detector
 */

import { AgentState, StateDetector, StateDetectionResult } from './types.js';

interface StateIndicator {
  state: AgentState;
  patterns: RegExp[];
  priority: number;
}

const CLAUDE_STATE_INDICATORS: StateIndicator[] = [
  {
    state: AgentState.THINKING,
    patterns: [/\(thinking\)/i, /Concocting|Twisting|Considering|Analyzing/i],
    priority: 100,
  },
  {
    state: AgentState.TOOL_RUNNING,
    patterns: [/esc to interrupt/i, /Running|Executing/i, /\[.*\]\s+\d+%/i],
    priority: 100,
  },
  {
    state: AgentState.PROCESSING,
    patterns: [/Processing|Analyzing|Generating/i, /Please wait/i],
    priority: 90,
  },
  {
    state: AgentState.AWAITING_SELECTION,
    patterns: [/Enter to select.*↑\/↓/i, /Use arrows to navigate/i, /Select an option/i],
    priority: 90,
  },
  {
    state: AgentState.ASKING_QUESTION,
    patterns: [/\?\s*$/m, /Please (choose|select|confirm)/i, /Would you like to/i, /Do you want to/i],
    priority: 85,
  },
  {
    state: AgentState.PLAN_APPROVAL,
    patterns: [/approve.*plan/i, /review.*plan/i, /proceed.*plan/i, /ExitPlanMode/i],
    priority: 90,
  },
  {
    state: AgentState.PERMISSION_REQUIRED,
    patterns: [/permission.*required/i, /authorize/i, /Allow.*\[y\/n\]/i, /Approve.*\[y\/n\]/i],
    priority: 90,
  },
  {
    state: AgentState.USER_DECLINED,
    patterns: [/declined/i, /permission denied/i, /User chose not to/i],
    priority: 85,
  },
  {
    state: AgentState.WORK_COMPLETE,
    patterns: [/done|complete|finished/i, /successfully/i, /All.*tests passed/i],
    priority: 50,
  },
  {
    state: AgentState.IDLE_AT_PROMPT,
    patterns: [/^>\s*$/m, /Ready for input/i, /What would you like/i],
    priority: 40,
  },
];

export class ClaudeStateDetector implements StateDetector {
  detectState(output: string): StateDetectionResult {
    const sorted = [...CLAUDE_STATE_INDICATORS].sort((a, b) => b.priority - a.priority);

    for (const indicator of sorted) {
      for (const pattern of indicator.patterns) {
        if (pattern.test(output)) {
          const result = this.mapState(indicator.state);
          return { ...result, confidence: 0.9, reason: `Detected ${indicator.state}` };
        }
      }
    }

    return { state: AgentState.UNKNOWN, confidence: 0.3, reason: 'No indicators found', isWaiting: false, needsHuman: false };
  }

  getStateDescription(state: AgentState): string {
    const descriptions: Record<AgentState, string> = {
      [AgentState.THINKING]: 'Claude is thinking',
      [AgentState.TOOL_RUNNING]: 'A tool is running',
      [AgentState.PROCESSING]: 'Processing request',
      [AgentState.IDLE_AT_PROMPT]: 'Idle at prompt',
      [AgentState.WORK_COMPLETE]: 'Work completed',
      [AgentState.ASKING_QUESTION]: 'Asking a question - needs response',
      [AgentState.AWAITING_SELECTION]: 'Awaiting user selection',
      [AgentState.PLAN_APPROVAL]: 'Waiting for plan approval',
      [AgentState.PERMISSION_REQUIRED]: 'Permission required',
      [AgentState.USER_DECLINED]: 'User declined - blocked',
      [AgentState.UNKNOWN]: 'Unknown state',
    };
    return descriptions[state] || 'Unknown';
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
    if (this.isActiveState(state)) {
      return { state, isWaiting: false, needsHuman: false };
    }
    if (this.isBlockedState(state)) {
      return { state, isWaiting: true, needsHuman: true };
    }
    if ([AgentState.IDLE_AT_PROMPT, AgentState.WORK_COMPLETE].includes(state)) {
      return { state, isWaiting: true, needsHuman: false };
    }
    return { state, isWaiting: false, needsHuman: false };
  }
}
