/**
 * Tests for Firestore notification filters repository.
 * Note: Tests for addOption/addOptions are limited because FakeFirestore
 * doesn't fully support FieldValue.arrayUnion. These methods are tested
 * indirectly via integration tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { FirestoreNotificationFiltersRepository } from '../../infra/firestore/notificationFiltersRepository.js';
import type { NotificationFiltersRepository } from '../../domain/filters/index.js';

describe('FirestoreNotificationFiltersRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: NotificationFiltersRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = new FirestoreNotificationFiltersRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getByUserId', () => {
    it('returns null for non-existent user', async () => {
      const result = await repository.getByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns filters data after addSavedFilter creates document', async () => {
      await repository.addSavedFilter('user-123', { name: 'Test Filter' });

      const result = await repository.getByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.options.app).toEqual([]);
        expect(result.value.options.device).toEqual([]);
        expect(result.value.options.source).toEqual([]);
        expect(result.value.savedFilters).toHaveLength(1);
      }
    });

    it('handles partial document data gracefully', async () => {
      const db = fakeFirestore as unknown as {
        collection: (name: string) => {
          doc: (id: string) => { set: (data: object) => Promise<void> };
        };
      };
      await db.collection('mobile_notifications_filters').doc('user-partial').set({
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repository.getByUserId('user-partial');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.options.app).toEqual([]);
        expect(result.value.options.device).toEqual([]);
        expect(result.value.options.source).toEqual([]);
        expect(result.value.savedFilters).toEqual([]);
      }
    });
  });

  describe('addOption', () => {
    it('calls without error for new user', async () => {
      const result = await repository.addOption('user-123', 'app', 'com.whatsapp');
      expect(result.ok).toBe(true);
    });

    it('calls without error for device field', async () => {
      const result = await repository.addOption('user-123', 'device', 'Pixel 7');
      expect(result.ok).toBe(true);
    });

    it('calls without error for source field', async () => {
      const result = await repository.addOption('user-123', 'source', 'tasker');
      expect(result.ok).toBe(true);
    });
  });

  describe('addOptions', () => {
    it('calls without error with multiple options', async () => {
      const result = await repository.addOptions('user-123', {
        app: 'com.whatsapp',
        device: 'Pixel 7',
      });
      expect(result.ok).toBe(true);
    });

    it('calls without error with all option types', async () => {
      const result = await repository.addOptions('user-123', {
        app: 'com.gmail',
        device: 'Samsung Galaxy',
        source: 'mail',
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('addSavedFilter', () => {
    it('creates saved filter for new user', async () => {
      const result = await repository.addSavedFilter('user-123', { name: 'My Filter' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.name).toBe('My Filter');
        expect(result.value.createdAt).toBeDefined();
      }
    });

    it('creates saved filter with app', async () => {
      const result = await repository.addSavedFilter('user-123', {
        name: 'WhatsApp Only',
        app: 'com.whatsapp',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('WhatsApp Only');
        expect(result.value.app).toBe('com.whatsapp');
      }
    });

    it('creates saved filter with device', async () => {
      const result = await repository.addSavedFilter('user-123', {
        name: 'Pixel Only',
        device: 'Pixel 7',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.device).toBe('Pixel 7');
      }
    });

    it('creates saved filter with source', async () => {
      const result = await repository.addSavedFilter('user-123', {
        name: 'Mail Only',
        source: 'mail',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.source).toBe('mail');
      }
    });

    it('creates saved filter with title', async () => {
      const result = await repository.addSavedFilter('user-123', {
        name: 'Meetings',
        title: 'meeting',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('meeting');
      }
    });

    it('creates saved filter with all optional fields', async () => {
      const result = await repository.addSavedFilter('user-123', {
        name: 'Complex Filter',
        app: 'com.gmail',
        device: 'Pixel 7',
        source: 'mail',
        title: 'meeting',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.app).toBe('com.gmail');
        expect(result.value.device).toBe('Pixel 7');
        expect(result.value.source).toBe('mail');
        expect(result.value.title).toBe('meeting');
      }
    });

    it('returns filter with unique id', async () => {
      const filter1 = await repository.addSavedFilter('user-123', { name: 'Filter 1' });
      const filter2 = await repository.addSavedFilter('user-456', { name: 'Filter 2' });

      expect(filter1.ok).toBe(true);
      expect(filter2.ok).toBe(true);
      if (filter1.ok && filter2.ok) {
        expect(filter1.value.id).not.toBe(filter2.value.id);
      }
    });
  });

  describe('deleteSavedFilter', () => {
    it('returns NOT_FOUND for non-existent user', async () => {
      const result = await repository.deleteSavedFilter('user-123', 'filter-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Filter data not found for user');
      }
    });

    it('returns NOT_FOUND for non-existent filter', async () => {
      const saveResult = await repository.addSavedFilter('user-123', { name: 'Existing Filter' });
      if (!saveResult.ok) throw new Error('Setup failed');

      const result = await repository.deleteSavedFilter(
        'user-123',
        'nonexistent-id-' + saveResult.value.id.slice(0, 4)
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Saved filter not found');
      }
    });

    it('deletes existing filter', async () => {
      const saveResult = await repository.addSavedFilter('user-123', { name: 'To Delete' });
      if (!saveResult.ok) throw new Error('Setup failed');

      const result = await repository.deleteSavedFilter('user-123', saveResult.value.id);

      expect(result.ok).toBe(true);

      const getResult = await repository.getByUserId('user-123');
      expect(getResult.ok && getResult.value?.savedFilters).toHaveLength(0);
    });

    it('throws error when deleting from document with no savedFilters array', async () => {
      const db = fakeFirestore as unknown as {
        collection: (name: string) => {
          doc: (id: string) => { set: (data: object) => Promise<void> };
        };
      };
      await db
        .collection('mobile_notifications_filters')
        .doc('user-empty')
        .set({
          options: { app: [], device: [], source: [] },
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });

      const result = await repository.deleteSavedFilter('user-empty', 'any-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Saved filter not found');
      }
    });
  });
});
