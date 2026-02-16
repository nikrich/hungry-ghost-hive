// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import type { TmuxSession } from '../../../tmux/manager.js';
import { findSessionForAgent } from './session-resolution.js';

function buildSession(name: string): TmuxSession {
  return { name, windows: 1, created: '0', attached: false };
}

describe('findSessionForAgent', () => {
  it('prefers the exact tmux_session value when present', () => {
    const sessions = [
      buildSession('hive-junior-Ql7odXu2'),
      buildSession('hive-junior-grigora'),
      buildSession('hive-qa-grigora-2'),
    ];

    const result = findSessionForAgent(sessions, {
      id: 'junior-Ql7odXu2',
      tmux_session: 'hive-junior-grigora',
    });

    expect(result?.name).toBe('hive-junior-grigora');
  });

  it('falls back to hive-<agent-id> when tmux_session is null', () => {
    const sessions = [buildSession('hive-junior-Ql7odXu2')];

    const result = findSessionForAgent(sessions, {
      id: 'junior-Ql7odXu2',
      tmux_session: null,
    });

    expect(result?.name).toBe('hive-junior-Ql7odXu2');
  });

  it('supports legacy session names that only include the agent id', () => {
    const sessions = [buildSession('hive-team-alpha-junior-Ql7odXu2')];

    const result = findSessionForAgent(sessions, {
      id: 'junior-Ql7odXu2',
      tmux_session: null,
    });

    expect(result?.name).toBe('hive-team-alpha-junior-Ql7odXu2');
  });
});
