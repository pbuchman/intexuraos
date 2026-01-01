import { getFirestore } from '@intexuraos/infra-firestore';
import type { Action } from '../../domain/models/action.js';
import type { ActionRepository } from '../../domain/ports/actionRepository.js';

const COLLECTION = 'actions';

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

export function createFirestoreActionRepository(): ActionRepository {
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

    async listByUserId(userId: string): Promise<Action[]> {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      return snapshot.docs.map((doc) => toAction(doc.id, doc.data() as ActionDoc));
    },
  };
}
