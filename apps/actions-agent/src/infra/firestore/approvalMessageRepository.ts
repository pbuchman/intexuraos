import { getFirestore } from '@intexuraos/infra-firestore';
import type { ApprovalMessage } from '../../domain/models/approvalMessage.js';
import type { ApprovalMessageRepository } from '../../domain/ports/approvalMessageRepository.js';

const COLLECTION = 'approval_messages';

interface ApprovalMessageDoc {
  wamid: string;
  actionId: string;
  userId: string;
  sentAt: string;
  actionType: string;
  actionTitle: string;
}

function toApprovalMessage(id: string, doc: ApprovalMessageDoc): ApprovalMessage {
  return {
    id,
    wamid: doc.wamid,
    actionId: doc.actionId,
    userId: doc.userId,
    sentAt: doc.sentAt,
    actionType: doc.actionType as ApprovalMessage['actionType'],
    actionTitle: doc.actionTitle,
  };
}

function toDoc(message: ApprovalMessage): ApprovalMessageDoc {
  return {
    wamid: message.wamid,
    actionId: message.actionId,
    userId: message.userId,
    sentAt: message.sentAt,
    actionType: message.actionType,
    actionTitle: message.actionTitle,
  };
}

export function createFirestoreApprovalMessageRepository(): ApprovalMessageRepository {
  return {
    async save(message: ApprovalMessage): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(message.id);
      await docRef.set(toDoc(message));
    },

    async findByWamid(wamid: string): Promise<ApprovalMessage | null> {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('wamid', '==', wamid)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      if (doc === undefined) {
        return null;
      }

      return toApprovalMessage(doc.id, doc.data() as ApprovalMessageDoc);
    },

    async deleteByActionId(actionId: string): Promise<void> {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('actionId', '==', actionId)
        .get();

      if (snapshot.empty) {
        return;
      }

      const batch = db.batch();
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    },

    async findByActionId(actionId: string): Promise<ApprovalMessage | null> {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('actionId', '==', actionId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      if (doc === undefined) {
        return null;
      }

      return toApprovalMessage(doc.id, doc.data() as ApprovalMessageDoc);
    },
  };
}
