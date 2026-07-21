/**
 * Firestore implementation of OutboundMessageRepository.
 */
import { createHash } from 'node:crypto';

import { err, ok, type Result, getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  OutboundMessage,
  OutboundMessageRepository,
  IdempotentDeliveryMutationResult,
  IdempotentDeliveryReserveResult,
} from '../../domain/whatsapp/ports/outboundMessageRepository.js';
import type { WhatsAppError } from '../../domain/whatsapp/ports/repositories.js';

const COLLECTION_NAME = 'whatsapp_outbound_messages';
export const OUTBOUND_DELIVERY_RECEIPTS_COLLECTION = 'whatsapp_outbound_delivery_receipts';
// Messages expire after 7 days (enough time for reply correlation)
const TTL_DAYS = 7;
const SENDING_RECOVERY_DEADLINE_MS = 15 * 60 * 1000;
const SAFE_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

type OutboundDeliveryReceipt =
  | Readonly<{
      version: 1;
      idempotencyKeyDigest: string;
      payloadDigest: string;
      state: 'sending' | 'ambiguous';
      createdAt: string;
      updatedAt: string;
      expiresAt: number;
    }>
  | Readonly<{
      version: 1;
      idempotencyKeyDigest: string;
      payloadDigest: string;
      state: 'sent';
      outboundMessageDigest: string;
      createdAt: string;
      updatedAt: string;
      expiresAt: number;
    }>;

interface OutboundMessageDoc {
  wamid: string;
  correlationId: string;
  userId: string;
  messageText?: string;
  sentAt: string;
  expiresAt: number;
}

function toDoc(message: OutboundMessage): OutboundMessageDoc {
  return {
    wamid: message.wamid,
    correlationId: message.correlationId,
    userId: message.userId,
    ...(message.messageText !== undefined ? { messageText: message.messageText } : {}),
    sentAt: message.sentAt,
    expiresAt: message.expiresAt,
  };
}

function toOutboundMessage(doc: OutboundMessageDoc): OutboundMessage {
  return {
    wamid: doc.wamid,
    correlationId: doc.correlationId,
    userId: doc.userId,
    ...(doc.messageText !== undefined ? { messageText: doc.messageText } : {}),
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

    async reserveIdempotentDelivery(input): Promise<IdempotentDeliveryReserveResult> {
      if (!isValidReservationInput(input)) return { ok: false, code: 'INVALID_INPUT' };
      const idempotencyKeyDigest = sha256(input.idempotencyKey);
      const ref = db.collection(OUTBOUND_DELIVERY_RECEIPTS_COLLECTION).doc(idempotencyKeyDigest);
      try {
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref);
          if (snapshot.exists) {
            const existing = parseDeliveryReceipt(snapshot.data());
            if (existing === null) return { ok: false as const, code: 'CORRUPT_RECEIPT' as const };
            if (
              existing.idempotencyKeyDigest !== idempotencyKeyDigest ||
              existing.payloadDigest !== input.payloadDigest
            )
              return {
                ok: false as const,
                code: 'CORRELATED_REPLAY_CONFLICT' as const,
              };
            if (
              existing.state === 'sending' &&
              isPastSendingRecoveryDeadline(existing.updatedAt, input.now)
            ) {
              const ambiguous: OutboundDeliveryReceipt = {
                ...existing,
                state: 'ambiguous',
                updatedAt: input.now,
              };
              transaction.set(ref, ambiguous);
              return {
                ok: true as const,
                disposition: 'duplicate_ambiguous' as const,
              };
            }
            return {
              ok: true as const,
              disposition:
                existing.state === 'sent'
                  ? ('duplicate_sent' as const)
                  : existing.state === 'ambiguous'
                    ? ('duplicate_ambiguous' as const)
                    : ('duplicate_in_flight' as const),
            };
          }
          const receipt: OutboundDeliveryReceipt = {
            version: 1,
            idempotencyKeyDigest,
            payloadDigest: input.payloadDigest,
            state: 'sending',
            createdAt: input.now,
            updatedAt: input.now,
            expiresAt: input.expiresAt,
          };
          transaction.set(ref, receipt);
          return { ok: true as const, disposition: 'acquired' as const };
        });
      } catch {
        return { ok: false, code: 'PERSISTENCE_ERROR' };
      }
    },

    async completeIdempotentDelivery(input): Promise<IdempotentDeliveryMutationResult> {
      if (
        !isValidKeyAndDigest(input.idempotencyKey, input.payloadDigest) ||
        !isValidOutboundMessage(input.outboundMessage)
      )
        return { ok: false, code: 'INVALID_INPUT' };
      const idempotencyKeyDigest = sha256(input.idempotencyKey);
      const outboundMessageDigest = sha256(stableJson(toDoc(input.outboundMessage)));
      const receiptRef = db
        .collection(OUTBOUND_DELIVERY_RECEIPTS_COLLECTION)
        .doc(idempotencyKeyDigest);
      const outboundRef = db.collection(COLLECTION_NAME).doc(input.outboundMessage.wamid);
      try {
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(receiptRef);
          if (!snapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
          const existing = parseDeliveryReceipt(snapshot.data());
          if (existing === null) return { ok: false as const, code: 'CORRUPT_RECEIPT' as const };
          if (
            existing.idempotencyKeyDigest !== idempotencyKeyDigest ||
            existing.payloadDigest !== input.payloadDigest
          )
            return {
              ok: false as const,
              code: 'CORRELATED_REPLAY_CONFLICT' as const,
            };
          if (existing.state === 'ambiguous')
            return { ok: false as const, code: 'INVALID_STATE' as const };
          if (existing.state === 'sent')
            return existing.outboundMessageDigest === outboundMessageDigest
              ? { ok: true as const, disposition: 'already_applied' as const }
              : { ok: false as const, code: 'CORRELATED_REPLAY_CONFLICT' as const };
          const completed: OutboundDeliveryReceipt = {
            ...existing,
            state: 'sent',
            outboundMessageDigest,
            updatedAt: input.outboundMessage.sentAt,
          };
          transaction.set(outboundRef, toDoc(input.outboundMessage));
          transaction.set(receiptRef, completed);
          return { ok: true as const, disposition: 'applied' as const };
        });
      } catch {
        return { ok: false, code: 'PERSISTENCE_ERROR' };
      }
    },

    async markIdempotentDeliveryAmbiguous(input): Promise<IdempotentDeliveryMutationResult> {
      if (
        !isValidKeyAndDigest(input.idempotencyKey, input.payloadDigest) ||
        !isIsoTimestamp(input.now)
      )
        return { ok: false, code: 'INVALID_INPUT' };
      const idempotencyKeyDigest = sha256(input.idempotencyKey);
      const ref = db.collection(OUTBOUND_DELIVERY_RECEIPTS_COLLECTION).doc(idempotencyKeyDigest);
      try {
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
          const existing = parseDeliveryReceipt(snapshot.data());
          if (existing === null) return { ok: false as const, code: 'CORRUPT_RECEIPT' as const };
          if (
            existing.idempotencyKeyDigest !== idempotencyKeyDigest ||
            existing.payloadDigest !== input.payloadDigest
          )
            return {
              ok: false as const,
              code: 'CORRELATED_REPLAY_CONFLICT' as const,
            };
          if (existing.state === 'sent')
            return { ok: false as const, code: 'INVALID_STATE' as const };
          if (existing.state === 'ambiguous')
            return { ok: true as const, disposition: 'already_applied' as const };
          const ambiguous: OutboundDeliveryReceipt = {
            ...existing,
            state: 'ambiguous',
            updatedAt: input.now,
          };
          transaction.set(ref, ambiguous);
          return { ok: true as const, disposition: 'applied' as const };
        });
      } catch {
        return { ok: false, code: 'PERSISTENCE_ERROR' };
      }
    },
  };
}

