import { createHash } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp, getFirestore } from '@intexuraos/infra-firestore';
import type {
  ConversationAssistantTurnRequest,
  ConversationAssistantTurnRequestPromptSnapshot,
  ConversationAssistantTurnRequestRepository,
  FinalizeConversationAssistantTurnRequestResult,
  TurnRequestConversationTurn,
} from '../../domain/conversation-assistant/turnRequestPorts.js';
import {
  CONVERSATION_ASSISTANT_HARD_PROMPT_TOKEN_UPPER_BOUND,
  buildConversationAssistantTurnPromptMessages,
  estimateConversationAssistantTurnPromptTokens,
} from '../../domain/conversation-assistant/turnPromptBudget.js';
import { buildConversationAssistantContextAttachmentAcknowledgment } from '../../domain/conversation-assistant/contextAttachmentAcknowledgment.js';
import { isLatestRetryableConversationAssistantAnswer } from '../../domain/conversation-assistant/answerRetryCapability.js';
import {
  recordConversationAssistantTelemetry,
  type ConversationAssistantOperationalTelemetry,
} from '../../domain/conversation-assistant/operationalTelemetry.js';
import { verifyConversationAssistantPreparedSnapshotIntegrity } from '../../domain/conversation-assistant/preparedSnapshotIntegrity.js';
import {
  buildPrivateConversationModelFacingMessageProjection,
  createConversationAssistantMessageReference,
} from '../../domain/conversation-assistant/transcriptFormatting.js';
import type {
  ConversationAssistantContextAttachmentCounts,
  ConversationAssistantContextAttachmentPreparedSnapshot,
  ConversationAssistantTurnContextAttachmentSummary,
} from '../../domain/conversation-assistant/types.js';
import {
  CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS,
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
} from './conversationAssistantContextAttachmentRepository.js';
import {
  TRANSCRIPT_CHUNK_MAX_BYTES,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
} from './conversationAssistantRepository.js';
import {
  conversationAssistantSessionReadFenceAllows,
  conversationAssistantSessionReadFenceAllowsWithAccount,
} from './conversationAssistantReadFence.js';
import { PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION } from './privateWhatsAppRepository.js';

export const WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION =
  'whatsapp_conversation_assistant_turn_requests';
export const CONVERSATION_ASSISTANT_TURN_REQUEST_HARD_INPUT_TOKEN_LIMIT =
  CONVERSATION_ASSISTANT_HARD_PROMPT_TOKEN_UPPER_BOUND;
export const CONVERSATION_ASSISTANT_INITIAL_TRANSCRIPT_MAX_CHUNKS = 400;

interface StoredContinuation {
  sourceAccountId: string;
  contextVersion: number;
  contextEventThrough: string;
  contextChangeThrough: number;
  contextChainSha256: string;
  displayTimeZone: string;
  nextTurnSequence: number;
  nextConversationRevision: number;
  completedConversationRevision: number;
  attachmentCount: number;
  totalAttachedMessageCount: number;
  totalAttachedOmittedCount: number;
  activeTurnRequestId?: string;
  activeTurnLeaseExpiresAt?: string;
}

interface StoredAttachment {
  id: string;
  snapshotId: string;
  chunkIds: string[];
  capturedAt: string;
  captureRange: { from: string; to: string };
  eventRange?: { from: string; to: string };
  counts: ConversationAssistantContextAttachmentCounts;
  omitted: ConversationAssistantContextAttachmentPreparedSnapshot['omitted'];
  baseContextVersion: number;
  baseEventThrough: string;
  baseChangeSeq: number;
  cutoffChangeSeq: number;
  deltaTranscriptSha256: string;
  previousContextChainSha256: string;
  resultingContextChainSha256: string;
  estimatedInputTokens: number;
  requiresConfirmation: boolean;
  confirmationToken?: string;
}

interface SessionOwnership {
  generationId: string;
  continuation: StoredContinuation;
  data: Record<string, unknown>;
}

type PreparedSnapshotLoadResult =
  | { status: 'found'; snapshot: ConversationAssistantContextAttachmentPreparedSnapshot }
  | { status: 'unavailable' }
  | { status: 'chain_mismatch' };

type StartTurnRequestReturn = ReturnType<
  ConversationAssistantTurnRequestRepository['startTurnRequest']
>;
type LoadPromptSnapshotReturn = ReturnType<
  ConversationAssistantTurnRequestRepository['loadPromptSnapshot']
>;
type CompleteTurnRequestReturn = ReturnType<
  ConversationAssistantTurnRequestRepository['completeTurnRequest']
>;
type FailTurnRequestReturn = ReturnType<
  ConversationAssistantTurnRequestRepository['failTurnRequest']
>;
type GetTurnRequestReturn = ReturnType<
  ConversationAssistantTurnRequestRepository['getTurnRequest']
>;
type ClaimAnswerRetryReturn = ReturnType<
  ConversationAssistantTurnRequestRepository['claimAnswerRetry']
>;
type ClaimTurnRequestRecoveryReturn = ReturnType<
  ConversationAssistantTurnRequestRepository['claimTurnRequestRecovery']
>;
type RenewTurnRequestLeaseReturn = ReturnType<
  ConversationAssistantTurnRequestRepository['renewTurnRequestLease']
>;

