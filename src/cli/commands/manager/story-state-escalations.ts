// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { EscalationRow } from '../../../db/client.js';

const CLASSIFIER_TIMEOUT_REASON_PREFIX = 'Classifier timeout';
const AI_DONE_FALSE_REASON_PREFIX = 'AI done=false escalation';

export interface StoryStateSnapshot {
  id: string;
  status: string;
  assignedSessionName: string | null;
}

export interface FindStoryStateEscalationsInput {
  pendingEscalations: EscalationRow[];
  storyById: Map<string, StoryStateSnapshot>;
  liveSessionNames?: Set<string>;
  nowMs?: number;
  minActiveAgeMs?: number;
}

export interface StoryStateEscalationResolution {
  escalation: EscalationRow;
  reason: string;
}

function isStoryStateEscalation(reason: string): boolean {
  return (
    reason.startsWith(CLASSIFIER_TIMEOUT_REASON_PREFIX) ||
    reason.startsWith(AI_DONE_FALSE_REASON_PREFIX)
  );
}

function isAiDoneFalseEscalation(reason: string): boolean {
  return reason.startsWith(AI_DONE_FALSE_REASON_PREFIX);
}

function parseIsoToMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function findStoryStateEscalationsToResolve(
  input: FindStoryStateEscalationsInput
): StoryStateEscalationResolution[] {
  const resolutions: StoryStateEscalationResolution[] = [];
  const nowMs = input.nowMs ?? Date.now();
  const minActiveAgeMs = Math.max(0, input.minActiveAgeMs ?? 0);

  for (const escalation of input.pendingEscalations) {
    if (!isStoryStateEscalation(escalation.reason)) continue;
    if (!escalation.story_id) continue;

    const story = input.storyById.get(escalation.story_id);
    if (!story) {
      resolutions.push({
        escalation,
        reason: `story ${escalation.story_id} no longer exists`,
      });
      continue;
    }

    if (story.status !== 'in_progress') {
      resolutions.push({
        escalation,
        reason: `story ${story.id} status advanced to ${story.status}`,
      });
      continue;
    }

    if (!story.assignedSessionName) {
      resolutions.push({
        escalation,
        reason: `story ${story.id} is in_progress but has no assigned agent session`,
      });
      continue;
    }

    // If a done=false escalation lingers while the same assigned session is still
    // active on this story, it's stale and should not remain pending indefinitely.
    if (
      isAiDoneFalseEscalation(escalation.reason) &&
      escalation.from_agent_id === story.assignedSessionName &&
      input.liveSessionNames?.has(story.assignedSessionName)
    ) {
      const createdAtMs = parseIsoToMs(escalation.created_at);
      const ageMs = createdAtMs === null ? minActiveAgeMs : nowMs - createdAtMs;
      if (ageMs >= minActiveAgeMs) {
        resolutions.push({
          escalation,
          reason: `story ${story.id} is actively running in assigned session ${story.assignedSessionName}; pending done=false escalation is stale`,
        });
        continue;
      }
    }

    if (escalation.from_agent_id && escalation.from_agent_id !== story.assignedSessionName) {
      resolutions.push({
        escalation,
        reason: `story ${story.id} is assigned to ${story.assignedSessionName}, escalation source ${escalation.from_agent_id} is outdated`,
      });
    }
  }

  return resolutions;
}
