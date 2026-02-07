import { describe, it, expect } from 'vitest';
import {
  extractStoryIdFromBranch,
  isValidStoryId,
  normalizeStoryId,
  STORY_ID_PATTERN,
} from './story-id.js';

describe('Story ID utilities', () => {
  describe('STORY_ID_PATTERN', () => {
    it('should match valid story IDs', () => {
      expect('STORY-001'.match(STORY_ID_PATTERN)).not.toBeNull();
      expect('STORY-FIX-004'.match(STORY_ID_PATTERN)).not.toBeNull();
      expect('STORY-REF-022'.match(STORY_ID_PATTERN)).not.toBeNull();
      expect('STORY-ABC123XYZ'.match(STORY_ID_PATTERN)).not.toBeNull();
    });
  });

  describe('isValidStoryId', () => {
    it('should validate story IDs correctly', () => {
      expect(isValidStoryId('STORY-001')).toBe(true);
      expect(isValidStoryId('STORY-FIX-004')).toBe(true);
      expect(isValidStoryId('STORY-REF-022')).toBe(true);
    });

    it('should reject invalid story IDs', () => {
      expect(isValidStoryId('INVALID-001')).toBe(false);
      expect(isValidStoryId('')).toBe(false);
      expect(isValidStoryId(null)).toBe(false);
      expect(isValidStoryId(undefined)).toBe(false);
    });
  });

  describe('extractStoryIdFromBranch', () => {
    it('should extract story ID from feature branch with prefix', () => {
      expect(extractStoryIdFromBranch('feature/STORY-001-test')).toBe('STORY-001');
      expect(extractStoryIdFromBranch('feature/STORY-FIX-004-description')).toBe(
        'STORY-FIX-004'
      );
    });

    it('should extract story ID from branch names with different prefixes', () => {
      expect(extractStoryIdFromBranch('bugfix/STORY-REF-022-fix')).toBe('STORY-REF-022');
      expect(extractStoryIdFromBranch('hotfix/STORY-IMP-003-critical')).toBe('STORY-IMP-003');
    });

    it('should extract story ID from branch names without prefix', () => {
      expect(extractStoryIdFromBranch('STORY-001')).toBe('STORY-001');
      expect(extractStoryIdFromBranch('STORY-FIX-004')).toBe('STORY-FIX-004');
    });

    it('should extract story ID with dashes in description', () => {
      expect(extractStoryIdFromBranch('feature/STORY-123_fix-bug-with-dashes')).toBe(
        'STORY-123'
      );
    });

    it('should handle empty branch name', () => {
      expect(extractStoryIdFromBranch('')).toBeNull();
    });

    it('should return null for branch without story ID', () => {
      expect(extractStoryIdFromBranch('feature/some-other-branch')).toBeNull();
      expect(extractStoryIdFromBranch('main')).toBeNull();
      expect(extractStoryIdFromBranch('develop')).toBeNull();
    });

    it('should be case-insensitive', () => {
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
