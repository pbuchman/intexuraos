import {
  FieldValue,
  Timestamp,
  getFirestore,
} from '@intexuraos/infra-firestore';
import type {
  ConversationAssistantContextAttachmentAccessRepository,
  ConversationAssistantContextAttachmentPreparationRepository,
  ConversationAssistantContextAttachmentRepository,
} from '../../domain/conversation-assistant/contextAttachmentPorts.js';
import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantContextAttachmentCounts,
  ConversationAssistantContextAttachmentPreparedSnapshot,
  ConversationAssistantContextSnapshotSummary,
} from '../../domain/conversation-assistant/types.js';
import { verifyConversationAssistantPreparedSnapshotIntegrity } from '../../domain/conversation-assistant/preparedSnapshotIntegrity.js';
import {
  recordConversationAssistantTelemetry,
  type ConversationAssistantOperationalTelemetry,
} from '../../domain/conversation-assistant/operationalTelemetry.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
} from './privateWhatsAppRepository.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
} from './conversationAssistantRepository.js';
import { conversationAssistantSessionReadFenceAllows } from './conversationAssistantReadFence.js';

export { WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION };

export const WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION =
  'whatsapp_conversation_assistant_context_attachments';
export const CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_DRAFT_TTL_MS = 30 * 60 * 1000;
export const CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_CHUNK_MAX_BYTES = 150_000;
export const CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS = 400;

export type ContextAttachmentFirestoreRepository =
  ConversationAssistantContextAttachmentRepository &
  ConversationAssistantContextAttachmentPreparationRepository &
  ConversationAssistantContextAttachmentAccessRepository;
type ResolveResult = Awaited<
  ReturnType<ConversationAssistantContextAttachmentRepository['resolveContextAttachmentSession']>
>;
type CaptureResult = Awaited<
  ReturnType<ConversationAssistantContextAttachmentRepository['captureContextAttachment']>
>;
type FailQueuedResult = Awaited<
  ReturnType<
    ConversationAssistantContextAttachmentRepository['failQueuedContextAttachmentPreparation']
  >
>;
type ClaimResult = Awaited<
  ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['claimContextAttachmentPreparation']
  >
>;
type PersistSnapshotResult = Awaited<
  ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['persistContextAttachmentPreparedSnapshot']
  >
>;
type CompletePreparationResult = Awaited<
  ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['completeContextAttachmentPreparation']
  >
>;
type FailPreparationResult = Awaited<
  ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['failContextAttachmentPreparation']
  >
>;
type RequeueResult = Awaited<
  ReturnType<
    ConversationAssistantContextAttachmentPreparationRepository['requeueContextAttachmentPreparation']
  >
>;
type GetOwnedResult = Awaited<
  ReturnType<ConversationAssistantContextAttachmentAccessRepository['getOwnedContextAttachment']>
>;
type LoadOwnedPreparedSnapshotResult = Awaited<
  ReturnType<
    ConversationAssistantContextAttachmentAccessRepository['loadOwnedContextAttachmentPreparedSnapshot']
  >
>;
type DeleteOwnedDraftResult = Awaited<
  ReturnType<
    ConversationAssistantContextAttachmentAccessRepository['deleteOwnedContextAttachmentDraft']
  >
>;
type ListOwnedHistoryResult = Awaited<
  ReturnType<ConversationAssistantContextAttachmentAccessRepository['listOwnedContextHistory']>
>;

interface ContinuationBoundary {
  sourceAccountId: string;
  contextVersion: number;
  contextEventThrough: string;
  contextChangeThrough: number;
  contextChainSha256: string;
}

