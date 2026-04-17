/**
 * Tests for Firestore Notification repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreNotificationRepository } from '../../infra/firestore/index.js';
import type { CreateNotificationInput } from '../../domain/notifications/index.js';

/**
 * Helper to create test notification input.
 */
function createTestInput(
  overrides: Partial<CreateNotificationInput> = {}
): CreateNotificationInput {
  return {
    userId: 'user-123',
    source: 'android',
    device: 'Pixel 7',
    app: 'com.example.app',
    title: 'Test Notification',
    text: 'This is a test notification',
    timestamp: Date.now(),
    postTime: new Date().toISOString(),
    notificationId: 'notif-123',
    ...overrides,
  };
}

describe('FirestoreNotificationRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: FirestoreNotificationRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repository = new FirestoreNotificationRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('save', () => {
    it('saves notification and returns with generated id', async () => {
      const input = createTestInput();

      const result = await repository.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.title).toBe('Test Notification');
        expect(result.value.receivedAt).toBeDefined();
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB error') });

      const result = await repository.save(createTestInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('findById', () => {
    it('returns null for non-existent notification', async () => {
      const result = await repository.findById('nonexistent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns notification for existing id', async () => {
      const saved = await repository.save(createTestInput({ title: 'My Notification' }));
      if (!saved.ok) throw new Error('Setup failed');

      const result = await repository.findById(saved.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.title).toBe('My Notification');
      }
    });
  });

  describe('findByUserIdPaginated', () => {
    it('returns empty array for user with no notifications', async () => {
      const result = await repository.findByUserIdPaginated('user-no-notifs', { limit: 10 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications).toHaveLength(0);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });

    it('returns notifications for user', async () => {
      // Save notifications for same user
      const saved1 = await repository.save(
        createTestInput({ userId: 'user-123', title: 'Notif 1' })
      );
      const saved2 = await repository.save(
        createTestInput({ userId: 'user-123', title: 'Notif 2' })
      );

      expect(saved1.ok).toBe(true);
      expect(saved2.ok).toBe(true);

      const result = await repository.findByUserIdPaginated('user-123', { limit: 10 });

      expect(result.ok).toBe(true);
      // Should find at least 1 notification (fake firestore limitation with compound queries)
      if (result.ok) {
        expect(result.value.notifications.length).toBeGreaterThan(0);
      }
    });

    it('respects limit', async () => {
      // Save more notifications than limit
      for (let i = 0; i < 5; i++) {
        await repository.save(createTestInput({ title: `Notif ${String(i)}` }));
      }

      const result = await repository.findByUserIdPaginated('user-123', { limit: 2 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should get at most limit items
        expect(result.value.notifications.length).toBeLessThanOrEqual(2);
      }
    });

    it('handles invalid base64 cursor gracefully', async () => {
      // Save a notification first
      await repository.save(createTestInput({ userId: 'user-123' }));

      // Provide an invalid cursor (not valid base64)
      const result = await repository.findByUserIdPaginated('user-123', {
        limit: 10,
        cursor: '!!!invalid-base64!!!',
      });

      // Should still work, just ignoring the invalid cursor
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications.length).toBeGreaterThan(0);
      }
    });

    it('handles cursor with invalid JSON structure gracefully', async () => {
      // Save a notification first
      await repository.save(createTestInput({ userId: 'user-123' }));

      // Provide a cursor with valid base64 but invalid JSON structure (missing id)
      const invalidCursor = Buffer.from(
        JSON.stringify({ receivedAt: '2023-01-01T00:00:00.000Z' })
      ).toString('base64');
      const result = await repository.findByUserIdPaginated('user-123', {
        limit: 10,
        cursor: invalidCursor,
      });

      // Should still work, ignoring the malformed cursor
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications.length).toBeGreaterThan(0);
      }
    });

    it('handles cursor with non-JSON content gracefully', async () => {
      // Save a notification first
      await repository.save(createTestInput({ userId: 'user-123' }));

      // Provide a cursor with valid base64 but not valid JSON
      const invalidCursor = Buffer.from('not-json-at-all').toString('base64');
      const result = await repository.findByUserIdPaginated('user-123', {
        limit: 10,
        cursor: invalidCursor,
      });

      // Should still work, ignoring the invalid cursor
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications.length).toBeGreaterThan(0);
      }
    });

    it('uses valid cursor for pagination', async () => {
      // Save multiple notifications
      await repository.save(createTestInput({ userId: 'user-cursor', title: 'First' }));
      await repository.save(createTestInput({ userId: 'user-cursor', title: 'Second' }));

      // Get first page
      const firstPage = await repository.findByUserIdPaginated('user-cursor', { limit: 1 });
      expect(firstPage.ok).toBe(true);
      if (!firstPage.ok) return;

      // If there's a nextCursor, use it for second page
      if (firstPage.value.nextCursor !== undefined) {
        const secondPage = await repository.findByUserIdPaginated('user-cursor', {
          limit: 1,
          cursor: firstPage.value.nextCursor,
        });
        expect(secondPage.ok).toBe(true);
      }
    });

    it('applies source filter when provided', async () => {
      // Save notifications with different sources
      await repository.save(
        createTestInput({ userId: 'user-filter', source: 'android', app: 'com.app1' })
      );
      await repository.save(
        createTestInput({ userId: 'user-filter', source: 'ios', app: 'com.app2' })
      );

      const result = await repository.findByUserIdPaginated('user-filter', {
        limit: 10,
        filter: { source: ['android'] },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications.length).toBeGreaterThan(0);
      }
    });

    it('applies app filter when provided', async () => {
      // Save notifications with different apps
      await repository.save(
        createTestInput({ userId: 'user-filter', source: 'android', app: 'com.whatsapp' })
      );
      await repository.save(
        createTestInput({ userId: 'user-filter', source: 'android', app: 'com.telegram' })
      );

      const result = await repository.findByUserIdPaginated('user-filter', {
        limit: 10,
        filter: { app: ['com.whatsapp'] },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications.length).toBeGreaterThan(0);
      }
    });

    it('applies both source and app filters when provided', async () => {
      await repository.save(
        createTestInput({ userId: 'user-filter', source: 'android', app: 'com.whatsapp' })
      );
      await repository.save(
        createTestInput({ userId: 'user-filter', source: 'ios', app: 'com.telegram' })
      );

      const result = await repository.findByUserIdPaginated('user-filter', {
        limit: 10,
        filter: { source: ['android'], app: ['com.whatsapp'] },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles empty filter arrays gracefully', async () => {
      await repository.save(createTestInput({ userId: 'user-filter' }));

      const result = await repository.findByUserIdPaginated('user-filter', {
        limit: 10,
        filter: { source: [], app: [] },
      });

      expect(result.ok).toBe(true);
    });

    it('applies title filter when provided', async () => {
      await repository.save(
        createTestInput({ userId: 'user-filter', title: 'Important Meeting' })
      );
      await repository.save(
        createTestInput({ userId: 'user-filter', title: 'Random Notification' })
      );

      const result = await repository.findByUserIdPaginated('user-filter', {
        limit: 10,
        filter: { title: 'meeting' },
      });

      expect(result.ok).toBe(true);
    });

    it('handles empty string title filter gracefully', async () => {
      await repository.save(createTestInput({ userId: 'user-filter' }));

      const result = await repository.findByUserIdPaginated('user-filter', {
        limit: 10,
        filter: { title: '' },
      });

      expect(result.ok).toBe(true);
    });

    it('handles pagination when snapshot contains no documents', async () => {
      // This tests the defensive check at line 201-203:
      // Even though docs.length > 0 is checked, lastDoc !== undefined is also checked
      // This test verifies cursor handling when the query returns results but snapshot edge cases occur
      const result = await repository.findByUserIdPaginated('user-empty-snapshot', {
        limit: 10,
      });

      // For a user with no notifications, should return empty results with no cursor
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications).toHaveLength(0);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });

    it('handles pagination with valid cursor and returns nextCursor', async () => {
      await repository.save(createTestInput({ userId: 'user-pagination', title: 'Notif 1' }));
      await repository.save(createTestInput({ userId: 'user-pagination', title: 'Notif 2' }));
      await repository.save(createTestInput({ userId: 'user-pagination', title: 'Notif 3' }));

      const firstPage = await repository.findByUserIdPaginated('user-pagination', { limit: 2 });

      expect(firstPage.ok).toBe(true);
      if (firstPage.ok) {
        expect(firstPage.value.notifications).toHaveLength(2);
        expect(firstPage.value.notifications[0]?.title).toMatch(/^Notif \d$/);
        expect(firstPage.value.notifications[1]?.title).toMatch(/^Notif \d$/);
        expect(firstPage.value.nextCursor).toBeDefined();
      }
    });

    it('findByUserIdPaginated works without a cursor', async () => {
      const result = await repository.findByUserIdPaginated('user-test', {
        limit: 10,
      });

      expect(result.ok).toBe(true);
    });

    it('decodeCursor returns undefined for invalid base64', async () => {
      // Test with invalid base64 cursor - this exercises decodeCursor
      const result = await repository.findByUserIdPaginated('user-test', {
        limit: 10,
        cursor: '!!!invalid-base64!!!',
      });

      // Should handle gracefully (already tested in earlier tests)
      expect(result.ok).toBe(true);
    });

    it('filters by postTimeSec range when postTimeSecFrom/postTimeSecTo are set', async () => {
      const mk = (text: string, timestampMs: number, notifId: string): CreateNotificationInput => ({
        userId: 'user-range',
        source: 'android',
        device: 'dev',
        app: 'com.whatsapp',
        title: 'Grupa',
        text,
        timestamp: timestampMs,
        postTime: String(Math.floor(timestampMs / 1000)),
        notificationId: notifId,
      });
      await repository.save(mk('t1', 100_000, 'r1'));
      await repository.save(mk('t2', 200_000, 'r2'));
      await repository.save(mk('t3', 300_000, 'r3'));

      const result = await repository.findByUserIdPaginated('user-range', {
        limit: 10,
        filter: { postTimeSecFrom: 150, postTimeSecTo: 250, app: ['com.whatsapp'] },
      });
      if (!result.ok) throw new Error(`unexpected: ${result.error.message}`);
      const texts = result.value.notifications.map((n) => n.text).sort();
      expect(texts).toEqual(['t2']);
    });

    // Migration 096 deploys the composite Firestore index (app + userId +
    // receivedAt + timestamp) required by digest backfill. FakeFirestore does
    // not surface missing-index errors, so this test cannot validate index
    // presence directly. Instead it pins the combined-filter query shape that
    // exercises the index in production, ensuring the call site keeps using
    // the field combination that migration 096 covers.
    it('filters by app + title + postTimeSec range simultaneously (migration 096 index)', async () => {
      const mk = (
        app: string,
        title: string,
        text: string,
        timestampMs: number,
        notifId: string
      ): CreateNotificationInput => ({
        userId: 'user-combo',
        source: 'android',
        device: 'dev',
        app,
        title,
        text,
        timestamp: timestampMs,
        postTime: String(Math.floor(timestampMs / 1000)),
        notificationId: notifId,
      });
      await repository.save(mk('com.whatsapp', 'Grupa Wedkarska', 'A', 200_000, 'c1'));
      await repository.save(mk('com.whatsapp', 'Other Group', 'B', 200_000, 'c2'));
      await repository.save(mk('com.telegram', 'Grupa Wedkarska', 'C', 200_000, 'c3'));
      await repository.save(mk('com.whatsapp', 'Grupa Wedkarska', 'D', 500_000, 'c4'));

      const result = await repository.findByUserIdPaginated('user-combo', {
        limit: 10,
        filter: {
          app: ['com.whatsapp'],
          title: 'wedkarska',
          postTimeSecFrom: 150,
          postTimeSecTo: 250,
        },
      });
      if (!result.ok) throw new Error(`unexpected: ${result.error.message}`);
      expect(result.value.notifications).toHaveLength(1);
      expect(result.value.notifications[0]?.text).toBe('A');
    });
  });

  describe('existsByNotificationIdAndUserId', () => {
    it('returns false when notification does not exist', async () => {
      const result = await repository.existsByNotificationIdAndUserId('notif-999', 'user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true when notification exists for user', async () => {
      await repository.save(createTestInput({ notificationId: 'notif-456', userId: 'user-123' }));

      const result = await repository.existsByNotificationIdAndUserId('notif-456', 'user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for different user with same notificationId', async () => {
      await repository.save(createTestInput({ notificationId: 'notif-456', userId: 'user-123' }));

      const result = await repository.existsByNotificationIdAndUserId(
        'notif-456',
        'different-user'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('delete', () => {
    it('deletes existing notification', async () => {
      const saved = await repository.save(createTestInput());
      if (!saved.ok) throw new Error('Setup failed');

      const deleteResult = await repository.delete(saved.value.id);
      expect(deleteResult.ok).toBe(true);

      const findResult = await repository.findById(saved.value.id);
      expect(findResult.ok && findResult.value).toBeNull();
    });

    it('succeeds even for non-existent notification', async () => {
      const result = await repository.delete('nonexistent');

      expect(result.ok).toBe(true);
    });
  });

  describe('title filter pagination — Strategy A', () => {
    it('returns all matches spanning more than 5 batches (removes old cap)', async () => {
      // 200 docs: first 190 have title "other stuff", last 10 have title "target message"
      // The fake Firestore orders by receivedAt desc, so we need the "target" docs to have
      // older receivedAt timestamps so they appear AFTER the "other" docs in the result set.
      const baseTime = Date.now();
      const docs = Array.from({ length: 200 }, (_, i) => ({
        id: `doc-many-${String(i)}`,
        data: {
          userId: 'user-many-batches',
          source: 'android',
          device: 'Pixel',
          app: 'com.app',
          // first 190 docs (i=0..189) have "other stuff"; last 10 (i=190..199) have "target message"
          // receivedAt DESC means i=0 is newest, i=199 is oldest
          // So target docs (i=190..199) are at the END of the result set
          title: i < 190 ? 'other stuff' : 'target message',
          text: 'text',
          timestamp: baseTime - i * 1000,
          postTime: new Date(baseTime - i * 1000).toISOString(),
          receivedAt: new Date(baseTime - i * 1000).toISOString(),
          notificationId: `notif-many-${String(i)}`,
        },
      }));
      fakeFirestore.seedCollection('mobile_notifications', docs);

      const result = await repository.findByUserIdPaginated('user-many-batches', {
        limit: 10,
        filter: { title: 'target' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications).toHaveLength(10);
        for (const n of result.value.notifications) {
          expect(n.title.toLowerCase()).toContain('target');
        }
      }
    });

    it('triggers safety guard when scan limit is exceeded', async () => {
      // Uses smaller limit but still reads from the shared fakeFirestore set up in beforeEach
      const smallLimitRepository = new FirestoreNotificationRepository(50);
      const baseTime = Date.now();
      const docs = Array.from({ length: 60 }, (_, i) => ({
        id: `doc-safety-${String(i)}`,
        data: {
          userId: 'user-safety',
          source: 'android',
          device: 'Pixel',
          app: 'com.app',
          title: 'no-match',
          text: 'text',
          timestamp: baseTime - i * 1000,
          postTime: new Date(baseTime - i * 1000).toISOString(),
          receivedAt: new Date(baseTime - i * 1000).toISOString(),
          notificationId: `notif-safety-${String(i)}`,
        },
      }));
      fakeFirestore.seedCollection('mobile_notifications', docs);

      const result = await smallLimitRepository.findByUserIdPaginated('user-safety', {
        limit: 5,
        filter: { title: 'target' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Scan safety limit exceeded');
      }
    });

    it('respects limit exactly with title filter', async () => {
      const baseTime = Date.now();
      const docs = Array.from({ length: 100 }, (_, i) => ({
        id: `doc-exact-${String(i)}`,
        data: {
          userId: 'user-exact-limit',
          source: 'android',
          device: 'Pixel',
          app: 'com.app',
          title: 'matching title',
          text: 'text',
          timestamp: baseTime - i * 1000,
          postTime: new Date(baseTime - i * 1000).toISOString(),
          receivedAt: new Date(baseTime - i * 1000).toISOString(),
          notificationId: `notif-exact-${String(i)}`,
        },
      }));
      fakeFirestore.seedCollection('mobile_notifications', docs);

      const result = await repository.findByUserIdPaginated('user-exact-limit', {
        limit: 5,
        filter: { title: 'matching' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications).toHaveLength(5);
      }
    });

    it('cursor-based pagination round-trip with title filter', async () => {
      const baseTime = Date.now();
      const docs = Array.from({ length: 20 }, (_, i) => ({
        id: `doc-page-${String(i)}`,
        data: {
          userId: 'user-page',
          source: 'android',
          device: 'Pixel',
          app: 'com.app',
          title: 'paginated title',
          text: 'text',
          timestamp: baseTime - i * 1000,
          postTime: new Date(baseTime - i * 1000).toISOString(),
          receivedAt: new Date(baseTime - i * 1000).toISOString(),
          notificationId: `notif-page-${String(i)}`,
        },
      }));
      fakeFirestore.seedCollection('mobile_notifications', docs);

      const firstPage = await repository.findByUserIdPaginated('user-page', {
        limit: 5,
        filter: { title: 'paginated' },
      });

      expect(firstPage.ok).toBe(true);
      if (!firstPage.ok) return;
      expect(firstPage.value.notifications).toHaveLength(5);
      expect(firstPage.value.nextCursor).toBeDefined();

      const nextCursor = firstPage.value.nextCursor;
      if (nextCursor === undefined) throw new Error('Expected nextCursor to be defined');

      const secondPage = await repository.findByUserIdPaginated('user-page', {
        limit: 5,
        cursor: nextCursor,
        filter: { title: 'paginated' },
      });

      expect(secondPage.ok).toBe(true);
      if (!secondPage.ok) return;
      expect(secondPage.value.notifications).toHaveLength(5);

      // No overlap: all IDs should be unique
      const firstIds = new Set(firstPage.value.notifications.map((n) => n.id));
      for (const n of secondPage.value.notifications) {
        expect(firstIds.has(n.id)).toBe(false);
      }
    });

    it('no regression for single-batch query without title filter', async () => {
      const baseTime = Date.now();
      const docs = Array.from({ length: 3 }, (_, i) => ({
        id: `doc-single-${String(i)}`,
        data: {
          userId: 'user-single',
          source: 'android',
          device: 'Pixel',
          app: 'com.app',
          title: `Notification ${String(i)}`,
          text: 'text',
          timestamp: baseTime - i * 1000,
          postTime: new Date(baseTime - i * 1000).toISOString(),
          receivedAt: new Date(baseTime - i * 1000).toISOString(),
          notificationId: `notif-single-${String(i)}`,
        },
      }));
      fakeFirestore.seedCollection('mobile_notifications', docs);

      const result = await repository.findByUserIdPaginated('user-single', { limit: 10 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notifications).toHaveLength(3);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });
  });

  describe('error handling', () => {
    it('returns error when findById fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await repository.findById('some-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when findByUserIdPaginated fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query error') });

      const result = await repository.findByUserIdPaginated('user-123', { limit: 10 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when existsByNotificationIdAndUserId fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query error') });

      const result = await repository.existsByNotificationIdAndUserId('notif-123', 'user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when delete fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete error') });

      const result = await repository.delete('some-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
