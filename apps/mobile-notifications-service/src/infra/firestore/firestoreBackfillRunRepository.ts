import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { FieldValue, getFirestore } from '@intexuraos/infra-firestore';
import type {
  BackfillFailure,
  BackfillRun,
  BackfillRunRepository,
  RepositoryError,
} from '../../domain/repositories/digestRepositories.js';

const COLLECTION = 'notification_digest_backfill_runs';

export class FirestoreBackfillRunRepository implements BackfillRunRepository {
  async create(run: BackfillRun): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(run.runId).set(run);
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'create failed') });
    }
  }

  async findById(runId: string): Promise<Result<BackfillRun | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION).doc(runId).get();
      if (!snap.exists) return ok(null);
      return ok(snap.data() as BackfillRun);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findById failed') });
    }
  }

  async markDayComplete(input: {
    runId: string;
    completedDate: string;
    nextCurrentDate: string | null;
  }): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(input.runId).update({
        completedDates: FieldValue.arrayUnion(input.completedDate),
        currentDate: input.nextCurrentDate,
        updatedAt: new Date().toISOString(),
      });
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'markDayComplete failed') });
    }
  }

  async markDayFailed(input: {
    runId: string;
    failure: BackfillFailure;
    markRunFailed: boolean;
  }): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      const patch: Record<string, unknown> = {
        failedDates: FieldValue.arrayUnion(input.failure),
        updatedAt: new Date().toISOString(),
      };
      if (input.markRunFailed) patch['status'] = 'failed';
      await db.collection(COLLECTION).doc(input.runId).update(patch);
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'markDayFailed failed') });
    }
  }

  async markRunCompleted(runId: string): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      const now = new Date().toISOString();
      await db.collection(COLLECTION).doc(runId).update({
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      });
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'markRunCompleted failed') });
    }
  }
}
