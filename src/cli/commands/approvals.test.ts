// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EscalationRow } from '../../db/queries/escalations.js';
import {
  getAllEscalations,
  getEscalationById,
  getPendingHumanEscalations,
  resolveEscalation,
} from '../../db/queries/escalations.js';
import { withHiveContext } from '../../utils/with-hive-context.js';
import { approvalsCommand } from './approvals.js';

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(),
}));

vi.mock('../../db/queries/escalations.js', () => ({
  getAllEscalations: vi.fn(),
  getEscalationById: vi.fn(),
  getPendingHumanEscalations: vi.fn(),
  resolveEscalation: vi.fn(),
}));

function getCommandAction(_name: string): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    await approvalsCommand.parseAsync(args.map(String), { from: 'user' });
  };
}

function sampleEscalation(overrides: Partial<EscalationRow> = {}): EscalationRow {
  return {
    id: 'ESC-TEST',
    story_id: 'STORY-1',
    from_agent_id: 'hive-tech-lead',
    to_agent_id: null,
    reason: 'Approval required: Permission required',
    status: 'pending',
    resolution: null,
    created_at: '2026-02-09T00:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

describe('approvals command', () => {
  const resetCommandOptions = (command: Command): void => {
    for (const option of command.options) {
      command.setOptionValue(option.attributeName(), undefined);
    }
    for (const child of command.commands) {
      resetCommandOptions(child);
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandOptions(approvalsCommand);
    vi.mocked(withHiveContext).mockImplementation(async fn => {
      await fn({
        root: '/tmp',
        paths: {} as any,
        db: { db: {} as any } as any,
      });
    });
  });

  it('list --json should return pending human approvals', async () => {
    const run = getCommandAction('list');
    const approvals = [sampleEscalation({ id: 'ESC-1' })];
    vi.mocked(getPendingHumanEscalations).mockReturnValue(approvals);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await run('list', '--json');

    expect(getPendingHumanEscalations).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(approvals, null, 2));
  });

  it('list --all --json should filter to human-targeted escalations only', async () => {
    const run = getCommandAction('list');
    const humanEsc = sampleEscalation({ id: 'ESC-HUMAN', to_agent_id: null });
    const agentEsc = sampleEscalation({ id: 'ESC-AGENT', to_agent_id: 'hive-senior-alpha' });
    vi.mocked(getAllEscalations).mockReturnValue([humanEsc, agentEsc]);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await run('list', '--all', '--json');

    expect(getAllEscalations).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify([humanEsc], null, 2));
  });

  it('list should print a friendly message when no pending approvals exist', async () => {
    const run = getCommandAction('list');
    vi.mocked(getPendingHumanEscalations).mockReturnValue([]);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await run('list');

    expect(String(logSpy.mock.calls[0]?.[0] || '')).toContain('No pending human approvals.');
  });

  it('show should exit when escalation is not human-targeted', async () => {
    const run = getCommandAction('show');
    vi.mocked(getEscalationById).mockReturnValue(
      sampleEscalation({ to_agent_id: 'hive-senior-alpha' })
    );

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit:${code ?? 0}`);
      });

    await expect(run('show', 'ESC-AGENT')).rejects.toThrow('process.exit:1');
    expect(String(errSpy.mock.calls[0]?.[0] || '')).toContain(
      'Escalation ESC-AGENT is not a human approval request.'
    );

    exitSpy.mockRestore();
  });

  it('approve should resolve escalation with APPROVED prefix', async () => {
    const run = getCommandAction('approve');
    vi.mocked(getEscalationById).mockReturnValue(sampleEscalation({ id: 'ESC-APPROVE' }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await run('approve', 'ESC-APPROVE', '--message', 'Looks good');

    expect(resolveEscalation).toHaveBeenCalledWith(
      expect.anything(),
      'ESC-APPROVE',
      'APPROVED: Looks good'
    );
    expect(String(logSpy.mock.calls[0]?.[0] || '')).toContain('Approved ESC-APPROVE.');
  });

  it('approve should use default approval message when none is provided', async () => {
    const run = getCommandAction('approve');
    vi.mocked(getEscalationById).mockReturnValue(sampleEscalation({ id: 'ESC-DEFAULT' }));

    await run('approve', 'ESC-DEFAULT');

    expect(resolveEscalation).toHaveBeenCalledWith(
      expect.anything(),
      'ESC-DEFAULT',
      'APPROVED: Approved by human reviewer.'
    );
  });

  it('deny should resolve escalation with DENIED prefix', async () => {
    const run = getCommandAction('deny');
    vi.mocked(getEscalationById).mockReturnValue(sampleEscalation({ id: 'ESC-DENY' }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await run('deny', 'ESC-DENY', '--message', 'Do not proceed');

    expect(resolveEscalation).toHaveBeenCalledWith(
      expect.anything(),
      'ESC-DENY',
      'DENIED: Do not proceed'
    );
    expect(String(logSpy.mock.calls[0]?.[0] || '')).toContain('Denied ESC-DENY.');
  });
});
