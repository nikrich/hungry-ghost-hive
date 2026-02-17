// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/client.js';
import { STORY_STATUS_ORDER } from './adapters.js';
import { ensureClusterTables } from './events.js';
import type { StoryRecord } from './types.js';

export function mergeSimilarStories(db: Database, similarityThreshold: number): number {
  ensureClusterTables(db, 'node-local');

  const stories = queryAll<StoryRecord>(
    db,
    `
    SELECT id, requirement_id, team_id, title, description, acceptance_criteria, complexity_score, story_points, status,
           assigned_agent_id, branch_name, pr_url, created_at, updated_at
    FROM stories
    WHERE status != 'merged'
    ORDER BY id
  `
  );

  if (stories.length < 2) return 0;

  const parent = new Map<string, string>();
  for (const story of stories) {
    parent.set(story.id, story.id);
  }

  const find = (id: string): string => {
    const root = parent.get(id);
    if (!root) return id;
    if (root === id) return id;
    const compressed = find(root);
    parent.set(id, compressed);
    return compressed;
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const canonical = rootA < rootB ? rootA : rootB;
    const other = canonical === rootA ? rootB : rootA;
    parent.set(other, canonical);
  };

  for (let i = 0; i < stories.length; i++) {
    for (let j = i + 1; j < stories.length; j++) {
      const a = stories[i];
      const b = stories[j];

      if ((a.team_id || null) !== (b.team_id || null)) continue;
      if ((a.requirement_id || null) !== (b.requirement_id || null)) continue;

      const similarity = storySimilarity(a, b);
      if (similarity >= similarityThreshold) {
        union(a.id, b.id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const story of stories) {
    const root = find(story.id);
    const group = groups.get(root) || [];
    group.push(story.id);
    groups.set(root, group);
  }

  let merged = 0;

  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    const canonical = sorted[0];

    for (const duplicate of sorted.slice(1)) {
      const alreadyMerged = queryOne<{ duplicate_story_id: string }>(
        db,
        'SELECT duplicate_story_id FROM cluster_story_merges WHERE duplicate_story_id = ?',
        [duplicate]
      );

      if (alreadyMerged) continue;

      if (mergeStoryIntoCanonical(db, canonical, duplicate)) {
        merged += 1;
      }
    }
  }

  return merged;
}

function mergeStoryIntoCanonical(db: Database, canonicalId: string, duplicateId: string): boolean {
  const canonical = queryOne<StoryRecord>(db, 'SELECT * FROM stories WHERE id = ?', [canonicalId]);
  const duplicate = queryOne<StoryRecord>(db, 'SELECT * FROM stories WHERE id = ?', [duplicateId]);

  if (!canonical || !duplicate) return false;

  const mergedStatus =
    STORY_STATUS_ORDER.indexOf(canonical.status) >= STORY_STATUS_ORDER.indexOf(duplicate.status)
      ? canonical.status
      : duplicate.status;

  const mergedTitle = pickLonger(canonical.title, duplicate.title);
  const mergedDescription = pickLonger(canonical.description, duplicate.description);

  run(
    db,
    `
    UPDATE stories
    SET
      title = ?,
      description = ?,
      acceptance_criteria = COALESCE(acceptance_criteria, ?),
      complexity_score = CASE
        WHEN complexity_score IS NULL THEN ?
        WHEN ? IS NULL THEN complexity_score
        WHEN complexity_score >= ? THEN complexity_score
        ELSE ?
      END,
      story_points = CASE
        WHEN story_points IS NULL THEN ?
        WHEN ? IS NULL THEN story_points
        WHEN story_points >= ? THEN story_points
        ELSE ?
      END,
      status = ?,
      assigned_agent_id = COALESCE(assigned_agent_id, ?),
      branch_name = COALESCE(branch_name, ?),
      pr_url = COALESCE(pr_url, ?),
      updated_at = ?
    WHERE id = ?
  `,
    [
      mergedTitle,
      mergedDescription,
      duplicate.acceptance_criteria,
      duplicate.complexity_score,
      duplicate.complexity_score,
      duplicate.complexity_score,
      duplicate.complexity_score,
      duplicate.story_points,
      duplicate.story_points,
      duplicate.story_points,
      duplicate.story_points,
      mergedStatus,
      duplicate.assigned_agent_id,
      duplicate.branch_name,
      duplicate.pr_url,
      new Date().toISOString(),
      canonicalId,
    ]
  );

  // Rebind all references to canonical story.
  run(db, 'UPDATE pull_requests SET story_id = ? WHERE story_id = ?', [canonicalId, duplicateId]);
  run(db, 'UPDATE escalations SET story_id = ? WHERE story_id = ?', [canonicalId, duplicateId]);
  run(db, 'UPDATE agent_logs SET story_id = ? WHERE story_id = ?', [canonicalId, duplicateId]);
  run(db, 'UPDATE agents SET current_story_id = ? WHERE current_story_id = ?', [
    canonicalId,
    duplicateId,
  ]);

  run(
    db,
    `
    INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
    SELECT ?, depends_on_story_id
    FROM story_dependencies
    WHERE story_id = ?
  `,
    [canonicalId, duplicateId]
  );

  run(
    db,
    `
    INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
    SELECT story_id, ?
    FROM story_dependencies
    WHERE depends_on_story_id = ?
  `,
    [canonicalId, duplicateId]
  );

  run(db, 'DELETE FROM story_dependencies WHERE story_id = ? OR depends_on_story_id = ?', [
    duplicateId,
    duplicateId,
  ]);
  run(db, 'DELETE FROM story_dependencies WHERE story_id = depends_on_story_id');

  run(db, 'DELETE FROM stories WHERE id = ?', [duplicateId]);

  run(
    db,
    'INSERT INTO cluster_story_merges (duplicate_story_id, canonical_story_id, merged_at) VALUES (?, ?, ?)',
    [duplicateId, canonicalId, new Date().toISOString()]
  );

  return true;
}

function storySimilarity(a: StoryRecord, b: StoryRecord): number {
  const tokensA = toTokenSet(`${a.title} ${a.description}`);
  const tokensB = toTokenSet(`${b.title} ${b.description}`);

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }

  const union = tokensA.size + tokensB.size - overlap;
  if (union === 0) return 0;

  return overlap / union;
}

function toTokenSet(input: string): Set<string> {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3);

  return new Set(normalized);
}

function pickLonger(a: string, b: string): string {
  return (b || '').length > (a || '').length ? b : a;
}
