// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { StoryRow } from '../db/client.js';

/**
 * Generate markdown content for a story.
 */
export function generateStoryMarkdown(story: StoryRow): string {
  const lines: string[] = [];

  lines.push(`# ${story.title}`);
  lines.push('');
  lines.push(`**Story ID:** ${story.id}`);
  lines.push(`**Status:** ${story.status}`);

  if (story.team_id) {
    lines.push(`**Team:** ${story.team_id}`);
  }
  if (story.requirement_id) {
    lines.push(`**Requirement:** ${story.requirement_id}`);
  }
  if (story.assigned_agent_id) {
    lines.push(`**Assigned Agent:** ${story.assigned_agent_id}`);
  }
  if (story.complexity_score !== null) {
    lines.push(`**Complexity:** ${story.complexity_score}`);
  }
  if (story.story_points !== null) {
    lines.push(`**Story Points:** ${story.story_points}`);
  }
  if (story.branch_name) {
    lines.push(`**Branch:** ${story.branch_name}`);
  }
  if (story.pr_url) {
    lines.push(`**PR:** ${story.pr_url}`);
  }

  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(story.description);

  if (story.acceptance_criteria) {
    lines.push('');
    lines.push('## Acceptance Criteria');
    lines.push('');
    try {
      const criteria = JSON.parse(story.acceptance_criteria) as string[];
      for (const criterion of criteria) {
        lines.push(`- [ ] ${criterion}`);
      }
    } catch {
      lines.push(story.acceptance_criteria);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*Created: ${story.created_at}*`);
  lines.push(`*Updated: ${story.updated_at}*`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Write a story as a markdown file in the storiesDir.
 * Creates the directory if it does not exist.
 * Returns the path to the written file.
 */
export function writeStoryMarkdown(storiesDir: string, story: StoryRow): string {
  mkdirSync(storiesDir, { recursive: true });

  const fileName = `${story.id}.md`;
  const filePath = join(storiesDir, fileName);
  const content = generateStoryMarkdown(story);

  writeFileSync(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Delete a story's markdown file if it exists.
 */
export function deleteStoryMarkdown(storiesDir: string, storyId: string): void {
  const filePath = join(storiesDir, `${storyId}.md`);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}
