import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreVisualizationRepository } from '../infra/firestore/visualizationRepository.js';
import type { VisualizationType, VisualizationStatus } from '../domain/visualization/index.js';

describe('FirestoreVisualizationRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repo: FirestoreVisualizationRepository;
  const userId = 'user-123';
  const feedId = 'feed-456';

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repo = new FirestoreVisualizationRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('create', () => {
    it('creates a visualization and returns it', async () => {
      const result = await repo.create(feedId, userId, {
        title: 'Test Visualization',
        description: 'Test description',
        type: 'chart' as VisualizationType,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Test Visualization');
        expect(result.value.description).toBe('Test description');
        expect(result.value.type).toBe('chart');
        expect(result.value.feedId).toBe(feedId);
        expect(result.value.userId).toBe(userId);
        expect(result.value.status).toBe('pending');
        expect(result.value.htmlContent).toBeNull();
        expect(result.value.errorMessage).toBeNull();
        expect(result.value.renderErrorCount).toBe(0);
        expect(result.value.lastGeneratedAt).toBeNull();
        expect(result.value.id).toBeDefined();
      }
    });

    it('sets createdAt and updatedAt timestamps', async () => {
      const result = await repo.create(feedId, userId, {
        title: 'Test',
        description: 'Description',
        type: 'table' as VisualizationType,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const result = await repo.create(feedId, userId, {
        title: 'Test',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to create visualization');
      }

      fakeFirestore.configure({});
    });
  });

  describe('getById', () => {
    it('returns visualization when found', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'My Visualization',
        description: 'Description',
        type: 'summary' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.getById(viz?.id ?? '', feedId, userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.title).toBe('My Visualization');
      }
    });

    it('returns null for non-existent visualization', async () => {
      const result = await repo.getById('non-existent-id', feedId, userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null when feedId does not match', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Visualization',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.getById(viz?.id ?? '', 'other-feed', userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null when userId does not match', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Visualization',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.getById(viz?.id ?? '', feedId, 'other-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repo.getById('any-id', feedId, userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to get visualization');
      }

      fakeFirestore.configure({});
    });
  });

  describe('listByFeedId', () => {
    it('returns all visualizations for feed and user', async () => {
      await repo.create(feedId, userId, {
        title: 'Viz 1',
        description: 'Desc 1',
        type: 'chart' as VisualizationType,
      });
      await repo.create(feedId, userId, {
        title: 'Viz 2',
        description: 'Desc 2',
        type: 'table' as VisualizationType,
      });
      await repo.create('other-feed', userId, {
        title: 'Other Viz',
        description: 'Other',
        type: 'chart' as VisualizationType,
      });

      const result = await repo.listByFeedId(feedId, userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('returns empty array when no visualizations', async () => {
      const result = await repo.listByFeedId(feedId, userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('orders visualizations by createdAt descending', async () => {
      await repo.create(feedId, userId, {
        title: 'First',
        description: 'First',
        type: 'chart' as VisualizationType,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await repo.create(feedId, userId, {
        title: 'Second',
        description: 'Second',
        type: 'chart' as VisualizationType,
      });

      const result = await repo.listByFeedId(feedId, userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]?.title).toBe('Second');
        expect(result.value[1]?.title).toBe('First');
      }
    });

    it('only returns visualizations for the specified user', async () => {
      await repo.create(feedId, userId, {
        title: 'User viz',
        description: 'Desc',
        type: 'chart' as VisualizationType,
      });
      await repo.create(feedId, 'other-user', {
        title: 'Other viz',
        description: 'Desc',
        type: 'chart' as VisualizationType,
      });

      const result = await repo.listByFeedId(feedId, userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.userId).toBe(userId);
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repo.listByFeedId(feedId, userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to list visualizations');
      }

      fakeFirestore.configure({});
    });
  });

  describe('update', () => {
    it('updates title', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Original',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        title: 'Updated',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated');
      }
    });

    it('updates description', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Original',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        description: 'Updated',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.description).toBe('Updated');
      }
    });

    it('updates type', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        type: 'table' as VisualizationType,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe('table');
      }
    });

    it('updates status', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        status: 'ready' as VisualizationStatus,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('ready');
      }
    });

    it('updates htmlContent', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        htmlContent: '<html>Test</html>',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.htmlContent).toBe('<html>Test</html>');
      }
    });

    it('updates errorMessage', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        errorMessage: 'Test error',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.errorMessage).toBe('Test error');
      }
    });

    it('updates renderErrorCount', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        renderErrorCount: 5,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.renderErrorCount).toBe(5);
      }
    });

    it('updates lastGeneratedAt', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const newDate = new Date('2025-01-01T00:00:00Z');
      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        lastGeneratedAt: newDate,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.lastGeneratedAt).toEqual(newDate);
      }
    });

    it('updates updatedAt timestamp', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;
      const originalUpdatedAt = viz?.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        title: 'Updated',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.updatedAt.getTime()).toBeGreaterThan(
          originalUpdatedAt?.getTime() ?? 0
        );
      }
    });

    it('updates multiple fields', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Original',
        description: 'Original desc',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, userId, {
        title: 'Updated',
        status: 'ready' as VisualizationStatus,
        htmlContent: '<html>Content</html>',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated');
        expect(result.value.status).toBe('ready');
        expect(result.value.htmlContent).toBe('<html>Content</html>');
      }
    });

    it('returns error for non-existent visualization', async () => {
      const result = await repo.update('non-existent', feedId, userId, {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('returns error when feedId does not match', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', 'other-feed', userId, {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('returns error when userId does not match', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.update(viz?.id ?? '', feedId, 'other-user', {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repo.update('any-id', feedId, userId, {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to update visualization');
      }

      fakeFirestore.configure({});
    });
  });

  describe('delete', () => {
    it('deletes visualization', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'To Delete',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.delete(viz?.id ?? '', feedId, userId);

      expect(result.ok).toBe(true);

      const getResult = await repo.getById(viz?.id ?? '', feedId, userId);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toBeNull();
      }
    });

    it('returns error for non-existent visualization', async () => {
      const result = await repo.delete('non-existent', feedId, userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('returns error when feedId does not match', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.delete(viz?.id ?? '', 'other-feed', userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('returns error when userId does not match', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.delete(viz?.id ?? '', feedId, 'other-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await repo.delete('any-id', feedId, userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to delete visualization');
      }

      fakeFirestore.configure({});
    });
  });

  describe('incrementRenderErrorCount', () => {
    it('increments render error count', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.incrementRenderErrorCount(viz?.id ?? '', feedId, userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1);
      }
    });

    it('increments from existing count', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      await repo.update(viz?.id ?? '', feedId, userId, {
        renderErrorCount: 3,
      });

      const result = await repo.incrementRenderErrorCount(viz?.id ?? '', feedId, userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(4);
      }
    });

    it('updates updatedAt timestamp', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;
      const originalUpdatedAt = viz?.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      await repo.incrementRenderErrorCount(viz?.id ?? '', feedId, userId);

      const getResult = await repo.getById(viz?.id ?? '', feedId, userId);
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value) {
        expect(getResult.value.updatedAt.getTime()).toBeGreaterThan(
          originalUpdatedAt?.getTime() ?? 0
        );
      }
    });

    it('returns error for non-existent visualization', async () => {
      const result = await repo.incrementRenderErrorCount('non-existent', feedId, userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('returns error when feedId does not match', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.incrementRenderErrorCount(viz?.id ?? '', 'other-feed', userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('returns error when userId does not match', async () => {
      const createResult = await repo.create(feedId, userId, {
        title: 'Title',
        description: 'Description',
        type: 'chart' as VisualizationType,
      });
      const viz = createResult.ok ? createResult.value : null;

      const result = await repo.incrementRenderErrorCount(viz?.id ?? '', feedId, 'other-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Visualization not found');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Increment failed') });

      const result = await repo.incrementRenderErrorCount('any-id', feedId, userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to increment render error count');
      }

      fakeFirestore.configure({});
    });
  });
});
