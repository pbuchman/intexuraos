import { createHash, randomBytes } from 'node:crypto';
import { getFirestore } from '@intexuraos/infra-firestore';
import {
  notificationContextSchema,
  type NotificationContext,
  type NotificationRunState,
  type TransportConfirmation,
} from '@intexuraos/http-contracts';
import type { NotificationDeliveryRepository } from '../../domain/whatsapp/ports/notificationDeliveryRepository.js';

const INTENTS_COLLECTION = 'whatsapp_notification_intents';
const RECEIPTS_COLLECTION = 'whatsapp_transport_receipts';
const MARKERS_COLLECTION = 'whatsapp_notification_markers';
const RETENTION_SECONDS = 7 * 86400;
const MARKER_LIFETIME_MS = 6 * 3600000;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const runKey = (input: { userId: string; source: string; runId: string }): string =>
  hash(JSON.stringify([input.userId, input.source, input.runId]));
const receiptKey = (input: { phoneNumberId: string; wamid: string }): string =>
  hash(JSON.stringify([input.phoneNumberId, input.wamid]));
const expiry = (now: string): number => Math.floor(Date.parse(now) / 1000) + RETENTION_SECONDS;
interface MarkerDoc {
  marker: string;
  userId: string;
  source: string;
  runId: string;
  runKey: string;
  scheduledFor: string;
  validUntil: string;
  consumedMessageId?: string;
  skippedBeforeResume?: string;
  expiresAt: number;
}
interface IntentDoc {
  dispatchStatus: 'sending' | 'accepted' | 'retry_ready' | 'failed';
  userId: string;
  correlationId: string;
  producerKey: string;
  notificationContext?: NotificationContext;
  runKey?: string;
  createdAt: string;
  expiresAt: number;
  transportConfirmation: TransportConfirmation;
  acceptedAt?: string;
}
interface ReceiptDoc {
  transportConfirmation: TransportConfirmation;
  intentId?: string;
  expiresAt: number;
}

/** Provider statuses form a monotonic lattice: delivery/read evidence always wins over failure. */
export function mergeTransportConfirmation(
  previous: TransportConfirmation,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  at: string,
  failureCode?: string
): TransportConfirmation {
  if (status === 'sent') return previous;
  if (previous.status === 'read') return previous;
  if (status === 'read')
    return { status: 'read', deliveredAt: previous.deliveredAt ?? at, readAt: at };
  if (previous.status === 'delivered') return previous;
  if (status === 'delivered') return { status: 'delivered', deliveredAt: at };
  return { status: 'failed', failedAt: at, ...(failureCode === undefined ? {} : { failureCode }) };
}

export function summarizeNotificationParts(parts: IntentDoc[]): NotificationRunState {
  const finals = parts.filter((part) => part.notificationContext?.phase === 'final');
  if (
    finals.some(
      (part) =>
        part.notificationContext?.outcome === 'failed' ||
        part.transportConfirmation.status === 'failed'
    )
  )
    return { status: 'failed', stage: 'failed', failureCode: 'FINAL_RESPONSE_FAILED' };
  const expected = finals[0]?.notificationContext?.partCount;
  if (
    expected === undefined ||
    finals.length !== expected ||
    new Set(finals.map((part) => part.notificationContext?.partIndex)).size !== expected ||
    finals.some(
      (part) =>
        part.notificationContext?.partCount !== expected ||
        !['delivered', 'read'].includes(part.transportConfirmation.status)
    )
  )
    return { status: 'pending', stage: finals.length > 0 ? 'awaiting_delivery' : 'processing' };
  const deliveredAt = finals
    .map((part) => part.transportConfirmation.deliveredAt as string)
    .sort()
    .at(-1) as string;
  return { status: 'delivered', stage: 'delivered', deliveredAt };
}

