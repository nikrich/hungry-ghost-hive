// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { HiveConfig } from '../../../config/schema.js';
import {
  createEscalation,
  getActiveEscalationsForAgent,
  getPendingEscalations,
} from '../../../db/queries/escalations.js';
import { createLog } from '../../../db/queries/logs.js';
import { AgentState } from '../../../state-detectors/types.js';
import { agentStates, detectAgentState } from './agent-monitoring.js';
import type { ManagerCheckContext } from './types.js';

const CLASSIFIER_TIMEOUT_REASON_PREFIX = 'Classifier timeout';
const AI_DONE_FALSE_REASON_PREFIX = 'AI done=false escalation';

interface ClassifierTimeoutIntervention {
  storyId: string;
  reason: string;
  createdAtMs: number;
}

export interface ScreenStaticTracking {
  fingerprint: string;
  unchangedSinceMs: number;
  lastAiAssessmentMs: number;
}

interface UnknownStateStuckHeuristicSnapshot {
  state: AgentState;
  isWaiting: boolean;
  sessionUnchangedForMs: number;
  staticInactivityThresholdMs: number;
}

interface StuckReminderDeferralSnapshot {
  state: AgentState;
  sessionUnchangedForMs: number;
  staticInactivityThresholdMs: number;
}

export const screenStaticBySession = new Map<string, ScreenStaticTracking>();
const classifierTimeoutInterventionsBySession = new Map<string, ClassifierTimeoutIntervention>();
const aiDoneFalseInterventionsBySession = new Map<string, ClassifierTimeoutIntervention>();

export function shouldTreatUnknownAsStuckWaiting(
  snapshot: UnknownStateStuckHeuristicSnapshot
): boolean {
  const thresholdMs = Math.max(1, snapshot.staticInactivityThresholdMs);
  return (
    snapshot.state === AgentState.UNKNOWN &&
    !snapshot.isWaiting &&
    snapshot.sessionUnchangedForMs >= thresholdMs
  );
}

export function shouldDeferStuckReminderUntilStaticWindow(
  snapshot: StuckReminderDeferralSnapshot
): boolean {
  const thresholdMs = Math.max(1, snapshot.staticInactivityThresholdMs);
  if (snapshot.state === AgentState.WORK_COMPLETE) {
    return false;
  }
  return snapshot.sessionUnchangedForMs < thresholdMs;
}

export function shouldIncludeProgressUpdates(config: HiveConfig): boolean {
  return config.integrations?.project_management?.provider !== 'none';
}

export function isClassifierTimeoutReason(reason: string): boolean {
  return /local classifier unavailable:.*timed out|command timed out/i.test(reason);
}

function formatClassifierTimeoutEscalationReason(storyId: string, reason: string): string {
  const singleLine = reason.replace(/\s+/g, ' ').trim();
  const shortReason = singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine;
  return `${CLASSIFIER_TIMEOUT_REASON_PREFIX}: manager completion classifier timed out for ${storyId}. Manual human intervention required. Detail: ${shortReason}`;
}

export async function applyHumanInterventionStateOverride(
  ctx: ManagerCheckContext,
  sessionName: string,
  storyId: string | null,
  stateResult: ReturnType<typeof detectAgentState>,
  agentId: string | null = null
): Promise<ReturnType<typeof detectAgentState>> {
  const timeoutIntervention = classifierTimeoutInterventionsBySession.get(sessionName);
  if (timeoutIntervention && (!storyId || storyId !== timeoutIntervention.storyId)) {
    classifierTimeoutInterventionsBySession.delete(sessionName);
  }
  const doneFalseIntervention = aiDoneFalseInterventionsBySession.get(sessionName);
  if (doneFalseIntervention && (!storyId || storyId !== doneFalseIntervention.storyId)) {
    aiDoneFalseInterventionsBySession.delete(sessionName);
  }

  const transientIntervention =
    [timeoutIntervention, doneFalseIntervention]
      .filter((candidate): candidate is ClassifierTimeoutIntervention =>
        Boolean(candidate && storyId && candidate.storyId === storyId)
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs)[0] ?? null;

  const persistedIntervention =
    storyId === null
      ? null
      : await ctx.withDb(async db => {
          return (
            (agentId ? getActiveEscalationsForAgent(db.db, agentId) : []).find(
              escalation =>
                escalation.story_id === storyId &&
                (escalation.reason.startsWith(CLASSIFIER_TIMEOUT_REASON_PREFIX) ||
                  escalation.reason.startsWith(AI_DONE_FALSE_REASON_PREFIX))
            ) ??
            getPendingEscalations(db.db).find(
              escalation =>
                escalation.story_id === storyId &&
                (escalation.reason.startsWith(CLASSIFIER_TIMEOUT_REASON_PREFIX) ||
                  escalation.reason.startsWith(AI_DONE_FALSE_REASON_PREFIX))
            ) ??
            null
          );
        });

  const interventionReason = transientIntervention?.reason || persistedIntervention?.reason || null;

  if (!interventionReason) {
    return stateResult;
  }

  return {
    ...stateResult,
    state: AgentState.ASKING_QUESTION,
    needsHuman: true,
    isWaiting: true,
    reason: `Manual intervention required: ${interventionReason}`,
  };
}

