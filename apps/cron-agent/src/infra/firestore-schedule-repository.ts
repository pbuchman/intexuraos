import { ok, err, type Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type { ScheduleRepository, ScheduleRepositoryError } from '../domain/ports/schedule-repository.js';
import type { CronSchedule, CreateScheduleInput, ListOptions, ListSchedulesResponse } from '../domain/types.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const COLLECTION = 'cron_schedules';

export class FirestoreScheduleRepository implements ScheduleRepository {
  async create(
    userId: string,
    input: CreateScheduleInput & { cronExpression: string; nextExecutionAt: string | null },
  ): Promise<Result<CronSchedule, ScheduleRepositoryError>> {
    try {
      const db = getFirestore();
      const now = new Date().toISOString();
      const docRef = db.collection(COLLECTION).doc();

      const schedule: CronSchedule = {
        id: docRef.id,
        userId,
        name: input.name,
        description: input.description,
        cronExpression: input.cronExpression,
        timezone: input.timezone,
        action: input.action,
        status: 'active',
        lastExecutedAt: null,
        nextExecutionAt: input.nextExecutionAt,
        executionCount: 0,
        failureCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(schedule);
      return ok(schedule);
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to create schedule: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async findById(id: string): Promise<Result<CronSchedule | null, ScheduleRepositoryError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(id).get();
      if (!doc.exists) {
        return ok(null);
      }
      return ok({ id: doc.id, ...doc.data() } as CronSchedule);
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to find schedule: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async findByUserId(
    userId: string,
    options: ListOptions,
  ): Promise<Result<ListSchedulesResponse, ScheduleRepositoryError>> {
    try {
      const db = getFirestore();
      let query = db.collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc');

      if (options.status !== undefined && options.status.length > 0) {
        query = query.where('status', 'in', options.status);
      }

      if (options.cursor !== undefined) {
        const cursorDoc = await db.collection(COLLECTION).doc(options.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const limit = options.limit + 1;
      const snapshot = await query.limit(limit).get();

      const schedules: CronSchedule[] = [];
      snapshot.docs.slice(0, options.limit).forEach((doc) => {
        schedules.push({ id: doc.id, ...doc.data() } as CronSchedule);
      });

      const hasMore = snapshot.docs.length > options.limit;
      const lastDoc = schedules[schedules.length - 1];

      return ok({
        schedules,
        nextCursor: hasMore && lastDoc !== undefined ? lastDoc.id : null,
        count: schedules.length,
      });
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to find schedules: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async findDueSchedules(now: Date): Promise<Result<CronSchedule[], ScheduleRepositoryError>> {
    try {
      const db = getFirestore();
      const snapshot = await db.collection(COLLECTION)
        .where('status', '==', 'active')
        .where('nextExecutionAt', '<=', now.toISOString())
        .limit(100)
        .get();

      const schedules: CronSchedule[] = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as CronSchedule),
      );

      return ok(schedules);
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to find due schedules: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async update(
    id: string,
    updates: Partial<CronSchedule>,
  ): Promise<Result<CronSchedule, ScheduleRepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();
      if (!doc.exists) {
        return err({ code: 'NOT_FOUND', message: `Schedule ${id} not found` });
      }

      const updatedData = { ...updates, updatedAt: new Date().toISOString() };
      await docRef.update(updatedData);
      const updated = await docRef.get();
      return ok({ id: updated.id, ...updated.data() } as CronSchedule);
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to update schedule: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }
}
