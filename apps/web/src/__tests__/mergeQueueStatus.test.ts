/**
 * Tests for getPrStatus utility.
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { getPrStatus, selectCurrentWatch } from '../utils/mergeQueueStatus.js';
import type { MergeQueuePr, MergeQueueWatch } from '../types/mergeQueue.js';

function makePr(overrides: Partial<MergeQueuePr> = {}): MergeQueuePr {
  return {
    number: 1,
    title: 'test',
    author: 'user',
    authorIsEligible: true,
    mergeConflictStatus: null,
    createdAt: '2026-01-01T00:00:00Z',
    htmlUrl: 'https://github.com/test/repo/pull/1',
    ...overrides,
  };
}

describe('getPrStatus', () => {
  it('returns mergeable when mergeConflictStatus is clean', () => {
    expect(getPrStatus(makePr({ mergeConflictStatus: 'clean' }))).toBe('mergeable');
  });

  it('returns blocked when mergeConflictStatus is conflicting', () => {
    expect(getPrStatus(makePr({ mergeConflictStatus: 'conflicting' }))).toBe('blocked');
  });

  it('returns pending when mergeConflictStatus is unknown', () => {
    expect(getPrStatus(makePr({ mergeConflictStatus: 'unknown' }))).toBe('pending');
  });

  it('returns pending when mergeConflictStatus is null', () => {
    expect(getPrStatus(makePr({ mergeConflictStatus: null }))).toBe('pending');
  });
});

function makeWatch(overrides: Partial<MergeQueueWatch> = {}): MergeQueueWatch {
  return {
    watchId: 'w-1',
    owner: 'test',
    repo: 'repo',
    baseBranch: 'main',
    status: 'active',
    mergedPrs: [],
    skippedPrs: [],
    lastError: null,
    lastErrorAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    lastTickAt: null,
    drainedAt: null,
    ...overrides,
  };
}

describe('selectCurrentWatch', () => {
  it('returns null when selectedBranch is null', () => {
    expect(selectCurrentWatch([makeWatch()], null)).toBeNull();
  });

  it('returns null when no watches match the branch', () => {
    expect(selectCurrentWatch([makeWatch({ baseBranch: 'other' })], 'main')).toBeNull();
  });

  it('prefers an active watch over drained or cancelled', () => {
    const active = makeWatch({ watchId: 'a', status: 'active', createdAt: '2026-01-01T00:00:00Z' });
    const drained = makeWatch({ watchId: 'd', status: 'drained', createdAt: '2026-01-02T00:00:00Z' });
    const cancelled = makeWatch({ watchId: 'c', status: 'cancelled', createdAt: '2026-01-03T00:00:00Z' });
    expect(selectCurrentWatch([drained, cancelled, active], 'main')?.watchId).toBe('a');
  });

  it('selects a cancelled watch over an older drained watch', () => {
    const olderDrained = makeWatch({ watchId: 'd', status: 'drained', createdAt: '2026-01-01T00:00:00Z' });
    const newerCancelled = makeWatch({ watchId: 'c', status: 'cancelled', createdAt: '2026-01-02T00:00:00Z' });
    expect(selectCurrentWatch([olderDrained, newerCancelled], 'main')?.watchId).toBe('c');
  });

  it('selects a drained watch over an older cancelled watch', () => {
    const olderCancelled = makeWatch({ watchId: 'c', status: 'cancelled', createdAt: '2026-01-01T00:00:00Z' });
    const newerDrained = makeWatch({ watchId: 'd', status: 'drained', createdAt: '2026-01-02T00:00:00Z' });
    expect(selectCurrentWatch([olderCancelled, newerDrained], 'main')?.watchId).toBe('d');
  });

  it('selects the most recent drained when no cancelled exists', () => {
    const older = makeWatch({ watchId: 'd1', status: 'drained', createdAt: '2026-01-01T00:00:00Z' });
    const newer = makeWatch({ watchId: 'd2', status: 'drained', createdAt: '2026-01-02T00:00:00Z' });
    expect(selectCurrentWatch([older, newer], 'main')?.watchId).toBe('d2');
  });

  it('filters watches by baseBranch', () => {
    const mainWatch = makeWatch({ watchId: 'main-w', baseBranch: 'main', status: 'cancelled' });
    const devWatch = makeWatch({ watchId: 'dev-w', baseBranch: 'dev', status: 'drained', createdAt: '2026-01-02T00:00:00Z' });
    expect(selectCurrentWatch([mainWatch, devWatch], 'dev')?.watchId).toBe('dev-w');
  });
});
