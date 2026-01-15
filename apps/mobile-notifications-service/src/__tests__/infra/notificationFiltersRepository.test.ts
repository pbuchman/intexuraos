/**
 * Tests for Firestore notification filters repository.
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

    it('uses fallback timestamp when updatedAt is missing from document', async () => {
      const db = fakeFirestore as unknown as {
        collection: (name: string) => {
          doc: (id: string) => { set: (data: object) => Promise<void> };
        };
      };
      await db
        .collection('mobile_notifications_filters')
        .doc('user-no-updatedAt')
        .set({
          options: { app: ['com.test'], device: [], source: [] },
          savedFilters: [],
          createdAt: '2024-01-01T00:00:00.000Z',
        });

      const result = await repository.getByUserId('user-no-updatedAt');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.updatedAt).toBeDefined();
        expect(result.value.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });
  });

  describe('addOption', () => {
    it('adds option to empty user document', async () => {
      const addResult = await repository.addOption('user-123', 'app', 'com.whatsapp');
      expect(addResult.ok).toBe(true);

      const getResult = await repository.getByUserId('user-123');
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value) {
        expect(getResult.value.options.app).toContain('com.whatsapp');
      }
    });

    it('adds device option and preserves it', async () => {
      await repository.addOption('user-123', 'device', 'Pixel 7');

      const result = await repository.getByUserId('user-123');
      expect(result.ok && result.value?.options.device).toContain('Pixel 7');
    });

    it('adds source option and preserves it', async () => {
      await repository.addOption('user-123', 'source', 'tasker');

      const result = await repository.getByUserId('user-123');
      expect(result.ok && result.value?.options.source).toContain('tasker');
    });

    it('does not duplicate existing option value', async () => {
      await repository.addOption('user-123', 'app', 'com.whatsapp');
      await repository.addOption('user-123', 'app', 'com.whatsapp');

      const result = await repository.getByUserId('user-123');
      expect(result.ok && result.value?.options.app).toEqual(['com.whatsapp']);
    });
  });

  describe('addOptions', () => {
    it('adds multiple options and stores them in nested structure', async () => {
      const addResult = await repository.addOptions('user-123', {
        app: 'com.whatsapp',
        device: 'Pixel 7',
      });
      expect(addResult.ok).toBe(true);

      const getResult = await repository.getByUserId('user-123');
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value) {
        expect(getResult.value.options.app).toContain('com.whatsapp');
        expect(getResult.value.options.device).toContain('Pixel 7');
      }
    });

    it('adds all option types at once', async () => {
      await repository.addOptions('user-123', {
        app: 'com.gmail',
        device: 'Samsung Galaxy',
        source: 'mail',
      });

      const result = await repository.getByUserId('user-123');
      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.options.app).toContain('com.gmail');
        expect(result.value.options.device).toContain('Samsung Galaxy');
        expect(result.value.options.source).toContain('mail');
      }
    });

    it('merges with existing options', async () => {
      await repository.addOption('user-123', 'app', 'com.whatsapp');
      await repository.addOptions('user-123', { app: 'com.gmail', device: 'Pixel 7' });

      const result = await repository.getByUserId('user-123');
      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.options.app).toContain('com.whatsapp');
        expect(result.value.options.app).toContain('com.gmail');
        expect(result.value.options.device).toContain('Pixel 7');
      }
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
        app: ['com.whatsapp'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('WhatsApp Only');
        expect(result.value.app).toEqual(['com.whatsapp']);
      }
    });

    it('creates saved filter with device', async () => {
      const result = await repository.addSavedFilter('user-123', {
        name: 'Pixel Only',
        device: ['Pixel 7'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.device).toEqual(['Pixel 7']);
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
        app: ['com.gmail'],
        device: ['Pixel 7'],
        source: 'mail',
        title: 'meeting',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.app).toEqual(['com.gmail']);
        expect(result.value.device).toEqual(['Pixel 7']);
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

    it('adds second saved filter to existing user document', async () => {
      const firstFilter = await repository.addSavedFilter('user-existing', { name: 'First Filter' });
      expect(firstFilter.ok).toBe(true);

      const secondFilter = await repository.addSavedFilter('user-existing', { name: 'Second Filter' });
      expect(secondFilter.ok).toBe(true);

      const result = await repository.getByUserId('user-existing');
      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.savedFilters).toHaveLength(2);
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

  describe('error handling: Firestore failures', () => {
    it('returns INTERNAL_ERROR when getByUserId and Firestore get() fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Firestore down') });

      const result = await repository.getByUserId('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns INTERNAL_ERROR when addOption and Firestore set() fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Network error') });

      const result = await repository.addOption('user-123', 'app', 'com.test');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns INTERNAL_ERROR when addOptions and Firestore set() fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Network error') });

      const result = await repository.addOptions('user-123', {
        app: 'com.test',
        device: 'Pixel 7',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns INTERNAL_ERROR when addSavedFilter and Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failure') });

      const result = await repository.addSavedFilter('user-123', { name: 'Test' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns INTERNAL_ERROR when deleteSavedFilter and Firestore get() fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await repository.deleteSavedFilter('user-123', 'filter-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