export function createConversationAssistantTurnRequestRepository(
  options: { telemetry?: ConversationAssistantOperationalTelemetry } = {}
): ConversationAssistantTurnRequestRepository {
  return {
    async startTurnRequest(input): StartTurnRequestReturn {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
      const requestRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
        .doc(turnRequestStorageId(input.sessionId, input.requestId));

      const outcome = await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const owned = parseOwnedSession(sessionSnapshot.data(), input.userId);
        if (owned === null) return { status: 'not_found' as const };
        const accountSnapshot = await transaction.get(accountRef);
        if (!(await sourceAccountAllowsTurnStart(accountSnapshot.data(), owned, db, transaction))) {
          return { status: 'not_found' as const };
        }

        const existingSnapshot = await transaction.get(requestRef);
        if (existingSnapshot.exists) {
          const existing = toTurnRequest(existingSnapshot.data() as Record<string, unknown>);
          if (
            existing.userId !== input.userId ||
            existing.sessionId !== input.sessionId ||
            existing.sessionGenerationId !== owned.generationId
          ) {
            return { status: 'not_found' as const };
          }
          if (existing.requestFingerprint !== input.requestFingerprint) {
            return { status: 'conflict' as const };
          }
          const userTurnSnapshot = await transaction.get(
            db.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).doc(existing.userTurnId)
          );
          if (!userTurnSnapshot.exists) return { status: 'not_found' as const };
          const userTurn = toTurn(
            userTurnSnapshot.id,
            userTurnSnapshot.data() as Record<string, unknown>
          );
          const assistantTurnSnapshot = await transaction.get(
            db
              .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
              .doc(existing.assistantTurnId)
          );
          if (
            existing.status === 'in_progress' &&
            existing.leaseExpiresAt <= input.now &&
            activeLeaseMayBeReclaimed(owned.continuation, input.now)
          ) {
            const reclaimed: ConversationAssistantTurnRequest = {
              ...existing,
              attempt: existing.attempt + 1,
              stateVersion: existing.stateVersion + 1,
              claimId: input.claimId,
              leaseExpiresAt: input.leaseExpiresAt,
              updatedAt: input.now,
            };
            transaction.set(requestRef, {
              ...toRequestDocument(reclaimed),
              assistantSequence: requireAssistantSequence(existingSnapshot.data()),
            });
            transaction.update(sessionRef, {
              continuation: {
                ...owned.continuation,
                activeTurnRequestId: existing.id,
                activeTurnLeaseExpiresAt: input.leaseExpiresAt,
              },
              updatedAt: input.now,
            });
            return { status: 'claimed' as const, request: reclaimed, userTurn };
          }
          return {
            status: 'replay' as const,
            request: existing,
            userTurn,
            completedConversationRevision: owned.continuation.completedConversationRevision,
            ...(owned.continuation.activeTurnRequestId === undefined
              ? {}
              : { activeTurnRequestId: owned.continuation.activeTurnRequestId }),
            ...(owned.continuation.activeTurnLeaseExpiresAt === undefined
              ? {}
              : { activeTurnLeaseExpiresAt: owned.continuation.activeTurnLeaseExpiresAt }),
            ...(assistantTurnSnapshot.exists
              ? {
                  assistantTurn: toTurn(
                    assistantTurnSnapshot.id,
                    assistantTurnSnapshot.data() as Record<string, unknown>
                  ),
                }
              : {}),
          };
        }

        if (owned.continuation.activeTurnRequestId !== undefined) {
          return { status: 'active_request' as const };
        }

        let attachment: StoredAttachment | undefined;
        let prepared: ConversationAssistantContextAttachmentPreparedSnapshot | undefined;
        if (input.contextAttachmentId !== undefined) {
          const attachmentSnapshot = await transaction.get(
            db
              .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
              .doc(input.contextAttachmentId)
          );
          const parsed = parseReadyAttachment(
            attachmentSnapshot.id,
            attachmentSnapshot.data(),
            input,
            owned
          );
          if (parsed.status !== 'ready') return { status: parsed.status };
          attachment = parsed.attachment;
          if (
            attachment.requiresConfirmation &&
            (attachment.confirmationToken === undefined ||
              input.confirmationToken !== attachment.confirmationToken)
          ) {
            return { status: 'confirmation_required' as const };
          }
          const loaded = await loadPreparedSnapshot(
            transaction,
            db,
            attachment,
            input.userId,
            input.sessionId,
            owned.generationId,
            input.contextAttachmentId,
            input.now,
            true
          );
          if (loaded.status === 'chain_mismatch') {
            return { status: 'chain_mismatch' as const };
          }
          if (loaded.status === 'unavailable') {
            return { status: 'attachment_not_ready' as const };
          }
          prepared = loaded.snapshot;
        }

        const turnsSnapshot = await transaction.get(
          db
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
            .where('sessionId', '==', input.sessionId)
            .where('userId', '==', input.userId)
            .orderBy('sequence', 'asc')
            .orderBy(FieldPath.documentId(), 'asc')
        );
        const promptPreflight = await buildPrecommitPromptSnapshot({
          transaction,
          db,
          owned,
          userId: input.userId,
          sessionId: input.sessionId,
          question: input.question,
          priorTurnDocuments: turnsSnapshot.docs.map((doc) => ({
            id: doc.id,
            data: doc.data(),
          })),
          ...(prepared === undefined
            ? {}
            : {
                currentContextUpdate: toPromptContextUpdate(
                  prepared,
                  input.sessionId,
                  owned.generationId
                ),
              }),
        });
        if (promptPreflight.status !== 'found') {
          if (promptPreflight.status === 'chain_mismatch') {
            return { status: 'chain_mismatch' as const };
          }
          return { status: 'not_found' as const };
        }
        if (
          estimateConversationAssistantTurnPromptTokens(
            buildConversationAssistantTurnPromptMessages(promptPreflight.snapshot)
          ) > CONVERSATION_ASSISTANT_TURN_REQUEST_HARD_INPUT_TOKEN_LIMIT
        ) {
          return { status: 'context_window_exceeded' as const };
        }

        const conversationRevision = owned.continuation.nextConversationRevision;
        const userSequence = owned.continuation.nextTurnSequence;
        const assistantSequence = userSequence + 1;
        const requestStorageId = turnRequestStorageId(input.sessionId, input.requestId);
        const userTurnId = `${requestStorageId}_user`;
        const assistantTurnId = `${requestStorageId}_assistant`;
        const acknowledgment =
          attachment === undefined
            ? ''
            : buildConversationAssistantContextAttachmentAcknowledgment({
                counts: attachment.counts,
                ...(attachment.eventRange === undefined
                  ? {}
                  : { eventRange: attachment.eventRange }),
                captureRange: attachment.captureRange,
                capturedAt: attachment.capturedAt,
                displayTimeZone: owned.continuation.displayTimeZone,
              });
        const request: ConversationAssistantTurnRequest = {
          id: input.requestId,
          requestFingerprint: input.requestFingerprint,
          sessionId: input.sessionId,
          userId: input.userId,
          sessionGenerationId: owned.generationId,
          status: 'in_progress',
          attempt: 1,
          stateVersion: 1,
          conversationRevision,
          userTurnId,
          assistantTurnId,
          question: input.question,
          acknowledgment,
          claimId: input.claimId,
          leaseExpiresAt: input.leaseExpiresAt,
          createdAt: input.now,
          updatedAt: input.now,
          ...(input.contextAttachmentId === undefined
            ? {}
            : { contextAttachmentId: input.contextAttachmentId }),
        };
        const userTurn = createUserTurn({
          id: userTurnId,
          input,
          generationId: owned.generationId,
          sequence: userSequence,
          conversationRevision,
          ...(attachment === undefined ? {} : { attachment }),
        });
        const nextContinuation: StoredContinuation = {
          ...owned.continuation,
          nextTurnSequence: assistantSequence + 1,
          nextConversationRevision: conversationRevision + 1,
          activeTurnRequestId: input.requestId,
          activeTurnLeaseExpiresAt: input.leaseExpiresAt,
        };

        if (attachment !== undefined && prepared !== undefined) {
          nextContinuation.contextVersion = attachment.baseContextVersion + 1;
          nextContinuation.contextEventThrough = attachment.capturedAt;
          nextContinuation.contextChangeThrough = attachment.cutoffChangeSeq;
          nextContinuation.contextChainSha256 = attachment.resultingContextChainSha256;
          nextContinuation.attachmentCount += 1;
          nextContinuation.totalAttachedMessageCount += attachment.counts.included;
          nextContinuation.totalAttachedOmittedCount += attachment.counts.omitted;
          const attachmentRef = db
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION)
            .doc(attachment.id);
          transaction.update(attachmentRef, {
            status: 'committed',
            committedTurnId: userTurnId,
            committedAt: input.now,
            expireAt: FieldValue.delete(),
          });
          for (const chunkId of attachment.chunkIds) {
            transaction.update(
              db.collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION).doc(chunkId),
              { expireAt: FieldValue.delete() }
            );
          }
        }

        transaction.set(requestRef, {
          ...toRequestDocument(request),
          assistantSequence,
        });
        transaction.set(
          db.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).doc(userTurnId),
          toTurnDocument(userTurn, owned.generationId, attachment)
        );
        transaction.update(sessionRef, {
          status: 'active',
          continuation: nextContinuation,
          lastTurnAt: input.now,
          updatedAt: input.now,
        });
        return { status: 'claimed' as const, request, userTurn };
      });
      if (outcome.status === 'chain_mismatch') {
        await recordConversationAssistantTelemetry(options.telemetry, {
          operation: 'chain_verification',
          outcome: 'mismatch',
        });
        return { status: 'attachment_not_ready' };
      }
      return outcome;
    },

    async loadPromptSnapshot(input): LoadPromptSnapshotReturn {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const requestRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
        .doc(turnRequestStorageId(input.sessionId, input.requestId));
      const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
      const outcome = await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const owned = parseOwnedSession(sessionSnapshot.data(), input.userId);
        if (owned === null) return { status: 'not_found' as const };
        const accountSnapshot = await transaction.get(accountRef);
        if (!(await sourceAccountAllowsTurnStart(accountSnapshot.data(), owned, db, transaction))) {
          return { status: 'not_found' as const };
        }
        if (owned.generationId !== input.expectedSessionGenerationId) {
          return { status: 'stale' as const };
        }
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) return { status: 'not_found' as const };
        const request = toTurnRequest(requestSnapshot.data() as Record<string, unknown>);
        if (
          request.userId !== input.userId ||
          request.sessionId !== input.sessionId ||
          request.sessionGenerationId !== input.expectedSessionGenerationId
        ) {
          return { status: 'not_found' as const };
        }
        if (
          request.status !== 'in_progress' ||
          request.attempt !== input.attempt ||
          request.claimId !== input.claimId ||
          request.leaseExpiresAt <= input.now ||
          owned.continuation.activeTurnRequestId !== request.id ||
          owned.continuation.activeTurnLeaseExpiresAt !== request.leaseExpiresAt
        ) {
          return { status: 'stale' as const };
        }
        const transcriptText = await loadInitialTranscript(
          transaction,
          db,
          input.sessionId,
          input.expectedSessionGenerationId,
          owned.data
        );
        if (transcriptText === null) return { status: 'stale' as const };
        const turnsSnapshot = await transaction.get(
          db
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
            .where('sessionId', '==', input.sessionId)
            .where('userId', '==', input.userId)
            .orderBy('sequence', 'asc')
            .orderBy(FieldPath.documentId(), 'asc')
        );
        const turns = turnsSnapshot.docs
          .map((doc) => toTurn(doc.id, doc.data()))
          .filter((turn) => turn.conversationRevision <= request.conversationRevision);
        const userTurn = turns.find((turn) => turn.id === request.userTurnId);
        if (userTurn === undefined) return { status: 'stale' as const };

        const history: ConversationAssistantTurnRequestPromptSnapshot['history'][number][] = [];
        let currentContextUpdate: ConversationAssistantTurnRequestPromptSnapshot['currentContextUpdate'];
        for (const turn of turns) {
          if (turn.sequence > userTurn.sequence || turn.id === request.assistantTurnId) continue;
          let contextUpdate: ConversationAssistantTurnRequestPromptSnapshot['currentContextUpdate'];
          if (turn.role === 'user' && turn.contextAttachmentId !== undefined) {
            const loaded = await loadCommittedTurnContext(
              transaction,
              db,
              turn,
              input.expectedSessionGenerationId,
              turn.contextAttachmentId
            );
            if (loaded.status === 'chain_mismatch') {
              return { status: 'chain_mismatch' as const };
            }
            if (loaded.status === 'unavailable') return { status: 'stale' as const };
            contextUpdate = toPromptContextUpdate(
              loaded.snapshot,
              input.sessionId,
              input.expectedSessionGenerationId
            );
          }
          if (turn.id === request.userTurnId) {
            currentContextUpdate = contextUpdate;
            continue;
          }
          history.push({
            role: turn.role,
            text: turn.text,
            ...(contextUpdate === undefined ? {} : { contextUpdate }),
          });
        }
        const range = parseDateRange(owned.data['range']);
        const effectiveRange = parseDateRange(owned.data['effectiveRange']) ?? range;
        const model = owned.data['model'];
        if (
          range === null ||
          effectiveRange === null ||
          typeof model !== 'string' ||
          model === ''
        ) {
          return { status: 'stale' as const };
        }
        return {
          status: 'found' as const,
          snapshot: {
            userId: input.userId,
            sessionId: input.sessionId,
            model,
            transcriptText,
            ...(typeof owned.data['chatDisplayName'] === 'string'
              ? { chatDisplayName: owned.data['chatDisplayName'] }
              : {}),
            range,
            effectiveRange,
            history,
            currentQuestion: request.question,
            ...(currentContextUpdate === undefined ? {} : { currentContextUpdate }),
          },
        };
      });
      if (outcome.status === 'chain_mismatch') {
        await recordConversationAssistantTelemetry(options.telemetry, {
          operation: 'chain_verification',
          outcome: 'mismatch',
        });
        return { status: 'stale' };
      }
      return outcome;
    },

    async claimTurnRequestRecovery(input): ClaimTurnRequestRecoveryReturn {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const requestRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
        .doc(turnRequestStorageId(input.sessionId, input.requestId));
      const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
      return await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const owned = parseOwnedSession(sessionSnapshot.data(), input.userId);
        if (owned === null) return { status: 'not_found' as const };
        const accountSnapshot = await transaction.get(accountRef);
        if (!(await sourceAccountAllowsTurnStart(accountSnapshot.data(), owned, db, transaction))) {
          return { status: 'not_found' as const };
        }
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) return { status: 'not_found' as const };
        const request = toTurnRequest(requestSnapshot.data() as Record<string, unknown>);
        if (
          request.userId !== input.userId ||
          request.sessionId !== input.sessionId ||
          request.sessionGenerationId !== owned.generationId
        ) {
          return { status: 'not_found' as const };
        }
        const userTurnSnapshot = await transaction.get(
          db.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).doc(request.userTurnId)
        );
        if (!userTurnSnapshot.exists) return { status: 'not_found' as const };
        const userTurn = toTurn(
          userTurnSnapshot.id,
          userTurnSnapshot.data() as Record<string, unknown>
        );
        const assistantTurnSnapshot = await transaction.get(
          db
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
            .doc(request.assistantTurnId)
        );
        const replay = (): {
          status: 'replay';
          request: ConversationAssistantTurnRequest;
          userTurn: TurnRequestConversationTurn;
          assistantTurn?: TurnRequestConversationTurn;
          completedConversationRevision: number;
          activeTurnRequestId?: string;
          activeTurnLeaseExpiresAt?: string;
        } => ({
          status: 'replay',
          request,
          userTurn,
          completedConversationRevision: owned.continuation.completedConversationRevision,
          ...(owned.continuation.activeTurnRequestId === undefined
            ? {}
            : { activeTurnRequestId: owned.continuation.activeTurnRequestId }),
          ...(owned.continuation.activeTurnLeaseExpiresAt === undefined
            ? {}
            : { activeTurnLeaseExpiresAt: owned.continuation.activeTurnLeaseExpiresAt }),
          ...(assistantTurnSnapshot.exists
            ? {
                assistantTurn: toTurn(
                  assistantTurnSnapshot.id,
                  assistantTurnSnapshot.data() as Record<string, unknown>
                ),
              }
            : {}),
        });
        if (request.status !== 'in_progress') return replay();
        if (
          owned.continuation.activeTurnRequestId !== request.id ||
          owned.continuation.activeTurnLeaseExpiresAt !== request.leaseExpiresAt
        ) {
          return { status: 'busy' as const };
        }
        if (request.leaseExpiresAt > input.now) return replay();
        const reclaimed: ConversationAssistantTurnRequest = {
          ...request,
          attempt: request.attempt + 1,
          stateVersion: request.stateVersion + 1,
          claimId: input.claimId,
          leaseExpiresAt: input.leaseExpiresAt,
          updatedAt: input.now,
        };
        transaction.set(requestRef, {
          ...toRequestDocument(reclaimed),
          assistantSequence: requireAssistantSequence(requestSnapshot.data()),
        });
        transaction.update(sessionRef, {
          continuation: {
            ...owned.continuation,
            activeTurnRequestId: request.id,
            activeTurnLeaseExpiresAt: input.leaseExpiresAt,
          },
          updatedAt: input.now,
        });
        return { status: 'claimed' as const, request: reclaimed, userTurn };
      });
    },

    async renewTurnRequestLease(input): RenewTurnRequestLeaseReturn {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const requestRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
        .doc(turnRequestStorageId(input.sessionId, input.requestId));
      const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
      return await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const owned = parseOwnedSession(sessionSnapshot.data(), input.userId);
        if (owned === null) return { status: 'not_found' as const };
        const accountSnapshot = await transaction.get(accountRef);
        if (!(await sourceAccountAllowsTurnStart(accountSnapshot.data(), owned, db, transaction))) {
          return { status: 'not_found' as const };
        }
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) return { status: 'not_found' as const };
        const request = toTurnRequest(requestSnapshot.data() as Record<string, unknown>);
        if (request.userId !== input.userId || request.sessionId !== input.sessionId) {
          return { status: 'not_found' as const };
        }
        if (
          owned.generationId !== input.expectedSessionGenerationId ||
          request.sessionGenerationId !== input.expectedSessionGenerationId ||
          request.status !== 'in_progress' ||
          request.attempt !== input.attempt ||
          request.claimId !== input.claimId ||
          request.leaseExpiresAt <= input.now ||
          input.leaseExpiresAt <= input.now ||
          owned.continuation.activeTurnRequestId !== request.id ||
          owned.continuation.activeTurnLeaseExpiresAt !== request.leaseExpiresAt
        ) {
          return { status: 'stale' as const };
        }
        const renewed: ConversationAssistantTurnRequest = {
          ...request,
          leaseExpiresAt: input.leaseExpiresAt,
          updatedAt: input.now,
        };
        transaction.set(requestRef, {
          ...toRequestDocument(renewed),
          assistantSequence: requireAssistantSequence(requestSnapshot.data()),
        });
        transaction.update(sessionRef, {
          continuation: {
            ...owned.continuation,
            activeTurnRequestId: request.id,
            activeTurnLeaseExpiresAt: input.leaseExpiresAt,
          },
          updatedAt: input.now,
        });
        return { status: 'renewed' as const, request: renewed };
      });
    },

    async completeTurnRequest(input): CompleteTurnRequestReturn {
      return await finalizeTurnRequest({
        ...input,
        status: 'completed',
        assistantText: input.answerText,
      });
    },

    async failTurnRequest(input): FailTurnRequestReturn {
      return await finalizeTurnRequest({
        ...input,
        status: 'failed',
        assistantText: input.errorBodyText,
        error: { code: input.error.code, message: input.publicErrorMessage },
      });
    },

    async getTurnRequest(input): GetTurnRequestReturn {
      const db = getFirestore();
      const sessionSnapshot = await db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId)
        .get();
      const owned = parseOwnedSession(sessionSnapshot.data(), input.userId);
      if (owned === null) return { status: 'not_found' };
      if (
        !(await conversationAssistantSessionReadFenceAllows({
          db,
          sessionData: sessionSnapshot.data(),
          expectedUserId: input.userId,
        }))
      ) {
        return { status: 'not_found' };
      }
      const requestSnapshot = await db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
        .doc(turnRequestStorageId(input.sessionId, input.requestId))
        .get();
      if (!requestSnapshot.exists) return { status: 'not_found' };
      const request = toTurnRequest(requestSnapshot.data() as Record<string, unknown>);
      if (
        request.userId !== input.userId ||
        request.sessionId !== input.sessionId ||
        request.sessionGenerationId !== owned.generationId
      ) {
        return { status: 'not_found' };
      }
      const [userTurnSnapshot, assistantTurnSnapshot] = await Promise.all([
        db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .doc(request.userTurnId)
          .get(),
        db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .doc(request.assistantTurnId)
          .get(),
      ]);
      if (!userTurnSnapshot.exists) return { status: 'not_found' };
      return {
        status: 'found',
        request,
        userTurn: toTurn(userTurnSnapshot.id, userTurnSnapshot.data() as Record<string, unknown>),
        completedConversationRevision: owned.continuation.completedConversationRevision,
        ...(owned.continuation.activeTurnRequestId === undefined
          ? {}
          : { activeTurnRequestId: owned.continuation.activeTurnRequestId }),
        ...(owned.continuation.activeTurnLeaseExpiresAt === undefined
          ? {}
          : { activeTurnLeaseExpiresAt: owned.continuation.activeTurnLeaseExpiresAt }),
        ...(assistantTurnSnapshot.exists
          ? {
              assistantTurn: toTurn(
                assistantTurnSnapshot.id,
                assistantTurnSnapshot.data() as Record<string, unknown>
              ),
            }
          : {}),
      };
    },

    async claimAnswerRetry(input): ClaimAnswerRetryReturn {
      const db = getFirestore();
      const sessionRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
        .doc(input.sessionId);
      const requestRef = db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
        .doc(turnRequestStorageId(input.sessionId, input.requestId));
      const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
      return await db.runTransaction(async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const owned = parseOwnedSession(sessionSnapshot.data(), input.userId);
        if (owned === null) return { status: 'not_found' as const };
        const accountSnapshot = await transaction.get(accountRef);
        if (!(await sourceAccountAllowsTurnStart(accountSnapshot.data(), owned, db, transaction))) {
          return { status: 'not_found' as const };
        }
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) return { status: 'not_found' as const };
        const request = toTurnRequest(requestSnapshot.data() as Record<string, unknown>);
        if (
          request.userId !== input.userId ||
          request.sessionId !== input.sessionId ||
          request.sessionGenerationId !== owned.generationId
        ) {
          return { status: 'not_found' as const };
        }
        const userTurnSnapshot = await transaction.get(
          db.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).doc(request.userTurnId)
        );
        if (!userTurnSnapshot.exists) return { status: 'not_found' as const };
        const userTurn = toTurn(
          userTurnSnapshot.id,
          userTurnSnapshot.data() as Record<string, unknown>
        );
        const assistantTurnSnapshot = await transaction.get(
          db
            .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
            .doc(request.assistantTurnId)
        );
        if (request.status === 'completed') {
          return {
            status: 'replay' as const,
            request,
            userTurn,
            completedConversationRevision: owned.continuation.completedConversationRevision,
            ...(owned.continuation.activeTurnRequestId === undefined
              ? {}
              : { activeTurnRequestId: owned.continuation.activeTurnRequestId }),
            ...(owned.continuation.activeTurnLeaseExpiresAt === undefined
              ? {}
              : { activeTurnLeaseExpiresAt: owned.continuation.activeTurnLeaseExpiresAt }),
            ...(assistantTurnSnapshot.exists
              ? {
                  assistantTurn: toTurn(
                    assistantTurnSnapshot.id,
                    assistantTurnSnapshot.data() as Record<string, unknown>
                  ),
                }
              : {}),
          };
        }
        if (request.status !== 'failed' || request.error?.code !== 'LLM_ERROR') {
          return { status: 'invalid_state' as const };
        }
        if (hasUnexpiredActiveLease(owned.continuation, input.now)) {
          return { status: 'busy' as const };
        }
        if (
          !isLatestRetryableConversationAssistantAnswer({
            failed: true,
            errorCode: request.error.code,
            conversationRevision: request.conversationRevision,
            completedConversationRevision: owned.continuation.completedConversationRevision,
            activeTurnRequestId: owned.continuation.activeTurnRequestId,
            activeTurnLeaseExpiresAt: owned.continuation.activeTurnLeaseExpiresAt,
            now: input.now,
          })
        ) {
          return { status: 'invalid_state' as const };
        }
        const claimed: ConversationAssistantTurnRequest = {
          ...request,
          status: 'in_progress',
          attempt: request.attempt + 1,
          stateVersion: request.stateVersion + 1,
          claimId: input.claimId,
          leaseExpiresAt: input.leaseExpiresAt,
          updatedAt: input.now,
        };
        delete claimed.completedAt;
        delete claimed.error;
        transaction.set(requestRef, {
          ...toRequestDocument(claimed),
          assistantSequence: requireAssistantSequence(requestSnapshot.data()),
        });
        transaction.update(sessionRef, {
          continuation: {
            ...owned.continuation,
            activeTurnRequestId: request.id,
            activeTurnLeaseExpiresAt: input.leaseExpiresAt,
          },
          updatedAt: input.now,
        });
        return { status: 'claimed' as const, request: claimed, userTurn };
      });
    },
  };
}

