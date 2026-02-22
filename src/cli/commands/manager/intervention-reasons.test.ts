// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { isImmediateHumanBlockerReason } from './intervention-reasons.js';

describe('isImmediateHumanBlockerReason', () => {
  it('matches explicit human-required language', () => {
    expect(
      isImmediateHumanBlockerReason(
        'Output indicates only a human can fix this environment issue.'
      )
    ).toBe(true);
    expect(
      isImmediateHumanBlockerReason('Manual intervention required before proceeding.')
    ).toBe(true);
  });

  it('matches generated/proto blocker signals', () => {
    expect(
      isImmediateHumanBlockerReason(
        'Agent is blocked due to missing generated files and cannot run tests.'
      )
    ).toBe(true);
    expect(
      isImmediateHumanBlockerReason(
        'Work is blocked until .proto definitions are restored and codegen rerun.'
      )
    ).toBe(true);
  });

  it('does not match normal incomplete-work reasons', () => {
    expect(
      isImmediateHumanBlockerReason(
        'Implementation is incomplete; continue coding and run tests.'
      )
    ).toBe(false);
  });
});
