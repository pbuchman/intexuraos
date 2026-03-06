import { describe, it, expect } from 'vitest';
import { normalizeLabel, hasCodeTaskLabel } from '../labels.js';

describe('labels', () => {
  describe('normalizeLabel', () => {
    it('lowercases and replaces underscores and spaces with dashes', () => {
      expect(normalizeLabel('Code_Task')).toBe('code-task');
      expect(normalizeLabel('  Code Task  ')).toBe('code-task');
      expect(normalizeLabel('CODE_TASK')).toBe('code-task');
    });
  });

  describe('hasCodeTaskLabel', () => {
    it('returns true for exact match', () => {
      expect(hasCodeTaskLabel(['code-task'])).toBe(true);
    });

    it('returns true for uppercase label', () => {
      expect(hasCodeTaskLabel(['CODE-TASK'])).toBe(true);
    });

    it('returns true for underscores', () => {
      expect(hasCodeTaskLabel(['code_task'])).toBe(true);
    });

    it('returns true for spaces', () => {
      expect(hasCodeTaskLabel(['code task'])).toBe(true);
    });

    it('returns true for mixed case with spaces', () => {
      expect(hasCodeTaskLabel(['Code Task'])).toBe(true);
    });

    it('returns true when multiple labels and one matches', () => {
      expect(hasCodeTaskLabel(['feature', 'code-task'])).toBe(true);
    });

    it('returns false when no match', () => {
      expect(hasCodeTaskLabel(['feature', 'unclear'])).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(hasCodeTaskLabel([])).toBe(false);
    });

    it('returns false for partial match', () => {
      expect(hasCodeTaskLabel(['code-task-extra'])).toBe(false);
    });
  });
});
