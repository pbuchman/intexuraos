/**
 * Tests for linearIdentifierParser utilities.
 */

import { describe, it, expect } from 'vitest';
import { parseLinearIdentifierFromUrl, extractIntIssueId, extractLinearIdentifierFromText } from '../../../domain/utils/linearIdentifierParser.js';

describe('parseLinearIdentifierFromUrl', () => {
  it('extracts identifier from plain Linear URL', () => {
    expect(parseLinearIdentifierFromUrl('https://linear.app/pbuchman/issue/INT-123/some-title')).toBe('INT-123');
  });

  it('extracts identifier from markdown link', () => {
    expect(parseLinearIdentifierFromUrl('[INT-123](https://linear.app/pbuchman/issue/INT-123/some-title)')).toBe('INT-123');
  });

  it('returns null for non-Linear URL', () => {
    expect(parseLinearIdentifierFromUrl('https://github.com/org/repo/issues/1')).toBeNull();
  });

  it('returns null for Linear URL without issue path', () => {
    expect(parseLinearIdentifierFromUrl('https://linear.app/pbuchman/projects')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(parseLinearIdentifierFromUrl('not-a-url')).toBeNull();
  });
});

describe('extractIntIssueId', () => {
  it('extracts INT-XXX from text', () => {
    expect(extractIntIssueId('Fixes INT-123')).toBe('INT-123');
  });

  it('extracts first INT-XXX match', () => {
    expect(extractIntIssueId('INT-100 and INT-200')).toBe('INT-100');
  });

  it('is case-insensitive', () => {
    expect(extractIntIssueId('int-456')).toBe('INT-456');
  });

  it('returns null when no match', () => {
    expect(extractIntIssueId('no issue here')).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(extractIntIssueId(undefined)).toBeNull();
  });
});

describe('extractLinearIdentifierFromText', () => {
  it('extracts identifier from plain Linear URL in text', () => {
    const text = 'See https://linear.app/pbuchman/issue/INT-456/fix-bug for details';
    expect(extractLinearIdentifierFromText(text)).toBe('INT-456');
  });

  it('extracts identifier from markdown link in text', () => {
    const text = '- Linear: [INT-789](https://linear.app/pbuchman/issue/INT-789/some-title)\n\nMore text';
    expect(extractLinearIdentifierFromText(text)).toBe('INT-789');
  });

  it('returns first valid Linear URL identifier', () => {
    const text = 'First: https://linear.app/pbuchman/issue/INT-100/a\nSecond: https://linear.app/pbuchman/issue/INT-200/b';
    expect(extractLinearIdentifierFromText(text)).toBe('INT-100');
  });

  it('returns null when no Linear URLs present', () => {
    const text = 'Just some text with https://github.com/org/repo and no Linear links';
    expect(extractLinearIdentifierFromText(text)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractLinearIdentifierFromText('')).toBeNull();
  });

  it('ignores non-issue Linear URLs', () => {
    const text = 'See https://linear.app/pbuchman/projects for more';
    expect(extractLinearIdentifierFromText(text)).toBeNull();
  });

  it('handles multiline PR body with markdown link', () => {
    const text = `## Summary
- Fix authentication bug

## Links
- Linear: [INT-555](https://linear.app/pbuchman/issue/INT-555/fix-auth)
- IntexuraOS Code Task: [View task](https://intexuraos.cloud/#/code-tasks/task_abc)`;
    expect(extractLinearIdentifierFromText(text)).toBe('INT-555');
  });
});
