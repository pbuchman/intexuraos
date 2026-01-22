/**
 * Firestore implementation of OutboundMessageRepository.
 */
import { err, ok, type Result, getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  OutboundMessage,
  OutboundMessageRepository,
} from '../../domain/whatsapp/ports/outboundMessageRepository.js';
import type { WhatsAppError } from '../../domain/whatsapp/ports/repositories.js';

const COLLECTION_NAME = 'whatsapp_outbound_messages';
// Messages expire after 7 days (enough time for reply correlation)
const TTL_DAYS = 7;

interface OutboundMessageDoc {
  wamid: string;
  correlationId: string;
  userId: string;
  sentAt: string;
  expiresAt: number;
}

function toDoc(message: OutboundMessage): OutboundMessageDoc {
  return {
    wamid: message.wamid,
    correlationId: message.correlationId,
    userId: message.userId,
    sentAt: message.sentAt,
    expiresAt: message.expiresAt,
  };
}

function toOutboundMessage(doc: OutboundMessageDoc): OutboundMessage {
  return {
    wamid: doc.wamid,
    correlationId: doc.correlationId,
    userId: doc.userId,
    sentAt: doc.sentAt,
    expiresAt: doc.expiresAt,
  };
}

/**
 * Creates an OutboundMessageRepository backed by Firestore.
 */
export function createOutboundMessageRepository(): OutboundMessageRepository {
  const db = getFirestore();

  return {
    async save(message: OutboundMessage): Promise<Result<void, WhatsAppError>> {
      try {
        const doc = toDoc(message);
        // Use wamid as document ID for efficient lookups
        await db.collection(COLLECTION_NAME).doc(message.wamid).set(doc);
        return ok(undefined);
      } catch (error) {
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `Failed to save outbound message: ${getErrorMessage(error)}`,
        });
      }
    },

    async findByWamid(wamid: string): Promise<Result<OutboundMessage | null, WhatsAppError>> {
      try {
        const docRef = db.collection(COLLECTION_NAME).doc(wamid);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
          return ok(null);
        }

        const data = snapshot.data() as OutboundMessageDoc;
        return ok(toOutboundMessage(data));
      } catch (error) {
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `Failed to find outbound message: ${getErrorMessage(error)}`,
        });
      }
    },

    async deleteByWamid(wamid: string): Promise<Result<void, WhatsAppError>> {
      try {
        await db.collection(COLLECTION_NAME).doc(wamid).delete();
        return ok(undefined);
      } catch (error) {
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `Failed to delete outbound message: ${getErrorMessage(error)}`,
        });
      }
    },
  };
}

/**
 * Helper to create an outbound message with TTL.
 *
 * The message includes an `expiresAt` Unix timestamp (seconds) for automatic
 * cleanup. Firestore TTL policy should be configured on this field to delete
 * documents after 7 days.
 *
 * CorrelationId format for approval messages: `action-{type}-approval-{actionId}`
 * This format is parsed by whatsapp-service to extract the actionId when
 * processing approval replies.
 *
 * @throws {Error} If required fields are empty strings
 */
export function createOutboundMessage(params: {
  wamid: string;
  correlationId: string;
  userId: string;
}): OutboundMessage {
  // Validate required fields are not empty
  // These are defensive checks - in practice, callers always provide valid values
  /* v8 ignore start */
  if (params.wamid.trim() === '') {
    throw new Error('wamid is required');
  }
  if (params.correlationId.trim() === '') {
    throw new Error('correlationId is required');
  }
  if (params.userId.trim() === '') {
    throw new Error('userId is required');
  }
  /* v8 ignore stop */

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);

  return {
    wamid: params.wamid,
    correlationId: params.correlationId,
    userId: params.userId,
    sentAt: now.toISOString(),
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
  };
}
