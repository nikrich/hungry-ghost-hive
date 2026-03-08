// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoryRow } from '../db/client.js';
import {
  deleteStoryMarkdown,
  generateStoryMarkdown,
  writeStoryMarkdown,
} from './story-markdown.js';

const TEST_DIR = join('/tmp', `story-markdown-test-${Date.now()}`);

function makeStory(overrides: Partial<StoryRow> = {}): StoryRow {
  return {
    id: 'STORY-TEST01',
    requirement_id: null,
    team_id: null,
    title: 'Test Story',
    description: 'A test story description.',
    acceptance_criteria: null,
    complexity_score: null,
    story_points: null,
    status: 'draft',
    assigned_agent_id: null,
    branch_name: null,
    pr_url: null,
    jira_issue_key: null,
    jira_issue_id: null,
    jira_project_key: null,
    jira_subtask_key: null,
    jira_subtask_id: null,
    external_issue_key: null,
    external_issue_id: null,
    external_project_key: null,
    external_subtask_key: null,
    external_subtask_id: null,
    external_provider: null,
    in_sprint: 0,
    markdown_path: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('generateStoryMarkdown', () => {
  it('should generate a markdown document with title and description', () => {
    const story = makeStory();
    const md = generateStoryMarkdown(story);

    expect(md).toContain('# Test Story');
    expect(md).toContain('**Story ID:** STORY-TEST01');
    expect(md).toContain('**Status:** draft');
    expect(md).toContain('A test story description.');
  });

  it('should include acceptance criteria as a checklist', () => {
    const story = makeStory({
      acceptance_criteria: JSON.stringify(['Criterion A', 'Criterion B']),
    });
    const md = generateStoryMarkdown(story);

    expect(md).toContain('## Acceptance Criteria');
    expect(md).toContain('- [ ] Criterion A');
    expect(md).toContain('- [ ] Criterion B');
  });

  it('should include optional fields when present', () => {
    const story = makeStory({
      team_id: 'TEAM-1',
      requirement_id: 'REQ-1',
      assigned_agent_id: 'agent-123',
      complexity_score: 5,
      story_points: 5,
      branch_name: 'feature/STORY-TEST01-test-story',
      pr_url: 'https://github.com/test/repo/pull/42',
    });
    const md = generateStoryMarkdown(story);

    expect(md).toContain('**Team:** TEAM-1');
    expect(md).toContain('**Requirement:** REQ-1');
    expect(md).toContain('**Assigned Agent:** agent-123');
    expect(md).toContain('**Complexity:** 5');
    expect(md).toContain('**Story Points:** 5');
    expect(md).toContain('**Branch:** feature/STORY-TEST01-test-story');
    expect(md).toContain('**PR:** https://github.com/test/repo/pull/42');
  });

  it('should include created and updated timestamps', () => {
    const story = makeStory();
    const md = generateStoryMarkdown(story);

    expect(md).toContain('*Created: 2026-01-01T00:00:00.000Z*');
    expect(md).toContain('*Updated: 2026-01-01T00:00:00.000Z*');
  });

  it('should handle malformed acceptance_criteria gracefully', () => {
    const story = makeStory({ acceptance_criteria: 'not-json' });
    const md = generateStoryMarkdown(story);

    expect(md).toContain('not-json');
  });
});

describe('writeStoryMarkdown', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should write a markdown file in storiesDir', () => {
    const story = makeStory();
    const filePath = writeStoryMarkdown(TEST_DIR, story);

    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toBe(join(TEST_DIR, 'STORY-TEST01.md'));
  });

  it('should create the directory if it does not exist', () => {
    const nestedDir = join(TEST_DIR, 'nested', 'stories');
    const story = makeStory();
    writeStoryMarkdown(nestedDir, story);

    expect(existsSync(nestedDir)).toBe(true);
    expect(existsSync(join(nestedDir, 'STORY-TEST01.md'))).toBe(true);
  });

  it('should write valid markdown content', () => {
    const story = makeStory({ description: 'My description.' });
    const filePath = writeStoryMarkdown(TEST_DIR, story);
    const content = readFileSync(filePath, 'utf-8');

    expect(content).toContain('# Test Story');
    expect(content).toContain('My description.');
  });

  it('should overwrite existing file on update', () => {
    const story = makeStory({ title: 'Old Title' });
    writeStoryMarkdown(TEST_DIR, story);

    const updatedStory = makeStory({ title: 'New Title' });
    const filePath = writeStoryMarkdown(TEST_DIR, updatedStory);
    const content = readFileSync(filePath, 'utf-8');

    expect(content).toContain('# New Title');
    expect(content).not.toContain('# Old Title');
  });
});

describe('deleteStoryMarkdown', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should delete the markdown file', () => {
    const story = makeStory();
    const filePath = writeStoryMarkdown(TEST_DIR, story);
    expect(existsSync(filePath)).toBe(true);

    deleteStoryMarkdown(TEST_DIR, story.id);
    expect(existsSync(filePath)).toBe(false);
  });

  it('should not throw if file does not exist', () => {
    expect(() => deleteStoryMarkdown(TEST_DIR, 'STORY-NONEXISTENT')).not.toThrow();
  });
});