export function createConversationAssistantContextAttachmentRepository(
  options: { telemetry?: ConversationAssistantOperationalTelemetry } = {}
): ContextAttachmentFirestoreRepository {
  return {
    async resolveContextAttachmentSession(input): Promise<ResolveResult> {
      const db = getFirestore();
      const sessionSnapshot = await db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId)
        .get();
      if (!sessionSnapshot.exists) return { status: 'not_found' };
      const data = asOptionalRecord(sessionSnapshot.data());
      if (
        data?.['userId'] !== input.userId ||
        typeof data['generationId'] !== 'string' ||
        typeof data['deletionStartedAt'] === 'string' ||
        !isAttachmentEligibleSessionStatus(data['status'])
      ) {
        return { status: 'not_found' };
      }
      const continuation = parseContinuation(data['continuation']);
      if (continuation === null) {
        return { status: 'unsupported', reason: 'legacy_session' };
      }
      const chatId = data['chatId'];
      const sourceAccountGeneration = data['sourceAccountGeneration'];
      if (
        typeof chatId !== 'string' ||
        data['sourceAccountId'] !== continuation.sourceAccountId ||
        typeof sourceAccountGeneration !== 'string' ||
        sourceAccountGeneration.length === 0
      ) {
        return { status: 'unsupported', reason: 'source_unavailable' };
      }
      const accountSnapshot = await db
        .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
        .doc(input.userId)
        .get();
      if (
        !sourceAccountMatches(
          accountSnapshot.data(),
          input.userId,
          continuation.sourceAccountId,
          sourceAccountGeneration
        )
      ) {
        return { status: 'unsupported', reason: 'source_unavailable' };
      }
      const chatSnapshot = await db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(chatId).get();
      if (!sourceChatMatches(chatSnapshot.data(), input.userId, continuation.sourceAccountId)) {
        return { status: 'unsupported', reason: 'source_unavailable' };
      }
      return { status: 'found', sessionGenerationId: data['generationId'] };
    },

    async captureContextAttachment(input): Promise<CaptureResult> {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const attachmentRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(input.attachmentId);
      const expireAt = Timestamp.fromMillis(
        Date.now() + CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_DRAFT_TTL_MS
      );
      const outcome = await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        if (!sessionSnapshot.exists) return { status: 'not_found' as const };
        const sessionData = asOptionalRecord(sessionSnapshot.data());
        if (
          sessionData?.['userId'] !== input.userId ||
          typeof sessionData['deletionStartedAt'] === 'string'
        ) {
          return { status: 'not_found' as const };
        }
        if (sessionData['generationId'] !== input.expectedSessionGenerationId) {
          return { status: 'stale' as const };
        }
        if (!isAttachmentEligibleSessionStatus(sessionData['status'])) {
          return { status: 'stale' as const };
        }
        const continuation = parseContinuation(sessionData['continuation']);
        if (continuation === null) {
          return {
            status: 'unsupported' as const,
            reason: 'legacy_session' as const,
          };
        }
        const chatId = sessionData['chatId'];
        const sourceAccountGeneration = sessionData['sourceAccountGeneration'];
        const initialContextFrom = parseInitialContextFrom(sessionData['range']);
        if (
          typeof chatId !== 'string' ||
          initialContextFrom === null ||
          sessionData['sourceAccountId'] !== continuation.sourceAccountId ||
          typeof sourceAccountGeneration !== 'string' ||
          sourceAccountGeneration.length === 0
        ) {
          return {
            status: 'unsupported' as const,
            reason: 'source_unavailable' as const,
          };
        }
        const accountRef = db
          .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
          .doc(input.userId);
        const accountSnapshot = await transaction.get(accountRef);
        if (
          !accountSnapshot.exists ||
          !sourceAccountMatches(
            accountSnapshot.data(),
            input.userId,
            continuation.sourceAccountId,
            sourceAccountGeneration
          )
        ) {
          return {
            status: 'unsupported' as const,
            reason: 'source_unavailable' as const,
          };
        }
        const chatRef = db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(chatId);
        const chatSnapshot = await transaction.get(chatRef);
        if (
          !chatSnapshot.exists ||
          !sourceChatMatches(chatSnapshot.data(), input.userId, continuation.sourceAccountId)
        ) {
          return {
            status: 'unsupported' as const,
            reason: 'source_unavailable' as const,
          };
        }
        const existingSnapshot = await transaction.get(attachmentRef);
        if (existingSnapshot.exists) {
          const existing = toContextAttachment(existingSnapshot.id, existingSnapshot.data());
          if (
            existing.userId !== input.userId ||
            existing.sessionId !== input.sessionId ||
            existing.sessionGenerationId !== input.expectedSessionGenerationId
          ) {
            return { status: 'not_found' as const };
          }
          if (
            existing.preparationRequestFingerprint !== input.preparationRequestFingerprint
          ) {
            return { status: 'conflict' as const };
          }
          return { status: 'replay' as const };
        }

        if (input.replacesAttachmentId !== undefined) {
          const replacementRef = db
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
            .doc(input.replacesAttachmentId);
          const replacementSnapshot = await transaction.get(replacementRef);
          const replacementData = asOptionalRecord(replacementSnapshot.data());
          const ownsCurrentReplacement =
            replacementSnapshot.exists &&
            replacementData?.['userId'] === input.userId &&
            replacementData['sessionId'] === input.sessionId &&
            replacementData['sessionGenerationId'] === input.expectedSessionGenerationId;
          if (ownsCurrentReplacement) {
            let replacement: ConversationAssistantContextAttachment;
            try {
              replacement = toContextAttachment(replacementSnapshot.id, replacementData);
            } catch {
              return { status: 'stale' as const };
            }
            if (replacement.status === 'committed') {
              return { status: 'stale' as const };
            }
            transaction.update(replacementRef, {
              status: 'expired',
              replacedByAttachmentId: input.attachmentId,
              preparationClaimId: FieldValue.delete(),
              preparationLeaseExpiresAt: FieldValue.delete(),
            });
          }
        }

        const storedCutoffChangeSeq = asOptionalRecord(chatSnapshot.data())?.[
          'contextChangeSequence'
        ];
        const cutoffChangeSeq = storedCutoffChangeSeq === undefined ? 0 : storedCutoffChangeSeq;
        if (
          typeof cutoffChangeSeq !== 'number' ||
          !Number.isInteger(cutoffChangeSeq) ||
          cutoffChangeSeq < continuation.contextChangeThrough
        ) {
          return {
            status: 'unsupported' as const,
            reason: 'source_unavailable' as const,
          };
        }
        const attachmentDocument: Record<string, unknown> = {
          userId: input.userId,
          sessionId: input.sessionId,
          sessionGenerationId: input.expectedSessionGenerationId,
          sourceAccountId: continuation.sourceAccountId,
          sourceAccountGeneration,
          chatId,
          preparationRequestId: input.preparationRequestId,
          preparationRequestFingerprint: input.preparationRequestFingerprint,
          status: 'queued',
          initialContextFrom,
          baseContextVersion: continuation.contextVersion,
          baseEventThrough: continuation.contextEventThrough,
          capturedAt: FieldValue.serverTimestamp(),
          baseChangeSeq: continuation.contextChangeThrough,
          cutoffChangeSeq,
          captureRange: {
            from: continuation.contextEventThrough,
            to: FieldValue.serverTimestamp(),
          },
          counts: emptyCounts(),
          omitted: emptyOmittedCounts(),
          previousContextChainSha256: continuation.contextChainSha256,
          requiresConfirmation: false,
          preparationAttempt: 1,
          expireAt,
          newerAvailableCount: 0,
          newerAvailableCorrectionCount: 0,
        };
        if (input.replacesAttachmentId !== undefined) {
          attachmentDocument['replacesAttachmentId'] = input.replacesAttachmentId;
        }
        transaction.set(attachmentRef, attachmentDocument);
        return { status: 'created' as const };
      });

      if (outcome.status !== 'created' && outcome.status !== 'replay') return outcome;
      const saved = await attachmentRef.get();
      if (!saved.exists) return { status: 'not_found' };
      return {
        status: outcome.status,
        attachment: toContextAttachment(saved.id, saved.data()),
      };
    },

    async failQueuedContextAttachmentPreparation(input): Promise<FailQueuedResult> {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const attachmentRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(input.attachmentId);
      const outcome = await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const attachmentSnapshot = await transaction.get(attachmentRef);
        const validation = validatePreparationOwnership({
          sessionData: sessionSnapshot.data(),
          attachmentData: attachmentSnapshot.data(),
          userId: input.userId,
          sessionId: input.sessionId,
          expectedSessionGenerationId: input.expectedSessionGenerationId,
        });
        if (validation === 'not_found') return { status: 'not_found' as const };
        if (validation === 'stale') {
          return {
            status: 'stale' as const,
            attachment: toContextAttachment(
              attachmentSnapshot.id,
              attachmentSnapshot.data()
            ),
          };
        }
        const attachment = toContextAttachment(
          attachmentSnapshot.id,
          attachmentSnapshot.data()
        );
        if (
          attachment.status !== 'queued' ||
          attachment.preparationAttempt !== input.attempt ||
          attachment.preparationClaimId !== undefined
        ) {
          return { status: 'stale' as const, attachment };
        }
        transaction.update(attachmentRef, {
          status: 'failed',
          preparationError: input.error,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { status: 'failed' as const };
      });
      if (outcome.status !== 'failed') return outcome;
      const saved = await attachmentRef.get();
      if (!saved.exists) return { status: 'not_found' };
      return {
        status: 'failed',
        attachment: toContextAttachment(saved.id, saved.data()),
      };
    },
    async claimContextAttachmentPreparation(input): Promise<ClaimResult> {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const attachmentRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(input.attachmentId);
      return await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const attachmentSnapshot = await transaction.get(attachmentRef);
        const validation = validatePreparationOwnership({
          sessionData: sessionSnapshot.data(),
          attachmentData: attachmentSnapshot.data(),
          userId: input.userId,
          sessionId: input.sessionId,
          expectedSessionGenerationId: input.expectedSessionGenerationId,
        });
        if (validation !== 'ok') return { status: validation };
        if (
          !(await sourceAccountAllowsAttachmentPreparation(
            transaction,
            db,
            sessionSnapshot.data(),
            attachmentSnapshot.data(),
            input.userId
          ))
        ) {
          return { status: 'stale' as const };
        }
        const attachment = toContextAttachment(
          attachmentSnapshot.id,
          attachmentSnapshot.data()
        );
        if (isExpired(attachment, input.now)) {
          transaction.update(attachmentRef, expiredAttachmentUpdate());
          return { status: 'expired' as const };
        }
        if (attachment.preparationAttempt !== input.attempt) {
          return { status: 'stale' as const };
        }
        if (attachment.status === 'preparing') {
          if (attachment.preparationClaimId === input.claimId) {
            return { status: 'claimed' as const, attachment };
          }
          if (
            attachment.preparationLeaseExpiresAt !== undefined &&
            attachment.preparationLeaseExpiresAt > input.now
          ) {
            return { status: 'busy' as const };
          }
        } else if (attachment.status !== 'queued') {
          return { status: 'stale' as const };
        }
        transaction.update(attachmentRef, {
          status: 'preparing',
          preparationClaimId: input.claimId,
          preparationLeaseExpiresAt: input.leaseExpiresAt,
          preparationError: FieldValue.delete(),
        });
        return {
          status: 'claimed' as const,
          attachment: {
            ...attachment,
            status: 'preparing' as const,
            preparationClaimId: input.claimId,
            preparationLeaseExpiresAt: input.leaseExpiresAt,
          },
        };
      });
    },
    async persistContextAttachmentPreparedSnapshot(input): Promise<PersistSnapshotResult> {
      const db = getFirestore();
      const attachmentRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(input.attachmentId);
      const serialized = serializePreparedSnapshot(input.prepared);
      const payloads = splitBuffer(serialized, CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_CHUNK_MAX_BYTES)
        .map((part) => part.toString('base64'));
      if (
        payloads.length > input.maxChunkCount ||
        payloads.length > CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS
      ) {
        return { status: 'too_large' as const, chunkCount: payloads.length };
      }
      const chunkIds = payloads.map((_payload, index) =>
        contextAttachmentChunkId(input.sessionId, input.snapshotId, index)
      );
      const savedChunkIds: string[] = [];
      for (const [chunkIndex, payload] of payloads.entries()) {
        const outcome = await db.runTransaction(async (transaction) => {
          const sessionRef = db
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
            .doc(input.sessionId);
          const sessionSnapshot = await transaction.get(sessionRef);
          const attachmentSnapshot = await transaction.get(attachmentRef);
          const validation = validatePreparationFence({
            sessionData: sessionSnapshot.data(),
            attachmentData: attachmentSnapshot.data(),
            input,
          });
          if (validation !== 'ok') return validation;
          if (
            !(await sourceAccountAllowsAttachmentPreparation(
              transaction,
              db,
              sessionSnapshot.data(),
              attachmentSnapshot.data(),
              input.userId
            ))
          ) {
            return 'stale' as const;
          }
          const attachment = toContextAttachment(
            attachmentSnapshot.id,
            attachmentSnapshot.data()
          );
          if (isExpired(attachment, input.now)) return 'expired' as const;
          const expireAt = asOptionalRecord(attachmentSnapshot.data())?.['expireAt'];
          if (!isTimestamp(expireAt)) return 'expired' as const;
          const chunkId = contextAttachmentChunkId(
            input.sessionId,
            input.snapshotId,
            chunkIndex
          );
          transaction.set(
            db
              .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
              .doc(chunkId),
            {
              sessionId: input.sessionId,
              userId: input.userId,
              sessionGenerationId: input.expectedSessionGenerationId,
              sourceAccountId: attachment.sourceAccountId,
              sourceAccountGeneration: attachment.sourceAccountGeneration,
              attachmentId: input.attachmentId,
              snapshotId: input.snapshotId,
              chunkIndex,
              chunkCount: payloads.length,
              encoding: 'base64-json',
              payload,
              byteLength: serialized.length,
              preparationAttempt: input.attempt,
              preparationClaimId: input.claimId,
              expireAt,
            }
          );
          return 'saved' as const;
        });
        if (outcome !== 'saved') {
          await deletePreparedSnapshotChunks(db, {
            ...input,
            chunkIds: savedChunkIds,
          });
          if (savedChunkIds.length > 0) {
            await recordConversationAssistantTelemetry(options.telemetry, {
              operation: 'attachment_preparation',
              outcome: 'partial',
              orphanCleanupCount: savedChunkIds.length,
            });
          }
          return { status: outcome };
        }
        savedChunkIds.push(
          contextAttachmentChunkId(input.sessionId, input.snapshotId, chunkIndex)
        );
      }
      return {
        status: 'saved' as const,
        manifest: { chunkIds, chunkCount: chunkIds.length },
      };
    },
    async completeContextAttachmentPreparation(input): Promise<CompletePreparationResult> {
      if (
        input.manifest.chunkCount !== input.manifest.chunkIds.length ||
        input.manifest.chunkCount > CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS ||
        new Set(input.manifest.chunkIds).size !== input.manifest.chunkIds.length
      ) {
        return { status: 'missing_chunks' };
      }
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const attachmentRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(input.attachmentId);
      const outcome = await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const attachmentSnapshot = await transaction.get(attachmentRef);
        const validation = validatePreparationFence({
          sessionData: sessionSnapshot.data(),
          attachmentData: attachmentSnapshot.data(),
          input,
        });
        if (validation !== 'ok') return { status: validation };
        if (
          !(await sourceAccountAllowsAttachmentPreparation(
            transaction,
            db,
            sessionSnapshot.data(),
            attachmentSnapshot.data(),
            input.userId
          ))
        ) {
          return { status: 'stale' as const };
        }
        const current = toContextAttachment(
          attachmentSnapshot.id,
          attachmentSnapshot.data()
        );
        if (isExpired(current, input.now)) {
          return { status: 'expired' as const };
        }
        const decodedParts: Buffer[] = [];
        for (const [chunkIndex, chunkId] of input.manifest.chunkIds.entries()) {
          if (chunkId !== contextAttachmentChunkId(input.sessionId, input.snapshotId, chunkIndex)) {
            return { status: 'missing_chunks' as const };
          }
          const chunkSnapshot = await transaction.get(
            db
              .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
              .doc(chunkId)
          );
          if (
            !chunkSnapshot.exists ||
            !validPreparedChunk({
              data: chunkSnapshot.data(),
              input,
              sourceAccountId: current.sourceAccountId,
              sourceAccountGeneration: current.sourceAccountGeneration,
              chunkIndex,
              chunkCount: input.manifest.chunkCount,
            })
          ) {
            return { status: 'missing_chunks' as const };
          }
          const chunkData = asOptionalRecord(chunkSnapshot.data());
          const chunkExpireAt = chunkData?.['expireAt'];
          if (!isTimestamp(chunkExpireAt) || chunkExpireAt.toDate().toISOString() <= input.now) {
            return { status: 'missing_chunks' as const };
          }
          decodedParts.push(Buffer.from(String(chunkData?.['payload']), 'base64'));
        }
        if (!Buffer.concat(decodedParts).equals(serializePreparedSnapshot(input.prepared))) {
          return { status: 'missing_chunks' as const };
        }
        const readyUpdate = preparedAttachmentUpdate(input);
        transaction.update(attachmentRef, readyUpdate);
        return { status: 'ready' as const };
      });
      if (outcome.status !== 'ready') return outcome;
      const saved = await attachmentRef.get();
      if (!saved.exists) return { status: 'not_found' };
      return {
        status: 'ready',
        attachment: toContextAttachment(saved.id, saved.data()),
      };
    },
    async failContextAttachmentPreparation(input): Promise<FailPreparationResult> {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const attachmentRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(input.attachmentId);
      const outcome = await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const attachmentSnapshot = await transaction.get(attachmentRef);
        const validation = validatePreparationFence({
          sessionData: sessionSnapshot.data(),
          attachmentData: attachmentSnapshot.data(),
          input,
        });
        if (validation !== 'ok') return { status: validation };
        if (
          !(await sourceAccountAllowsAttachmentPreparation(
            transaction,
            db,
            sessionSnapshot.data(),
            attachmentSnapshot.data(),
            input.userId
          ))
        ) {
          return { status: 'stale' as const };
        }
        const attachment = toContextAttachment(
          attachmentSnapshot.id,
          attachmentSnapshot.data()
        );
        if (isExpired(attachment, input.now)) {
          transaction.update(attachmentRef, expiredAttachmentUpdate());
          return { status: 'expired' as const };
        }
        transaction.update(attachmentRef, {
          status: 'failed',
          preparationError: input.error,
          preparationClaimId: FieldValue.delete(),
          preparationLeaseExpiresAt: FieldValue.delete(),
          updatedAt: input.now,
        });
        return { status: 'failed' as const };
      });
      if (outcome.status !== 'failed') return outcome;
      const saved = await attachmentRef.get();
      if (!saved.exists) return { status: 'not_found' };
      return {
        status: 'failed',
        attachment: toContextAttachment(saved.id, saved.data()),
      };
    },
    async deleteContextAttachmentPreparedSnapshot(input): Promise<void> {
      await deletePreparedSnapshotChunks(getFirestore(), {
        ...input,
        expectedSessionGenerationId: input.expectedSessionGenerationId,
      });
    },
    async requeueContextAttachmentPreparation(input): Promise<RequeueResult> {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const attachmentRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(input.attachmentId);
      const outcome = await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const attachmentSnapshot = await transaction.get(attachmentRef);
        const validation = validatePreparationOwnership({
          sessionData: sessionSnapshot.data(),
          attachmentData: attachmentSnapshot.data(),
          userId: input.userId,
          sessionId: input.sessionId,
          expectedSessionGenerationId: input.expectedSessionGenerationId,
        });
        if (validation !== 'ok') return { status: validation };
        if (
          !(await sourceAccountAllowsAttachmentPreparation(
            transaction,
            db,
            sessionSnapshot.data(),
            attachmentSnapshot.data(),
            input.userId
          ))
        ) {
          return { status: 'stale' as const };
        }
        const attachment = toContextAttachment(
          attachmentSnapshot.id,
          attachmentSnapshot.data()
        );
        if (isExpired(attachment, input.updatedAt)) {
          transaction.update(attachmentRef, expiredAttachmentUpdate());
          return { status: 'expired' as const };
        }
        if (attachment.status !== 'failed') {
          return { status: 'invalid_state' as const };
        }
        transaction.update(attachmentRef, {
          status: 'queued',
          preparationAttempt: attachment.preparationAttempt + 1,
          preparationClaimId: FieldValue.delete(),
          preparationLeaseExpiresAt: FieldValue.delete(),
          preparationError: FieldValue.delete(),
          updatedAt: input.updatedAt,
        });
        return { status: 'queued' as const };
      });
      if (outcome.status !== 'queued') return outcome;
      const saved = await attachmentRef.get();
      if (!saved.exists) return { status: 'not_found' };
      return {
        status: 'queued',
        attachment: toContextAttachment(saved.id, saved.data()),
      };
    },
    async getOwnedContextAttachment(input): Promise<GetOwnedResult> {
      const owned = await loadOwnedContextAttachment(input);
      return owned === null ? { status: 'not_found' as const } : { status: 'found' as const, ...owned };
    },
    async loadOwnedContextAttachmentPreparedSnapshot(
      input
    ): Promise<LoadOwnedPreparedSnapshotResult> {
      const owned = await loadOwnedContextAttachment(input);
      if (owned === null) return { status: 'not_found' as const };
      const { attachment } = owned;
      if (
        attachment.status === 'expired' ||
        (attachment.status !== 'committed' &&
          attachment.expiresAt !== undefined &&
          attachment.expiresAt <= input.now)
      ) {
        return { status: 'not_found' as const };
      }
      if (
        (attachment.status !== 'ready' && attachment.status !== 'committed') ||
        attachment.snapshotId === undefined ||
        attachment.chunkManifest === undefined ||
        !validChunkManifest(attachment.chunkManifest)
      ) {
        return { status: 'snapshot_unavailable' as const };
      }
      const db = getFirestore();
      const parts: Buffer[] = [];
      for (const [chunkIndex, chunkId] of attachment.chunkManifest.chunkIds.entries()) {
        const chunkSnapshot = await db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc(chunkId)
          .get();
        if (
          !chunkSnapshot.exists ||
          !validOwnedSnapshotChunk({
            data: chunkSnapshot.data(),
            attachment,
            chunkIndex,
            chunkCount: attachment.chunkManifest.chunkCount,
          })
        ) {
          return { status: 'snapshot_unavailable' as const };
        }
        const payload = asOptionalRecord(chunkSnapshot.data())?.['payload'];
        const chunkExpireAt = asOptionalRecord(chunkSnapshot.data())?.['expireAt'];
        if (
          (attachment.status === 'committed' && chunkExpireAt !== undefined) ||
          (attachment.status !== 'committed' &&
            (!isTimestamp(chunkExpireAt) ||
              chunkExpireAt.toDate().toISOString() <= input.now))
        ) {
          return { status: 'snapshot_unavailable' as const };
        }
        if (typeof payload !== 'string' || !isCanonicalBase64(payload)) {
          return { status: 'snapshot_unavailable' as const };
        }
        parts.push(Buffer.from(payload, 'base64'));
      }
      const snapshot = parsePreparedSnapshot(Buffer.concat(parts));
      if (snapshot === null) {
        return { status: 'snapshot_unavailable' as const };
      }
      if (
        snapshot.deltaTranscriptSha256 !== attachment.deltaTranscriptSha256 ||
        snapshot.previousContextChainSha256 !== attachment.previousContextChainSha256 ||
        snapshot.resultingContextChainSha256 !== attachment.resultingContextChainSha256 ||
        !verifyConversationAssistantPreparedSnapshotIntegrity(snapshot)
      ) {
        await recordConversationAssistantTelemetry(options.telemetry, {
          operation: 'chain_verification',
          outcome: 'mismatch',
        });
        return { status: 'snapshot_unavailable' as const };
      }
      await recordConversationAssistantTelemetry(options.telemetry, {
        operation: 'chain_verification',
        outcome: 'completed',
      });
      return { status: 'found' as const, ...owned, snapshot };
    },
    async deleteOwnedContextAttachmentDraft(input): Promise<DeleteOwnedDraftResult> {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const attachmentRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .doc(input.attachmentId);
      const result = await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const attachmentSnapshot = await transaction.get(attachmentRef);
        if (
          !(await conversationAssistantSessionReadFenceAllows({
            db,
            transaction,
            sessionData: sessionSnapshot.data(),
            expectedUserId: input.userId,
          }))
        ) {
          return { status: 'not_found' as const, chunkIds: [] as string[] };
        }
        const owned = parseOwnedContextAttachment({
          sessionData: sessionSnapshot.data(),
          attachmentId: attachmentSnapshot.id,
          attachmentData: attachmentSnapshot.data(),
          userId: input.userId,
          sessionId: input.sessionId,
        });
        if (owned === null) return { status: 'not_found' as const, chunkIds: [] as string[] };
        if (owned.attachment.status === 'committed') {
          return { status: 'committed' as const, chunkIds: [] as string[] };
        }
        if (owned.attachment.status !== 'expired') {
          transaction.update(attachmentRef, expiredAttachmentUpdate());
        }
        return {
          status: 'deleted' as const,
          chunkIds: owned.attachment.chunkManifest?.chunkIds ?? [],
          attachment: owned.attachment,
        };
      });
      if (result.status !== 'deleted') return { status: result.status };
      for (const chunkId of result.chunkIds) {
        const chunkRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
          .doc(chunkId);
        await db.runTransaction(async (transaction) => {
          const chunkSnapshot = await transaction.get(chunkRef);
          if (
            chunkSnapshot.exists &&
            chunkBelongsToOwnedAttachment(chunkSnapshot.data(), result.attachment)
          ) {
            transaction.delete(chunkRef);
          }
        });
      }
      return { status: 'deleted' as const };
    },
    async listOwnedContextHistory(input): Promise<ListOwnedHistoryResult> {
      const db = getFirestore();
      const sessionSnapshot = await db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId)
        .get();
      const sessionData = asOptionalRecord(sessionSnapshot.data());
      if (
        !(await conversationAssistantSessionReadFenceAllows({
          db,
          sessionData,
          expectedUserId: input.userId,
        }))
      ) {
        return { status: 'not_found' as const };
      }
      const initial = parseInitialContextHistorySummary(sessionData, input.userId);
      if (initial === null) return { status: 'not_found' as const };
      const attachmentSnapshots = await db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
        .where('sessionId', '==', input.sessionId)
        .where('userId', '==', input.userId)
        .orderBy('capturedAt', 'asc')
        .get();
      const updates: (ConversationAssistantContextSnapshotSummary & {
        attachmentId: string;
      })[] = [];
      for (const snapshot of attachmentSnapshots.docs) {
        const raw = asOptionalRecord(snapshot.data());
        if (raw?.['status'] !== 'committed') continue;
        if (raw['sessionGenerationId'] !== initial.sessionGenerationId) {
          continue;
        }
        let committed: ConversationAssistantContextAttachment;
        try {
          committed = toContextAttachment(snapshot.id, raw);
        } catch {
          return { status: 'not_found' as const };
        }
        updates.push({
          kind: 'update',
          contextVersion: committed.baseContextVersion + 1,
          capturedAt: committed.capturedAt,
          messageCount: committed.counts.included,
          excludedCount: committed.counts.omitted,
          correctionCount:
            committed.counts.completedTranscriptions +
            committed.counts.edited +
            committed.counts.redacted +
            committed.counts.deleted +
            committed.counts.reactionsChanged,
          omitted: { ...committed.omitted },
          attachmentId: committed.id,
          captureRange: { ...committed.captureRange },
          ...(committed.committedTurnId === undefined
            ? {}
            : { linkedTurnId: committed.committedTurnId }),
          ...(committed.eventRange === undefined
            ? {}
            : { eventRange: { ...committed.eventRange } }),
        });
      }
      updates.sort((left, right) => {
        const version = left.contextVersion - right.contextVersion;
        return version === 0
          ? left.attachmentId.localeCompare(right.attachmentId)
          : version;
      });
      return {
        status: 'found' as const,
        snapshots: [initial.summary, ...updates],
      };
    },
  };
}

