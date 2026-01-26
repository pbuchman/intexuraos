/**
 * Firestore implementation of UserUsageRepository.
 * Uses transactions for atomic updates.
 */

/* eslint-disable */
import { Timestamp, FieldValue } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';
import type { UserUsageRepository } from '../../domain/ports/userUsageRepository.js';
import type { UserUsage } from '../../domain/models/userUsage.js';

const COLLECTION = 'user_usage';

/**
 * Helper to ensure a value is a Timestamp.
 * Handles both real Firestore Timestamp objects and plain Date objects from fake Firestore.
 */
function toTimestamp(value: unknown): Timestamp {
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  // For fake firestore tests that might return plain objects with _seconds or toDate
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('toDate' in obj && typeof obj['toDate'] === 'function') {
      return obj as unknown as Timestamp;
    }
    if ('_seconds' in obj && typeof obj['_seconds'] === 'number') {
      const seconds = obj['_seconds'] as number;
      const nanos = (obj['_nanoseconds'] as number) ?? 0;
      return new Timestamp(seconds, nanos);
    }
  }
  // Fallback to now
  return Timestamp.now();
}

export function createUserUsageFirestoreRepository(
  firestore: Firestore,
  _logger: Logger
): UserUsageRepository {
  function createDefaultUsage(userId: string, now: Timestamp): UserUsage {
    return {
      userId,
      concurrentTasks: 0,
      tasksThisHour: 0,
      hourStartedAt: now,
      costToday: 0,
      costThisMonth: 0,
      dayStartedAt: getStartOfDay(now),
      monthStartedAt: getStartOfMonth(now),
      updatedAt: now,
    };
  }

  function getStartOfDay(ts: Timestamp): Timestamp {
    const date = ts.toDate();
    date.setUTCHours(0, 0, 0, 0);
    return Timestamp.fromDate(date);
  }

  function getStartOfMonth(ts: Timestamp): Timestamp {
    const date = ts.toDate();
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
    return Timestamp.fromDate(date);
  }

  function isNewHour(lastHourStart: Timestamp, now: Timestamp): boolean {
    return now.toMillis() - lastHourStart.toMillis() >= 60 * 60 * 1000;
  }

  function isNewDay(lastDayStart: Timestamp, now: Timestamp): boolean {
    return getStartOfDay(now).toMillis() > lastDayStart.toMillis();
  }

  function isNewMonth(lastMonthStart: Timestamp, now: Timestamp): boolean {
    return getStartOfMonth(now).toMillis() > lastMonthStart.toMillis();
  }

  /**
   * Normalize a UserUsage object from Firestore, ensuring all Timestamp fields are actual Timestamps.
   */
  function normalizeUsage(data: Record<string, unknown>): UserUsage {
    return {
      userId: String(data['userId']),
      concurrentTasks: Number(data['concurrentTasks'] ?? 0),
      tasksThisHour: Number(data['tasksThisHour'] ?? 0),
      hourStartedAt: toTimestamp(data['hourStartedAt']),
      costToday: Number(data['costToday'] ?? 0),
      costThisMonth: Number(data['costThisMonth'] ?? 0),
      dayStartedAt: toTimestamp(data['dayStartedAt']),
      monthStartedAt: toTimestamp(data['monthStartedAt']),
      updatedAt: toTimestamp(data['updatedAt']),
    };
  }

  return {
    async getOrCreate(userId: string): Promise<UserUsage> {
      const ref = firestore.collection(COLLECTION).doc(userId);
      const doc = await ref.get();

      if (!doc.exists) {
        const now = Timestamp.now();
        const defaultUsage = createDefaultUsage(userId, now);
        await ref.set(defaultUsage);
        return defaultUsage;
      }

      return normalizeUsage(doc.data() as Record<string, unknown>);
    },

    async update(usage: UserUsage): Promise<void> {
      const ref = firestore.collection(COLLECTION).doc(usage.userId);
      await ref.set({ ...usage, updatedAt: FieldValue.serverTimestamp() });
    },

    async incrementConcurrent(userId: string): Promise<void> {
      const ref = firestore.collection(COLLECTION).doc(userId);
      await firestore.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) {
          const now = Timestamp.now();
          tx.set(ref, { ...createDefaultUsage(userId, now), concurrentTasks: 1 });
        } else {
          tx.update(ref, {
            concurrentTasks: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
    },

    async decrementConcurrent(userId: string): Promise<void> {
      const ref = firestore.collection(COLLECTION).doc(userId);
      await ref.update({
        concurrentTasks: FieldValue.increment(-1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    },

    async recordTaskStart(userId: string, estimatedCost: number): Promise<void> {
      const ref = firestore.collection(COLLECTION).doc(userId);

      await firestore.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const now = Timestamp.now();

        if (!doc.exists) {
          tx.set(ref, {
            ...createDefaultUsage(userId, now),
            concurrentTasks: 1,
            tasksThisHour: 1,
            costToday: estimatedCost,
            costThisMonth: estimatedCost,
          });
          return;
        }

        const usage = normalizeUsage(doc.data() as Record<string, unknown>);
        const updates: Partial<UserUsage> = {
          updatedAt: now,
        };

        // Reset hour window if needed
        if (isNewHour(usage.hourStartedAt, now)) {
          updates.tasksThisHour = 1;
          updates.hourStartedAt = now;
        } else {
          updates.tasksThisHour = usage.tasksThisHour + 1;
        }

        // Reset day window if needed
        if (isNewDay(usage.dayStartedAt, now)) {
          updates.costToday = estimatedCost;
          updates.dayStartedAt = getStartOfDay(now);
        } else {
          updates.costToday = usage.costToday + estimatedCost;
        }

        // Reset month window if needed
        if (isNewMonth(usage.monthStartedAt, now)) {
          updates.costThisMonth = estimatedCost;
          updates.monthStartedAt = getStartOfMonth(now);
        } else {
          updates.costThisMonth = usage.costThisMonth + estimatedCost;
        }

        tx.update(ref, updates);
      });
    },

    async recordActualCost(userId: string, actualCost: number, estimatedCost: number): Promise<void> {
      const costDiff = actualCost - estimatedCost;
      if (Math.abs(costDiff) < 0.01) return; // No significant difference

      const ref = firestore.collection(COLLECTION).doc(userId);
      await ref.update({
        costToday: FieldValue.increment(costDiff),
        costThisMonth: FieldValue.increment(costDiff),
        updatedAt: FieldValue.serverTimestamp(),
      });
    },
  };
}