function parseOwnedSession(
  data: Record<string, unknown> | undefined,
  userId: string
): SessionOwnership | null {
  if (
    data?.['userId'] !== userId ||
    typeof data['generationId'] !== 'string' ||
    typeof data['deletionStartedAt'] === 'string' ||
    (data['status'] !== 'ready' && data['status'] !== 'active')
  ) {
    return null;
  }
  const continuation = parseContinuation(data['continuation']);
  if (continuation === null) return null;
  return { generationId: data['generationId'], continuation, data };
}

async function sourceAccountAllowsTurnStart(
  account: Record<string, unknown> | undefined,
  owned: SessionOwnership,
  db: ReturnType<typeof getFirestore>,
  transaction: FirebaseFirestore.Transaction
): Promise<boolean> {
  return await conversationAssistantSessionReadFenceAllowsWithAccount({
    db,
    transaction,
    sessionData: owned.data,
    accountData: account,
    requireSourceAccountGeneration: true,
  });
}

function parseContinuation(value: unknown): StoredContinuation | null {
  if (!isRecord(value)) return null;
  const strings = [
    'sourceAccountId',
    'contextEventThrough',
    'contextChainSha256',
    'displayTimeZone',
  ] as const;
  const integers = [
    'contextVersion',
    'contextChangeThrough',
    'nextTurnSequence',
    'nextConversationRevision',
    'completedConversationRevision',
    'attachmentCount',
    'totalAttachedMessageCount',
    'totalAttachedOmittedCount',
  ] as const;
  if (
    strings.some((key) => typeof value[key] !== 'string') ||
    integers.some((key) => !isNonNegativeInteger(value[key]))
  ) {
    return null;
  }
  return {
    sourceAccountId: value['sourceAccountId'] as string,
    contextVersion: value['contextVersion'] as number,
    contextEventThrough: value['contextEventThrough'] as string,
    contextChangeThrough: value['contextChangeThrough'] as number,
    contextChainSha256: value['contextChainSha256'] as string,
    displayTimeZone: value['displayTimeZone'] as string,
    nextTurnSequence: value['nextTurnSequence'] as number,
    nextConversationRevision: value['nextConversationRevision'] as number,
    completedConversationRevision: value['completedConversationRevision'] as number,
    attachmentCount: value['attachmentCount'] as number,
    totalAttachedMessageCount: value['totalAttachedMessageCount'] as number,
    totalAttachedOmittedCount: value['totalAttachedOmittedCount'] as number,
    ...(typeof value['activeTurnRequestId'] === 'string'
      ? { activeTurnRequestId: value['activeTurnRequestId'] }
      : {}),
    ...(typeof value['activeTurnLeaseExpiresAt'] === 'string'
      ? { activeTurnLeaseExpiresAt: value['activeTurnLeaseExpiresAt'] }
      : {}),
  };
}