async function loadOwnedContextAttachment(input: {
  userId: string;
  sessionId: string;
  attachmentId: string;
}): Promise<
  | {
      attachment: ConversationAssistantContextAttachment;
      currentContextVersion: number;
    }
  | null
> {
  const db = getFirestore();
  const sessionRef = db
    .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
    .doc(input.sessionId);
  const attachmentRef = db
    .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
    .doc(input.attachmentId);
  return await db.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    const attachmentSnapshot = await transaction.get(attachmentRef);
    if (
      !(await conversationAssistantSessionReadFenceAllows({
        db,
        transaction,
        sessionData: sessionSnapshot.data(),
        expectedUserId: input.userId,
      }))
    ) {
      return null;
    }
    return parseOwnedContextAttachment({
      sessionData: sessionSnapshot.data(),
      attachmentId: attachmentSnapshot.id,
      attachmentData: attachmentSnapshot.data(),
      userId: input.userId,
      sessionId: input.sessionId,
    });
  });
}

function parseOwnedContextAttachment(input: {
  sessionData: Record<string, unknown> | undefined;
  attachmentId: string;
  attachmentData: Record<string, unknown> | undefined;
  userId: string;
  sessionId: string;
}): { attachment: ConversationAssistantContextAttachment; currentContextVersion: number } | null {
  const sessionData = asOptionalRecord(input.sessionData);
  const attachmentData = asOptionalRecord(input.attachmentData);
  const continuation = parseContinuation(sessionData?.['continuation']);
  if (
    sessionData?.['userId'] !== input.userId ||
    typeof sessionData['deletionStartedAt'] === 'string' ||
    typeof sessionData['generationId'] !== 'string' ||
    continuation === null ||
    attachmentData?.['userId'] !== input.userId ||
    attachmentData['sessionId'] !== input.sessionId ||
    attachmentData['sessionGenerationId'] !== sessionData['generationId'] ||
    attachmentData['sourceAccountId'] !== sessionData['sourceAccountId'] ||
    attachmentData['sourceAccountGeneration'] !== sessionData['sourceAccountGeneration']
  ) {
    return null;
  }
  try {
    return {
      attachment: toContextAttachment(input.attachmentId, attachmentData),
      currentContextVersion: continuation.contextVersion,
    };
  } catch {
    return null;
  }
}

