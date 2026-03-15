import { describe, it, expect } from 'vitest';
import { hasActionableFindings } from '../../../domain/utils/reviewBodyParser.js';

describe('hasActionableFindings', () => {
  describe('returns false for non-actionable reviews', () => {
    it('returns false for null body', () => {
      expect(hasActionableFindings(null)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasActionableFindings('')).toBe(false);
    });

    it('returns false for whitespace-only body', () => {
      expect(hasActionableFindings('   \n\t  ')).toBe(false);
    });

    it('returns false for "no issues found" indicator', () => {
      const body = `## Code Quality Review\n\nNo issues found. The code looks clean.`;
      expect(hasActionableFindings(body)).toBe(false);
    });

    it('returns false for "no code quality issues were identified" indicator', () => {
      const body = `## Review Summary\n\nAfter thorough analysis, no code quality issues were identified in this PR.`;
      expect(hasActionableFindings(body)).toBe(false);
    });

    it('returns false for "no issues identified" indicator', () => {
      const body = `Overall assessment: no issues identified. Ship it!`;
      expect(hasActionableFindings(body)).toBe(false);
    });

    it('returns false for "no significant issues" indicator', () => {
      const body = `Code review complete. No significant issues to report.`;
      expect(hasActionableFindings(body)).toBe(false);
    });

    it('is case-insensitive for clean-review indicators', () => {
      const body = `Review complete. NO ISSUES FOUND in the submitted code.`;
      expect(hasActionableFindings(body)).toBe(false);
    });
  });

  describe('returns true for actionable reviews', () => {
    it('returns true for body with ### Suggestions header and numbered items', () => {
      const body = [
        '## Code Quality Review',
        '',
        '### Suggestions',
        '',
        '1. **Hardcoded timeout value** — Consider extracting the 5000ms timeout to a constant.',
        '2. **Weak assertion** — Use `toStrictEqual` instead of `toEqual` for type safety.',
      ].join('\n');
      expect(hasActionableFindings(body)).toBe(true);
    });

    it('returns true for body with ### Issues header and numbered items', () => {
      const body = [
        '## Code Review',
        '',
        '### Issues',
        '',
        '1. **Missing null check** — `data.user` could be undefined.',
      ].join('\n');
      expect(hasActionableFindings(body)).toBe(true);
    });

    it('returns true for body with ### Findings header and numbered items', () => {
      const body = [
        '## Analysis',
        '',
        '### Findings',
        '',
        '1. **Unused import** — `lodash` is imported but never used.',
      ].join('\n');
      expect(hasActionableFindings(body)).toBe(true);
    });

    it('returns true for body with ### Minor Suggestions header and numbered items', () => {
      const body = [
        '## Code Quality Review',
        '',
        '### Minor Suggestions',
        '',
        '1. **Naming** — Consider renaming `x` to `userCount` for clarity.',
      ].join('\n');
      expect(hasActionableFindings(body)).toBe(true);
    });

    it('returns true for finding header without numbered items (default true when uncertain)', () => {
      const body = [
        '## Review',
        '',
        'There are some concerns with the error handling approach.',
      ].join('\n');
      expect(hasActionableFindings(body)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns false when clean-review indicator exists alongside finding header', () => {
      const body = [
        '## Code Quality Review',
        '',
        'No issues found.',
        '',
        '### Suggestions',
        '',
        'None at this time.',
      ].join('\n');
      expect(hasActionableFindings(body)).toBe(false);
    });

    it('returns true when clean-review indicator is absent and finding headers exist', () => {
      const body = [
        '## Code Quality Review',
        '',
        '### Suggestions',
        '',
        '1. **Consider using const** — Use `const` instead of `let` where variable is never reassigned.',
      ].join('\n');
      expect(hasActionableFindings(body)).toBe(true);
    });
  });
});
