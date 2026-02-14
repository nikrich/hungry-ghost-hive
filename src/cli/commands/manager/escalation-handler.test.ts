// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { AgentState } from '../../../state-detectors/types.js';
import {
  buildHumanApprovalReason,
  buildInterruptionRecoveryPrompt,
  buildRateLimitRecoveryPrompt,
} from './escalation-handler.js';

describe('buildHumanApprovalReason', () => {
  it('should include option-2 guidance for codex permission menus', () => {
    const output = `
Would you like to run the following command?

$ git restore --worktree

1. Yes, proceed (y)
2. Yes, and don't ask again for commands that start with \`git restore\` (p)
3. No, and tell Codex what to do differently (esc)
`;

    const reason = buildHumanApprovalReason(
      'hive-junior-team-1',
      'Permission required',
      AgentState.PERMISSION_REQUIRED,
      'codex',
      output
    );

    expect(reason).toContain('Approval required (codex)');
    expect(reason).toContain('Action: Select option 2');
    expect(reason).toContain('`git restore`');
  });

  it('should include selection guidance for waiting-selection state', () => {
    const reason = buildHumanApprovalReason(
      'hive-qa-team-1',
      'Awaiting user selection',
      AgentState.AWAITING_SELECTION,
      'claude',
      'Select an option'
    );

    expect(reason).toContain('Approval required (claude)');
    expect(reason).toContain('Action: Choose one of the presented options');
  });

  it('should include answer guidance for question state', () => {
    const reason = buildHumanApprovalReason(
      'hive-intermediate-team-1',
      'Asking a question - needs response',
      AgentState.ASKING_QUESTION,
      'gemini',
      'Do you want to continue?'
    );

    expect(reason).toContain('Approval required (gemini)');
    expect(reason).toContain('Action: Answer the question in the agent session');
  });

  it('should include recovery guidance for declined state', () => {
    const reason = buildHumanApprovalReason(
      'hive-senior-team-1',
      'User declined - blocked',
      AgentState.USER_DECLINED,
      'claude',
      'User chose not to proceed'
    );

    expect(reason).toContain('Approval required (claude)');
    expect(reason).toContain('Action: Agent is blocked after a declined prompt');
  });
});

describe('buildInterruptionRecoveryPrompt', () => {
  it('includes story-specific resume and submit instructions', () => {
    const prompt = buildInterruptionRecoveryPrompt('hive-intermediate-grigora', 'STORY-003');

    expect(prompt).toContain('Continue STORY-003 from your last checkpoint');
    expect(prompt).toContain(
      'hive pr submit -b <branch> -s STORY-003 --from hive-intermediate-grigora'
    );
    expect(prompt).toContain('Do not reply with a status update');
  });

  it('falls back to generic story placeholder when story id is missing', () => {
    const prompt = buildInterruptionRecoveryPrompt('hive-junior-grigora');

    expect(prompt).toContain('Continue your assigned story from your last checkpoint');
    expect(prompt).toContain('hive pr submit -b <branch> -s <story-id> --from hive-junior-grigora');
  });
});

describe('buildRateLimitRecoveryPrompt', () => {
  it('includes sleep/pause and story-specific submit instructions', () => {
    const prompt = buildRateLimitRecoveryPrompt('hive-intermediate-grigora-8', 120000, 'STORY-003');

    expect(prompt).toContain('rate limit detected (HTTP 429)');
    expect(prompt).toContain('Run: sleep 120');
    expect(prompt).toContain(
      'hive pr submit -b <branch> -s STORY-003 --from hive-intermediate-grigora-8'
    );
  });

  it('falls back to generic story placeholder when story id is missing', () => {
    const prompt = buildRateLimitRecoveryPrompt('hive-junior-grigora-11', 90000);

    expect(prompt).toContain('continue your assigned story from your last checkpoint');
    expect(prompt).toContain('hive pr submit -b <branch> -s <story-id> --from hive-junior-grigora-11');
  });
});
