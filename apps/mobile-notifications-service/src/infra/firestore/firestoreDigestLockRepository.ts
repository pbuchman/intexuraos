import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  DigestLockRepository,
  RepositoryError,
} from '../../domain/repositories/digestRepositories.js';

const COLLECTION = 'notification_digest_locks';
const TTL_MS = 5 * 60 * 1000;

interface LockDoc {
  readonly userId: string;
  readonly groupKey: string;
  readonly holder: 'cron' | 'backfill' | 'manual';
  readonly currentDate: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

function docId(userId: string, groupKey: string): string {
  return `${userId}_${groupKey}`;
}

export class FirestoreDigestLockRepository implements DigestLockRepository {
  async acquire(input: {
    userId: string; groupKey: string; holder: 'cron' | 'backfill' | 'manual'; currentDate: string;
  }): Promise<Result<{ acquired: boolean; heldBy?: string }, RepositoryError>> {
    try {
      const db = getFirestore();
      const id = docId(input.userId, input.groupKey);
      const ref = db.collection(COLLECTION).doc(id);
      const now = Date.now();
      return await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) {
          const data = existing.data() as LockDoc;
          const expires = new Date(data.expiresAt).getTime();
          if (expires > now) {
            return ok({ acquired: false, heldBy: data.holder });
          }
        }
        const doc: LockDoc = {
          userId: input.userId,
          groupKey: input.groupKey,
          holder: input.holder,
          currentDate: input.currentDate,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + TTL_MS).toISOString(),
        };
        tx.set(ref, doc);
        return ok({ acquired: true });
      });
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'acquire failed') });
    }
  }

  async release(input: { userId: string; groupKey: string }): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(docId(input.userId, input.groupKey)).delete();
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'release failed') });
    }
  }
}
