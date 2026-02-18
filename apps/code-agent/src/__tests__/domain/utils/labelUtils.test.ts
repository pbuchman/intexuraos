import { describe, it, expect } from 'vitest';
import { hasCodeTaskLabel, hasUnclearLabel } from '../../../domain/utils/labelUtils.js';

describe('labelUtils', () => {
  describe('hasCodeTaskLabel', () => {
    it('returns true for exact match', () => {
      expect(hasCodeTaskLabel(['code-task'])).toBe(true);
    });

    it('returns true for uppercase label', () => {
      expect(hasCodeTaskLabel(['CODE-TASK'])).toBe(true);
    });

    it('returns true for underscores (normalized to dashes)', () => {
      expect(hasCodeTaskLabel(['code_task'])).toBe(true);
    });

    it('returns true for spaces (normalized to dashes)', () => {
      expect(hasCodeTaskLabel(['code task'])).toBe(true);
    });

    it('returns true for mixed case with spaces', () => {
      expect(hasCodeTaskLabel(['Code Task'])).toBe(true);
    });

    it('returns true when multiple labels and one matches', () => {
      expect(hasCodeTaskLabel(['feature', 'code-task'])).toBe(true);
    });

    it('returns false when multiple labels and none match', () => {
      expect(hasCodeTaskLabel(['feature', 'unclear'])).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(hasCodeTaskLabel([])).toBe(false);
    });

    it('returns false for partial match (code-task-extra)', () => {
      expect(hasCodeTaskLabel(['code-task-extra'])).toBe(false);
    });
  });

  describe('hasUnclearLabel', () => {
    it('returns true for exact match', () => {
      expect(hasUnclearLabel(['unclear'])).toBe(true);
    });

    it('returns true for uppercase label', () => {
      expect(hasUnclearLabel(['UNCLEAR'])).toBe(true);
    });

    it('returns false for un_clear (normalizes to un-clear, not unclear)', () => {
      expect(hasUnclearLabel(['un_clear'])).toBe(false);
    });

    it('returns true when combined with other labels', () => {
      expect(hasUnclearLabel(['code-task', 'unclear'])).toBe(true);
    });

    it('returns false for empty array', () => {
      expect(hasUnclearLabel([])).toBe(false);
    });

    it('returns false for unclear-requirement (not exact match)', () => {
      expect(hasUnclearLabel(['unclear-requirement'])).toBe(false);
    });
  });
});
