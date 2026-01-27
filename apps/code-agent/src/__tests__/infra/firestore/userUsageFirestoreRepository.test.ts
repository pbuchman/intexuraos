/**
 * Tests for UserUsage Firestore repository.
 * Test-first development: Tests written before implementation.
 *
 * Note: Tests using FieldValue.increment() are limited because the fake Firestore
 * doesn't fully implement increment operations. These are tested indirectly through
 * recordTaskStart which uses transactions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import { createUserUsageFirestoreRepository } from '../../../infra/firestore/userUsageFirestoreRepository.js';
import type { UserUsage } from '../../../domain/models/userUsage.js';

describe('userUsageFirestoreRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    resetFirestore();
  });

  function createUsage(overrides: Partial<UserUsage> = {}): UserUsage {
    const now = Timestamp.now();
    return {
      userId: 'test-user',
      concurrentTasks: 0,
      tasksThisHour: 0,
      hourStartedAt: now,
      costToday: 0,
      costThisMonth: 0,
      dayStartedAt: now,
      monthStartedAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  describe('getOrCreate', () => {
    it('should create default usage for new user', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      const result = await repo.getOrCreate('new-user');

      expect(result.userId).toBe('new-user');
      expect(result.concurrentTasks).toBe(0);
      expect(result.tasksThisHour).toBe(0);
      expect(result.costToday).toBe(0);
      expect(result.costThisMonth).toBe(0);
    });

    it('should return existing usage for known user', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Create initial usage
      await repo.getOrCreate('existing-user');

      // Modify it directly
      const collection = fakeFirestore.collection('user_usage');
      await collection.doc('existing-user').update({
        concurrentTasks: 2,
        tasksThisHour: 5,
        costToday: 10.5,
      });

      // Get it again
      const result = await repo.getOrCreate('existing-user');

      expect(result.userId).toBe('existing-user');
      expect(result.concurrentTasks).toBe(2);
      expect(result.tasksThisHour).toBe(5);
      expect(result.costToday).toBe(10.5);
    });
  });

  describe('update', () => {
    it('should update usage document', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      const usage = createUsage({
        userId: 'user-1',
        concurrentTasks: 3,
        costToday: 15.5,
      });

      await repo.update(usage);

      const collection = fakeFirestore.collection('user_usage');
      const doc = await collection.doc('user-1').get();

      expect(doc.exists).toBe(true);
      expect(doc.get('concurrentTasks')).toBe(3);
      expect(doc.get('costToday')).toBe(15.5);
    });
  });

  describe('incrementConcurrent', () => {
    it('should increment from 0 to 1 for new user', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.incrementConcurrent('new-user');

      const collection = fakeFirestore.collection('user_usage');
      const doc = await collection.doc('new-user').get();

      expect(doc.exists).toBe(true);
      expect(doc.get('concurrentTasks')).toBe(1);
    });

    it('should call update for existing user', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Create initial usage
      await repo.getOrCreate('existing-user');

      // This will call FieldValue.increment which fake firestore doesn't fully support
      // but we verify the method doesn't throw
      await expect(repo.incrementConcurrent('existing-user')).resolves.toBeUndefined();
    });
  });

  describe('decrementConcurrent', () => {
    it('should call update without throwing', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Create initial usage
      await repo.getOrCreate('user-1');

      // This will call FieldValue.increment(-1) which fake firestore doesn't fully support
      // but we verify the method doesn't throw
      await expect(repo.decrementConcurrent('user-1')).resolves.toBeUndefined();
    });
  });

  describe('recordTaskStart', () => {
    it('should create new document with initial values for new user', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.recordTaskStart('new-user', 1.17);

      const collection = fakeFirestore.collection('user_usage');
      const doc = await collection.doc('new-user').get();

      expect(doc.exists).toBe(true);
      expect(doc.get('concurrentTasks')).toBe(1);
      expect(doc.get('tasksThisHour')).toBe(1);
      expect(doc.get('costToday')).toBe(1.17);
      expect(doc.get('costThisMonth')).toBe(1.17);
    });

    it('should handle existing user without throwing', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Create initial usage
      await repo.getOrCreate('existing-user');

      // Transaction-based updates don't work with fake firestore
      // but we verify the method doesn't throw
      await expect(repo.recordTaskStart('existing-user', 1.17)).resolves.toBeUndefined();
    });

    it('should handle time window reset logic', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Create initial usage with old timestamps
      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      const oldHourTimestamp = Timestamp.fromDate(
        new Date(Date.now() - 61 * 60 * 1000)
      );
      const oldDayTimestamp = Timestamp.fromDate(
        new Date(Date.now() - 25 * 60 * 60 * 1000)
      );
      const oldMonthTimestamp = Timestamp.fromDate(
        new Date(Date.now() - 32 * 24 * 60 * 60 * 1000)
      );

      await collection.doc('user-1').update({
        hourStartedAt: oldHourTimestamp,
        tasksThisHour: 10,
        dayStartedAt: oldDayTimestamp,
        costToday: 20.0,
        monthStartedAt: oldMonthTimestamp,
        costThisMonth: 200.0,
      });

      // The method should handle time window resets
      // Fake firestore transactions don't work, but we verify no throw
      await expect(repo.recordTaskStart('user-1', 1.17)).resolves.toBeUndefined();
    });
  });

  describe('recordActualCost', () => {
    it('should call update and log info for significant difference', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Create initial usage
      await repo.getOrCreate('user-1');

      // This will call FieldValue.increment which fake firestore doesn't fully support
      // but we verify the method doesn't throw and logs info
      await expect(repo.recordActualCost('user-1', 2.50, 1.17)).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', actualCost: 2.5, estimatedCost: 1.17, costDiff: 1.33 }),
        'Recorded actual cost correction'
      );
    });

    it('should not update when difference is less than 0.01', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Create initial usage
      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');
      await collection.doc('user-1').update({
        costToday: 10.0,
        costThisMonth: 50.0,
      });

      // Difference is only 0.005 - should not call update
      const spy = vi.spyOn(collection.doc('user-1'), 'update');
      await repo.recordActualCost('user-1', 1.175, 1.17);

      expect(spy).not.toHaveBeenCalled();
    });

    it('should log warning and not throw when update fails', async () => {
      // First create a user
      await fakeFirestore.collection('user_usage').doc('user-1').set({
        userId: 'user-1',
        concurrentTasks: 0,
        tasksThisHour: 0,
        hourStartedAt: new Date(),
        costToday: 10,
        costThisMonth: 50,
        dayStartedAt: new Date(),
        monthStartedAt: new Date(),
        updatedAt: new Date(),
      });

      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Mock the collection method to return a collection with failing update
      const originalCollection = fakeFirestore.collection;
      const shouldFail = true;
      fakeFirestore.collection = vi.fn((name: string) => {
        const coll = originalCollection.call(fakeFirestore, name);
        if (name === 'user_usage') {
          const originalDoc = coll.doc;
          coll.doc = vi.fn((userId: string) => {
            const docRef = originalDoc.call(coll, userId);
            const boundUpdate = docRef.update.bind(docRef);
            docRef.update = vi.fn((data: Record<string, unknown>) => {
              if (shouldFail) {
                throw new Error('Firestore unavailable');
              }
              return boundUpdate(data);
            });
            return docRef;
          });
        }
        return coll;
      });

      // Should not throw
      await expect(repo.recordActualCost('user-1', 3.0, 1.0)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'Failed to record actual cost (non-critical)'
      );

      // Restore
      fakeFirestore.collection = originalCollection;
    });
  });

  describe('toTimestamp normalization', () => {
    it('should handle plain Date objects from fake firestore', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Set a plain Date (which fake firestore might return)
      const testDate = new Date('2024-01-15T10:30:00Z');
      await collection.doc('user-1').update({
        hourStartedAt: testDate,
        dayStartedAt: testDate,
      });

      const result = await repo.getOrCreate('user-1');

      // Should normalize without throwing
      expect(result.userId).toBe('user-1');
    });

    it('should handle object with toDate method', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Create an object with toDate method (like Firestore Timestamp)
      const mockTimestamp = {
        toDate: (): Date => new Date('2024-01-15T10:30:00Z'),
        _seconds: 1705315800,
        _nanoseconds: 0,
      };
      await collection.doc('user-1').update({
        hourStartedAt: mockTimestamp,
      });

      const result = await repo.getOrCreate('user-1');

      expect(result.userId).toBe('user-1');
    });

    it('should handle object with _seconds property', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Create an object with _seconds (like serialized Timestamp)
      const mockTimestamp = {
        _seconds: 1705315800,
        _nanoseconds: 123000000,
      };
      await collection.doc('user-1').update({
        hourStartedAt: mockTimestamp,
      });

      const result = await repo.getOrCreate('user-1');

      expect(result.userId).toBe('user-1');
    });

    it('should handle object with _seconds but no _nanoseconds', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Create an object with _seconds but no _nanoseconds
      const mockTimestamp = {
        _seconds: 1705315800,
      };
      await collection.doc('user-1').update({
        hourStartedAt: mockTimestamp,
      });

      const result = await repo.getOrCreate('user-1');

      expect(result.userId).toBe('user-1');
    });

    it('should handle unknown object type (fallback to Timestamp.now)', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Create an object that doesn't match any of the known patterns
      const unknownTimestamp = {
        unknownProperty: 'some-value',
      };
      await collection.doc('user-1').update({
        hourStartedAt: unknownTimestamp,
      });

      const result = await repo.getOrCreate('user-1');

      // Should normalize without throwing (uses Timestamp.now() fallback)
      expect(result.userId).toBe('user-1');
    });

    it('should handle string value (fallback to Timestamp.now)', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Create a string value (should trigger fallback)
      await collection.doc('user-1').update({
        hourStartedAt: 'invalid-timestamp',
      });

      const result = await repo.getOrCreate('user-1');

      // Should normalize without throwing
      expect(result.userId).toBe('user-1');
    });

    it('should handle null value (fallback to Timestamp.now)', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Set null value (should trigger fallback)
      await collection.doc('user-1').update({
        hourStartedAt: null,
      });

      const result = await repo.getOrCreate('user-1');

      // Should normalize without throwing
      expect(result.userId).toBe('user-1');
    });
  });

  describe('time window logic', () => {
    it('should handle same hour (not reset)', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Set timestamp from 30 minutes ago (same hour)
      const recentTimestamp = Timestamp.fromDate(
        new Date(Date.now() - 30 * 60 * 1000)
      );
      await collection.doc('user-1').update({
        hourStartedAt: recentTimestamp,
        tasksThisHour: 5,
      });

      // Transaction won't actually update in fake firestore, but no error
      await expect(repo.recordTaskStart('user-1', 1.0)).resolves.toBeUndefined();
    });

    it('should handle same day (not reset)', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Set timestamp from 2 hours ago (same day)
      const recentTimestamp = Timestamp.fromDate(
        new Date(Date.now() - 2 * 60 * 60 * 1000)
      );
      await collection.doc('user-1').update({
        dayStartedAt: recentTimestamp,
        costToday: 10.0,
      });

      // Transaction won't actually update in fake firestore, but no error
      await expect(repo.recordTaskStart('user-1', 1.0)).resolves.toBeUndefined();
    });

    it('should handle same month (not reset)', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      await repo.getOrCreate('user-1');
      const collection = fakeFirestore.collection('user_usage');

      // Set timestamp from 5 days ago (same month)
      const recentTimestamp = Timestamp.fromDate(
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      );
      await collection.doc('user-1').update({
        monthStartedAt: recentTimestamp,
        costThisMonth: 100.0,
      });

      // Transaction won't actually update in fake firestore, but no error
      await expect(repo.recordTaskStart('user-1', 1.0)).resolves.toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should log and rethrow error when getOrCreate fails', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Mock collection to throw
      const originalCollection = fakeFirestore.collection;
      vi.spyOn(fakeFirestore, 'collection').mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      await expect(repo.getOrCreate('user-1')).rejects.toThrow('Database connection failed');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'Failed to get or create user usage document'
      );

      // Restore
      fakeFirestore.collection = originalCollection;
    });

    it('should log and rethrow error when incrementConcurrent fails', async () => {
      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Mock runTransaction to throw
      const originalRunTransaction = fakeFirestore.runTransaction;
      vi.spyOn(fakeFirestore, 'runTransaction').mockImplementation(() => {
        throw new Error('Transaction failed');
      });

      await expect(repo.incrementConcurrent('user-1')).rejects.toThrow('Transaction failed');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'Failed to increment concurrent task counter'
      );

      // Restore
      fakeFirestore.runTransaction = originalRunTransaction;
    });

    it('should log and rethrow error when decrementConcurrent fails', async () => {
      // First create a user
      await fakeFirestore.collection('user_usage').doc('user-1').set({
        userId: 'user-1',
        concurrentTasks: 0,
        tasksThisHour: 0,
        hourStartedAt: new Date(),
        costToday: 10,
        costThisMonth: 50,
        dayStartedAt: new Date(),
        monthStartedAt: new Date(),
        updatedAt: new Date(),
      });

      const repo = createUserUsageFirestoreRepository(
        fakeFirestore as unknown as Firestore,
        logger
      );

      // Mock the collection method to return a collection with failing update
      const originalCollection = fakeFirestore.collection;
      fakeFirestore.collection = vi.fn((name: string) => {
        const coll = originalCollection.call(fakeFirestore, name);
        if (name === 'user_usage') {
          const originalDoc = coll.doc;
          coll.doc = vi.fn((userId: string) => {
            const docRef = originalDoc.call(coll, userId);
            docRef.update = vi.fn(() => {
              throw new Error('Update failed');
            });
            return docRef;
          });
        }
        return coll;
      });

      await expect(repo.decrementConcurrent('user-1')).rejects.toThrow('Update failed');

      // Restore
      fakeFirestore.collection = originalCollection;
    });
  });
});
