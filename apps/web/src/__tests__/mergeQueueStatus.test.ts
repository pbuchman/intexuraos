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
    mergeable: null,
    mergeableState: null,
    checksStatus: 'pending',
    createdAt: '2026-01-01T00:00:00Z',
    htmlUrl: 'https://github.com/test/repo/pull/1',
    ...overrides,
  };
}

describe('getPrStatus', () => {
  it('returns mergeable when mergeable is true and checks pass', () => {
    expect(getPrStatus(makePr({ mergeable: true, checksStatus: 'success' }))).toBe('mergeable');
  });

  it('returns pending when checks are pending', () => {
    expect(getPrStatus(makePr({ mergeable: true, checksStatus: 'pending' }))).toBe('pending');
  });

  it('returns pending when mergeable is null (GitHub still computing)', () => {
    expect(getPrStatus(makePr({ mergeable: null, checksStatus: 'success' }))).toBe('pending');
  });

  it('returns pending when both signals are unknown', () => {
    expect(getPrStatus(makePr({ mergeable: null, checksStatus: 'pending' }))).toBe('pending');
  });

  it('returns pending when mergeable is false but checks are still pending', () => {
    // Design intent: wait for all signals before declaring blocked
    expect(getPrStatus(makePr({ mergeable: false, checksStatus: 'pending' }))).toBe('pending');
  });

  it('returns blocked when mergeable is false and checks fail', () => {
    expect(getPrStatus(makePr({ mergeable: false, checksStatus: 'failure' }))).toBe('blocked');
  });

  it('returns blocked when mergeable is false and checks succeed (merge conflict)', () => {
    expect(getPrStatus(makePr({ mergeable: false, checksStatus: 'success' }))).toBe('blocked');
  });

  it('returns blocked when mergeable is true but checks fail', () => {
    expect(getPrStatus(makePr({ mergeable: true, checksStatus: 'failure' }))).toBe('blocked');
  });

  it('returns pending when mergeable is null and checks fail', () => {
    // mergeable === null means GitHub has not computed yet — still pending
    expect(getPrStatus(makePr({ mergeable: null, checksStatus: 'failure' }))).toBe('pending');
  });
});