function isValidReservationInput(
  input: Readonly<{
    idempotencyKey: string;
    payloadDigest: string;
    now: string;
    expiresAt: number;
  }>
): boolean {
  return (
    isValidKeyAndDigest(input.idempotencyKey, input.payloadDigest) &&
    isIsoTimestamp(input.now) &&
    Number.isSafeInteger(input.expiresAt) &&
    input.expiresAt > 0
  );
}

function isValidKeyAndDigest(idempotencyKey: string, payloadDigest: string): boolean {
  return SAFE_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey) && SHA_256_PATTERN.test(payloadDigest);
}

function isValidOutboundMessage(message: OutboundMessage): boolean {
  return (
    message.wamid.trim() !== '' &&
    message.correlationId.trim() !== '' &&
    message.userId.trim() !== '' &&
    isIsoTimestamp(message.sentAt) &&
    Number.isSafeInteger(message.expiresAt) &&
    message.expiresAt > 0
  );
}

function parseDeliveryReceipt(value: unknown): OutboundDeliveryReceipt | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const commonKeys = [
    'createdAt',
    'expiresAt',
    'idempotencyKeyDigest',
    'payloadDigest',
    'state',
    'updatedAt',
    'version',
  ];
  const expectedKeys =
    record['state'] === 'sent'
      ? [...commonKeys, 'outboundMessageDigest'].sort()
      : commonKeys.sort();
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => actualKeys[index] !== key) ||
    record['version'] !== 1 ||
    typeof record['idempotencyKeyDigest'] !== 'string' ||
    !SHA_256_PATTERN.test(record['idempotencyKeyDigest']) ||
    typeof record['payloadDigest'] !== 'string' ||
    !SHA_256_PATTERN.test(record['payloadDigest']) ||
    (record['state'] !== 'sending' &&
      record['state'] !== 'sent' &&
      record['state'] !== 'ambiguous') ||
    typeof record['createdAt'] !== 'string' ||
    !isIsoTimestamp(record['createdAt']) ||
    typeof record['updatedAt'] !== 'string' ||
    !isIsoTimestamp(record['updatedAt']) ||
    !Number.isSafeInteger(record['expiresAt']) ||
    Number(record['expiresAt']) <= 0 ||
    (record['state'] === 'sent' &&
      (typeof record['outboundMessageDigest'] !== 'string' ||
        !SHA_256_PATTERN.test(record['outboundMessageDigest'])))
  )
    return null;
  return record as unknown as OutboundDeliveryReceipt;
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isPastSendingRecoveryDeadline(updatedAt: string, now: string): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  const nowMs = Date.parse(now);
  return (
    Number.isFinite(updatedAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs - updatedAtMs >= SENDING_RECOVERY_DEADLINE_MS
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableJson(value: OutboundMessageDoc): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    )
  );
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
  if (params.wamid.trim() === '') {
    throw new Error('wamid is required');
  }
  if (params.correlationId.trim() === '') {
    throw new Error('correlationId is required');
  }
  if (params.userId.trim() === '') {
    throw new Error('userId is required');
  }

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