function parseReadyAttachment(
  id: string,
  data: Record<string, unknown> | undefined,
  input: { userId: string; sessionId: string; contextAttachmentId?: string; now: string },
  owned: SessionOwnership
):
  | { status: 'ready'; attachment: StoredAttachment }
  | { status: 'attachment_stale' | 'attachment_not_ready' | 'not_found' } {
  if (
    data?.['userId'] !== input.userId ||
    data['sessionId'] !== input.sessionId ||
    data['sessionGenerationId'] !== owned.generationId
  ) {
    return { status: 'not_found' };
  }
  if (data['status'] !== 'ready') return { status: 'attachment_not_ready' };
  if (
    data['baseContextVersion'] !== owned.continuation.contextVersion ||
    data['baseEventThrough'] !== owned.continuation.contextEventThrough ||
    data['baseChangeSeq'] !== owned.continuation.contextChangeThrough ||
    data['previousContextChainSha256'] !== owned.continuation.contextChainSha256
  ) {
    return { status: 'attachment_stale' };
  }
  const expireAt = toIso(data['expireAt']);
  const capturedAt = toIso(data['capturedAt']);
  const manifest = data['chunkManifest'];
  const captureRange = parseDateRange(data['captureRange']);
  const eventRange = parseDateRange(data['eventRange']);
  const counts = parseAttachmentCounts(data['counts']);
  const omitted = parseOmittedCounts(data['omitted']);
  if (
    expireAt === null ||
    expireAt <= input.now ||
    !isRecord(manifest) ||
    !Array.isArray(manifest['chunkIds']) ||
    !manifest['chunkIds'].every((chunkId) => typeof chunkId === 'string') ||
    !isNonNegativeInteger(manifest['chunkCount']) ||
    manifest['chunkCount'] !== manifest['chunkIds'].length ||
    manifest['chunkCount'] > CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS ||
    new Set(manifest['chunkIds']).size !== manifest['chunkIds'].length ||
    typeof data['snapshotId'] !== 'string' ||
    capturedAt === null ||
    captureRange === null ||
    counts === null ||
    omitted === null ||
    !isNonNegativeInteger(data['cutoffChangeSeq']) ||
    typeof data['resultingContextChainSha256'] !== 'string' ||
    typeof data['deltaTranscriptSha256'] !== 'string' ||
    !isNonNegativeInteger(data['estimatedInputTokens'])
  ) {
    return { status: 'attachment_not_ready' };
  }
  return {
    status: 'ready',
    attachment: {
      id,
      snapshotId: data['snapshotId'],
      chunkIds: manifest['chunkIds'],
      capturedAt,
      captureRange,
      ...(eventRange === null ? {} : { eventRange }),
      counts,
      omitted,
      baseContextVersion: data['baseContextVersion'],
      baseEventThrough: data['baseEventThrough'],
      baseChangeSeq: data['baseChangeSeq'],
      cutoffChangeSeq: data['cutoffChangeSeq'],
      deltaTranscriptSha256: data['deltaTranscriptSha256'],
      previousContextChainSha256: data['previousContextChainSha256'],
      resultingContextChainSha256: data['resultingContextChainSha256'],
      estimatedInputTokens: data['estimatedInputTokens'],
      requiresConfirmation: data['requiresConfirmation'] === true,
      ...(typeof data['confirmationToken'] === 'string'
        ? { confirmationToken: data['confirmationToken'] }
        : {}),
    },
  };
}

