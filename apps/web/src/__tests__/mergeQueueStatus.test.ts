/**
 * Tests for getPrStatus utility.
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { getPrStatus } from '../utils/mergeQueueStatus.js';
import type { MergeQueuePr } from '../types/mergeQueue.js';

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
