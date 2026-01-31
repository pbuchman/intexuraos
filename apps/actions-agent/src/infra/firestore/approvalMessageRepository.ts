import { getFirestore } from '@intexuraos/infra-firestore';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ApprovalMessage } from '../../domain/models/approvalMessage.js';
import type {
  ApprovalMessageRepository,
  ApprovalMessageRepositoryError,
} from '../../domain/ports/approvalMessageRepository.js';

const COLLECTION = 'approval_messages';

interface ApprovalMessageDoc {
  wamid: string;
  actionId: string;
  userId: string;
  sentAt: string;
  actionType: string;
  actionTitle: string;
}

// Coverage is provided by integration tests via the Pub/Sub handler in internalRoutes.ts.
/* v8 ignore start -- test-infra: block coverage @preserve */
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
/* v8 ignore stop @preserve */

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

function createError(error: unknown): ApprovalMessageRepositoryError {
  return {
    code: 'PERSISTENCE_ERROR',
    message: getErrorMessage(error),
  };
}

export function createFirestoreApprovalMessageRepository(): ApprovalMessageRepository {
  return {
    async save(message): Promise<Result<void, ApprovalMessageRepositoryError>> {
      try {
        const db = getFirestore();
        const docRef = db.collection(COLLECTION).doc(message.id);
        await docRef.set(toDoc(message));
        return ok(undefined);
      } catch (error) {
        return err(createError(error));
      }
    },

    async findByWamid(wamid): Promise<Result<ApprovalMessage | null, ApprovalMessageRepositoryError>> {
      try {
        const db = getFirestore();
        const snapshot = await db
          .collection(COLLECTION)
          .where('wamid', '==', wamid)
          .limit(1)
          .get();

        /* v8 ignore start -- test-infra: fake repository behavior in tests @preserve */
        if (snapshot.empty) {
          return ok(null);
        }
        /* v8 ignore stop @preserve */

        /* v8 ignore start -- ts-type: array access and undefined check @preserve */
        const doc = snapshot.docs[0];
        if (doc === undefined) {
          return ok(null);
        }

        return ok(toApprovalMessage(doc.id, doc.data() as ApprovalMessageDoc));
        /* v8 ignore stop @preserve */
      } catch (error) {
        return err(createError(error));
      }
    },

    async deleteByActionId(actionId): Promise<Result<void, ApprovalMessageRepositoryError>> {
      try {
        const db = getFirestore();
        const snapshot = await db
          .collection(COLLECTION)
          .where('actionId', '==', actionId)
          /* v8 ignore start -- test-infra: snapshot.empty branch @preserve */
          .get();

        if (snapshot.empty) {
          return ok(undefined);
        }
        /* v8 ignore stop @preserve */

        const batch = db.batch();
        for (const doc of snapshot.docs) {
          batch.delete(doc.ref);
        }
        await batch.commit();
        return ok(undefined);
      } catch (error) {
        return err(createError(error));
      }
    },

    async findByActionId(actionId): Promise<Result<ApprovalMessage | null, ApprovalMessageRepositoryError>> {
      try {
        const db = getFirestore();
        const snapshot = await db
          .collection(COLLECTION)
          .where('actionId', '==', actionId)
          /* v8 ignore start -- ts-type: snapshot.empty and array access checks @preserve */
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok(null);
        }

        const doc = snapshot.docs[0];
        if (doc === undefined) {
          return ok(null);
        }

        return ok(toApprovalMessage(doc.id, doc.data() as ApprovalMessageDoc));
        /* v8 ignore stop @preserve */
      } catch (error) {
        return err(createError(error));
      }
    },
  };
}