async function loadPreparedSnapshot(
  transaction: FirebaseFirestore.Transaction,
  db: ReturnType<typeof getFirestore>,
  attachment: StoredAttachment,
  userId: string,
  sessionId: string,
  generationId: string,
  attachmentId: string,
  now: string,
  requirePendingTtl: boolean
): Promise<PreparedSnapshotLoadResult> {
  const parts: Buffer[] = [];
  for (const [chunkIndex, chunkId] of attachment.chunkIds.entries()) {
    const chunkSnapshot = await transaction.get(
      db.collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION).doc(chunkId)
    );
    const data = chunkSnapshot.data();
    const expireAt = toIso(data?.['expireAt']);
    if (
      !chunkSnapshot.exists ||
      data?.['userId'] !== userId ||
      data['sessionId'] !== sessionId ||
      data['sessionGenerationId'] !== generationId ||
      data['attachmentId'] !== attachmentId ||
      data['snapshotId'] !== attachment.snapshotId ||
      data['chunkIndex'] !== chunkIndex ||
      data['chunkCount'] !== attachment.chunkIds.length ||
      data['encoding'] !== 'base64-json' ||
      typeof data['payload'] !== 'string' ||
      (requirePendingTtl ? expireAt === null || expireAt <= now : expireAt !== null)
    ) {
      return { status: 'unavailable' };
    }
    parts.push(Buffer.from(data['payload'], 'base64'));
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!isPreparedSnapshot(parsed, attachment)) return { status: 'unavailable' };
    if (
      parsed.previousContextChainSha256 !== attachment.previousContextChainSha256 ||
      parsed.deltaTranscriptSha256 !== attachment.deltaTranscriptSha256 ||
      parsed.resultingContextChainSha256 !== attachment.resultingContextChainSha256 ||
      !verifyConversationAssistantPreparedSnapshotIntegrity(parsed)
    ) {
      return { status: 'chain_mismatch' };
    }
    return { status: 'found', snapshot: parsed };
  } catch {
    return { status: 'unavailable' };
  }
}

function isPreparedSnapshot(
  value: unknown,
  attachment: StoredAttachment
): value is ConversationAssistantContextAttachmentPreparedSnapshot {
  if (!isRecord(value)) return false;
  const counts = parseAttachmentCounts(value['counts']);
  const omitted = parseOmittedCounts(value['omitted']);
  return (
    typeof value['transcriptText'] === 'string' &&
    Array.isArray(value['messages']) &&
    Array.isArray(value['omittedMessages']) &&
    Array.isArray(value['corrections']) &&
    typeof value['deltaTranscriptSha256'] === 'string' &&
    typeof value['previousContextChainSha256'] === 'string' &&
    typeof value['resultingContextChainSha256'] === 'string' &&
    counts !== null &&
    JSON.stringify(counts) === JSON.stringify(attachment.counts) &&
    omitted !== null &&
    JSON.stringify(omitted) === JSON.stringify(attachment.omitted) &&
    value['estimatedInputTokens'] === attachment.estimatedInputTokens &&
    value['requiresConfirmation'] === attachment.requiresConfirmation &&
    (attachment.confirmationToken === undefined
      ? value['confirmationToken'] === undefined
      : value['confirmationToken'] === attachment.confirmationToken)
  );
}

