import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreCompositeFeedRepository } from '../infra/firestore/compositeFeedRepository.js';

describe('FirestoreCompositeFeedRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repo: FirestoreCompositeFeedRepository;
  const userId = 'user-123';

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repo = new FirestoreCompositeFeedRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('create', () => {
    it('creates a composite feed and returns it', async () => {
      const result = await repo.create(userId, 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: ['src-1', 'src-2'],
        notificationFilters: [{ id: 'f1', name: 'Filter 1', app: ['WhatsApp'] }],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('Test Feed');
        expect(result.value.purpose).toBe('Test purpose');
        expect(result.value.userId).toBe(userId);
        expect(result.value.staticSourceIds).toEqual(['src-1', 'src-2']);
        expect(result.value.notificationFilters).toHaveLength(1);
        expect(result.value.id).toBeDefined();
      }
    });

    it('sets createdAt and updatedAt timestamps', async () => {
      const result = await repo.create(userId, 'Test', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const result = await repo.create(userId, 'Test', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to create composite feed');
      }

      fakeFirestore.configure({});
    });
  });

  describe('getById', () => {
    it('returns composite feed when found', async () => {
      const createResult = await repo.create(userId, 'My Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.getById(feed?.id ?? '', userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.name).toBe('My Feed');
      }
    });

    it('returns null for non-existent feed', async () => {
      const result = await repo.getById('non-existent-id', userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null when userId does not match', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.getById(feed?.id ?? '', 'other-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repo.getById('any-id', userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to get composite feed');
      }

      fakeFirestore.configure({});
    });
  });

  describe('listByUserId', () => {
    it('returns all feeds for user', async () => {
      await repo.create(userId, 'Feed 1', {
        purpose: 'Purpose 1',
        staticSourceIds: [],
        notificationFilters: [],
      });
      await repo.create(userId, 'Feed 2', {
        purpose: 'Purpose 2',
        staticSourceIds: [],
        notificationFilters: [],
      });
      await repo.create('other-user', 'Other Feed', {
        purpose: 'Other',
        staticSourceIds: [],
        notificationFilters: [],
      });

      const result = await repo.listByUserId(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('returns empty array when no feeds', async () => {
      const result = await repo.listByUserId(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('orders feeds by createdAt descending', async () => {
      await repo.create(userId, 'First', {
        purpose: 'First',
        staticSourceIds: [],
        notificationFilters: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await repo.create(userId, 'Second', {
        purpose: 'Second',
        staticSourceIds: [],
        notificationFilters: [],
      });

      const result = await repo.listByUserId(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.name).toBe('Second');
        expect(result.value[1]?.name).toBe('First');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repo.listByUserId(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to list composite feeds');
      }

      fakeFirestore.configure({});
    });
  });

  describe('update', () => {
    it('updates purpose', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Original purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.update(feed?.id ?? '', userId, {
        purpose: 'Updated purpose',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.purpose).toBe('Updated purpose');
      }
    });

    it('updates staticSourceIds', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: ['old-1'],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.update(feed?.id ?? '', userId, {
        staticSourceIds: ['new-1', 'new-2'],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.staticSourceIds).toEqual(['new-1', 'new-2']);
      }
    });

    it('updates notificationFilters', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [{ id: 'old', name: 'Old' }],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.update(feed?.id ?? '', userId, {
        notificationFilters: [{ id: 'new', name: 'New Filter', app: ['WhatsApp'] }],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.notificationFilters).toHaveLength(1);
        expect(result.value.notificationFilters[0]?.name).toBe('New Filter');
      }
    });

    it('updates updatedAt timestamp', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;
      const originalUpdatedAt = feed?.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await repo.update(feed?.id ?? '', userId, {
        purpose: 'Updated',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt?.getTime() ?? 0);
      }
    });

    it('returns error for non-existent feed', async () => {
      const result = await repo.update('non-existent', userId, {
        purpose: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Composite feed not found');
      }
    });

    it('returns error when userId does not match', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.update(feed?.id ?? '', 'other-user', {
        purpose: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Composite feed not found');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.update('any-id', userId, {
        purpose: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to update composite feed');
      }

      fakeFirestore.configure({});
    });
  });

  describe('delete', () => {
    it('deletes composite feed', async () => {
      const createResult = await repo.create(userId, 'To Delete', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.delete(feed?.id ?? '', userId);

      expect(result.ok).toBe(true);

      const getResult = await repo.getById(feed?.id ?? '', userId);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });

    it('returns error for non-existent feed', async () => {
      const result = await repo.delete('non-existent', userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Composite feed not found');
      }
    });

    it('returns error when userId does not match', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.delete(feed?.id ?? '', 'other-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Composite feed not found');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await repo.delete('any-id', userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to delete composite feed');
      }

      fakeFirestore.configure({});
    });
  });

  describe('listAll', () => {
    it('returns all feeds regardless of user', async () => {
      await repo.create(userId, 'Feed 1', {
        purpose: 'Purpose 1',
        staticSourceIds: [],
        notificationFilters: [],
      });
      await repo.create('other-user', 'Feed 2', {
        purpose: 'Purpose 2',
        staticSourceIds: [],
        notificationFilters: [],
      });

      const result = await repo.listAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('returns empty array when no feeds exist', async () => {
      const result = await repo.listAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repo.listAll();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to list all composite feeds');
      }

      fakeFirestore.configure({});
    });
  });

  describe('findByStaticSourceId', () => {
    it('finds feeds containing the source id', async () => {
      await repo.create(userId, 'Feed with source', {
        purpose: 'Purpose',
        staticSourceIds: ['target-source', 'other'],
        notificationFilters: [],
      });
      await repo.create(userId, 'Feed without source', {
        purpose: 'Purpose',
        staticSourceIds: ['different'],
        notificationFilters: [],
      });

      const result = await repo.findByStaticSourceId(userId, 'target-source');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.name).toBe('Feed with source');
      }
    });

    it('returns empty array when no feeds contain source', async () => {
      await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: ['other-source'],
        notificationFilters: [],
      });

      const result = await repo.findByStaticSourceId(userId, 'target-source');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('only returns feeds for the specified user', async () => {
      await repo.create(userId, 'User feed', {
        purpose: 'Purpose',
        staticSourceIds: ['target-source'],
        notificationFilters: [],
      });
      await repo.create('other-user', 'Other feed', {
        purpose: 'Purpose',
        staticSourceIds: ['target-source'],
        notificationFilters: [],
      });

      const result = await repo.findByStaticSourceId(userId, 'target-source');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.userId).toBe(userId);
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repo.findByStaticSourceId(userId, 'target-source');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to find composite feeds');
      }

      fakeFirestore.configure({});
    });
  });

  describe('updateDataInsights', () => {
    it('updates data insights for composite feed', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const dataInsights = [
        {
          id: 'insight-1',
          title: 'Test Insight',
          description: 'A test insight',
          trackableMetric: 'test-metric',
          suggestedChartType: 'C1' as const,
          generatedAt: new Date().toISOString(),
        },
      ];

      const result = await repo.updateDataInsights(feed?.id ?? '', userId, dataInsights);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dataInsights).toEqual(dataInsights);
      }
    });

    it('updates updatedAt timestamp', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;
      const originalUpdatedAt = feed?.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await repo.updateDataInsights(feed?.id ?? '', userId, []);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt?.getTime() ?? 0);
      }
    });

    it('returns error for non-existent feed', async () => {
      const result = await repo.updateDataInsights('non-existent', userId, []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Composite feed not found');
      }
    });

    it('returns error when userId does not match', async () => {
      const createResult = await repo.create(userId, 'Feed', {
        purpose: 'Purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feed = createResult.ok ? createResult.value : null;

      const result = await repo.updateDataInsights(feed?.id ?? '', 'other-user', []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Composite feed not found');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.updateDataInsights('any-id', userId, []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to update data insights');
      }

      fakeFirestore.configure({});
    });
  });
});
