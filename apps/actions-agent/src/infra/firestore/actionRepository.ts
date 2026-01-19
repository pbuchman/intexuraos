import { getFirestore } from '@intexuraos/infra-firestore';
import type { Action } from '../../domain/models/action.js';
import type {
  ActionRepository,
  ListByUserIdOptions,
  UpdateStatusIfResult,
} from '../../domain/ports/actionRepository.js';
import type { Logger } from 'pino';

const COLLECTION = 'actions';

interface CreateFirestoreActionRepositoryDeps {
  logger?: Logger;
}

interface ActionDoc {
  userId: string;
  commandId: string;
  type: string;
  confidence: number;
  title: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function toAction(id: string, doc: ActionDoc): Action {
  return {
    id,
    userId: doc.userId,
    commandId: doc.commandId,
    type: doc.type as Action['type'],
    confidence: doc.confidence,
    title: doc.title,
    status: doc.status as Action['status'],
    payload: doc.payload,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toDoc(action: Action): ActionDoc {
  return {
    userId: action.userId,
    commandId: action.commandId,
    type: action.type,
    confidence: action.confidence,
    title: action.title,
    status: action.status,
    payload: action.payload,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

export function createFirestoreActionRepository(deps?: CreateFirestoreActionRepositoryDeps): ActionRepository {
  const { logger } = deps ?? {};
  const hasLogger = logger !== undefined;
  return {
    async getById(id: string): Promise<Action | null> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        return null;
      }

      return toAction(id, snapshot.data() as ActionDoc);
    },

    async save(action: Action): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(action.id);
      await docRef.set(toDoc(action));
    },

    async update(action: Action): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(action.id);
      await docRef.update({
        ...toDoc(action),
        updatedAt: new Date().toISOString(),
      });
    },

    async delete(id: string): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      await docRef.delete();
    },

    async listByUserId(userId: string, options?: ListByUserIdOptions): Promise<Action[]> {
      const db = getFirestore();
      let query = db.collection(COLLECTION).where('userId', '==', userId);

      if (options?.status !== undefined && options.status.length > 0) {
        query = query.where('status', 'in', options.status);
      }

      const snapshot = await query.orderBy('createdAt', 'desc').limit(100).get();

      return snapshot.docs.map((doc) => toAction(doc.id, doc.data() as ActionDoc));
    },

    async listByStatus(status: Action['status'], limit = 100): Promise<Action[]> {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('status', '==', status)
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => toAction(doc.id, doc.data() as ActionDoc));
    },

    async updateStatusIf(
      actionId: string,
      newStatus: Action['status'],
      expectedStatuses: Action['status'] | Action['status'][]
    ): Promise<UpdateStatusIfResult> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(actionId);
      const expectedArray = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];

      try {
        const result = await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(docRef);

          if (!snapshot.exists) {
            return { outcome: 'not_found' } as const;
          }

          const currentStatus = snapshot.get('status') as string;

          if (!expectedArray.includes(currentStatus as Action['status'])) {
            return { outcome: 'status_mismatch', currentStatus } as const;
          }

          transaction.update(docRef, {
            status: newStatus,
            updatedAt: new Date().toISOString(),
          });

          return { outcome: 'updated' } as const;
        });

        return result;
      } catch (error) {
        if (hasLogger) {
          logger.error(
            { actionId, newStatus, expectedStatuses, error },
            'Firestore transaction failed in updateStatusIf'
          );
        }
        return { outcome: 'error', error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
  };
}