function createUserTurn(input: {
  id: string;
  input: {
    userId: string;
    sessionId: string;
    requestId: string;
    question: string;
    contextAttachmentId?: string;
    now: string;
  };
  generationId: string;
  sequence: number;
  conversationRevision: number;
  attachment?: StoredAttachment;
}): TurnRequestConversationTurn {
  return {
    id: input.id,
    sessionId: input.input.sessionId,
    userId: input.input.userId,
    role: 'user',
    text: input.input.question,
    createdAt: input.input.now,
    sequence: input.sequence,
    conversationRevision: input.conversationRevision,
    requestId: input.input.requestId,
    kind: input.attachment === undefined ? 'message' : 'context_attachment_question',
    ...(input.attachment === undefined
      ? {}
      : {
          contextAttachmentId: input.attachment.id,
          contextAttachment: {
            id: input.attachment.id,
            capturedAt: input.attachment.capturedAt,
            captureRange: input.attachment.captureRange,
            ...(input.attachment.eventRange === undefined
              ? {}
              : { eventRange: input.attachment.eventRange }),
            counts: {
              included: input.attachment.counts.included,
              excluded: input.attachment.counts.omitted,
              newlyAvailable: input.attachment.counts.newlyAvailable,
              edited: input.attachment.counts.edited,
              redacted: input.attachment.counts.redacted,
              deleted: input.attachment.counts.deleted,
              reactionsChanged: input.attachment.counts.reactionsChanged,
              lateIngested: input.attachment.counts.lateIngested,
              completedTranscriptions: input.attachment.counts.completedTranscriptions,
            },
            omitted: input.attachment.omitted,
          },
        }),
  };
}

function toTurnDocument(
  turn: TurnRequestConversationTurn,
  generationId: string,
  attachment?: StoredAttachment
): Record<string, unknown> {
  return {
    ...turn,
    sessionGenerationId: generationId,
    ...(attachment === undefined
      ? {}
      : {
          contextAttachmentEstimatedInputTokens: attachment.estimatedInputTokens,
        }),
  };
}

function toRequestDocument(request: ConversationAssistantTurnRequest): Record<string, unknown> {
  return { ...request };
}

function toTurnRequest(data: Record<string, unknown>): ConversationAssistantTurnRequest {
  const request: ConversationAssistantTurnRequest = {
    id: requireString(data, 'id'),
    requestFingerprint: requireString(data, 'requestFingerprint'),
    sessionId: requireString(data, 'sessionId'),
    userId: requireString(data, 'userId'),
    sessionGenerationId: requireString(data, 'sessionGenerationId'),
    status: requireRequestStatus(data['status']),
    attempt: requireNonNegativeInteger(data, 'attempt'),
    stateVersion: requireNonNegativeInteger(data, 'stateVersion'),
    conversationRevision: requireNonNegativeInteger(data, 'conversationRevision'),
    userTurnId: requireString(data, 'userTurnId'),
    assistantTurnId: requireString(data, 'assistantTurnId'),
    question: requireString(data, 'question'),
    acknowledgment: requireString(data, 'acknowledgment'),
    claimId: requireString(data, 'claimId'),
    leaseExpiresAt: requireString(data, 'leaseExpiresAt'),
    createdAt: requireString(data, 'createdAt'),
    updatedAt: requireString(data, 'updatedAt'),
  };
  copyOptionalString(data, request, 'contextAttachmentId');
  copyOptionalString(data, request, 'completedAt');
  if (
    isRecord(data['error']) &&
    typeof data['error']['code'] === 'string' &&
    typeof data['error']['message'] === 'string'
  ) {
    request.error = { code: data['error']['code'], message: data['error']['message'] };
  }
  return request;
}

function toTurn(id: string, data: Record<string, unknown>): TurnRequestConversationTurn {
  const role = data['role'];
  const kind = data['kind'];
  if (
    (role !== 'user' && role !== 'assistant') ||
    (kind !== 'message' && kind !== 'context_attachment_question')
  ) {
    throw new Error('Invalid Conversation Assistant turn');
  }
  const turn: TurnRequestConversationTurn = {
    id,
    sessionId: requireString(data, 'sessionId'),
    userId: requireString(data, 'userId'),
    role,
    text: requireString(data, 'text'),
    createdAt: requireString(data, 'createdAt'),
    sequence: requireNonNegativeInteger(data, 'sequence'),
    conversationRevision: requireNonNegativeInteger(data, 'conversationRevision'),
    requestId: requireString(data, 'requestId'),
    kind,
  };
  copyOptionalString(data, turn, 'acknowledgment');
  copyOptionalString(data, turn, 'contextAttachmentId');
  const summary = parseTurnContextAttachmentSummary(data['contextAttachment']);
  if (summary !== null) turn.contextAttachment = summary;
  if (isRecord(data['usage'])) {
    turn.usage = data['usage'] as NonNullable<TurnRequestConversationTurn['usage']>;
  }
  if (
    isRecord(data['error']) &&
    typeof data['error']['code'] === 'string' &&
    typeof data['error']['message'] === 'string'
  ) {
    turn.error = { code: data['error']['code'], message: data['error']['message'] };
  }
  return turn;
}

async function finalizeTurnRequest(input: {
  userId: string;
  sessionId: string;
  requestId: string;
  expectedSessionGenerationId: string;
  attempt: number;
  claimId: string;
  completedAt: string;
  assistantText: string;
  status: 'completed' | 'failed';
  usage?: TurnRequestConversationTurn['usage'];
  error?: { code: string; message: string };
}): Promise<FinalizeConversationAssistantTurnRequestResult> {
  const db = getFirestore();
  const sessionRef = db
    .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
    .doc(input.sessionId);
  const requestRef = db
    .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION)
    .doc(turnRequestStorageId(input.sessionId, input.requestId));
  const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
  return await db.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    const owned = parseOwnedSession(sessionSnapshot.data(), input.userId);
    if (owned === null) return { status: 'not_found' as const };
    const accountSnapshot = await transaction.get(accountRef);
    if (!(await sourceAccountAllowsTurnStart(accountSnapshot.data(), owned, db, transaction))) {
      return { status: 'not_found' as const };
    }
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) return { status: 'not_found' as const };
    const request = toTurnRequest(requestSnapshot.data() as Record<string, unknown>);
    const retryFinalization =
      request.attempt > 1 &&
      owned.continuation.completedConversationRevision === request.conversationRevision;
    if (
      request.userId !== input.userId ||
      request.sessionId !== input.sessionId ||
      request.sessionGenerationId !== input.expectedSessionGenerationId ||
      owned.generationId !== input.expectedSessionGenerationId ||
      request.status !== 'in_progress' ||
      request.attempt !== input.attempt ||
      request.claimId !== input.claimId ||
      request.leaseExpiresAt <= input.completedAt ||
      owned.continuation.activeTurnRequestId !== request.id ||
      owned.continuation.activeTurnLeaseExpiresAt !== request.leaseExpiresAt ||
      (!retryFinalization &&
        owned.continuation.completedConversationRevision + 1 !== request.conversationRevision)
    ) {
      return { status: 'stale' as const };
    }
    const assistantTurn: TurnRequestConversationTurn = {
      id: request.assistantTurnId,
      sessionId: request.sessionId,
      userId: request.userId,
      role: 'assistant',
      text: input.assistantText,
      createdAt: input.completedAt,
      sequence: requireAssistantSequence(requestSnapshot.data()),
      conversationRevision: request.conversationRevision,
      requestId: request.id,
      kind: 'message',
      acknowledgment: request.acknowledgment,
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      ...(input.error === undefined ? {} : { error: input.error }),
    };
    const finalized: ConversationAssistantTurnRequest = {
      ...request,
      status: input.status,
      stateVersion: request.stateVersion + 1,
      updatedAt: input.completedAt,
      completedAt: input.completedAt,
      ...(input.error === undefined ? {} : { error: input.error }),
    };
    if (input.error === undefined) delete finalized.error;
    const continuation: StoredContinuation = {
      ...owned.continuation,
      completedConversationRevision: request.conversationRevision,
    };
    delete continuation.activeTurnRequestId;
    delete continuation.activeTurnLeaseExpiresAt;
    transaction.set(requestRef, {
      ...toRequestDocument(finalized),
      assistantSequence: assistantTurn.sequence,
    });
    transaction.set(
      db.collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION).doc(request.assistantTurnId),
      toTurnDocument(assistantTurn, owned.generationId)
    );
    transaction.update(sessionRef, {
      continuation,
      lastTurnAt: input.completedAt,
      updatedAt: input.completedAt,
    });
    return { status: input.status, request: finalized, assistantTurn };
  });
}

