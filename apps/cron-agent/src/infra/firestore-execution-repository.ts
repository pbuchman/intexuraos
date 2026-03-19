import { ok, err, type Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type { ExecutionRepository, ExecutionRepositoryError } from '../domain/ports/execution-repository.js';
import type { CronExecution, CreateExecutionInput, ExecutionListOptions, ListExecutionsResponse } from '../domain/types.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const COLLECTION = 'cron_executions';

export class FirestoreExecutionRepository implements ExecutionRepository {
  async create(input: CreateExecutionInput): Promise<Result<CronExecution, ExecutionRepositoryError>> {
    try {
      const db = getFirestore();
      const now = new Date().toISOString();
      const docRef = db.collection(COLLECTION).doc();

      const execution: CronExecution = {
        id: docRef.id,
        scheduleId: input.scheduleId,
        scheduleName: input.scheduleName,
        userId: input.userId,
        status: 'running',
        trigger: input.trigger,
        startedAt: now,
        completedAt: null,
        durationMs: null,
        toolCalls: [],
        agentResponse: null,
        tokenUsage: null,
        error: null,
        createdAt: now,
      };

      await docRef.set(execution);
      return ok(execution);
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to create execution: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async findById(id: string): Promise<Result<CronExecution | null, ExecutionRepositoryError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(id).get();
      if (!doc.exists) {
        return ok(null);
      }
      return ok({ id: doc.id, ...doc.data() } as CronExecution);
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to find execution: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async findByUserId(
    userId: string,
    options: ExecutionListOptions,
  ): Promise<Result<ListExecutionsResponse, ExecutionRepositoryError>> {
    try {
      const db = getFirestore();
      let query = db.collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc');

      if (options.scheduleId !== undefined) {
        query = query.where('scheduleId', '==', options.scheduleId);
      }

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

      const executions: CronExecution[] = [];
      snapshot.docs.slice(0, options.limit).forEach((doc) => {
        executions.push({ id: doc.id, ...doc.data() } as CronExecution);
      });

      const hasMore = snapshot.docs.length > options.limit;
      const lastDoc = executions[executions.length - 1];

      return ok({
        executions,
        nextCursor: hasMore && lastDoc !== undefined ? lastDoc.id : null,
        count: executions.length,
      });
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to find executions: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async findByScheduleId(
    scheduleId: string,
    options: ExecutionListOptions,
  ): Promise<Result<ListExecutionsResponse, ExecutionRepositoryError>> {
    try {
      const db = getFirestore();
      let query = db.collection(COLLECTION)
        .where('scheduleId', '==', scheduleId)
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

      const executions: CronExecution[] = [];
      snapshot.docs.slice(0, options.limit).forEach((doc) => {
        executions.push({ id: doc.id, ...doc.data() } as CronExecution);
      });

      const hasMore = snapshot.docs.length > options.limit;
      const lastDoc = executions[executions.length - 1];

      return ok({
        executions,
        nextCursor: hasMore && lastDoc !== undefined ? lastDoc.id : null,
        count: executions.length,
      });
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to find executions by schedule: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async findRunningByScheduleId(
    scheduleId: string,
  ): Promise<Result<CronExecution | null, ExecutionRepositoryError>> {
    try {
      const db = getFirestore();
      const snapshot = await db.collection(COLLECTION)
        .where('scheduleId', '==', scheduleId)
        .where('status', '==', 'running')
        .limit(1)
        .get();

      if (snapshot.empty) {
        return ok(null);
      }

      const doc = snapshot.docs[0];
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard after snapshot.empty check @preserve */
      if (doc === undefined) {
        return ok(null);
      }
      /* v8 ignore stop @preserve */
      return ok({ id: doc.id, ...doc.data() } as CronExecution);
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to find running execution: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }

  async update(
    id: string,
    updates: Partial<CronExecution>,
  ): Promise<Result<CronExecution, ExecutionRepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();
      if (!doc.exists) {
        return err({ code: 'NOT_FOUND', message: `Execution ${id} not found` });
      }

      await docRef.update(updates);
      const updated = await docRef.get();
      return ok({ id: updated.id, ...updated.data() } as CronExecution);
    } catch (error: unknown) {
      return err({ code: 'INTERNAL_ERROR', message: `Failed to update execution: ${getErrorMessage(error, 'Unknown error')}` });
    }
  }
}
