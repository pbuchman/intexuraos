/**
 * Tests for Visualization Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreVisualizationRepository } from '../infra/firestore/visualizationRepository.js';
import type { Visualization } from '../domain/visualization/index.js';

function createTestVisualization(
  overrides: Partial<Omit<Visualization, 'id' | 'createdAt' | 'updatedAt'>> = {}
): Omit<Visualization, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    userId: 'user-123',
    feedId: 'feed-1',
    feedName: 'Test Feed',
    insightId: 'insight-1',
    insightTitle: 'Test Insight',
    trackableMetric: 'revenue',
    chartConfig: { type: 'bar' },
    transformInstructions: 'sum by month',
    chartData: [{ month: 'Jan', value: 100 }],
    status: 'ready',
    ...overrides,
  };
}

describe('FirestoreVisualizationRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: FirestoreVisualizationRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repository = new FirestoreVisualizationRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('create', () => {
    it('creates a visualization with all fields and returns it with generated id, createdAt, updatedAt', async () => {
      const input = createTestVisualization({
        lastError: 'some error',
        lastRefreshedAt: new Date('2025-06-01T00:00:00.000Z'),
      });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBeDefined();
      expect(result.value.userId).toBe('user-123');
      expect(result.value.feedId).toBe('feed-1');
      expect(result.value.feedName).toBe('Test Feed');
      expect(result.value.insightId).toBe('insight-1');
      expect(result.value.insightTitle).toBe('Test Insight');
      expect(result.value.trackableMetric).toBe('revenue');
      expect(result.value.chartConfig).toEqual({ type: 'bar' });
      expect(result.value.transformInstructions).toBe('sum by month');
      expect(result.value.chartData).toEqual([{ month: 'Jan', value: 100 }]);
      expect(result.value.status).toBe('ready');
      expect(result.value.lastError).toBe('some error');
      expect(result.value.lastRefreshedAt).toBeInstanceOf(Date);
      expect(result.value.createdAt).toBeInstanceOf(Date);
      expect(result.value.updatedAt).toBeInstanceOf(Date);
    });

    it('creates a visualization with optional fields (lastError, lastRefreshedAt)', async () => {
      const input = createTestVisualization({
        lastError: 'timeout',
        lastRefreshedAt: new Date('2025-07-01T12:00:00.000Z'),
      });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.lastError).toBe('timeout');
      expect(result.value.lastRefreshedAt).toEqual(new Date('2025-07-01T12:00:00.000Z'));
    });

    it('creates a visualization without optional fields (null chartData, no lastError, no lastRefreshedAt)', async () => {
      const input = createTestVisualization({
        chartData: null,
        status: 'pending',
      });

      const result = await repository.create(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.chartData).toBeNull();
      expect(result.value.lastError).toBeUndefined();
      expect(result.value.lastRefreshedAt).toBeUndefined();
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Write failed') });

      const input = createTestVisualization();
      const result = await repository.create(input);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Failed to create visualization');

      fakeFirestore.configure({});
    });
  });

  describe('getById', () => {
    it('returns null for non-existent id', async () => {
      const result = await repository.getById('non-existent', 'user-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('returns visualization for existing id and matching userId', async () => {
      const input = createTestVisualization();
      const createResult = await repository.create(input);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.getById(createResult.value.id, 'user-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      if (result.value === null) return;
      expect(result.value.feedId).toBe('feed-1');
      expect(result.value.userId).toBe('user-123');
    });

    it('returns null when userId does not match', async () => {
      const input = createTestVisualization();
      const createResult = await repository.create(input);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.getById(createResult.value.id, 'other-user');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repository.getById('some-id', 'user-123');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Failed to get visualization');

      fakeFirestore.configure({});
    });
  });

  describe('getByIdInternal', () => {
    it('returns null for non-existent id', async () => {
      const result = await repository.getByIdInternal('non-existent');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it('returns visualization without userId check', async () => {
      const input = createTestVisualization({ userId: 'user-abc' });
      const createResult = await repository.create(input);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.getByIdInternal(createResult.value.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      if (result.value === null) return;
      expect(result.value.userId).toBe('user-abc');
      expect(result.value.feedId).toBe('feed-1');
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await repository.getByIdInternal('some-id');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Failed to get visualization');

      fakeFirestore.configure({});
    });
  });

  describe('listByUserId', () => {
    it('returns empty array when no visualizations', async () => {
      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it('returns visualizations for matching userId', async () => {
      await repository.create(createTestVisualization({ insightId: 'insight-1' }));
      await repository.create(createTestVisualization({ insightId: 'insight-2' }));

      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });

    it('does not return other users visualizations', async () => {
      await repository.create(createTestVisualization({ userId: 'user-123' }));
      await repository.create(createTestVisualization({ userId: 'other-user' }));

      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      const viz = result.value[0];
      expect(viz).toBeDefined();
      if (viz === undefined) return;
      expect(viz.userId).toBe('user-123');
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repository.listByUserId('user-123');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Failed to list visualizations');

      fakeFirestore.configure({});
    });
  });

  describe('listByFeedId', () => {
    it('returns empty array when no visualizations for feed', async () => {
      const result = await repository.listByFeedId('non-existent-feed');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it('returns visualizations for matching feedId', async () => {
      await repository.create(createTestVisualization({ feedId: 'feed-1', insightId: 'i-1' }));
      await repository.create(createTestVisualization({ feedId: 'feed-1', insightId: 'i-2' }));
      await repository.create(createTestVisualization({ feedId: 'feed-other', insightId: 'i-3' }));

      const result = await repository.listByFeedId('feed-1');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      for (const viz of result.value) {
        expect(viz.feedId).toBe('feed-1');
      }
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query failed') });

      const result = await repository.listByFeedId('feed-1');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Failed to list visualizations by feed');

      fakeFirestore.configure({});
    });
  });

  describe('update', () => {
    it('updates status field', async () => {
      const createResult = await repository.create(createTestVisualization({ status: 'pending' }));
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.update(createResult.value.id, { status: 'ready' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('ready');
    });

    it('updates chartData field', async () => {
      const createResult = await repository.create(
        createTestVisualization({ chartData: null, status: 'pending' })
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const newData = [{ x: 1, y: 2 }];
      const result = await repository.update(createResult.value.id, { chartData: newData });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.chartData).toEqual(newData);
    });

    it('updates lastError field', async () => {
      const createResult = await repository.create(createTestVisualization({ status: 'error' }));
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await repository.update(createResult.value.id, {
        lastError: 'something went wrong',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.lastError).toBe('something went wrong');
    });

    it('updates lastRefreshedAt field', async () => {
      const createResult = await repository.create(createTestVisualization());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const refreshDate = new Date('2025-08-15T10:00:00.000Z');
      const result = await repository.update(createResult.value.id, {
        lastRefreshedAt: refreshDate,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.lastRefreshedAt).toEqual(refreshDate);
    });

    it('updates multiple fields at once', async () => {
      const createResult = await repository.create(
        createTestVisualization({ status: 'pending', chartData: null })
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const refreshDate = new Date('2025-09-01T00:00:00.000Z');
      const result = await repository.update(createResult.value.id, {
        status: 'ready',
        chartData: [{ val: 42 }],
        lastRefreshedAt: refreshDate,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('ready');
      expect(result.value.chartData).toEqual([{ val: 42 }]);
      expect(result.value.lastRefreshedAt).toEqual(refreshDate);
    });

    it('returns error when visualization not found', async () => {
      const result = await repository.update('non-existent', { status: 'ready' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Visualization not found');
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await repository.update('some-id', { status: 'error' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Failed to update visualization');

      fakeFirestore.configure({});
    });
  });

  describe('delete', () => {
    it('deletes existing visualization', async () => {
      const createResult = await repository.create(createTestVisualization());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const deleteResult = await repository.delete(createResult.value.id, 'user-123');
      expect(deleteResult.ok).toBe(true);

      const getResult = await repository.getById(createResult.value.id, 'user-123');
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value).toBeNull();
    });

    it('returns ok(undefined) when not found', async () => {
      const result = await repository.delete('non-existent', 'user-123');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeUndefined();
    });

    it('returns ok(undefined) when userId does not match', async () => {
      const createResult = await repository.create(createTestVisualization());
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const deleteResult = await repository.delete(createResult.value.id, 'other-user');
      expect(deleteResult.ok).toBe(true);

      // Verify the visualization still exists
      const getResult = await repository.getById(createResult.value.id, 'user-123');
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.value).not.toBeNull();
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete failed') });

      const result = await repository.delete('some-id', 'user-123');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Failed to delete visualization');

      fakeFirestore.configure({});
    });
  });

  describe('deleteByFeedId', () => {
    it('deletes all visualizations for a feed (batch delete)', async () => {
      await repository.create(createTestVisualization({ feedId: 'feed-1', insightId: 'i-1' }));
      await repository.create(createTestVisualization({ feedId: 'feed-1', insightId: 'i-2' }));
      await repository.create(createTestVisualization({ feedId: 'feed-other', insightId: 'i-3' }));

      const deleteResult = await repository.deleteByFeedId('feed-1');
      expect(deleteResult.ok).toBe(true);

      const listResult = await repository.listByFeedId('feed-1');
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.value).toEqual([]);

      // Verify other feed's visualizations are untouched
      const otherResult = await repository.listByFeedId('feed-other');
      expect(otherResult.ok).toBe(true);
      if (!otherResult.ok) return;
      expect(otherResult.value).toHaveLength(1);
    });

    it('returns ok(undefined) when no visualizations exist for feed (empty snapshot)', async () => {
      const result = await repository.deleteByFeedId('non-existent-feed');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeUndefined();
    });

    it('handles Firestore errors', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Batch delete failed') });

      const result = await repository.deleteByFeedId('feed-1');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Failed to delete visualizations by feed');

      fakeFirestore.configure({});
    });
  });
});