function requireAssistantSequence(data: Record<string, unknown> | undefined): number {
  if (!isRecord(data) || !isNonNegativeInteger(data['assistantSequence'])) {
    throw new Error('Invalid Conversation Assistant turn request sequence');
  }
  return data['assistantSequence'];
}

async function buildPrecommitPromptSnapshot(input: {
  transaction: FirebaseFirestore.Transaction;
  db: ReturnType<typeof getFirestore>;
  owned: SessionOwnership;
  userId: string;
  sessionId: string;
  question: string;
  priorTurnDocuments: { id: string; data: Record<string, unknown> }[];
  currentContextUpdate?: ConversationAssistantTurnRequestPromptSnapshot['currentContextUpdate'];
}): Promise<
  | { status: 'found'; snapshot: ConversationAssistantTurnRequestPromptSnapshot }
  | { status: 'chain_mismatch' | 'not_found' }
> {
  const transcriptText = await loadInitialTranscript(
    input.transaction,
    input.db,
    input.sessionId,
    input.owned.generationId,
    input.owned.data
  );
  const range = parseDateRange(input.owned.data['range']);
  const effectiveRange = parseDateRange(input.owned.data['effectiveRange']) ?? range;
  const model = input.owned.data['model'];
  if (
    transcriptText === null ||
    range === null ||
    effectiveRange === null ||
    typeof model !== 'string' ||
    model === ''
  ) {
    return { status: 'not_found' };
  }

  const history: ConversationAssistantTurnRequestPromptSnapshot['history'][number][] = [];
  for (const document of input.priorTurnDocuments) {
    if (document.data['sessionGenerationId'] !== input.owned.generationId) continue;
    let turn: TurnRequestConversationTurn;
    try {
      turn = toTurn(document.id, document.data);
    } catch {
      return { status: 'not_found' };
    }
    if (turn.conversationRevision > input.owned.continuation.completedConversationRevision) {
      continue;
    }
    let contextUpdate: ConversationAssistantTurnRequestPromptSnapshot['currentContextUpdate'];
    if (turn.role === 'user' && turn.contextAttachmentId !== undefined) {
      const loaded = await loadCommittedTurnContext(
        input.transaction,
        input.db,
        turn,
        input.owned.generationId,
        turn.contextAttachmentId
      );
      if (loaded.status !== 'found')
        return { status: loaded.status === 'chain_mismatch' ? 'chain_mismatch' : 'not_found' };
      contextUpdate = toPromptContextUpdate(
        loaded.snapshot,
        input.sessionId,
        input.owned.generationId
      );
    }
    history.push({
      role: turn.role,
      text: turn.text,
      ...(contextUpdate === undefined ? {} : { contextUpdate }),
    });
  }

  return {
    status: 'found',
    snapshot: {
      userId: input.userId,
      sessionId: input.sessionId,
      model,
      transcriptText,
      ...(typeof input.owned.data['chatDisplayName'] === 'string'
        ? { chatDisplayName: input.owned.data['chatDisplayName'] }
        : {}),
      range,
      effectiveRange,
      history,
      currentQuestion: input.question,
      ...(input.currentContextUpdate === undefined
        ? {}
        : { currentContextUpdate: input.currentContextUpdate }),
    },
  };
}

async function loadInitialTranscript(
  transaction: FirebaseFirestore.Transaction,
  db: ReturnType<typeof getFirestore>,
  sessionId: string,
  generationId: string,
  sessionData: Record<string, unknown>
): Promise<string | null> {
  const storage = sessionData['transcriptStorage'];
  const transcriptSha256 = sessionData['transcriptSha256'];
  if (
    typeof transcriptSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(transcriptSha256)
  ) {
    return null;
  }
  if (storage === undefined) {
    const inlineTranscript = sessionData['transcriptText'];
    if (typeof inlineTranscript !== 'string') return null;
    return createHash('sha256').update(inlineTranscript, 'utf8').digest('hex') === transcriptSha256
      ? inlineTranscript
      : null;
  }
  if (!isRecord(storage) || storage['type'] !== 'chunks') return null;
  const chunkCount = storage['chunkCount'];
  const chunkSizeBytes = storage['chunkSizeBytes'];
  const byteLength = storage['byteLength'];
  const snapshotId = storage['snapshotId'];
  if (
    !isNonNegativeInteger(chunkCount) ||
    chunkCount === 0 ||
    chunkCount > CONVERSATION_ASSISTANT_INITIAL_TRANSCRIPT_MAX_CHUNKS ||
    chunkSizeBytes !== TRANSCRIPT_CHUNK_MAX_BYTES ||
    !isNonNegativeInteger(byteLength) ||
    byteLength === 0 ||
    byteLength > chunkCount * TRANSCRIPT_CHUNK_MAX_BYTES ||
    snapshotId !== transcriptSha256
  ) {
    return null;
  }
  const chunks: string[] = [];
  let loadedByteLength = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const chunkDocumentId = `${sessionId}_${snapshotId}_${String(index).padStart(6, '0')}`;
    const chunkSnapshot: FirebaseFirestore.DocumentSnapshot = await transaction.get(
      db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
        .doc(chunkDocumentId)
    );
    const data: Record<string, unknown> | undefined = chunkSnapshot.data();
    if (
      !chunkSnapshot.exists ||
      data?.['sessionId'] !== sessionId ||
      data['sessionGenerationId'] !== generationId ||
      data['chunkIndex'] !== index ||
      data['snapshotId'] !== snapshotId ||
      typeof data['text'] !== 'string'
    ) {
      return null;
    }
    const chunkByteLength = Buffer.byteLength(data['text'], 'utf8');
    if (
      chunkByteLength === 0 ||
      chunkByteLength > TRANSCRIPT_CHUNK_MAX_BYTES ||
      (index < chunkCount - 1 && chunkByteLength <= TRANSCRIPT_CHUNK_MAX_BYTES - 4)
    ) {
      return null;
    }
    loadedByteLength += chunkByteLength;
    chunks.push(data['text']);
  }
  const transcriptText = chunks.join('');
  if (
    loadedByteLength !== byteLength ||
    Buffer.byteLength(transcriptText, 'utf8') !== byteLength ||
    createHash('sha256').update(transcriptText, 'utf8').digest('hex') !== transcriptSha256
  ) {
    return null;
  }
  return transcriptText;
}

async function loadCommittedTurnContext(
  transaction: FirebaseFirestore.Transaction,
  db: ReturnType<typeof getFirestore>,
  turn: TurnRequestConversationTurn,
  generationId: string,
  attachmentId: string
): Promise<PreparedSnapshotLoadResult> {
  const snapshot = await transaction.get(
    db.collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION).doc(attachmentId)
  );
  const data = snapshot.data();
  if (
    data?.['status'] !== 'committed' ||
    data['userId'] !== turn.userId ||
    data['sessionId'] !== turn.sessionId ||
    data['sessionGenerationId'] !== generationId ||
    data['committedTurnId'] !== turn.id ||
    data['expireAt'] !== undefined
  ) {
    return { status: 'unavailable' };
  }
  const parsed = parseCommittedAttachment(snapshot.id, data);
  if (parsed === null) return { status: 'unavailable' };
  return await loadPreparedSnapshot(
    transaction,
    db,
    parsed,
    turn.userId,
    turn.sessionId,
    generationId,
    attachmentId,
    '',
    false
  );
}

