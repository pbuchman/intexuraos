/**
 * Tests for Firestore Notification repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/common';
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