function validChunkManifest(manifest: {
  chunkIds: string[];
  chunkCount: number;
}): boolean {
  return (
    Number.isInteger(manifest.chunkCount) &&
    manifest.chunkCount > 0 &&
    manifest.chunkCount <= CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS &&
    manifest.chunkIds.length === manifest.chunkCount &&
    new Set(manifest.chunkIds).size === manifest.chunkIds.length
  );
}

function validOwnedSnapshotChunk(input: {
  data: Record<string, unknown> | undefined;
  attachment: ConversationAssistantContextAttachment;
  chunkIndex: number;
  chunkCount: number;
}): boolean {
  const data = input.data;
  if (!hasSnapshotChunkData(data)) return false;
  return (
    chunkBelongsToOwnedAttachment(data, input.attachment) &&
    data['snapshotId'] === input.attachment.snapshotId &&
    data['chunkIndex'] === input.chunkIndex &&
    data['chunkCount'] === input.chunkCount &&
    data['encoding'] === 'base64-json' &&
    typeof data['payload'] === 'string'
  );
}

function chunkBelongsToOwnedAttachment(
  data: Record<string, unknown> | undefined,
  attachment: ConversationAssistantContextAttachment
): boolean {
  return (
    data?.['userId'] === attachment.userId &&
    data['sessionId'] === attachment.sessionId &&
    data['sessionGenerationId'] === attachment.sessionGenerationId &&
    data['sourceAccountId'] === attachment.sourceAccountId &&
    data['sourceAccountGeneration'] === attachment.sourceAccountGeneration &&
    data['attachmentId'] === attachment.id
  );
}

