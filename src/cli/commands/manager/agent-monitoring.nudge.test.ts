// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSendToTmuxSession,
  mockSendEnterToTmuxSession,
  mockGetAvailableCommands,
  mockBuildAutoRecoveryReminder,
} = vi.hoisted(() => ({
  mockSendToTmuxSession: vi.fn(),
  mockSendEnterToTmuxSession: vi.fn(),
  mockGetAvailableCommands: vi.fn(() => ({
    queueCheck: () => 'hive pr queue',
    getMyStories: () => 'hive my-stories',
    msgReply: () => 'hive msg reply',
  })),
  mockBuildAutoRecoveryReminder: vi.fn(() => '# reminder'),
}));

vi.mock('../../../tmux/manager.js', () => ({
  autoApprovePermission: vi.fn(),
  captureTmuxPane: vi.fn(),
  forceBypassMode: vi.fn(),
  sendEnterToTmuxSession: mockSendEnterToTmuxSession,
  sendMessageWithConfirmation: vi.fn(),
  sendToTmuxSession: mockSendToTmuxSession,
}));

vi.mock('../../../utils/cli-commands.js', () => ({
  buildAutoRecoveryReminder: mockBuildAutoRecoveryReminder,
  getAvailableCommands: mockGetAvailableCommands,
}));

import { nudgeAgent, withManagerNudgeEnvelope } from './agent-monitoring.js';

describe('nudgeAgent custom message path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSendToTmuxSession.mockReset();
    mockSendEnterToTmuxSession.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends custom nudge text and presses enter', async () => {
    const promise = nudgeAgent('/tmp', 'hive-junior-demo', 'Continue STORY-013 now.');

    expect(mockSendToTmuxSession).toHaveBeenCalledWith(
      'hive-junior-demo',
      withManagerNudgeEnvelope('Continue STORY-013 now.')
    );
    expect(mockSendEnterToTmuxSession).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await promise;

    expect(mockSendEnterToTmuxSession).toHaveBeenCalledWith('hive-junior-demo');
    expect(mockSendEnterToTmuxSession).toHaveBeenCalledTimes(1);
  });
});
