import { getFirestore } from '@intexuraos/infra-firestore';
import type { ActionTransition } from '../../domain/models/actionTransition.js';
import type { ActionTransitionRepository } from '../../domain/ports/actionTransitionRepository.js';

const COLLECTION = 'actions_transitions';

interface ActionTransitionDoc {
  userId: string;
  actionId: string;
  commandId: string;
  commandText: string;
  originalType: string;
  newType: string;
  originalConfidence: number;
  createdAt: string;
}

function toActionTransition(id: string, doc: ActionTransitionDoc): ActionTransition {
  return {
    id,
    userId: doc.userId,
    actionId: doc.actionId,
    commandId: doc.commandId,
    commandText: doc.commandText,
    originalType: doc.originalType as ActionTransition['originalType'],
    newType: doc.newType as ActionTransition['newType'],
    originalConfidence: doc.originalConfidence,
    createdAt: doc.createdAt,
  };
}

function toDoc(transition: ActionTransition): ActionTransitionDoc {
  return {
    userId: transition.userId,
    actionId: transition.actionId,
    commandId: transition.commandId,
    commandText: transition.commandText,
    originalType: transition.originalType,
    newType: transition.newType,
    originalConfidence: transition.originalConfidence,
    createdAt: transition.createdAt,
  };
}

export function createFirestoreActionTransitionRepository(): ActionTransitionRepository {
  return {
    async save(transition: ActionTransition): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(transition.id);
      await docRef.set(toDoc(transition));
    },

    async listByUserId(userId: string): Promise<ActionTransition[]> {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      return snapshot.docs.map((doc) =>
        toActionTransition(doc.id, doc.data() as ActionTransitionDoc)
      );
    },
  };
}