function isCanonicalBase64(value: string): boolean {
  if (value === '' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function parsePreparedSnapshot(
  serialized: Buffer
): ConversationAssistantContextAttachmentPreparedSnapshot | null {
  try {
    const value = JSON.parse(serialized.toString('utf8')) as unknown;
    if (!isRecord(value)) return null;
    if (
      typeof value['transcriptText'] !== 'string' ||
      !Array.isArray(value['messages']) ||
      !Array.isArray(value['omittedMessages']) ||
      !Array.isArray(value['corrections']) ||
      !isRecord(value['counts']) ||
      !isRecord(value['omitted']) ||
      typeof value['deltaTranscriptSha256'] !== 'string' ||
      typeof value['previousContextChainSha256'] !== 'string' ||
      typeof value['resultingContextChainSha256'] !== 'string' ||
      typeof value['estimatedInputTokens'] !== 'number' ||
      value['estimatedInputTokens'] < 0 ||
      value['requiresConfirmation'] !== true && value['requiresConfirmation'] !== false ||
      value['confirmationToken'] !== undefined &&
        typeof value['confirmationToken'] !== 'string'
    ) {
      return null;
    }
    parseCounts(value['counts']);
    requireNonNegativeInteger(value['omitted'], 'mediaOnly');
    requireNonNegativeInteger(value['omitted'], 'failedTranscriptions');
    requireNonNegativeInteger(value['omitted'], 'pendingTranscriptions');
    requireNonNegativeInteger(value['omitted'], 'nonText');
    requireNonNegativeInteger(value['omitted'], 'overLimit');
    const eventRange = value['eventRange'];
    if (
      eventRange !== undefined &&
      (!isRecord(eventRange) ||
        typeof eventRange['from'] !== 'string' ||
        typeof eventRange['to'] !== 'string')
    ) {
      return null;
    }
    return value as unknown as ConversationAssistantContextAttachmentPreparedSnapshot;
  } catch {
    return null;
  }
}

function parseInitialContextHistorySummary(
  sessionData: Record<string, unknown> | undefined,
  userId: string
):
  | {
      sessionGenerationId: string;
      summary: ConversationAssistantContextSnapshotSummary;
    }
  | null {
  if (
    sessionData?.['userId'] !== userId ||
    typeof sessionData['deletionStartedAt'] === 'string' ||
    typeof sessionData['generationId'] !== 'string'
  ) {
    return null;
  }
  const capturedAt = toIso(sessionData['createdAt']);
  const omitted = asOptionalRecord(sessionData['omitted']);
  if (capturedAt === null || !isRecord(omitted)) return null;
  try {
    return {
      sessionGenerationId: sessionData['generationId'],
      summary: {
        kind: 'initial',
        contextVersion: 0,
        capturedAt,
        messageCount: requireNonNegativeInteger(sessionData, 'transcriptMessageCount'),
        excludedCount:
          requireNonNegativeInteger(omitted, 'mediaOnly') +
          requireNonNegativeInteger(omitted, 'failedTranscriptions') +
          requireNonNegativeInteger(omitted, 'pendingTranscriptions') +
          requireNonNegativeInteger(omitted, 'nonText') +
          requireNonNegativeInteger(omitted, 'overLimit'),
        correctionCount: 0,
        omitted: {
          mediaOnly: requireNonNegativeInteger(omitted, 'mediaOnly'),
          failedTranscriptions: requireNonNegativeInteger(omitted, 'failedTranscriptions'),
          pendingTranscriptions: requireNonNegativeInteger(omitted, 'pendingTranscriptions'),
          nonText: requireNonNegativeInteger(omitted, 'nonText'),
          overLimit: requireNonNegativeInteger(omitted, 'overLimit'),
        },
      },
    };
  } catch {
    return null;
  }
}

function parseContinuation(value: unknown): ContinuationBoundary | null {
  if (!isRecord(value)) return null;
  const sourceAccountId = value['sourceAccountId'];
  const contextVersion = value['contextVersion'];
  const contextEventThrough = value['contextEventThrough'];
  const contextChangeThrough = value['contextChangeThrough'];
  const contextChainSha256 = value['contextChainSha256'];
  if (
    typeof sourceAccountId !== 'string' ||
    !Number.isInteger(contextVersion) ||
    typeof contextVersion !== 'number' ||
    contextVersion < 0 ||
    typeof contextEventThrough !== 'string' ||
    !Number.isInteger(contextChangeThrough) ||
    typeof contextChangeThrough !== 'number' ||
    contextChangeThrough < 0 ||
    typeof contextChainSha256 !== 'string'
  ) {
    return null;
  }
  return {
    sourceAccountId,
    contextVersion,
    contextEventThrough,
    contextChangeThrough,
    contextChainSha256,
  };
}

function parseInitialContextFrom(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value['from'] === 'string' ? value['from'] : null;
}

function sourceAccountMatches(
  value: Record<string, unknown> | undefined,
  userId: string,
  sourceAccountId: string,
  sourceAccountGeneration: string
): boolean {
  const storedGeneration =
    typeof value?.['generationId'] === 'string' && value['generationId'].length > 0
      ? value['generationId']
      : value?.['sourceAccountId'];
  return (
    value?.['userId'] === userId &&
    value['sourceAccountId'] === sourceAccountId &&
    storedGeneration === sourceAccountGeneration &&
    value['status'] === 'active' &&
    value['erasureStatus'] !== 'erasing'
  );
}

async function sourceAccountAllowsAttachmentPreparation(
  transaction: FirebaseFirestore.Transaction,
  db: ReturnType<typeof getFirestore>,
  sessionData: Record<string, unknown> | undefined,
  attachmentData: Record<string, unknown> | undefined,
  userId: string
): Promise<boolean> {
  if (!validAttachmentPreparationSource(sessionData, attachmentData)) {
    return false;
  }
  const sourceAccountId = sessionData?.['sourceAccountId'] as string;
  const sourceAccountGeneration = sessionData?.['sourceAccountGeneration'] as string;
  const accountSnapshot = await transaction.get(
    db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(userId)
  );
  return (
    accountSnapshot.exists &&
    sourceAccountMatches(
      accountSnapshot.data(),
      userId,
      sourceAccountId,
      sourceAccountGeneration
    )
  );
}

function sourceChatMatches(
  value: Record<string, unknown> | undefined,
  userId: string,
  sourceAccountId: string
): boolean {
  return value?.['userId'] === userId && value['sourceAccountId'] === sourceAccountId;
}

function toContextAttachment(
  id: string,
  value: Record<string, unknown> | undefined
): ConversationAssistantContextAttachment {
  if (!isRecord(value)) throw new Error('Invalid context attachment document');
  const capturedAt = toIso(value['capturedAt']);
  const expireAt = toOptionalIso(value['expireAt']);
  const captureRange = value['captureRange'];
  const counts = value['counts'];
  const omitted = value['omitted'];
  if (
    capturedAt === null ||
    !isRecord(captureRange) ||
    !isRecord(counts) ||
    !isRecord(omitted)
  ) {
    throw new Error('Invalid context attachment document');
  }
  const captureFrom = toIso(captureRange['from']);
  const captureTo = toIso(captureRange['to']);
  if (captureFrom === null || captureTo === null) {
    throw new Error('Invalid context attachment document');
  }
  const attachment: ConversationAssistantContextAttachment = {
    id,
    sessionId: requireString(value, 'sessionId'),
    userId: requireString(value, 'userId'),
    sessionGenerationId: requireString(value, 'sessionGenerationId'),
    sourceAccountId: requireString(value, 'sourceAccountId'),
    sourceAccountGeneration: requireString(value, 'sourceAccountGeneration'),
    chatId: requireString(value, 'chatId'),
    preparationRequestId: requireString(value, 'preparationRequestId'),
    preparationRequestFingerprint: requireString(value, 'preparationRequestFingerprint'),
    status: requireAttachmentStatus(value['status']),
    initialContextFrom: requireString(value, 'initialContextFrom'),
    baseContextVersion: requireNonNegativeInteger(value, 'baseContextVersion'),
    baseEventThrough: requireString(value, 'baseEventThrough'),
    capturedAt,
    baseChangeSeq: requireNonNegativeInteger(value, 'baseChangeSeq'),
    cutoffChangeSeq: requireNonNegativeInteger(value, 'cutoffChangeSeq'),
    captureRange: { from: captureFrom, to: capturedAt },
    counts: parseCounts(counts),
    omitted: {
      mediaOnly: requireNonNegativeInteger(omitted, 'mediaOnly'),
      failedTranscriptions: requireNonNegativeInteger(omitted, 'failedTranscriptions'),
      pendingTranscriptions: requireNonNegativeInteger(omitted, 'pendingTranscriptions'),
      nonText: requireNonNegativeInteger(omitted, 'nonText'),
      overLimit: requireNonNegativeInteger(omitted, 'overLimit'),
    },
    requiresConfirmation: value['requiresConfirmation'] === true,
    preparationAttempt: requireNonNegativeInteger(value, 'preparationAttempt'),
  };
  copyOptionalString(value, attachment, 'replacesAttachmentId');
  copyOptionalString(value, attachment, 'snapshotId');
  copyOptionalString(value, attachment, 'deltaTranscriptSha256');
  copyOptionalString(value, attachment, 'previousContextChainSha256');
  copyOptionalString(value, attachment, 'resultingContextChainSha256');
  copyOptionalString(value, attachment, 'confirmationToken');
  copyOptionalString(value, attachment, 'preparationClaimId');
  copyOptionalString(value, attachment, 'preparationLeaseExpiresAt');
  copyOptionalString(value, attachment, 'committedTurnId');
  copyOptionalString(value, attachment, 'committedAt');
  if (expireAt !== undefined) attachment.expiresAt = expireAt;
  if (typeof value['estimatedInputTokens'] === 'number') {
    attachment.estimatedInputTokens = value['estimatedInputTokens'];
  }
  if (typeof value['newerAvailableCount'] === 'number') {
    attachment.newerAvailableCount = value['newerAvailableCount'];
  }
  if (typeof value['newerAvailableCorrectionCount'] === 'number') {
    attachment.newerAvailableCorrectionCount = value['newerAvailableCorrectionCount'];
  }
  const eventRange = value['eventRange'];
  if (isRecord(eventRange)) {
    const from = toIso(eventRange['from']);
    const to = toIso(eventRange['to']);
    if (from !== null && to !== null) attachment.eventRange = { from, to };
  }
  const chunkManifest = value['chunkManifest'];
  if (
    isRecord(chunkManifest) &&
    Array.isArray(chunkManifest['chunkIds']) &&
    chunkManifest['chunkIds'].every((chunkId) => typeof chunkId === 'string') &&
    typeof chunkManifest['chunkCount'] === 'number'
  ) {
    attachment.chunkManifest = {
      chunkIds: chunkManifest['chunkIds'],
      chunkCount: chunkManifest['chunkCount'],
    };
  }
  const preparationError = value['preparationError'];
  if (
    isRecord(preparationError) &&
    typeof preparationError['code'] === 'string' &&
    typeof preparationError['message'] === 'string'
  ) {
    attachment.preparationError = {
      code: preparationError['code'],
      message: preparationError['message'],
    };
  }
  return attachment;
}

type PreparationOwnershipValidation = 'ok' | 'not_found' | 'stale';

function validatePreparationOwnership(input: {
  sessionData: Record<string, unknown> | undefined;
  attachmentData: Record<string, unknown> | undefined;
  userId: string;
  sessionId: string;
  expectedSessionGenerationId: string;
}): PreparationOwnershipValidation {
  if (
    input.sessionData?.['userId'] !== input.userId ||
    typeof input.sessionData['deletionStartedAt'] === 'string' ||
    input.attachmentData?.['userId'] !== input.userId ||
    input.attachmentData['sessionId'] !== input.sessionId
  ) {
    return 'not_found';
  }
  if (
    input.sessionData['generationId'] !== input.expectedSessionGenerationId ||
    input.attachmentData['sessionGenerationId'] !== input.expectedSessionGenerationId ||
    typeof input.sessionData['sourceAccountId'] !== 'string' ||
    input.sessionData['sourceAccountId'].length === 0 ||
    typeof input.sessionData['sourceAccountGeneration'] !== 'string' ||
    input.sessionData['sourceAccountGeneration'].length === 0 ||
    input.attachmentData['sourceAccountId'] !== input.sessionData['sourceAccountId'] ||
    input.attachmentData['sourceAccountGeneration'] !==
      input.sessionData['sourceAccountGeneration']
  ) {
    return 'stale';
  }
  return 'ok';
}

function validatePreparationFence(input: {
  sessionData: Record<string, unknown> | undefined;
  attachmentData: Record<string, unknown> | undefined;
  input: {
    userId: string;
    sessionId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    now: string;
  };
}): PreparationOwnershipValidation {
  const ownership = validatePreparationOwnership({
    sessionData: input.sessionData,
    attachmentData: input.attachmentData,
    userId: input.input.userId,
    sessionId: input.input.sessionId,
    expectedSessionGenerationId: input.input.expectedSessionGenerationId,
  });
  if (ownership !== 'ok') return ownership;
  if (
    input.attachmentData?.['status'] !== 'preparing' ||
    input.attachmentData['preparationAttempt'] !== input.input.attempt ||
    input.attachmentData['preparationClaimId'] !== input.input.claimId ||
    typeof input.attachmentData['preparationLeaseExpiresAt'] !== 'string' ||
    input.attachmentData['preparationLeaseExpiresAt'] <= input.input.now
  ) {
    return 'stale';
  }
  return 'ok';
}

function serializePreparedSnapshot(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function splitBuffer(value: Buffer, maxBytes: number): Buffer[] {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < value.length; offset += maxBytes) {
    parts.push(value.subarray(offset, Math.min(offset + maxBytes, value.length)));
  }
  return parts;
}

function contextAttachmentChunkId(
  sessionId: string,
  snapshotId: string,
  chunkIndex: number
): string {
  return `${sessionId}_${snapshotId}_${String(chunkIndex).padStart(6, '0')}`;
}

async function deletePreparedSnapshotChunks(
  db: ReturnType<typeof getFirestore>,
  input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    snapshotId: string;
    chunkIds: string[];
  }
): Promise<void> {
  for (const chunkId of input.chunkIds) {
    const ref = db
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
      .doc(chunkId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || !chunkBelongsToFence(snapshot.data(), input)) return;
      transaction.delete(ref);
    });
  }
}

