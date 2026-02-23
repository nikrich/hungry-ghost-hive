// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { HiveConfig } from '../../../config/schema.js';
import type { DatabaseClient, StoryRow } from '../../../db/client.js';
import type { getAllAgents } from '../../../db/queries/agents.js';
import type { MessageRow } from '../../../db/queries/messages.js';
import type { Scheduler } from '../../../orchestrator/scheduler.js';
import type { TmuxSession } from '../../../tmux/manager.js';
import type { getHivePaths } from '../../../utils/paths.js';

// --- Named constants (extracted from inline magic numbers) ---

/** Number of tmux pane lines to capture for agent state detection */
export const TMUX_CAPTURE_LINES = 50;
/** Number of tmux pane lines to capture for brief status checks */
export const TMUX_CAPTURE_LINES_SHORT = 30;
/** Max retries when forcing bypass mode on an agent */
export const BYPASS_MODE_MAX_RETRIES = 3;
/** Lookback window in minutes for recent escalations to avoid duplicates */
export const RECENT_ESCALATION_LOOKBACK_MINUTES = 30;
/** Delay in ms after sending a message to an agent before killing session */
export const AGENT_SPINDOWN_DELAY_MS = 1000;
/** Delay in ms before killing tmux session when pipeline is empty */
export const IDLE_SPINDOWN_DELAY_MS = 500;
/** Delay in ms before sending Enter to prompt after nudge */
export const POST_NUDGE_DELAY_MS = 100;
/** Delay in ms between forwarding messages to an agent */
export const MESSAGE_FORWARD_DELAY_MS = 100;
/** Delay before escalating a stalled planning handoff from nudge to automation */
export const PROACTIVE_HANDOFF_RETRY_DELAY_MS = 60000;
/** Marker lines used to tag manager-authored nudges in tmux output */
export const MANAGER_NUDGE_START_MARKER = '[HIVE_MANAGER_NUDGE_START]';
export const MANAGER_NUDGE_END_MARKER = '[HIVE_MANAGER_NUDGE_END]';

// Agent state tracking for nudge logic
export interface AgentStateTracking {
  lastState: import('../../../state-detectors/types.js').AgentState;
  lastStateChangeTime: number;
  /** Cooldown timestamp for story-progress nudges and AI stuck checks. */
  lastNudgeTime: number;
  /** Number of stuck-story nudges sent in the current stalled window. */
  storyStuckNudgeCount?: number;
  /** Cooldown timestamp for escalation/recovery nudges (separate from story nudges). */
  lastEscalationNudgeTime?: number;
}

export interface PlanningHandoffTracking {
  signature: string;
  lastNudgeAt: number;
}

// Shared context passed between helper functions during a manager check cycle
export interface ManagerCheckContext {
  root: string;
  verbose: boolean;
  config: HiveConfig;
  paths: ReturnType<typeof getHivePaths>;
  /**
   * Acquire a short-lived DB lock, open a fresh database, create a Scheduler,
   * run the callback, then save/close/release.  Each call is independent so
   * the lock is only held for the duration of `fn`.
   */
  withDb: <T>(
    fn: (db: DatabaseClient, scheduler: InstanceType<typeof Scheduler>) => Promise<T> | T
  ) => Promise<T>;
  hiveSessions: TmuxSession[];
  // Counters accumulated across helpers
  counters: {
    nudged: number;
    autoProgressed: number;
    messagesForwarded: number;
    escalationsCreated: number;
    escalationsResolved: number;
    queuedPRCount: number;
    handoffPromoted: number;
    handoffAutoAssigned: number;
    plannedAutoAssigned: number;
    jiraSynced: number;
    featureTestsSpawned: number;
  };
  // Shared state for dedup
  escalatedSessions: Set<string | null>;
  agentsBySessionName: Map<string, ReturnType<typeof getAllAgents>[number]>;
  messagesToMarkRead: string[];
}

export type { MessageRow, StoryRow };