export function clearHumanIntervention(sessionName: string): void {
  classifierTimeoutInterventionsBySession.delete(sessionName);
  aiDoneFalseInterventionsBySession.delete(sessionName);
}

export async function markClassifierTimeoutForHumanIntervention(
  ctx: ManagerCheckContext,
  sessionName: string,
  storyId: string,
  reason: string,
  agentId: string | null = null
): Promise<void> {
  const escalationReason = formatClassifierTimeoutEscalationReason(storyId, reason);
  classifierTimeoutInterventionsBySession.set(sessionName, {
    storyId,
    reason: escalationReason,
    createdAtMs: Date.now(),
  });

  await ctx.withDb(async db => {
    const activeTimeoutEscalation = (
      agentId ? getActiveEscalationsForAgent(db.db, agentId) : []
    ).some(escalation => escalation.reason.startsWith(CLASSIFIER_TIMEOUT_REASON_PREFIX));
    if (!activeTimeoutEscalation) {
      const escalation = createEscalation(db.db, {
        storyId,
        fromAgentId: agentId,
        toAgentId: null,
        reason: escalationReason,
      });
      createLog(db.db, {
        agentId: 'manager',
        storyId,
        eventType: 'ESCALATION_CREATED',
        status: 'error',
        message: `${sessionName} requires human intervention: completion classifier timed out`,
        metadata: {
          escalation_id: escalation.id,
          session_name: sessionName,
          escalation_type: 'classifier_timeout',
        },
      });
      db.save();
      ctx.counters.escalationsCreated++;
      ctx.escalatedSessions.add(sessionName);
    }
  });

  const tracked = agentStates.get(sessionName);
  if (tracked) {
    tracked.lastState = AgentState.ASKING_QUESTION;
    tracked.lastStateChangeTime = Date.now();
  }
}

function formatDoneFalseEscalationReason(storyId: string, reason: string): string {
  const singleLine = reason.replace(/\s+/g, ' ').trim();
  const shortReason = singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine;
  return `${AI_DONE_FALSE_REASON_PREFIX}: manager AI assessment returned done=false for ${storyId} after nudge limit reached. Manual human intervention required. Detail: ${shortReason}`;
}

export async function markDoneFalseForHumanIntervention(
  ctx: ManagerCheckContext,
  sessionName: string,
  storyId: string,
  reason: string,
  agentId: string | null = null
): Promise<void> {
  const escalationReason = formatDoneFalseEscalationReason(storyId, reason);
  aiDoneFalseInterventionsBySession.set(sessionName, {
    storyId,
    reason: escalationReason,
    createdAtMs: Date.now(),
  });

  await ctx.withDb(async db => {
    const hasActiveEscalation = (agentId ? getActiveEscalationsForAgent(db.db, agentId) : []).some(
      escalation => escalation.reason.startsWith(AI_DONE_FALSE_REASON_PREFIX)
    );
    if (!hasActiveEscalation) {
      const escalation = createEscalation(db.db, {
        storyId,
        fromAgentId: agentId,
        toAgentId: null,
        reason: escalationReason,
      });
      createLog(db.db, {
        agentId: 'manager',
        storyId,
        eventType: 'ESCALATION_CREATED',
        status: 'error',
        message: `${sessionName} requires human intervention: AI assessment reports blocked/incomplete after nudge limit`,
        metadata: {
          escalation_id: escalation.id,
          session_name: sessionName,
          escalation_type: 'ai_done_false',
        },
      });
      db.save();
      ctx.counters.escalationsCreated++;
      ctx.escalatedSessions.add(sessionName);
    }
  });

  const tracked = agentStates.get(sessionName);
  if (tracked) {
    tracked.lastState = AgentState.ASKING_QUESTION;
    tracked.lastStateChangeTime = Date.now();
  }
}

export function getSessionStaticUnchangedForMs(sessionName: string, nowMs: number): number {
  const tracking = screenStaticBySession.get(sessionName);
  if (!tracking) return 0;
  return Math.max(0, nowMs - tracking.unchangedSinceMs);
}