function chunkBelongsToFence(
  value: Record<string, unknown> | undefined,
  input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    snapshotId: string;
  }
): boolean {
  return (
    value?.['userId'] === input.userId &&
    value['sessionId'] === input.sessionId &&
    value['attachmentId'] === input.attachmentId &&
    value['sessionGenerationId'] === input.expectedSessionGenerationId &&
    value['preparationAttempt'] === input.attempt &&
    value['preparationClaimId'] === input.claimId &&
    value['snapshotId'] === input.snapshotId
  );
}

function validPreparedChunk(input: {
  data: Record<string, unknown> | undefined;
  sourceAccountId: string;
  sourceAccountGeneration: string;
  input: {
    userId: string;
    sessionId: string;
    attachmentId: string;
    expectedSessionGenerationId: string;
    attempt: number;
    claimId: string;
    snapshotId: string;
  };
  chunkIndex: number;
  chunkCount: number;
}): boolean {
  const data = input.data;
  if (!hasSnapshotChunkData(data)) return false;
  return (
    chunkBelongsToFence(data, input.input) &&
    data['sourceAccountId'] === input.sourceAccountId &&
    data['sourceAccountGeneration'] === input.sourceAccountGeneration &&
    data['chunkIndex'] === input.chunkIndex &&
    data['chunkCount'] === input.chunkCount &&
    data['encoding'] === 'base64-json' &&
    typeof data['payload'] === 'string'
  );
}

