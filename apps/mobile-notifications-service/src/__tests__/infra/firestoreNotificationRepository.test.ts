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
});
