import { describe, expect, it } from 'vitest';

import {
  getTaskMergeUrl,
  hasImplementationReadyLabel,
  hasMergeReadyLabel,
  isTaskMergeable,
} from '../../../domain/issueGrouping/index.js';

describe('hasImplementationReadyLabel', () => {
  it('returns true for ready-to-implement label', () => {
    expect(hasImplementationReadyLabel([{ name: 'ready-to-implement' }])).toBe(true);
  });

  it('returns true for code-task label (backward compat)', () => {
    expect(hasImplementationReadyLabel([{ name: 'code-task' }])).toBe(true);
  });

  it('returns true for case variations via normalization', () => {
    expect(hasImplementationReadyLabel([{ name: 'Ready To Implement' }])).toBe(true);
    expect(hasImplementationReadyLabel([{ name: 'READY_TO_IMPLEMENT' }])).toBe(true);
    expect(hasImplementationReadyLabel([{ name: 'Code Task' }])).toBe(true);
    expect(hasImplementationReadyLabel([{ name: 'CODE_TASK' }])).toBe(true);
  });

  it('returns true for undefined labels (fallback)', () => {
    expect(hasImplementationReadyLabel(undefined)).toBe(true);
  });

  it('returns true for empty labels (fallback)', () => {
    expect(hasImplementationReadyLabel([])).toBe(true);
  });

  it('returns false for labels with neither ready-to-implement nor code-task', () => {
    expect(hasImplementationReadyLabel([{ name: 'bug' }, { name: 'feature' }])).toBe(false);
  });
});

describe('hasMergeReadyLabel', () => {
  it('returns true for ready-to-merge label', () => {
    expect(hasMergeReadyLabel([{ name: 'ready-to-merge' }])).toBe(true);
  });

  it('returns true for case variations', () => {
    expect(hasMergeReadyLabel([{ name: 'Ready To Merge' }])).toBe(true);
    expect(hasMergeReadyLabel([{ name: 'READY_TO_MERGE' }])).toBe(true);
  });

  it('returns false for undefined labels', () => {
    expect(hasMergeReadyLabel(undefined)).toBe(false);
  });

  it('returns false for empty labels', () => {
    expect(hasMergeReadyLabel([])).toBe(false);
  });

  it('returns false for other labels', () => {
    expect(hasMergeReadyLabel([{ name: 'bug' }, { name: 'feature' }])).toBe(false);
  });
});

describe('isTaskMergeable', () => {
  it('returns true for implemented task with prUrl and merge label', () => {
    expect(
      isTaskMergeable({
        status: 'implemented',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
        linearIssue: { labels: [{ name: 'ready-to-merge' }] },
      }),
    ).toBe(true);
  });

  it('returns true for reviewed task with prNumber and merge label', () => {
    expect(
      isTaskMergeable({
        status: 'reviewed',
        prNumber: 42,
        linearIssue: { labels: [{ name: 'ready-to-merge' }] },
      }),
    ).toBe(true);
  });

  it('returns false for reviewed task with prNumber and needs_remediation=0 but no label (planning-origin)', () => {
    expect(
      isTaskMergeable({
        status: 'reviewed',
        prNumber: 42,
        result: { needs_remediation: '0' },
      }),
    ).toBe(false);
  });

  it('returns false when no label and no passed review', () => {
    expect(
      isTaskMergeable({
        status: 'implemented',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
      }),
    ).toBe(false);
  });

  it('returns false for implemented task with merge label but no prUrl', () => {
    expect(
      isTaskMergeable({
        status: 'implemented',
        linearIssue: { labels: [{ name: 'ready-to-merge' }] },
      }),
    ).toBe(false);
  });

  it('returns false for reviewed task with merge label but no prNumber', () => {
    expect(
      isTaskMergeable({
        status: 'reviewed',
        linearIssue: { labels: [{ name: 'ready-to-merge' }] },
      }),
    ).toBe(false);
  });

  it('returns false for non-implemented/non-reviewed status even with label and prUrl', () => {
    expect(
      isTaskMergeable({
        status: 'planned',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
        linearIssue: { labels: [{ name: 'ready-to-merge' }] },
      }),
    ).toBe(false);
  });

  it('returns false for reviewed task with needs_remediation=1', () => {
    expect(
      isTaskMergeable({
        status: 'reviewed',
        prNumber: 42,
        result: { needs_remediation: '1' },
      }),
    ).toBe(false);
  });

  it('returns false for reviewed task with needs_remediation=0 but no merge-ready label (planning-origin)', () => {
    expect(
      isTaskMergeable({
        status: 'reviewed',
        prNumber: 42,
        result: { needs_remediation: '0' },
        linearIssue: { labels: [{ name: 'code-task' }] },
      }),
    ).toBe(false);
  });

  it('returns true for reviewed task with needs_remediation=0 AND merge-ready label (execution-origin)', () => {
    expect(
      isTaskMergeable({
        status: 'reviewed',
        prNumber: 42,
        result: { needs_remediation: '0' },
        linearIssue: { labels: [{ name: 'ready-to-merge' }] },
      }),
    ).toBe(true);
  });
});

describe('getTaskMergeUrl', () => {
  it('prefers result.prUrl when available', () => {
    expect(
      getTaskMergeUrl({
        repository: 'owner/repo',
        prNumber: 42,
        result: { prUrl: 'https://github.com/owner/repo/pull/99' },
      }),
    ).toBe('https://github.com/owner/repo/pull/99');
  });

  it('falls back to constructed URL from repository and prNumber', () => {
    expect(
      getTaskMergeUrl({
        repository: 'owner/repo',
        prNumber: 42,
      }),
    ).toBe('https://github.com/owner/repo/pull/42');
  });

  it('returns undefined when neither prUrl nor prNumber exist', () => {
    expect(
      getTaskMergeUrl({
        repository: 'owner/repo',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when result exists but has no prUrl and no prNumber', () => {
    expect(
      getTaskMergeUrl({
        repository: 'owner/repo',
        result: {},
      }),
    ).toBeUndefined();
  });
});