export function createNotificationDeliveryRepository(): NotificationDeliveryRepository {
  const db = getFirestore();
  const loadOwnedIntent = async (input: {
    userId: string;
    idempotencyKey: string;
  }): Promise<IntentDoc | undefined> => {
    const snapshot = await db
      .collection(INTENTS_COLLECTION)
      .doc(hash(JSON.stringify([input.userId, input.idempotencyKey])))
      .get();
    if (!snapshot.exists) return undefined;
    const data = snapshot.data() as IntentDoc;
    return data.userId === input.userId ? data : undefined;
  };
  return {
    async register(input): ReturnType<NotificationDeliveryRepository['register']> {
      const ref = db.collection(MARKERS_COLLECTION).doc(runKey(input));
      return await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) return { marker: (existing.data() as MarkerDoc).marker };
        const marker = randomBytes(32).toString('hex');
        tx.set(ref, {
          ...input,
          runKey: runKey(input),
          marker,
          validUntil: new Date(Date.parse(input.now) + MARKER_LIFETIME_MS).toISOString(),
          expiresAt: expiry(input.now),
          ttlExpiresAt: new Date(expiry(input.now) * 1000),
        });
        return { marker };
      });
    },
    async consume(input): ReturnType<NotificationDeliveryRepository['consume']> {
      const matches = await db
        .collection(MARKERS_COLLECTION)
        .where('marker', '==', input.marker)
        .limit(1)
        .get();
      const doc = matches.docs[0];
      if (doc === undefined) return null;
      return await db.runTransaction(async (tx) => {
        const fresh = await tx.get(db.collection(MARKERS_COLLECTION).doc(doc.id));
        if (!fresh.exists) return null;
        const data = fresh.data() as MarkerDoc;
        if (
          data.userId !== input.userId ||
          data.skippedBeforeResume !== undefined ||
          data.validUntil <= input.now ||
          (data.consumedMessageId !== undefined && data.consumedMessageId !== input.messageId)
        )
          return null;
        tx.update(db.collection(MARKERS_COLLECTION).doc(doc.id), {
          consumedMessageId: input.messageId,
        });
        return { source: data.source, runId: data.runId, phase: 'ack' as const };
      });
    },
    async begin(input): ReturnType<NotificationDeliveryRepository['begin']> {
      const notificationContext =
        input.notificationContext === undefined
          ? undefined
          : notificationContextSchema.parse(input.notificationContext);
      const id = hash(JSON.stringify([input.userId, input.idempotencyKey]));
      const ref = db.collection(INTENTS_COLLECTION).doc(id);
      return await db.runTransaction(async (tx) => {
        if (notificationContext?.source === 'calendar') {
          const marker = await tx.get(
            db
              .collection(MARKERS_COLLECTION)
              .doc(runKey({ ...notificationContext, userId: input.userId }))
          );
          const data = marker.data() as MarkerDoc | undefined;
          // Validate authenticated ingress ownership before applying the operator's dispatch skip.
          if (
            !marker.exists ||
            data?.userId !== input.userId ||
            data.consumedMessageId === undefined ||
            data.consumedMessageId !== input.replyToMessageId
          )
            throw new Error('Notification ownership unavailable');
          if (data.skippedBeforeResume !== undefined) return { id, acquired: false };
          if (data.validUntil <= input.now) throw new Error('Notification ownership unavailable');
        }
        const existing = await tx.get(ref);
        if (existing.exists) {
          const dispatchStatus = (existing.data() as IntentDoc).dispatchStatus;
          if (
            dispatchStatus !== 'retry_ready' &&
            !(dispatchStatus === 'failed' && input.retryAuthorized === true)
          )
            return { id, acquired: false };
          tx.update(ref, {
            dispatchStatus: 'sending',
            transportConfirmation: { status: 'pending' },
          });
          return { id, acquired: true };
        }
        tx.set(ref, {
          dispatchStatus: 'sending',
          userId: input.userId,
          correlationId: input.correlationId,
          producerKey: input.producerKey ?? 'outbound',
          ...(notificationContext === undefined
            ? {}
            : {
                notificationContext,
                runKey: runKey({ ...notificationContext, userId: input.userId }),
              }),
          createdAt: input.now,
          expiresAt: expiry(input.now),
          ttlExpiresAt: new Date(expiry(input.now) * 1000),
          transportConfirmation: { status: 'pending' },
        });
        return { id, acquired: true };
      });
    },
    async accepted(input): ReturnType<NotificationDeliveryRepository['accepted']> {
      const intentRef = db.collection(INTENTS_COLLECTION).doc(input.intentId);
      const receiptRef = db.collection(RECEIPTS_COLLECTION).doc(receiptKey(input));
      await db.runTransaction(async (tx) => {
        const intent = await tx.get(intentRef);
        const receipt = await tx.get(receiptRef);
        if (!intent.exists) throw new Error('Notification intent missing');
        const confirmation = receipt.exists
          ? (receipt.data() as ReceiptDoc).transportConfirmation
          : { status: 'pending' as const };
        tx.update(intentRef, {
          dispatchStatus: 'accepted',
          acceptedAt: input.at,
          transportConfirmation: confirmation,
        });
        tx.set(receiptRef, {
          intentId: input.intentId,
          transportConfirmation: confirmation,
          expiresAt: expiry(input.at),
          ttlExpiresAt: new Date(expiry(input.at) * 1000),
        });
      });
    },
    async failed(input): ReturnType<NotificationDeliveryRepository['failed']> {
      const ref = db.collection(INTENTS_COLLECTION).doc(input.intentId);
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new Error('Notification intent missing');
        const previous = (snapshot.data() as IntentDoc).transportConfirmation;
        if (previous.status === 'delivered' || previous.status === 'read') return;
        tx.update(ref, {
          dispatchStatus: input.retryable === true ? 'retry_ready' : 'failed',
          transportConfirmation: mergeTransportConfirmation(
            (snapshot.data() as IntentDoc).transportConfirmation,
            'failed',
            input.at,
            input.failureCode
          ),
        });
      });
    },
    async recordReceipt(input): ReturnType<NotificationDeliveryRepository['recordReceipt']> {
      const ref = db.collection(RECEIPTS_COLLECTION).doc(receiptKey(input));
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const previous = snapshot.exists ? (snapshot.data() as ReceiptDoc) : undefined;
        const intentRef =
          previous?.intentId === undefined
            ? undefined
            : db.collection(INTENTS_COLLECTION).doc(previous.intentId);
        const intent = intentRef === undefined ? undefined : await tx.get(intentRef);
        const confirmation = mergeTransportConfirmation(
          previous?.transportConfirmation ?? { status: 'pending' },
          input.status,
          input.at,
          input.failureCode
        );
        tx.set(ref, {
          ...(previous?.intentId === undefined ? {} : { intentId: previous.intentId }),
          transportConfirmation: confirmation,
          expiresAt: expiry(input.at),
          ttlExpiresAt: new Date(expiry(input.at) * 1000),
        });
        if (intentRef !== undefined && intent?.exists === true)
          tx.update(intentRef, { transportConfirmation: confirmation });
      });
    },
    async getConfirmation(input): ReturnType<NotificationDeliveryRepository['getConfirmation']> {
      return (await loadOwnedIntent(input))?.transportConfirmation;
    },
    async getDeliveryObservation(
      input
    ): ReturnType<NotificationDeliveryRepository['getDeliveryObservation']> {
      const data = await loadOwnedIntent(input);
      if (data === undefined) return undefined;
      return {
        ...(data.acceptedAt === undefined ? {} : { acceptedAt: data.acceptedAt }),
        transportConfirmation: data.transportConfirmation,
      };
    },
    async getRun(input): ReturnType<NotificationDeliveryRepository['getRun']> {
      const [parts, marker] = await Promise.all([
        db.collection(INTENTS_COLLECTION).where('runKey', '==', runKey(input)).get(),
        db.collection(MARKERS_COLLECTION).doc(runKey(input)).get(),
      ]);
      const state = summarizeNotificationParts(parts.docs.map((doc) => doc.data() as IntentDoc));
      if (state.status !== 'pending') return state;
      if (!marker.exists) return { status: 'pending', stage: 'awaiting_ingress' };
      const data = marker.data() as MarkerDoc;
      if (data.validUntil <= new Date().toISOString())
        return { status: 'failed', stage: 'failed', failureCode: 'DELIVERY_EXPIRED' };
      if (data.consumedMessageId === undefined)
        return { status: 'pending', stage: 'awaiting_ingress' };
      return state;
    },
    async monitoring(now): ReturnType<NotificationDeliveryRepository['monitoring']> {
      const [intents, markers] = await Promise.all([
        db
          .collection(INTENTS_COLLECTION)
          .where('expiresAt', '>', Math.floor(Date.parse(now) / 1000))
          .get(),
        db
          .collection(MARKERS_COLLECTION)
          .where('expiresAt', '>', Math.floor(Date.parse(now) / 1000))
          .get(),
      ]);
      const all = intents.docs.map((doc) => doc.data() as IntentDoc);
      let pendingCount = 0;
      let failedCount = 0;
      let oldestPendingScheduledFor: string | null = null;
      let lastDeliveredAt: string | null = null;
      for (const doc of markers.docs) {
        const marker = doc.data() as MarkerDoc;
        const state = summarizeNotificationParts(
          all.filter((part) => part.runKey === marker.runKey)
        );
        const superseded = markers.docs.some((other) => {
          const next = other.data() as MarkerDoc;
          return (
            next.userId === marker.userId &&
            next.source === marker.source &&
            next.scheduledFor > marker.scheduledFor &&
            summarizeNotificationParts(all.filter((part) => part.runKey === next.runKey)).status ===
              'delivered'
          );
        });
        if (state.status === 'delivered') {
          const deliveredAt = state.deliveredAt as string;
          if (lastDeliveredAt === null || deliveredAt > lastDeliveredAt)
            lastDeliveredAt = deliveredAt;
        } else if (!superseded && marker.skippedBeforeResume === undefined) {
          if (state.status === 'failed' || marker.validUntil <= now) failedCount++;
          else {
            pendingCount++;
            if (
              oldestPendingScheduledFor === null ||
              marker.scheduledFor < oldestPendingScheduledFor
            )
              oldestPendingScheduledFor = marker.scheduledFor;
          }
        }
      }
      // Other producers (including digests) have no Matrix marker but still contribute transport state.
      for (const intent of all.filter(
        (part) => part.runKey === undefined && part.notificationContext?.phase !== 'ack'
      )) {
        const status = intent.transportConfirmation.status;
        const superseded = all.some(
          (next) =>
            next.userId === intent.userId &&
            next.producerKey === intent.producerKey &&
            next.createdAt > intent.createdAt &&
            ['delivered', 'read'].includes(next.transportConfirmation.status)
        );
        if (superseded && (status === 'pending' || status === 'failed')) continue;
        if (status === 'pending') {
          pendingCount++;
          if (oldestPendingScheduledFor === null || intent.createdAt < oldestPendingScheduledFor)
            oldestPendingScheduledFor = intent.createdAt;
        }
        if (status === 'failed') failedCount++;
        if (
          intent.transportConfirmation.deliveredAt !== undefined &&
          (lastDeliveredAt === null || intent.transportConfirmation.deliveredAt > lastDeliveredAt)
        )
          lastDeliveredAt = intent.transportConfirmation.deliveredAt;
      }
      return { pendingCount, failedCount, oldestPendingScheduledFor, lastDeliveredAt };
    },
  };
}
