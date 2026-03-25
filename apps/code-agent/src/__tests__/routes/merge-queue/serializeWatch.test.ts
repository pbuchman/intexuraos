import { describe, expect, it } from 'vitest';
import { tsToIso, serializeWatch } from '../../../routes/merge-queue/serializeWatch.js';
import type { MergeQueueWatch } from '../../../domain/models/mergeQueueWatch.js';

describe('tsToIso', () => {
  it('should return null for null', () => {
    expect(tsToIso(null)).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(tsToIso(undefined)).toBeNull();
  });

  it('should pass through ISO strings unchanged', () => {
    const iso = '2026-01-15T10:30:00.000Z';
    expect(tsToIso(iso)).toBe(iso);
  });

  it('should convert a Date to ISO string', () => {
    const date = new Date('2026-01-15T10:30:00.000Z');
    expect(tsToIso(date)).toBe('2026-01-15T10:30:00.000Z');
  });

  it('should convert a Firestore Timestamp (duck-typed toDate) to ISO string', () => {
    const timestamp = { toDate: (): Date => new Date('2026-03-01T12:00:00.000Z') };
    expect(tsToIso(timestamp)).toBe('2026-03-01T12:00:00.000Z');
  });

  it('should return null for unexpected types (number)', () => {
    expect(tsToIso(42)).toBeNull();
  });

  it('should return null for unexpected types (boolean)', () => {
    expect(tsToIso(true)).toBeNull();
  });

  it('should return null for objects without toDate', () => {
    expect(tsToIso({ foo: 'bar' })).toBeNull();
  });

  it('should return null when toDate throws', () => {
    const broken = {
      toDate: (): Date => {
        throw new Error('not a real Timestamp');
      },
    };
    expect(tsToIso(broken)).toBeNull();
  });

  it('should return null when toDate returns a non-Date value', () => {
    const bad = { toDate: (): Date => 'not-a-date' as unknown as Date };
    expect(tsToIso(bad)).toBeNull();
  });
});

describe('serializeWatch', () => {
  const makeTimestamp = (iso: string): { toDate: () => Date } => ({
    toDate: (): Date => new Date(iso),
  });

  it('should serialize a watch with all fields populated', () => {
    const watch = {
      id: 'watch-1',
      userId: 'user-secret',
      gitHubUsername: 'octocat',
      owner: 'org',
      repo: 'repo',
      baseBranch: 'main',
      status: 'active' as const,
      lastError: 'some error',
      createdAt: makeTimestamp('2026-01-01T00:00:00.000Z'),
      lastTickAt: makeTimestamp('2026-01-02T00:00:00.000Z'),
      lastErrorAt: makeTimestamp('2026-01-03T00:00:00.000Z'),
      drainedAt: null,
      cancelledAt: null,
      skippedPrs: [{ prNumber: 5, reason: 'merge_conflict' as const }],
      mergedPrs: [
        {
          prNumber: 10,
          title: 'Fix bug',
          author: 'dev',
          mergedAt: makeTimestamp('2026-01-04T00:00:00.000Z'),
        },
      ],
      excludedPrNumbers: [42, 55],
    } as unknown as MergeQueueWatch;

    const result = serializeWatch(watch);

    expect(result).toEqual({
      watchId: 'watch-1',
      owner: 'org',
      repo: 'repo',
      baseBranch: 'main',
      status: 'active',
      lastError: 'some error',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastTickAt: '2026-01-02T00:00:00.000Z',
      lastErrorAt: '2026-01-03T00:00:00.000Z',
      drainedAt: null,
      skippedPrs: [{ prNumber: 5, reason: 'merge_conflict' }],
      mergedPrs: [
        {
          prNumber: 10,
          title: 'Fix bug',
          author: 'dev',
          mergedAt: '2026-01-04T00:00:00.000Z',
        },
      ],
      excludedPrNumbers: [42, 55],
    });
  });

  it('should strip internal fields (userId, gitHubUsername, cancelledAt)', () => {
    const watch = {
      id: 'watch-2',
      userId: 'secret-user-id',
      gitHubUsername: 'secret-username',
      owner: 'org',
      repo: 'repo',
      baseBranch: 'main',
      status: 'drained' as const,
      lastError: null,
      createdAt: makeTimestamp('2026-01-01T00:00:00.000Z'),
      lastTickAt: null,
      lastErrorAt: null,
      drainedAt: makeTimestamp('2026-01-05T00:00:00.000Z'),
      cancelledAt: makeTimestamp('2026-01-06T00:00:00.000Z'),
      skippedPrs: [],
      mergedPrs: [],
    } as unknown as MergeQueueWatch;

    const result = serializeWatch(watch);

    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('gitHubUsername');
    expect(result).not.toHaveProperty('cancelledAt');
    expect(result).not.toHaveProperty('id');
    expect(result['watchId']).toBe('watch-2');
  });

  it('should handle null timestamp fields', () => {
    const watch = {
      id: 'watch-3',
      userId: 'u',
      gitHubUsername: 'g',
      owner: 'org',
      repo: 'repo',
      baseBranch: 'main',
      status: 'active' as const,
      lastError: null,
      createdAt: makeTimestamp('2026-01-01T00:00:00.000Z'),
      lastTickAt: null,
      lastErrorAt: null,
      drainedAt: null,
      cancelledAt: null,
      skippedPrs: [],
      mergedPrs: [],
    } as unknown as MergeQueueWatch;

    const result = serializeWatch(watch);

    expect(result['lastTickAt']).toBeNull();
    expect(result['lastErrorAt']).toBeNull();
    expect(result['drainedAt']).toBeNull();
  });

  it('should include excludedPrNumbers in serialized output', () => {
    const watch = {
      id: 'watch-excl',
      userId: 'u',
      gitHubUsername: 'g',
      owner: 'org',
      repo: 'repo',
      baseBranch: 'main',
      status: 'active' as const,
      lastError: null,
      createdAt: makeTimestamp('2026-01-01T00:00:00.000Z'),
      lastTickAt: null,
      lastErrorAt: null,
      drainedAt: null,
      cancelledAt: null,
      skippedPrs: [],
      mergedPrs: [],
      excludedPrNumbers: [42, 99],
    } as unknown as MergeQueueWatch;

    const result = serializeWatch(watch);
    expect(result['excludedPrNumbers']).toStrictEqual([42, 99]);
  });

});
