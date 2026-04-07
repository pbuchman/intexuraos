import { describe, expect, it } from 'vitest';
import { hasImplementationReadyLabel, hasMergeReadyLabel, isTaskMergeable, getTaskMergeUrl } from '../issueGroups.js';

describe('hasImplementationReadyLabel', () => {
  it('returns true when ready-to-implement label exists', () => {
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'ready-to-implement' }])).toBe(true);
  });

  it('returns true when code-task label exists (backward compat)', () => {
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'code-task' }])).toBe(true);
  });

  it('returns true when labels is undefined (graceful fallback)', () => {
    expect(hasImplementationReadyLabel(undefined)).toBe(true);
  });

  it('returns true when labels is empty array (graceful fallback)', () => {
    expect(hasImplementationReadyLabel([])).toBe(true);
  });

  it('returns false when labels has items but neither ready-to-implement nor code-task', () => {
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'some-other-label' }])).toBe(false);
  });

  it('handles mixed labels with ready-to-implement present', () => {
    expect(hasImplementationReadyLabel([
      { id: 'l1', name: 'bug' },
      { id: 'l2', name: 'ready-to-implement' },
    ])).toBe(true);
  });

  it('normalizes label names (spaces, underscores, casing)', () => {
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'Ready To Implement' }])).toBe(true);
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'ready_to_implement' }])).toBe(true);
    expect(hasImplementationReadyLabel([{ id: 'l1', name: 'Code-Task' }])).toBe(true);
  });
});

describe('hasMergeReadyLabel', () => {
  it('returns true when ready-to-merge label exists', () => {
    expect(hasMergeReadyLabel([{ id: 'l1', name: 'ready-to-merge' }])).toBe(true);
  });

  it('returns false when labels is undefined (no fallback)', () => {
    expect(hasMergeReadyLabel(undefined)).toBe(false);
  });

  it('returns false when labels is empty (no fallback)', () => {
    expect(hasMergeReadyLabel([])).toBe(false);
  });

  it('returns false when labels has items but not ready-to-merge', () => {
    expect(hasMergeReadyLabel([{ id: 'l1', name: 'some-other-label' }])).toBe(false);
  });

  it('normalizes label names (spaces, underscores, casing)', () => {
    expect(hasMergeReadyLabel([{ id: 'l1', name: 'Ready To Merge' }])).toBe(true);
    expect(hasMergeReadyLabel([{ id: 'l1', name: 'ready_to_merge' }])).toBe(true);
    expect(hasMergeReadyLabel([{ id: 'l1', name: 'READY-TO-MERGE' }])).toBe(true);
  });

  it('handles mixed labels with ready-to-merge present', () => {
    expect(hasMergeReadyLabel([
      { id: 'l1', name: 'bug' },
      { id: 'l2', name: 'ready-to-merge' },
    ])).toBe(true);
  });
});

describe('isTaskMergeable (detail view)', () => {
  it('returns true for implemented task with prUrl and ready-to-merge label', () => {
    expect(isTaskMergeable({
      status: 'implemented',
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(true);
  });

  it('returns true for reviewed task with prNumber and ready-to-merge label', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      prNumber: 42,
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(true);
  });

  it('returns false for reviewed task without prNumber', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(false);
  });

  it('returns false for implemented task without prUrl', () => {
    expect(isTaskMergeable({
      status: 'implemented',
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(false);
  });

  it('returns false when ready-to-merge label is absent', () => {
    expect(isTaskMergeable({
      status: 'implemented',
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
      linearIssue: { labels: [{ name: 'bug' }] },
    })).toBe(false);
  });

  it('returns false for running task even with label and prUrl', () => {
    expect(isTaskMergeable({
      status: 'running',
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(false);
  });

  it('returns false for reviewed task with needs_remediation=0 and prNumber but no label (planning-origin)', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      prNumber: 42,
      result: { needs_remediation: '0' },
    })).toBe(false);
  });

  it('returns false for reviewed task with needs_remediation=1 and prNumber, no label', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      prNumber: 42,
      result: { needs_remediation: '1' },
    })).toBe(false);
  });

  it('returns false for reviewed task with needs_remediation=0 but no prNumber', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      result: { needs_remediation: '0' },
    })).toBe(false);
  });

  it('returns true for reviewed task with needs_remediation=0 AND ready-to-merge label', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      prNumber: 42,
      result: { needs_remediation: '0' },
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(true);
  });

  it('returns false for implemented task with needs_remediation=0 but no prUrl', () => {
    expect(isTaskMergeable({
      status: 'implemented',
      result: { needs_remediation: '0' },
    })).toBe(false);
  });

  it('returns false for implemented task with needs_remediation=0 and prUrl but no label (fallback scoped to reviewed)', () => {
    expect(isTaskMergeable({
      status: 'implemented',
      result: { prUrl: 'https://github.com/org/repo/pull/42', needs_remediation: '0' },
    })).toBe(false);
  });

  it('returns false for reviewed task with needs_remediation=0 but no merge-ready label (planning-origin)', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      prNumber: 42,
      result: { needs_remediation: '0' },
      linearIssue: { labels: [{ name: 'code-task' }] },
    })).toBe(false);
  });

  it('returns true for reviewed task with needs_remediation=0 AND merge-ready label (execution-origin)', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      prNumber: 42,
      result: { needs_remediation: '0' },
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(true);
  });
});

describe('getTaskMergeUrl (detail view)', () => {
  it('returns result.prUrl when available', () => {
    expect(getTaskMergeUrl({
      repository: 'org/repo',
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
      prNumber: 42,
    })).toBe('https://github.com/org/repo/pull/42');
  });

  it('constructs URL from repository + prNumber when prUrl missing', () => {
    expect(getTaskMergeUrl({
      repository: 'org/repo',
      prNumber: 42,
    })).toBe('https://github.com/org/repo/pull/42');
  });

  it('returns undefined when both prUrl and prNumber are missing', () => {
    expect(getTaskMergeUrl({
      repository: 'org/repo',
    })).toBeUndefined();
  });
});
