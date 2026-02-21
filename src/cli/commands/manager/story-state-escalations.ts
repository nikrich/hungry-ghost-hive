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

export function findStoryStateEscalationsToResolve(
  input: FindStoryStateEscalationsInput
): StoryStateEscalationResolution[] {
  const resolutions: StoryStateEscalationResolution[] = [];

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

    if (escalation.from_agent_id && escalation.from_agent_id !== story.assignedSessionName) {
      resolutions.push({
        escalation,
        reason: `story ${story.id} is assigned to ${story.assignedSessionName}, escalation source ${escalation.from_agent_id} is outdated`,
      });
    }
  }

  return resolutions;
}
