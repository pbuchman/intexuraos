import { describe, it, expect, beforeEach } from 'vitest';
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import { getDataInsightSnapshot } from '../../../../domain/snapshot/usecases/getDataInsightSnapshot.js';
import { FakeSnapshotRepository } from '../../../fakes.js';
import type { DataInsightSnapshot } from '../../../../domain/snapshot/models/index.js';

describe('getDataInsightSnapshot', () => {
  let fakeRepo: FakeSnapshotRepository;

  beforeEach(() => {
    fakeRepo = new FakeSnapshotRepository();
  });

  it('returns snapshot when found', async () => {
    await fakeRepo.upsert('feed-123', 'user-123', 'Test Feed', {
      feedId: 'feed-123',
      feedName: 'Test Feed',
      purpose: 'Test purpose',
      generatedAt: '2026-01-09T12:00:00.000Z',
      staticSources: [],
      notifications: [],
    });

    const result = await getDataInsightSnapshot('feed-123', 'user-123', {
      snapshotRepository: fakeRepo,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feedId).toBe('feed-123');
      expect(result.value.feedName).toBe('Test Feed');
    }
  });

  it('returns NOT_FOUND error when snapshot does not exist', async () => {
    const result = await getDataInsightSnapshot('feed-123', 'user-123', {
      snapshotRepository: fakeRepo,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Snapshot not found');
    }
  });

  it('returns REPOSITORY_ERROR when repository fails', async () => {
    fakeRepo.getByFeedId = async (): Promise<Result<DataInsightSnapshot | null, string>> =>
      err('Database error');

    const result = await getDataInsightSnapshot('feed-123', 'user-123', {
      snapshotRepository: fakeRepo,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('REPOSITORY_ERROR');
      expect(result.error.message).toBe('Database error');
    }
  });

  it('returns NOT_FOUND error when repository returns null', async () => {
    fakeRepo.getByFeedId = async (): Promise<Result<DataInsightSnapshot | null, string>> =>
      ok(null);

    const result = await getDataInsightSnapshot('feed-123', 'user-123', {
      snapshotRepository: fakeRepo,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});