function parseCommittedAttachment(
  id: string,
  data: Record<string, unknown>
): StoredAttachment | null {
  const manifest = data['chunkManifest'];
  const counts = parseAttachmentCounts(data['counts']);
  const omitted = parseOmittedCounts(data['omitted']);
  const captureRange = parseDateRange(data['captureRange']);
  const eventRange = parseDateRange(data['eventRange']);
  const capturedAt = toIso(data['capturedAt']);
  if (
    !isRecord(manifest) ||
    !Array.isArray(manifest['chunkIds']) ||
    !manifest['chunkIds'].every((idValue) => typeof idValue === 'string') ||
    manifest['chunkIds'].length > CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENT_MAX_CHUNKS ||
    typeof data['snapshotId'] !== 'string' ||
    capturedAt === null ||
    captureRange === null ||
    counts === null ||
    omitted === null ||
    !isNonNegativeInteger(data['baseContextVersion']) ||
    typeof data['baseEventThrough'] !== 'string' ||
    !isNonNegativeInteger(data['baseChangeSeq']) ||
    !isNonNegativeInteger(data['cutoffChangeSeq']) ||
    typeof data['previousContextChainSha256'] !== 'string' ||
    typeof data['resultingContextChainSha256'] !== 'string' ||
    typeof data['deltaTranscriptSha256'] !== 'string' ||
    !isNonNegativeInteger(data['estimatedInputTokens'])
  ) {
    return null;
  }
  return {
    id,
    snapshotId: data['snapshotId'],
    chunkIds: manifest['chunkIds'],
    capturedAt,
    captureRange,
    ...(eventRange === null ? {} : { eventRange }),
    counts,
    omitted,
    baseContextVersion: data['baseContextVersion'],
    baseEventThrough: data['baseEventThrough'],
    baseChangeSeq: data['baseChangeSeq'],
    cutoffChangeSeq: data['cutoffChangeSeq'],
    deltaTranscriptSha256: data['deltaTranscriptSha256'],
    previousContextChainSha256: data['previousContextChainSha256'],
    resultingContextChainSha256: data['resultingContextChainSha256'],
    estimatedInputTokens: data['estimatedInputTokens'],
    requiresConfirmation: data['requiresConfirmation'] === true,
  };
}

function toPromptContextUpdate(
  snapshot: ConversationAssistantContextAttachmentPreparedSnapshot,
  sessionId: string,
  sessionGenerationId: string
): NonNullable<ConversationAssistantTurnRequestPromptSnapshot['currentContextUpdate']> {
  const records: NonNullable<
    ConversationAssistantTurnRequestPromptSnapshot['currentContextUpdate']
  >['records'][number][] = [];
  const referenceScope = { sessionId, sessionGenerationId };
  for (const change of snapshot.corrections) {
    if (change.after.state === 'redacted' || change.after.state === 'deleted') {
      records.push({
        kind: 'tombstone',
        targetReference: createConversationAssistantMessageReference(
          referenceScope,
          change.messageId
        ),
        state: change.after.state,
      });
    } else if (change.before.state === 'included' && change.after.state === 'included') {
      records.push({
        kind: 'correction',
        targetReference: createConversationAssistantMessageReference(
          referenceScope,
          change.messageId
        ),
        replacementText: buildPrivateConversationModelFacingMessageProjection(
          {
            id: change.messageId,
            eventTimestamp: change.after.eventTimestamp,
            importedAt: change.after.importedAt,
            direction: change.after.direction,
            speakerLabel: change.after.speakerLabel,
            messageType: change.after.messageType,
            contentKind: change.after.contentKind,
            content: change.after.content,
            reactions: change.after.reactions,
          },
          referenceScope
        ),
      });
    } else if (
      change.before.state === 'included' &&
      (change.after.state === 'omitted' || change.after.state === 'missing')
    ) {
      records.push({
        kind: 'tombstone',
        targetReference: createConversationAssistantMessageReference(
          referenceScope,
          change.messageId
        ),
        state: 'unavailable',
      });
    }
  }
  return {
    transcriptText: snapshot.transcriptText,
    records,
  };
}

function hasUnexpiredActiveLease(continuation: StoredContinuation, now: string): boolean {
  return (
    continuation.activeTurnRequestId !== undefined &&
    continuation.activeTurnLeaseExpiresAt !== undefined &&
    continuation.activeTurnLeaseExpiresAt > now
  );
}

function activeLeaseMayBeReclaimed(continuation: StoredContinuation, now: string): boolean {
  return (
    continuation.activeTurnRequestId === undefined ||
    continuation.activeTurnLeaseExpiresAt === undefined ||
    continuation.activeTurnLeaseExpiresAt <= now
  );
}

function turnRequestStorageId(sessionId: string, requestId: string): string {
  return createHash('sha256').update(`${sessionId}\u0000${requestId}`).digest('hex');
}

function parseAttachmentCounts(
  value: unknown
): ConversationAssistantContextAttachmentCounts | null {
  if (!isRecord(value)) return null;
  const keys = [
    'included',
    'omitted',
    'newlyAvailable',
    'edited',
    'redacted',
    'deleted',
    'reactionsChanged',
    'lateIngested',
    'completedTranscriptions',
  ] as const;
  if (keys.some((key) => !isNonNegativeInteger(value[key]))) return null;
  return Object.fromEntries(
    keys.map((key) => [key, value[key]])
  ) as unknown as ConversationAssistantContextAttachmentCounts;
}

function parseTurnContextAttachmentSummary(
  value: unknown
): ConversationAssistantTurnContextAttachmentSummary | null {
  if (!isRecord(value)) return null;
  const captureRange = parseDateRange(value['captureRange']);
  const eventRange = parseDateRange(value['eventRange']);
  const countsValue = value['counts'];
  const omitted = parseOmittedCounts(value['omitted']);
  const countKeys = [
    'included',
    'excluded',
    'newlyAvailable',
    'edited',
    'redacted',
    'deleted',
    'reactionsChanged',
    'lateIngested',
    'completedTranscriptions',
  ] as const;
  if (
    typeof value['id'] !== 'string' ||
    typeof value['capturedAt'] !== 'string' ||
    captureRange === null ||
    (value['eventRange'] !== undefined && eventRange === null) ||
    !isRecord(countsValue) ||
    countKeys.some((key) => !isNonNegativeInteger(countsValue[key])) ||
    omitted === null
  ) {
    return null;
  }
  const counts = Object.fromEntries(
    countKeys.map((key) => [key, countsValue[key]])
  ) as unknown as ConversationAssistantTurnContextAttachmentSummary['counts'];
  return {
    id: value['id'],
    capturedAt: value['capturedAt'],
    captureRange,
    ...(eventRange === null ? {} : { eventRange }),
    counts,
    omitted,
  };
}

function parseOmittedCounts(
  value: unknown
): ConversationAssistantContextAttachmentPreparedSnapshot['omitted'] | null {
  if (!isRecord(value)) return null;
  const keys = [
    'mediaOnly',
    'failedTranscriptions',
    'pendingTranscriptions',
    'nonText',
    'overLimit',
  ] as const;
  if (keys.some((key) => !isNonNegativeInteger(value[key]))) return null;
  return Object.fromEntries(
    keys.map((key) => [key, value[key]])
  ) as unknown as ConversationAssistantContextAttachmentPreparedSnapshot['omitted'];
}

function parseDateRange(value: unknown): { from: string; to: string } | null {
  if (!isRecord(value)) return null;
  const from = toIso(value['from']);
  const to = toIso(value['to']);
  return from === null || to === null ? null : { from, to };
}

function toIso(value: unknown): string | null {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return null;
}

function requireString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string') throw new Error('Invalid Conversation Assistant document');
  return field;
}

function requireNonNegativeInteger(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (!isNonNegativeInteger(field)) throw new Error('Invalid Conversation Assistant document');
  return field;
}

function requireRequestStatus(value: unknown): ConversationAssistantTurnRequest['status'] {
  if (value === 'in_progress' || value === 'completed' || value === 'failed') return value;
  throw new Error('Invalid Conversation Assistant turn request');
}

function copyOptionalString<T extends object>(
  source: Record<string, unknown>,
  target: T,
  key: keyof T
): void {
  const value = source[key as string];
  if (typeof value === 'string') (target as Record<string, unknown>)[key as string] = value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
