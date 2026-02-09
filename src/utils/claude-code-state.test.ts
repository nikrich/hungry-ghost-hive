// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { ClaudeCodeState, detectClaudeCodeState } from './claude-code-state.js';

describe('detectClaudeCodeState', () => {
  it('detects Codex command approval prompt as permission_required', () => {
    const output = `
Would you like to run the following command?

$ hive assign

1. Yes, proceed (y)
2. Yes, and don't ask again
3. No, and tell Codex what to do differently (esc)

Press enter to confirm or esc to cancel
`;

    const result = detectClaudeCodeState(output);

    expect(result.state).toBe(ClaudeCodeState.PERMISSION_REQUIRED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(true);
  });

  it('keeps normal questions classified as asking_question', () => {
    const output = 'Would you like me to continue with the refactor?';

    const result = detectClaudeCodeState(output);

    expect(result.state).toBe(ClaudeCodeState.ASKING_QUESTION);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(true);
  });
});
