// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { shouldAutoResolveOrphanedManagerEscalation } from './orphaned-escalations.js';

describe('shouldAutoResolveOrphanedManagerEscalation', () => {
  it('returns true for inactive manager session with terminated agent', () => {
    const activeSessionNames = new Set<string>(['hive-manager', 'hive-junior-team-2']);
    const agentStatusBySessionName = new Map<string, string>([
      ['hive-junior-team-1', 'terminated'],
    ]);

    expect(
      shouldAutoResolveOrphanedManagerEscalation(
        'hive-junior-team-1',
        activeSessionNames,
        agentStatusBySessionName
      )
    ).toBe(true);
  });

  it('returns true for inactive manager session with no mapped agent', () => {
    expect(
      shouldAutoResolveOrphanedManagerEscalation(
        'hive-intermediate-team-1',
        new Set<string>(),
        new Map<string, string>()
      )
    ).toBe(true);
  });

  it('returns false when the session is still active', () => {
    expect(
      shouldAutoResolveOrphanedManagerEscalation(
        'hive-junior-team-1',
        new Set<string>(['hive-junior-team-1']),
        new Map<string, string>([['hive-junior-team-1', 'terminated']])
      )
    ).toBe(false);
  });

  it('returns false when mapped agent is not terminated', () => {
    expect(
      shouldAutoResolveOrphanedManagerEscalation(
        'hive-junior-team-1',
        new Set<string>(),
        new Map<string, string>([['hive-junior-team-1', 'working']])
      )
    ).toBe(false);
  });

  it('returns false for non-manager escalation identifiers', () => {
    expect(
      shouldAutoResolveOrphanedManagerEscalation(
        'junior-ABCD1234',
        new Set<string>(),
        new Map<string, string>()
      )
    ).toBe(false);
  });
});