export function hasSnapshotChunkData(
  data: Record<string, unknown> | undefined
): data is Record<string, unknown> {
  return data !== undefined;
}

export function validAttachmentPreparationSource(
  sessionData: Record<string, unknown> | undefined,
  attachmentData: Record<string, unknown> | undefined
): boolean {
  const sourceAccountId = sessionData?.['sourceAccountId'];
  const sourceAccountGeneration = sessionData?.['sourceAccountGeneration'];
  return (
    typeof sourceAccountId === 'string' &&
    sourceAccountId.length > 0 &&
    typeof sourceAccountGeneration === 'string' &&
    sourceAccountGeneration.length > 0 &&
    attachmentData?.['sourceAccountId'] === sourceAccountId &&
    attachmentData['sourceAccountGeneration'] === sourceAccountGeneration
  );
}

function preparedAttachmentUpdate(input: {
  snapshotId: string;
  manifest: { chunkIds: string[]; chunkCount: number };
  prepared: {
    eventRange?: { from: string; to: string };
    counts: ConversationAssistantContextAttachmentCounts;
    omitted: ConversationAssistantContextAttachment['omitted'];
    deltaTranscriptSha256: string;
    previousContextChainSha256: string;
    resultingContextChainSha256: string;
    estimatedInputTokens: number;
    requiresConfirmation: boolean;
    confirmationToken?: string;
  };
}): Record<string, unknown> {
  return {
    status: 'ready',
    snapshotId: input.snapshotId,
    chunkManifest: input.manifest,
    counts: input.prepared.counts,
    omitted: input.prepared.omitted,
    deltaTranscriptSha256: input.prepared.deltaTranscriptSha256,
    previousContextChainSha256: input.prepared.previousContextChainSha256,
    resultingContextChainSha256: input.prepared.resultingContextChainSha256,
    estimatedInputTokens: input.prepared.estimatedInputTokens,
    requiresConfirmation: input.prepared.requiresConfirmation,
    ...(input.prepared.eventRange === undefined
      ? { eventRange: FieldValue.delete() }
      : { eventRange: input.prepared.eventRange }),
    ...(input.prepared.confirmationToken === undefined
      ? { confirmationToken: FieldValue.delete() }
      : { confirmationToken: input.prepared.confirmationToken }),
    preparationClaimId: FieldValue.delete(),
    preparationLeaseExpiresAt: FieldValue.delete(),
    preparationError: FieldValue.delete(),
  };
}

