import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';

const COLLECTION = 'notification_digest_backfill_runs';

export interface BackfillRun {
  readonly runId: string;
  readonly userId: string;
  readonly groupKey: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly totalDates: number;
  readonly completedDates: readonly string[];
  readonly failedDates: readonly { readonly date: string; readonly error: string }[];
  readonly currentDate: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface BackfillRunRepositoryError {
  readonly code: 'INTERNAL_ERROR';
  readonly message: string;
}

export class FirestoreBackfillRunRepository {
  async create(run: BackfillRun): Promise<Result<void, BackfillRunRepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(run.runId).set(run);
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'create failed') });
    }
  }

  async update(runId: string, partial: Partial<BackfillRun>): Promise<Result<void, BackfillRunRepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(runId).update({ ...partial, updatedAt: new Date().toISOString() });
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'update failed') });
    }
  }

  async findById(runId: string): Promise<Result<BackfillRun | null, BackfillRunRepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION).doc(runId).get();
      if (!snap.exists) return ok(null);
      return ok(snap.data() as BackfillRun);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findById failed') });
    }
  }
}
