// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import {
  extractStoryIdFromBranch,
  isValidStoryId,
  normalizeStoryId,
  STORY_ID_PATTERN,
} from './story-id.js';

describe('Story ID utilities', () => {
  describe('STORY_ID_PATTERN', () => {
    it('should match valid story IDs with STORY prefix', () => {
      expect('STORY-001'.match(STORY_ID_PATTERN)).not.toBeNull();
      expect('STORY-FIX-004'.match(STORY_ID_PATTERN)).not.toBeNull();
      expect('STORY-REF-022'.match(STORY_ID_PATTERN)).not.toBeNull();
      expect('STORY-ABC123XYZ'.match(STORY_ID_PATTERN)).not.toBeNull();
    });

    it('should match story IDs with non-STORY prefixes', () => {
      expect('CONN-003'.match(STORY_ID_PATTERN)).not.toBeNull();
      expect('HT-001'.match(STORY_ID_PATTERN)).not.toBeNull();
      expect('INFRA-042'.match(STORY_ID_PATTERN)).not.toBeNull();
    });
  });

  describe('isValidStoryId', () => {
    it('should validate STORY- IDs correctly', () => {
      expect(isValidStoryId('STORY-001')).toBe(true);
      expect(isValidStoryId('STORY-FIX-004')).toBe(true);
      expect(isValidStoryId('STORY-REF-022')).toBe(true);
    });

    it('should validate non-STORY prefix IDs', () => {
      expect(isValidStoryId('CONN-003')).toBe(true);
      expect(isValidStoryId('HT-001')).toBe(true);
      expect(isValidStoryId('INFRA-042')).toBe(true);
    });

    it('should reject invalid story IDs', () => {
      expect(isValidStoryId('A-001')).toBe(false); // prefix too short
      expect(isValidStoryId('')).toBe(false);
      expect(isValidStoryId(null)).toBe(false);
      expect(isValidStoryId(undefined)).toBe(false);
    });
  });

  describe('extractStoryIdFromBranch', () => {
    it('should extract story ID from feature branch with STORY prefix', () => {
      expect(extractStoryIdFromBranch('feature/STORY-001-test')).toBe('STORY-001');
      expect(extractStoryIdFromBranch('feature/STORY-FIX-004-description')).toBe('STORY-FIX-004');
    });

    it('should extract non-STORY prefix IDs from branch names', () => {
      expect(extractStoryIdFromBranch('feature/CONN-003-jira-pm-connector')).toBe('CONN-003');
      expect(extractStoryIdFromBranch('feature/HT-001-add-feature')).toBe('HT-001');
      expect(extractStoryIdFromBranch('feature/INFRA-042-fix-deploy')).toBe('INFRA-042');
    });

    it('should extract story ID from branch names with different git prefixes', () => {
      expect(extractStoryIdFromBranch('bugfix/STORY-REF-022-fix')).toBe('STORY-REF-022');
      expect(extractStoryIdFromBranch('hotfix/STORY-IMP-003-critical')).toBe('STORY-IMP-003');
      expect(extractStoryIdFromBranch('bugfix/CONN-009-fix-sync')).toBe('CONN-009');
    });

    it('should extract story ID from branch names without git prefix', () => {
      expect(extractStoryIdFromBranch('STORY-001')).toBe('STORY-001');
      expect(extractStoryIdFromBranch('STORY-FIX-004')).toBe('STORY-FIX-004');
      expect(extractStoryIdFromBranch('CONN-003')).toBe('CONN-003');
    });

    it('should extract story ID with dashes in description', () => {
      expect(extractStoryIdFromBranch('feature/STORY-123_fix-bug-with-dashes')).toBe('STORY-123');
    });

    it('should handle empty branch name', () => {
      expect(extractStoryIdFromBranch('')).toBeNull();
    });

    it('should return null for branch without story ID', () => {
      expect(extractStoryIdFromBranch('feature/some-other-branch')).toBeNull();
      expect(extractStoryIdFromBranch('main')).toBeNull();
      expect(extractStoryIdFromBranch('develop')).toBeNull();
    });

    it('should be case-insensitive for STORY prefix (legacy support)', () => {
      expect(extractStoryIdFromBranch('feature/story-001-test')).toBe('STORY-001');
      expect(extractStoryIdFromBranch('feature/Story-FIX-004-description')).toBe('STORY-FIX-004');
    });
  });

  describe('normalizeStoryId', () => {
    it('should normalize story IDs to uppercase', () => {
      expect(normalizeStoryId('story-001')).toBe('STORY-001');
      expect(normalizeStoryId('Story-FIX-004')).toBe('STORY-FIX-004');
      expect(normalizeStoryId('STORY-REF-022')).toBe('STORY-REF-022');
    });
  });
});