function expiredAttachmentUpdate(): Record<string, unknown> {
  return {
    status: 'expired',
    preparationClaimId: FieldValue.delete(),
    preparationLeaseExpiresAt: FieldValue.delete(),
  };
}

function isTimestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp;
}

function emptyCounts(): ConversationAssistantContextAttachmentCounts {
  return {
    included: 0,
    omitted: 0,
    newlyAvailable: 0,
    edited: 0,
    redacted: 0,
    deleted: 0,
    reactionsChanged: 0,
    lateIngested: 0,
    completedTranscriptions: 0,
  };
}

function emptyOmittedCounts(): ConversationAssistantContextAttachment['omitted'] {
  return {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  };
}

function parseCounts(value: Record<string, unknown>): ConversationAssistantContextAttachmentCounts {
  return {
    included: requireNonNegativeInteger(value, 'included'),
    omitted: requireNonNegativeInteger(value, 'omitted'),
    newlyAvailable: requireNonNegativeInteger(value, 'newlyAvailable'),
    edited: requireNonNegativeInteger(value, 'edited'),
    redacted: requireNonNegativeInteger(value, 'redacted'),
    deleted: requireNonNegativeInteger(value, 'deleted'),
    reactionsChanged: requireNonNegativeInteger(value, 'reactionsChanged'),
    lateIngested: requireNonNegativeInteger(value, 'lateIngested'),
    completedTranscriptions: requireNonNegativeInteger(value, 'completedTranscriptions'),
  };
}

function isExpired(attachment: ConversationAssistantContextAttachment, now: string): boolean {
  return attachment.expiresAt !== undefined && attachment.expiresAt <= now;
}

function toIso(value: unknown): string | null {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  if (value instanceof Date) return value.toISOString();
  if (
    isRecord(value) &&
    typeof value['toDate'] === 'function'
  ) {
    const date = (value['toDate'] as () => unknown)();
    return date instanceof Date ? date.toISOString() : null;
  }
  return null;
}

function toOptionalIso(value: unknown): string | undefined {
  const iso = toIso(value);
  return iso ?? undefined;
}

function requireString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string') throw new Error('Invalid context attachment document');
  return field;
}

function requireNonNegativeInteger(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== 'number' || !Number.isInteger(field) || field < 0) {
    throw new Error('Invalid context attachment document');
  }
  return field;
}

function requireAttachmentStatus(
  value: unknown
): ConversationAssistantContextAttachment['status'] {
  if (
    value === 'queued' ||
    value === 'preparing' ||
    value === 'ready' ||
    value === 'failed' ||
    value === 'expired' ||
    value === 'committed'
  ) {
    return value;
  }
  throw new Error('Invalid context attachment document');
}

function copyOptionalString(
  source: Record<string, unknown>,
  target: ConversationAssistantContextAttachment,
  key: keyof ConversationAssistantContextAttachment
): void {
  const value = source[key as string];
  if (typeof value === 'string') {
    (target as unknown as Record<string, unknown>)[key as string] = value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAttachmentEligibleSessionStatus(value: unknown): boolean {
  return value === 'ready' || value === 'active';
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
