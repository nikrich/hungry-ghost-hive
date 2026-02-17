// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execa } from 'execa';
import type Database from 'better-sqlite3';
// @ts-ignore Database.Database type;
import type { HiveConfig } from '../config/schema.js';
import { queryAll } from '../db/client.js';
import { createLog } from '../db/queries/logs.js';
import {
  getRequirementById,
  updateRequirement,
  type RequirementRow,
} from '../db/queries/requirements.js';
import type { StoryRow } from '../db/queries/stories.js';
import { createPullRequest as createGitHubPR } from '../git/github.js';

/** Timeout in ms for git operations during feature branch management */
const GIT_TIMEOUT_MS = 30000;

/**
 * Generate a feature branch name for a requirement.
 * Format: feature/REQ-xxx (lowercased requirement ID)
 */
export function getFeatureBranchName(requirementId: string): string {
  return `feature/${requirementId}`;
}

/**
 * Check if a requirement has e2e_tests configured and should use feature branches.
 */
export function requiresFeatureBranch(hiveConfig: HiveConfig | undefined): boolean {
  return !!hiveConfig?.e2e_tests?.path;
}

/**
 * Check if a requirement is eligible for feature branch creation.
 * A requirement is eligible when:
 * - It has no feature_branch set yet
 * - It is in 'planned' status (about to transition to in_progress)
 * - The hive config has e2e_tests configured
 */
export function isEligibleForFeatureBranch(
  requirement: RequirementRow,
  hiveConfig: HiveConfig | undefined
): boolean {
  if (!requiresFeatureBranch(hiveConfig)) return false;
  if (requirement.feature_branch) return false;
  if (requirement.status !== 'planned') return false;
  return true;
}

/**
 * Create a feature branch for a requirement from main and push it to the remote.
 * Updates the requirement's target_branch and feature_branch fields.
 *
 * @param db - Database instance
 * @param repoPath - Full path to the repository
 * @param requirementId - The requirement ID (e.g., REQ-ABCD1234)
 * @returns The feature branch name, or null if creation failed
 */
export async function createRequirementFeatureBranch(
  db: Database.Database,
  repoPath: string,
  requirementId: string
): Promise<string | null> {
  const requirement = getRequirementById(db, requirementId);
  if (!requirement) {
    createLog(db, {
      agentId: 'scheduler',
      eventType: 'FEATURE_BRANCH_FAILED',
      status: 'error',
      message: `Requirement ${requirementId} not found`,
    });
    return null;
  }

  const featureBranch = getFeatureBranchName(requirementId);

  try {
    // Fetch latest main to ensure we branch from the latest commit
    try {
      await execa('git', ['fetch', 'origin', 'main'], {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
      });
    } catch (_err) {
      // Fetch failure is non-fatal; proceed with local state
    }

    // Create the feature branch from origin/main
    await execa('git', ['branch', featureBranch, 'origin/main'], {
      cwd: repoPath,
      timeout: GIT_TIMEOUT_MS,
    });

    // Push the feature branch to the remote
    await execa('git', ['push', 'origin', featureBranch], {
      cwd: repoPath,
      timeout: GIT_TIMEOUT_MS,
    });

    // Update the requirement with the feature branch info
    updateRequirement(db, requirementId, {
      featureBranch,
      targetBranch: featureBranch,
      status: 'in_progress',
    });



    createLog(db, {
      agentId: 'scheduler',
      eventType: 'FEATURE_BRANCH_CREATED',
      message: `Created feature branch ${featureBranch} for requirement ${requirementId}`,
      metadata: { requirementId, featureBranch },
    });

    return featureBranch;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    createLog(db, {
      agentId: 'scheduler',
      eventType: 'FEATURE_BRANCH_FAILED',
      status: 'error',
      message: `Failed to create feature branch for ${requirementId}: ${errorMessage}`,
      metadata: { requirementId, featureBranch },
    });

    // Still transition requirement to in_progress even if branch creation fails,
    // but without the feature branch. Stories will target main as fallback.
    updateRequirement(db, requirementId, { status: 'in_progress' });


    return null;
  }
}

/**
 * Create a PR from a feature branch back to main.
 * Called after sign-off passes for a requirement.
 *
 * @param repoPath - Full path to the repository
 * @param requirement - The requirement row
 * @returns The PR URL, or null if creation failed
 */
export async function createFeatureBranchPR(
  repoPath: string,
  requirement: RequirementRow
): Promise<{ number: number; url: string } | null> {
  if (!requirement.feature_branch) return null;

  try {
    const result = await createGitHubPR(repoPath, {
      title: `feat: merge ${requirement.feature_branch} for ${requirement.id}`,
      body: `## Feature Branch Merge\n\n**Requirement:** ${requirement.id}\n**Title:** ${requirement.title}\n\nThis PR merges the feature branch back to main after sign-off passed.\nAll stories for this requirement have been merged into \`${requirement.feature_branch}\` and E2E tests have passed.`,
      baseBranch: 'main',
      headBranch: requirement.feature_branch,
    });

    return result;
  } catch (_err) {
    return null;
  }
}

/**
 * Get requirements that need feature branch creation during story assignment.
 * Returns requirement IDs for stories being assigned where the requirement
 * is in 'planned' status and doesn't have a feature branch yet.
 */
export function getRequirementsNeedingFeatureBranch(
  db: Database.Database,
  storyIds: string[],
  hiveConfig: HiveConfig | undefined
): string[] {
  if (!requiresFeatureBranch(hiveConfig)) return [];
  if (storyIds.length === 0) return [];

  const requirementIds = new Set<string>();

  for (const storyId of storyIds) {
    const stories = queryAll<StoryRow>(db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
    const story = stories[0];
    if (!story?.requirement_id) continue;

    const requirement = getRequirementById(db, story.requirement_id);
    if (!requirement) continue;

    if (isEligibleForFeatureBranch(requirement, hiveConfig)) {
      requirementIds.add(requirement.id);
    }
  }

  return Array.from(requirementIds);
}
