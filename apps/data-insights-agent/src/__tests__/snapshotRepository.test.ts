/**
 * Tests for Snapshot Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreSnapshotRepository } from '../infra/firestore/snapshotRepository.js';
import type { CompositeFeedData } from '../domain/compositeFeed/schemas/index.js';

function createTestFeedData(overrides: Partial<CompositeFeedData> = {}): CompositeFeedData {
  return {
    feedId: 'feed-1',
    feedName: 'Test Feed',
    purpose: 'Test purpose',
    generatedAt: new Date().toISOString(),
    staticSources: [],
    notifications: [],
    ...overrides,
  };
}

describe('FirestoreSnapshotRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: FirestoreSnapshotRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repository = new FirestoreSnapshotRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('upsert', () => {
    it('creates a new snapshot and returns it', async () => {
      const feedData = createTestFeedData();
      const result = await repository.upsert('feed-1', 'user-123', 'Test Feed', feedData);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feedId).toBe('feed-1');
        expect(result.value.userId).toBe('user-123');
        expect(result.value.feedName).toBe('Test Feed');
        expect(result.value.data).toEqual(feedData);
        expect(result.value.generatedAt).toBeInstanceOf(Date);
        expect(result.value.expiresAt).toBeInstanceOf(Date);
        expect(result.value.expiresAt.getTime()).toBeGreaterThan(result.value.generatedAt.getTime());
      }
    });

    it('overwrites existing snapshot', async () => {
      const feedData1 = createTestFeedData({ purpose: 'First purpose' });
      const feedData2 = createTestFeedData({ purpose: 'Second purpose' });

      await repository.upsert('feed-1', 'user-123', 'Test Feed', feedData1);
      const result = await repository.upsert('feed-1', 'user-123', 'Updated Feed', feedData2);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feedName).toBe('Updated Feed');
        expect(result.value.data.purpose).toBe('Second purpose');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const feedData = createTestFeedData();
      const result = await repository.upsert('feed-1', 'user-123', 'Test Feed', feedData);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to upsert snapshot');
      }

      fakeFirestore.configure({});
    });
  });

  describe('getByFeedId', () => {
    it('returns null for non-existent snapshot', async () => {
      const result = await repository.getByFeedId('non-existent', 'user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns snapshot for existing feed and matching user', async () => {
      const feedData = createTestFeedData();
      await repository.upsert('feed-1', 'user-123', 'Test Feed', feedData);

      const result = await repository.getByFeedId('feed-1', 'user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.feedId).toBe('feed-1');
        expect(result.value.feedName).toBe('Test Feed');
      }
    });

    it('returns null when user id does not match', async () => {
      const feedData = createTestFeedData();
      await repository.upsert('feed-1', 'user-123', 'Test Feed', feedData);

      const result = await repository.getByFeedId('feed-1', 'other-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repository.getByFeedId('feed-1', 'user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to get snapshot');
      }

      fakeFirestore.configure({});
    });
  });

  describe('delete', () => {
    it('deletes an existing snapshot', async () => {
      const feedData = createTestFeedData();
      await repository.upsert('feed-1', 'user-123', 'Test Feed', feedData);

      const deleteResult = await repository.delete('feed-1', 'user-123');
      expect(deleteResult.ok).toBe(true);

      const getResult = await repository.getByFeedId('feed-1', 'user-123');
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });

    it('returns ok for non-existent snapshot (idempotent)', async () => {
      const result = await repository.delete('non-existent', 'user-123');

      expect(result.ok).toBe(true);
    });

    it('returns ok when user id does not match (no-op)', async () => {
      const feedData = createTestFeedData();
      await repository.upsert('feed-1', 'user-123', 'Test Feed', feedData);

      const deleteResult = await repository.delete('feed-1', 'other-user');
      expect(deleteResult.ok).toBe(true);

      const getResult = await repository.getByFeedId('feed-1', 'user-123');
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).not.toBeNull();
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await repository.delete('feed-1', 'user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to delete snapshot');
      }

      fakeFirestore.configure({});
    });
  });

  describe('deleteByFeedId', () => {
    it('deletes snapshot by feed ID without user check', async () => {
      const feedData = createTestFeedData();
      await repository.upsert('feed-1', 'user-123', 'Test Feed', feedData);

      const deleteResult = await repository.deleteByFeedId('feed-1');
      expect(deleteResult.ok).toBe(true);

      const getResult = await repository.getByFeedId('feed-1', 'user-123');
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await repository.deleteByFeedId('feed-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to delete snapshot by feed ID');
      }

      fakeFirestore.configure({});
    });
  });

  describe('listByUserId', () => {
    it('returns empty array when no snapshots exist', async () => {
      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns only snapshots for the specified user', async () => {
      const feedData1 = createTestFeedData({ feedId: 'feed-1' });
      const feedData2 = createTestFeedData({ feedId: 'feed-2' });
      const feedData3 = createTestFeedData({ feedId: 'feed-3' });

      await repository.upsert('feed-1', 'user-123', 'Feed 1', feedData1);
      await repository.upsert('feed-2', 'user-123', 'Feed 2', feedData2);
      await repository.upsert('feed-3', 'other-user', 'Other Feed', feedData3);

      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const feedIds = result.value.map((s) => s.feedId);
        expect(feedIds).toContain('feed-1');
        expect(feedIds).toContain('feed-2');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to list snapshots');
      }

      fakeFirestore.configure({});
    });
  });
});
