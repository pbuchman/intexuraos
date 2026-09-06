import { getErrorMessage } from '@intexuraos/common-core';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  computeExpireAt,
  getFirestore,
} from '@intexuraos/infra-firestore';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import type { ConversationAssistantRepository } from '../../domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantContextResult,
  ConversationAssistantSession,
  ConversationAssistantSessionContinuation,
  ConversationAssistantTurn,
} from '../../domain/conversation-assistant/types.js';
import { DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL } from '../../domain/conversation-assistant/roleInference.js';
import { createConversationAssistantDeletionToken } from '../../domain/conversation-assistant/deletionToken.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
} from './privateWhatsAppRepository.js';
import {
  conversationAssistantSessionReadFenceAllows,
  conversationAssistantSessionReadFenceAllowsWithAccount,
} from './conversationAssistantReadFence.js';

export const WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION =
  'whatsapp_conversation_assistant_sessions';
export const WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION =
  'whatsapp_conversation_assistant_transcript_chunks';
export const WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION =
  'whatsapp_conversation_assistant_context_chunks';
export const WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION =
  'whatsapp_conversation_assistant_turns';
const WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_CASCADE_COLLECTION =
  'whatsapp_conversation_assistant_context_attachments';
const WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_CASCADE_COLLECTION =
  'whatsapp_conversation_assistant_turn_requests';
export const TRANSCRIPT_CHUNK_MAX_BYTES = 200_000;
export const CONTEXT_CHUNK_MAX_BYTES = 200_000;
export const CASCADE_DELETE_BATCH_SIZE = 20;
export const CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS = 499;
export const CONVERSATION_ASSISTANT_INITIAL_PREPARATION_CHUNK_TTL_MS = 30 * 60 * 1000;

export function resolveConversationAssistantInitialPreparationChunkLimit<T>(input: {
  chunkCounts: readonly number[];
  withinLimit: () => T;
  overLimit: () => T;
}): T {
  const chunkCount = input.chunkCounts.reduce((total, count) => total + count, 0);
  return chunkCount <= CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS
    ? input.withinLimit()
    : input.overLimit();
}

interface TranscriptChunkStorage {
  type: 'chunks';
  chunkCount: number;
  chunkSizeBytes: number;
  byteLength: number;
  snapshotId?: string;
}

interface PendingContextChunkStorage {
  type: 'chunks';
  snapshotId: string;
  chunkIds: string[];
  chunkCount: number;
  sessionGenerationId?: string;
  sourceAccountId: string;
  sourceAccountGeneration: string;
  preparationAttempt: number;
  preparationClaimId: string;
}

type PreparationClaimResult = Awaited<
  ReturnType<ConversationAssistantRepository['claimPreparation']>
>;
type CreateSessionIfAbsentResult = Awaited<
  ReturnType<ConversationAssistantRepository['createSessionIfAbsent']>
>;
type RequeueFailedPreparationResult = Awaited<
  ReturnType<ConversationAssistantRepository['requeueFailedPreparation']>
>;
type QueuedPreparationFailureResult = Awaited<
  ReturnType<ConversationAssistantRepository['failQueuedPreparation']>
>;

export function createConversationAssistantRepository(): ConversationAssistantRepository {
  return {
    async saveSession(session: ConversationAssistantSession): Promise<void> {
      try {
        const db = getFirestore();
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(session.id);
        const transcriptStorage = await saveTranscriptChunks(db, session);
        await sessionRef.set(toSessionDocument(session, transcriptStorage));
      } catch (error) {
        throw new Error(`Failed to save Conversation Assistant session: ${getErrorMessage(error)}`);
      }
    },

    async createSessionIfAbsent(
      session: ConversationAssistantSession
    ): Promise<CreateSessionIfAbsentResult> {
      try {
        const db = getFirestore();
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(session.id);
        const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(session.userId);
        const result = await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          const accountSnapshot = await transaction.get(accountRef);
          if (!sourceAccountFenceMatches(accountSnapshot.data(), session)) {
            return { status: 'source_unavailable' as const };
          }
          if (snapshot.exists) {
            const data = snapshot.data() as Record<string, unknown>;
            if (
              (typeof data['sourceAccountId'] === 'string' &&
                data['sourceAccountId'] !== session.sourceAccountId) ||
              (typeof data['sourceAccountGeneration'] === 'string' &&
                data['sourceAccountGeneration'] !== session.sourceAccountGeneration)
            ) {
              return { status: 'source_unavailable' as const };
            }
            const fencedData = {
              ...data,
              sourceAccountId: session.sourceAccountId,
              sourceAccountGeneration: session.sourceAccountGeneration,
            };
            if (
              data['sourceAccountId'] !== session.sourceAccountId ||
              data['sourceAccountGeneration'] !== session.sourceAccountGeneration
            ) {
              transaction.set(sessionRef, fencedData);
            }
            return { status: 'existing' as const, data: fencedData };
          }
          transaction.set(sessionRef, toSessionDocument(session, emptyTranscriptStorage()));
          return { status: 'created' as const };
        });
        if (result.status === 'source_unavailable') {
          return { status: 'source_unavailable' };
        }
        if (result.status === 'created') {
          return { status: 'created', session };
        }
        const existing = toSession(session.id, result.data);
        if (existing.deletionStartedAt !== undefined) {
          return { status: 'existing', session: existing };
        }
        return {
          status: 'existing',
          session: await toHydratedSession(db, session.id, result.data),
        };
      } catch (error) {
        throw new Error(
          `Failed to create Conversation Assistant session atomically: ${getErrorMessage(error)}`
        );
      }
    },

    async getSessionById(sessionId: string): Promise<ConversationAssistantSession | null> {
      try {
        const db = getFirestore();
        const doc = await db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(sessionId)
          .get();
        if (!doc.exists) {
          return null;
        }
        if (
          !(await conversationAssistantSessionReadFenceAllows({
            db,
            sessionData: doc.data(),
          }))
        ) {
          return null;
        }
        return await toHydratedSession(db, doc.id, doc.data());
      } catch (error) {
        throw new Error(`Failed to load Conversation Assistant session: ${getErrorMessage(error)}`);
      }
    },

    async getSessionSnapshotById(input: {
      sessionId: string;
      userId: string;
    }): Promise<{
      session: ConversationAssistantSession;
      turns: ConversationAssistantTurn[];
    } | null> {
      try {
        const db = getFirestore();
        const sessionDoc = await db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.sessionId)
          .get();
        if (!sessionDoc.exists) {
          return null;
        }
        const sessionWithoutTranscript = toSession(sessionDoc.id, sessionDoc.data());
        if (
          sessionWithoutTranscript.userId !== input.userId ||
          !(await conversationAssistantSessionReadFenceAllows({
            db,
            sessionData: sessionDoc.data(),
            expectedUserId: input.userId,
          }))
        ) {
          return null;
        }
        const session = await toHydratedSession(db, sessionDoc.id, sessionDoc.data());
        const turnsSnapshot = await db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .where('sessionId', '==', input.sessionId)
          .where('userId', '==', input.userId)
          .orderBy('createdAt', 'asc')
          .orderBy(FieldPath.documentId(), 'asc')
          .get();
        return {
          session,
          turns: turnsSnapshot.docs
            .map((doc) => toTurn(doc.id, doc.data()))
            .sort(compareConversationAssistantTurns),
        };
      } catch (error) {
        throw new Error(
          `Failed to load Conversation Assistant session snapshot: ${getErrorMessage(error)}`
        );
      }
    },

    async listSessionsByUserId(userId: string): Promise<ConversationAssistantSession[]> {
      try {
        const db = getFirestore();
        const [snapshot, accountSnapshot] = await Promise.all([
          db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .where('userId', '==', userId)
          .orderBy('updatedAt', 'desc')
          .orderBy(FieldPath.documentId(), 'desc')
            .get(),
          db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(userId).get(),
        ]);
        const accountData = accountSnapshot.exists ? accountSnapshot.data() : undefined;
        const readable = await Promise.all(
          snapshot.docs.map(
            async (doc) =>
              await conversationAssistantSessionReadFenceAllowsWithAccount({
                db,
                sessionData: doc.data(),
                expectedUserId: userId,
                accountData,
              })
          )
        );
        return snapshot.docs
          .filter((_doc, index) => readable[index] === true)
          .map((doc) => toSession(doc.id, doc.data()));
      } catch (error) {
        throw new Error(
          `Failed to list Conversation Assistant sessions: ${getErrorMessage(error)}`
        );
      }
    },

    async deleteSession(input: {
      sessionId: string;
      userId: string;
      deletionToken: string;
    }): Promise<void> {
      try {
        const db = getFirestore();
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.sessionId);
        const deletionTarget = await db.runTransaction(async (transaction) => {
          const sessionSnapshot = await transaction.get(sessionRef);
          if (!sessionSnapshot.exists) return null;
          const session = toSession(sessionSnapshot.id, sessionSnapshot.data());
          if (
            session.userId !== input.userId ||
            createConversationAssistantDeletionToken(session) !== input.deletionToken
          ) {
            return null;
          }
          if (session.deletionStartedAt === undefined) {
            transaction.set(sessionRef, {
              ...sessionSnapshot.data(),
              deletionStartedAt: new Date().toISOString(),
            });
          }
          return { generationId: session.generationId };
        });
        if (deletionTarget === null) return;

        for (const collectionName of [
          WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
          WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
          WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
          WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_CASCADE_COLLECTION,
          WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_CASCADE_COLLECTION,
        ]) {
          await deleteGenerationDocuments(
            db,
            collectionName,
            input.sessionId,
            deletionTarget.generationId
          );
        }
        await db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(sessionRef);
          if (!currentSnapshot.exists) return;
          const current = toSession(currentSnapshot.id, currentSnapshot.data());
          if (
            current.userId === input.userId &&
            current.deletionStartedAt !== undefined &&
            current.generationId === deletionTarget.generationId
          ) {
            transaction.delete(sessionRef);
          }
        });
      } catch (error) {
        throw new Error(
          `Failed to delete Conversation Assistant session: ${getErrorMessage(error)}`
        );
      }
    },

    async claimPreparation(input): Promise<PreparationClaimResult> {
      try {
        const db = getFirestore();
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.sessionId);
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          if (!snapshot.exists) {
            return { status: 'not_found' as const };
          }
          const session = toSession(snapshot.id, snapshot.data());
          if (
            session.userId !== input.userId ||
            session.deletionStartedAt !== undefined ||
            session.generationId !== input.expectedGenerationId
          ) {
            return { status: 'not_found' as const };
          }
          if (!(await sourceAccountAllowsPrivatePreparation(transaction, db, session))) {
            return { status: 'not_found' as const };
          }
          if (session.status !== 'preparing' || session.preparationAttempt !== input.attempt) {
            return { status: 'stale' as const, session };
          }
          if (
            session.preparationClaimId !== undefined &&
            session.preparationLeaseExpiresAt !== undefined &&
            session.preparationLeaseExpiresAt > input.now
          ) {
            return { status: 'busy' as const, session };
          }
          const claimed: ConversationAssistantSession = {
            ...session,
            status: 'preparing',
            preparationStage: 'loading_messages',
            preparationClaimId: input.claimId,
            preparationLeaseExpiresAt: input.leaseExpiresAt,
            updatedAt: input.now,
          };
          delete claimed.preparationError;
          const storage =
            parseTranscriptStorage(snapshot.data()?.['transcriptStorage']) ??
            emptyTranscriptStorage();
          transaction.set(sessionRef, toSessionDocument(claimed, storage));
          return { status: 'claimed' as const, session: claimed };
        });
      } catch (error) {
        throw new Error(
          `Failed to claim Conversation Assistant preparation: ${getErrorMessage(error)}`
        );
      }
    },

    async saveClaimedPreparationSession(input): Promise<boolean> {
      try {
        const db = getFirestore();
        const transcriptStorage = await saveTranscriptChunks(db, input.session, {
          attempt: input.attempt,
          claimId: input.claimId,
          now: input.now,
        });
        if (transcriptStorage === null) return false;
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.session.id);
        const saved = await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          if (!snapshot.exists) {
            return false;
          }
          const current = toSession(snapshot.id, snapshot.data());
          if (
            current.deletionStartedAt !== undefined ||
            current.generationId !== input.session.generationId ||
            current.preparationAttempt !== input.attempt ||
            current.preparationClaimId !== input.claimId ||
            !preparationLeaseIsActive(current, input.now)
          ) {
            return false;
          }
          if (!(await sourceAccountAllowsPrivatePreparation(transaction, db, current))) {
            return false;
          }
          const finalizedChunkRefs =
            input.session.status === 'ready'
              ? await loadPendingInitialPreparationChunksForFinalization({
                  transaction,
                  db,
                  sessionData: snapshot.data(),
                  current,
                  readySession: input.session,
                  transcriptStorage,
                  attempt: input.attempt,
                  claimId: input.claimId,
                  now: input.now,
                })
              : [];
          if (finalizedChunkRefs === null) return false;
          for (const chunkRef of finalizedChunkRefs) {
            transaction.update(chunkRef, { expireAt: FieldValue.delete() });
          }
          transaction.set(sessionRef, toSessionDocument(input.session, transcriptStorage));
          return true;
        });
        if (!saved && transcriptStorage.chunkCount > 0) {
          const currentSnapshot = await sessionRef.get();
          const currentStorage = parseTranscriptStorage(
            currentSnapshot.data()?.['transcriptStorage']
          );
          if (currentStorage?.snapshotId !== transcriptStorage.snapshotId) {
            await deleteTranscriptChunks(
              db,
              input.session.id,
              transcriptStorage,
              input.session.generationId,
              { attempt: input.attempt, claimId: input.claimId }
            );
          }
        }
        return saved;
      } catch (error) {
        throw new Error(
          `Failed to save claimed Conversation Assistant preparation: ${getErrorMessage(error)}`
        );
      }
    },

    async requeueFailedPreparation(input): Promise<RequeueFailedPreparationResult> {
      try {
        const db = getFirestore();
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.sessionId);
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          if (!snapshot.exists) {
            return { status: 'not_found' as const };
          }
          const session = toSession(snapshot.id, snapshot.data());
          if (
            session.userId !== input.userId ||
            session.deletionStartedAt !== undefined ||
            session.generationId !== input.expectedGenerationId
          ) {
            return { status: 'not_found' as const };
          }
          if (!(await sourceAccountAllowsPrivatePreparation(transaction, db, session))) {
            return { status: 'not_found' as const };
          }
          if (
            session.status !== 'failed' ||
            (session.preparationAttempt ?? 0) !== input.expectedAttempt
          ) {
            return { status: 'stale' as const, session };
          }
          const queued: ConversationAssistantSession = {
            ...session,
            status: 'preparing',
            preparationStage: 'queued',
            preparationAttempt: input.expectedAttempt + 1,
            updatedAt: input.updatedAt,
          };
          delete queued.preparationError;
          delete queued.preparationClaimId;
          delete queued.preparationLeaseExpiresAt;
          const storage =
            parseTranscriptStorage(snapshot.data()?.['transcriptStorage']) ??
            emptyTranscriptStorage();
          transaction.set(sessionRef, toSessionDocument(queued, storage));
          return { status: 'queued' as const, session: queued };
        });
      } catch (error) {
        throw new Error(
          `Failed to requeue Conversation Assistant preparation: ${getErrorMessage(error)}`
        );
      }
    },

    async failQueuedPreparation(input): Promise<QueuedPreparationFailureResult> {
      try {
        const db = getFirestore();
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.sessionId);
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          if (!snapshot.exists) {
            return { status: 'not_found' as const };
          }
          const session = toSession(snapshot.id, snapshot.data());
          if (
            session.userId !== input.userId ||
            session.deletionStartedAt !== undefined ||
            session.generationId !== input.expectedGenerationId
          ) {
            return { status: 'not_found' as const };
          }
          if (
            session.status !== 'preparing' ||
            session.preparationStage !== 'queued' ||
            session.preparationAttempt !== input.attempt ||
            session.preparationClaimId !== undefined
          ) {
            return { status: 'stale' as const, session };
          }
          const failed: ConversationAssistantSession = {
            ...session,
            status: 'failed',
            preparationStage: 'failed',
            preparationError: { ...input.error },
            updatedAt: input.updatedAt,
          };
          const storage =
            parseTranscriptStorage(snapshot.data()?.['transcriptStorage']) ??
            emptyTranscriptStorage();
          transaction.set(sessionRef, toSessionDocument(failed, storage));
          return { status: 'saved' as const, session: failed };
        });
      } catch (error) {
        throw new Error(
          `Failed to mark queued Conversation Assistant preparation failed: ${getErrorMessage(error)}`
        );
      }
    },

    async saveContextSnapshot(
      sessionId: string,
      userId: string,
      snapshotId: string,
      contextSnapshot: Pick<ConversationAssistantContextResult, 'messages' | 'omittedMessages'>,
      expectedGenerationId?: string
    ): Promise<boolean> {
      try {
        const db = getFirestore();
        const collection = db.collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION);
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(sessionId);
        const writeFence = await db.runTransaction(async (transaction) => {
          const sessionSnapshot = await transaction.get(sessionRef);
          if (!sessionSnapshot.exists) return null;
          const session = toSession(sessionSnapshot.id, sessionSnapshot.data());
          if (
            session.userId !== userId ||
            session.deletionStartedAt !== undefined ||
            session.generationId !== expectedGenerationId
          ) {
            return null;
          }
          if (!(await sourceAccountAllowsPrivatePreparation(transaction, db, session))) {
            return null;
          }
          const isPendingPreparation =
            session.status === 'preparing' &&
            typeof session.preparationAttempt === 'number' &&
            typeof session.preparationClaimId === 'string' &&
            session.preparationClaimId.length > 0;
          return {
            sourceAccountId: session.sourceAccountId as string,
            sourceAccountGeneration: session.sourceAccountGeneration as string,
            ...(isPendingPreparation
              ? {
                  preparationAttempt: session.preparationAttempt as number,
                  preparationClaimId: session.preparationClaimId as string,
                }
              : {}),
          };
        });
        if (writeFence === null) return false;
        const existing = await collection
          .where('sessionId', '==', sessionId)
          .where('snapshotId', '==', snapshotId)
          .get();
        const chunks = splitContextSnapshot(contextSnapshot);
        return await resolveConversationAssistantInitialPreparationChunkLimit({
          chunkCounts: [chunks.length],
          overLimit: () => Promise.resolve(false),
          withinLimit: async () => {
            const pendingExpireAt =
          writeFence.preparationClaimId === undefined
            ? undefined
            : computeExpireAt(CONVERSATION_ASSISTANT_INITIAL_PREPARATION_CHUNK_TTL_MS);
        const expectedIds = new Set<string>();

        for (const [chunkIndex, chunk] of chunks.entries()) {
          const chunkId = toContextChunkId(sessionId, snapshotId, chunkIndex);
          expectedIds.add(chunkId);
          const saved = await db.runTransaction(async (transaction) => {
            const sessionSnapshot = await transaction.get(sessionRef);
            if (!sessionSnapshot.exists) return false;
            const session = toSession(sessionSnapshot.id, sessionSnapshot.data());
            if (
              session.userId !== userId ||
              session.deletionStartedAt !== undefined ||
              session.generationId !== expectedGenerationId
            ) {
              return false;
            }
            if (!(await sourceAccountAllowsPrivatePreparation(transaction, db, session))) {
              return false;
            }
            if (
              writeFence.preparationClaimId !== undefined &&
              (session.status !== 'preparing' ||
                session.preparationAttempt !== writeFence.preparationAttempt ||
                session.preparationClaimId !== writeFence.preparationClaimId)
            ) {
              return false;
            }
            transaction.set(collection.doc(chunkId), {
              sessionId,
              userId,
              sessionGenerationId: expectedGenerationId ?? null,
              sourceAccountId: session.sourceAccountId,
              sourceAccountGeneration: session.sourceAccountGeneration,
              snapshotId,
              chunkIndex,
              kind: chunk.kind,
              start: chunk.start,
              end: chunk.end,
              messages: chunk.messages,
              omittedMessages: chunk.omittedMessages,
              ...(writeFence.preparationClaimId === undefined
                ? {}
                : {
                    preparationAttempt: writeFence.preparationAttempt,
                    preparationClaimId: writeFence.preparationClaimId,
                    expireAt: pendingExpireAt,
                  }),
            });
            return true;
          });
          if (!saved) {
            await deleteContextSnapshotForGeneration(
              db,
              sessionId,
              userId,
              snapshotId,
              expectedGenerationId
            );
            return false;
          }
        }
        for (const document of existing.docs) {
          if (
            !expectedIds.has(document.id) &&
            documentBelongsToGeneration(document.data(), expectedGenerationId)
          ) {
            await deleteDocumentIfCurrentMatches(db, document.ref, (data) =>
              documentBelongsToGeneration(data, expectedGenerationId)
            );
          }
        }
        if (writeFence.preparationClaimId !== undefined) {
          const manifest: PendingContextChunkStorage = {
            type: 'chunks',
            snapshotId,
            chunkIds: [...expectedIds],
            chunkCount: expectedIds.size,
            ...(expectedGenerationId === undefined
              ? {}
              : { sessionGenerationId: expectedGenerationId }),
            sourceAccountId: writeFence.sourceAccountId,
            sourceAccountGeneration: writeFence.sourceAccountGeneration,
            preparationAttempt: writeFence.preparationAttempt as number,
            preparationClaimId: writeFence.preparationClaimId,
          };
          const manifestSaved = await db.runTransaction(async (transaction) => {
            const sessionSnapshot = await transaction.get(sessionRef);
            if (!sessionSnapshot.exists) return false;
            const session = toSession(sessionSnapshot.id, sessionSnapshot.data());
            if (
              session.userId !== userId ||
              session.deletionStartedAt !== undefined ||
              session.generationId !== expectedGenerationId ||
              session.status !== 'preparing' ||
              session.preparationAttempt !== manifest.preparationAttempt ||
              session.preparationClaimId !== manifest.preparationClaimId ||
              !(await sourceAccountAllowsPrivatePreparation(transaction, db, session))
            ) {
              return false;
            }
            transaction.update(sessionRef, { pendingContextStorage: manifest });
            return true;
          });
          if (!manifestSaved) {
            await deleteContextSnapshotForGeneration(
              db,
              sessionId,
              userId,
              snapshotId,
              expectedGenerationId
            );
            return false;
          }
        }
            return true;
          },
        });
      } catch (error) {
        throw new Error(`Failed to save Conversation Assistant context: ${getErrorMessage(error)}`);
      }
    },

    async deleteContextSnapshot(
      sessionId: string,
      userId: string,
      snapshotId: string,
      expectedGenerationId?: string
    ): Promise<void> {
      try {
        await deleteContextSnapshotForGeneration(
          getFirestore(),
          sessionId,
          userId,
          snapshotId,
          expectedGenerationId
        );
      } catch (error) {
        throw new Error(
          `Failed to delete Conversation Assistant context: ${getErrorMessage(error)}`
        );
      }
    },

    async getContextPage(
      sessionId: string,
      snapshotId: string,
      input: {
        messageCursor: number;
        omittedCursor: number;
        limit: number;
        messageCount: number;
        omittedMessageCount: number;
      }
    ): Promise<
      Pick<ConversationAssistantContextResult, 'messages' | 'omittedMessages' | 'snapshotAvailable'>
    > {
      try {
        const db = getFirestore();
        const sessionSnapshot = await db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(sessionId)
          .get();
        if (
          !sessionSnapshot.exists ||
          !(await conversationAssistantSessionReadFenceAllows({
            db,
            sessionData: sessionSnapshot.data(),
          }))
        ) {
          return { messages: [], omittedMessages: [], snapshotAvailable: false };
        }
        const [messageChunks, omittedChunks] = await Promise.all([
          loadContextChunksForPage(
            db,
            sessionId,
            snapshotId,
            'included',
            input.messageCursor,
            input.limit
          ),
          loadContextChunksForPage(
            db,
            sessionId,
            snapshotId,
            'omitted',
            input.omittedCursor,
            input.limit
          ),
        ]);
        const messages = sliceIncludedContextPage(messageChunks, input.messageCursor, input.limit);
        const omittedMessages = sliceOmittedContextPage(
          omittedChunks,
          input.omittedCursor,
          input.limit
        );
        return {
          messages,
          omittedMessages,
          snapshotAvailable:
            messages.length ===
              expectedContextPageLength(input.messageCursor, input.messageCount, input.limit) &&
            omittedMessages.length ===
              expectedContextPageLength(
                input.omittedCursor,
                input.omittedMessageCount,
                input.limit
              ),
        };
      } catch (error) {
        throw new Error(`Failed to load Conversation Assistant context: ${getErrorMessage(error)}`);
      }
    },

    async saveTurn(turn: ConversationAssistantTurn): Promise<void> {
      try {
        await getFirestore()
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .doc(turn.id)
          .set(turn);
      } catch (error) {
        throw new Error(`Failed to save Conversation Assistant turn: ${getErrorMessage(error)}`);
      }
    },

    async saveTurnIfSessionExists(
      turn: ConversationAssistantTurn,
      expectedGenerationId: string | undefined
    ): Promise<boolean> {
      try {
        const db = getFirestore();
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(turn.sessionId);
        const turnRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .doc(turn.id);
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          if (!snapshot.exists) {
            return false;
          }
          const current = toSession(snapshot.id, snapshot.data());
          if (
            current.userId !== turn.userId ||
            current.deletionStartedAt !== undefined ||
            current.generationId !== expectedGenerationId ||
            (current.status !== 'ready' && current.status !== 'active')
          ) {
            return false;
          }
          if (!(await sourceAccountAllowsSessionWrite(transaction, db, snapshot.data(), current))) {
            return false;
          }
          transaction.set(turnRef, {
            ...turn,
            sessionGenerationId: expectedGenerationId ?? null,
          });
          return true;
        });
      } catch (error) {
        throw new Error(
          `Failed to save Conversation Assistant turn conditionally: ${getErrorMessage(error)}`
        );
      }
    },

    async saveAssistantTurnAndTouchSession(input: {
      session: ConversationAssistantSession;
      turn: ConversationAssistantTurn;
    }): Promise<boolean> {
      try {
        const db = getFirestore();
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.session.id);
        const turnRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .doc(input.turn.id);
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          if (!snapshot.exists) return false;
          const current = toSession(snapshot.id, snapshot.data());
          if (
            current.userId !== input.session.userId ||
            input.turn.userId !== input.session.userId ||
            current.deletionStartedAt !== undefined ||
            current.generationId !== input.session.generationId ||
            (current.status !== 'ready' && current.status !== 'active')
          ) {
            return false;
          }
          if (!(await sourceAccountAllowsSessionWrite(transaction, db, snapshot.data(), current))) {
            return false;
          }
          const storage =
            parseTranscriptStorage(snapshot.data()?.['transcriptStorage']) ??
            emptyTranscriptStorage();
          transaction.set(turnRef, {
            ...input.turn,
            sessionGenerationId: input.session.generationId ?? null,
          });
          transaction.set(
            sessionRef,
            toSessionDocument(
              {
                ...current,
                updatedAt: input.turn.createdAt,
                lastTurnAt: input.turn.createdAt,
              },
              storage
            )
          );
          return true;
        });
      } catch (error) {
        throw new Error(
          `Failed to save Conversation Assistant response conditionally: ${getErrorMessage(error)}`
        );
      }
    },

    async listTurnsBySessionId(sessionId: string): Promise<ConversationAssistantTurn[]> {
      try {
        const db = getFirestore();
        const sessionSnapshot = await db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(sessionId)
          .get();
        const sessionData = sessionSnapshot.data() as Record<string, unknown> | undefined;
        if (
          !sessionSnapshot.exists ||
          !(await conversationAssistantSessionReadFenceAllows({
            db,
            sessionData,
          }))
        ) {
          return [];
        }
        const sessionUserId = sessionData?.['userId'];
        /* v8 ignore start -- upstream: userId is guaranteed non-empty by the prior conversationAssistantSessionReadFenceAllows check @preserve */
        if (typeof sessionUserId !== 'string') return [];
        /* v8 ignore stop @preserve */
        const snapshot = await db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .where('sessionId', '==', sessionId)
          .where('userId', '==', sessionUserId)
          .orderBy('createdAt', 'asc')
          .orderBy(FieldPath.documentId(), 'asc')
          .get();
        return snapshot.docs
          .map((doc) => toTurn(doc.id, doc.data()))
          .sort(compareConversationAssistantTurns);
      } catch (error) {
        throw new Error(`Failed to list Conversation Assistant turns: ${getErrorMessage(error)}`);
      }
    },
  };
}

function toSessionDocument(
  session: ConversationAssistantSession,
  transcriptStorage: TranscriptChunkStorage
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    ...session,
    transcriptStorage,
  };
  Reflect.deleteProperty(document, 'transcriptText');
  return document;
}

async function toHydratedSession(
  db: ReturnType<typeof getFirestore>,
  id: string,
  data: Record<string, unknown> | undefined
): Promise<ConversationAssistantSession> {
  return toSession(id, data, await loadTranscriptText(db, id, data));
}

function toSession(
  id: string,
  data: Record<string, unknown> | undefined,
  transcriptText?: string
): ConversationAssistantSession {
  const session = data as Partial<ConversationAssistantSession> | undefined;
  const range = session?.range ?? { from: '', to: '' };
  const projected: ConversationAssistantSession = {
    id,
    userId: session?.userId ?? '',
    chatId: session?.chatId ?? '',
    status:
      session?.status === 'preparing' ||
      session?.status === 'failed' ||
      session?.status === 'ready' ||
      session?.status === 'active'
        ? session.status
        : 'ready',
    range,
    effectiveRange: session?.effectiveRange ?? range,
    model:
      typeof session?.model === 'string' && session.model.length > 0
        ? session.model
        : DEFAULT_CONVERSATION_ASSISTANT_MODEL,
    transcriptSha256: session?.transcriptSha256 ?? '',
    transcriptMessageCount: session?.transcriptMessageCount ?? 0,
    transcriptText: transcriptText ?? session?.transcriptText ?? '',
    assistantRoleLabel:
      typeof session?.assistantRoleLabel === 'string' &&
      session.assistantRoleLabel.trim().length > 0
        ? session.assistantRoleLabel
        : DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
    omitted: session?.omitted ?? {
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    },
    title: session?.title ?? '',
    createdAt: session?.createdAt ?? '',
    updatedAt: session?.updatedAt ?? '',
  };
  if (session?.chatDisplayName !== undefined) {
    projected.chatDisplayName = session.chatDisplayName;
  }
  if (typeof session?.sourceAccountId === 'string') {
    projected.sourceAccountId = session.sourceAccountId;
  }
  if (typeof session?.sourceAccountGeneration === 'string') {
    projected.sourceAccountGeneration = session.sourceAccountGeneration;
  }
  if (session?.lastTurnAt !== undefined) {
    projected.lastTurnAt = session.lastTurnAt;
  }
  if (
    session?.preparationStage === 'queued' ||
    session?.preparationStage === 'loading_messages' ||
    session?.preparationStage === 'building_context' ||
    session?.preparationStage === 'ready' ||
    session?.preparationStage === 'failed'
  ) {
    projected.preparationStage = session.preparationStage;
  }
  if (
    typeof session?.preparationAttempt === 'number' &&
    Number.isInteger(session.preparationAttempt) &&
    session.preparationAttempt >= 0
  ) {
    projected.preparationAttempt = session.preparationAttempt;
  }
  if (
    typeof session?.preparationError?.code === 'string' &&
    typeof session.preparationError.message === 'string'
  ) {
    projected.preparationError = { ...session.preparationError };
  }
  if (typeof session?.creationRequestId === 'string') {
    projected.creationRequestId = session.creationRequestId;
  }
  if (typeof session?.contextSnapshotId === 'string') {
    projected.contextSnapshotId = session.contextSnapshotId;
  }
  if (typeof session?.generationId === 'string') {
    projected.generationId = session.generationId;
  }
  if (typeof session?.deletionStartedAt === 'string') {
    projected.deletionStartedAt = session.deletionStartedAt;
  }
  if (typeof session?.preparationClaimId === 'string') {
    projected.preparationClaimId = session.preparationClaimId;
  }
  if (typeof session?.preparationLeaseExpiresAt === 'string') {
    projected.preparationLeaseExpiresAt = session.preparationLeaseExpiresAt;
  }
  if (typeof session?.preparationDisplayTimeZone === 'string') {
    projected.preparationDisplayTimeZone = session.preparationDisplayTimeZone;
  }
  const continuation = toSessionContinuation(session?.continuation);
  if (continuation !== undefined) {
    projected.continuation = continuation;
  }
  if (
    typeof session?.maxMessages === 'number' &&
    Number.isInteger(session.maxMessages) &&
    session.maxMessages > 0
  ) {
    projected.maxMessages = session.maxMessages;
  }
  return projected;
}

function sourceAccountFenceMatches(
  account: Record<string, unknown> | undefined,
  session: ConversationAssistantSession
): boolean {
  if (
    typeof session.sourceAccountId !== 'string' ||
    session.sourceAccountId === '' ||
    typeof session.sourceAccountGeneration !== 'string' ||
    session.sourceAccountGeneration === ''
  ) {
    return false;
  }
  const storedGeneration =
    typeof account?.['generationId'] === 'string' && account['generationId'] !== ''
      ? account['generationId']
      : account?.['sourceAccountId'];
  return (
    account?.['userId'] === session.userId &&
    account['sourceAccountId'] === session.sourceAccountId &&
    storedGeneration === session.sourceAccountGeneration &&
    account['status'] === 'active' &&
    account['erasureStatus'] !== 'erasing'
  );
}

async function sourceAccountAllowsPrivatePreparation(
  transaction: FirebaseFirestore.Transaction,
  db: ReturnType<typeof getFirestore>,
  session: ConversationAssistantSession
): Promise<boolean> {
  const accountSnapshot = await transaction.get(
    db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(session.userId)
  );
  return accountSnapshot.exists && sourceAccountFenceMatches(accountSnapshot.data(), session);
}

function preparationLeaseIsActive(
  session: ConversationAssistantSession,
  now: string
): boolean {
  if (session.status !== 'preparing' || session.preparationLeaseExpiresAt === undefined) {
    return false;
  }
  const nowMs = Date.parse(now);
  const leaseExpiresAtMs = Date.parse(session.preparationLeaseExpiresAt);
  return Number.isFinite(nowMs) && Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs > nowMs;
}

function pendingChunkExpiresAfter(value: unknown, now: string): boolean {
  const nowMs = Date.parse(now);
  return value instanceof Timestamp && Number.isFinite(nowMs) && value.toMillis() > nowMs;
}

async function sourceAccountAllowsSessionWrite(
  transaction: FirebaseFirestore.Transaction,
  db: ReturnType<typeof getFirestore>,
  sessionData: Record<string, unknown> | undefined,
  session: ConversationAssistantSession
): Promise<boolean> {
  let sourceAccountId = session.sourceAccountId ?? session.continuation?.sourceAccountId;
  if (sourceAccountId === undefined) {
    const chatSnapshot = await transaction.get(
      db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(session.chatId)
    );
    const chat = chatSnapshot.data();
    if (
      !chatSnapshot.exists ||
      chat?.['userId'] !== session.userId ||
      typeof chat['sourceAccountId'] !== 'string'
    ) {
      return false;
    }
    sourceAccountId = chat['sourceAccountId'];
  }

  const accountSnapshot = await transaction.get(
    db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(session.userId)
  );
  const account = accountSnapshot.data();
  if (!accountSnapshot.exists || account === undefined) return false;
  const accountGeneration: unknown = account['generationId'];
  const accountSourceId: unknown = account['sourceAccountId'];
  const storedGeneration =
    typeof accountGeneration === 'string' && accountGeneration !== ''
      ? accountGeneration
      : accountSourceId;
  const expectedGeneration =
    typeof sessionData?.['sourceAccountGeneration'] === 'string'
      ? sessionData['sourceAccountGeneration']
      : session.sourceAccountGeneration;
  return (
    account['userId'] === session.userId &&
    account['sourceAccountId'] === sourceAccountId &&
    account['status'] === 'active' &&
    account['erasureStatus'] !== 'erasing' &&
    (expectedGeneration === undefined || storedGeneration === expectedGeneration)
  );
}

function toSessionContinuation(
  value: unknown
): ConversationAssistantSessionContinuation | undefined {
  if (!isRecord(value)) return undefined;
  const integerFields = [
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
    typeof value['sourceAccountId'] !== 'string' ||
    value['sourceAccountId'].length === 0 ||
    typeof value['contextEventThrough'] !== 'string' ||
    typeof value['contextChainSha256'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value['contextChainSha256']) ||
    typeof value['displayTimeZone'] !== 'string' ||
    integerFields.some(
      (field) =>
        typeof value[field] !== 'number' || !Number.isInteger(value[field]) || value[field] < 0
    )
  ) {
    return undefined;
  }
  const continuation: ConversationAssistantSessionContinuation = {
    sourceAccountId: value['sourceAccountId'],
    contextVersion: value['contextVersion'] as number,
    contextEventThrough: value['contextEventThrough'],
    contextChangeThrough: value['contextChangeThrough'] as number,
    contextChainSha256: value['contextChainSha256'],
    displayTimeZone: value['displayTimeZone'],
    nextTurnSequence: value['nextTurnSequence'] as number,
    nextConversationRevision: value['nextConversationRevision'] as number,
    completedConversationRevision: value['completedConversationRevision'] as number,
    attachmentCount: value['attachmentCount'] as number,
    totalAttachedMessageCount: value['totalAttachedMessageCount'] as number,
    totalAttachedOmittedCount: value['totalAttachedOmittedCount'] as number,
  };
  if (typeof value['activeTurnRequestId'] === 'string') {
    continuation.activeTurnRequestId = value['activeTurnRequestId'];
  }
  if (typeof value['activeTurnLeaseExpiresAt'] === 'string') {
    continuation.activeTurnLeaseExpiresAt = value['activeTurnLeaseExpiresAt'];
  }
  return continuation;
}

async function loadTranscriptText(
  db: ReturnType<typeof getFirestore>,
  sessionId: string,
  data: Record<string, unknown> | undefined
): Promise<string> {
  const storage = parseTranscriptStorage(data?.['transcriptStorage']);
  if (storage === null) {
    const inlineTranscriptText = data?.['transcriptText'];
    return typeof inlineTranscriptText === 'string' ? inlineTranscriptText : '';
  }

  const chunkCollection = db.collection(
    WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION
  );
  const chunks = await Promise.all(
    Array.from({ length: storage.chunkCount }, async (_value, chunkIndex) => {
      const chunkDoc = await chunkCollection
        .doc(toTranscriptChunkId(sessionId, chunkIndex, storage.snapshotId))
        .get();
      if (!chunkDoc.exists) {
        throw new Error(`Missing transcript chunk ${String(chunkIndex)} for ${sessionId}`);
      }
      const chunkData: unknown = chunkDoc.data();
      const text = isRecord(chunkData) ? chunkData['text'] : undefined;
      if (typeof text !== 'string') {
        throw new Error(`Invalid transcript chunk ${String(chunkIndex)} for ${sessionId}`);
      }
      return text;
    })
  );
  return chunks.join('');
}

function parseTranscriptStorage(value: unknown): TranscriptChunkStorage | null {
  if (!isRecord(value)) return null;
  if (value['type'] !== 'chunks') return null;
  const chunkCount = value['chunkCount'];
  const chunkSizeBytes = value['chunkSizeBytes'];
  const byteLength = value['byteLength'];
  const snapshotId = value['snapshotId'];
  if (
    !isInteger(chunkCount) ||
    !isInteger(chunkSizeBytes) ||
    !isInteger(byteLength) ||
    chunkCount < 0 ||
    chunkSizeBytes <= 0 ||
    byteLength < 0
  ) {
    return null;
  }
  return {
    type: 'chunks',
    chunkCount,
    chunkSizeBytes,
    byteLength,
    ...(typeof snapshotId === 'string' && snapshotId.length > 0 ? { snapshotId } : {}),
  };
}

function emptyTranscriptStorage(): TranscriptChunkStorage {
  return {
    type: 'chunks',
    chunkCount: 0,
    chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
    byteLength: 0,
  };
}

function parsePendingContextStorage(value: unknown): PendingContextChunkStorage | null {
  if (!isRecord(value) || value['type'] !== 'chunks') return null;
  const chunkIds = value['chunkIds'];
  const chunkCount = value['chunkCount'];
  if (
    typeof value['snapshotId'] !== 'string' ||
    value['snapshotId'].length === 0 ||
    !Array.isArray(chunkIds) ||
    !chunkIds.every((chunkId) => typeof chunkId === 'string' && chunkId.length > 0) ||
    !isInteger(chunkCount) ||
    chunkCount !== chunkIds.length ||
    chunkCount > CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS ||
    new Set(chunkIds).size !== chunkIds.length ||
    typeof value['sourceAccountId'] !== 'string' ||
    value['sourceAccountId'].length === 0 ||
    typeof value['sourceAccountGeneration'] !== 'string' ||
    value['sourceAccountGeneration'].length === 0 ||
    !isInteger(value['preparationAttempt']) ||
    value['preparationAttempt'] < 0 ||
    typeof value['preparationClaimId'] !== 'string' ||
    value['preparationClaimId'].length === 0
  ) {
    return null;
  }
  return {
    type: 'chunks',
    snapshotId: value['snapshotId'],
    chunkIds: chunkIds.filter((chunkId): chunkId is string => typeof chunkId === 'string'),
    chunkCount,
    ...(typeof value['sessionGenerationId'] === 'string'
      ? { sessionGenerationId: value['sessionGenerationId'] }
      : {}),
    sourceAccountId: value['sourceAccountId'],
    sourceAccountGeneration: value['sourceAccountGeneration'],
    preparationAttempt: value['preparationAttempt'],
    preparationClaimId: value['preparationClaimId'],
  };
}

async function loadPendingInitialPreparationChunksForFinalization(input: {
  transaction: FirebaseFirestore.Transaction;
  db: ReturnType<typeof getFirestore>;
  sessionData: Record<string, unknown> | undefined;
  current: ConversationAssistantSession;
  readySession: ConversationAssistantSession;
  transcriptStorage: TranscriptChunkStorage;
  attempt: number;
  claimId: string;
  now: string;
}): Promise<FirebaseFirestore.DocumentReference[] | null> {
  const contextStorage =
    input.readySession.contextSnapshotId === undefined
      ? undefined
      : parsePendingContextStorage(input.sessionData?.['pendingContextStorage']);
  if (
    input.readySession.contextSnapshotId !== undefined &&
    (contextStorage === null || contextStorage === undefined)
  ) {
    return null;
  }
  if (
    contextStorage !== null &&
    contextStorage !== undefined &&
    (contextStorage.snapshotId !== input.readySession.contextSnapshotId ||
      contextStorage.sessionGenerationId !== input.readySession.generationId ||
      contextStorage.sourceAccountId !== input.readySession.sourceAccountId ||
      contextStorage.sourceAccountGeneration !== input.readySession.sourceAccountGeneration ||
      contextStorage.preparationAttempt !== input.attempt ||
      contextStorage.preparationClaimId !== input.claimId)
  ) {
    return null;
  }
  const contextChunkCount = contextStorage?.chunkCount ?? 0;
  return await resolveConversationAssistantInitialPreparationChunkLimit({
    chunkCounts: [input.transcriptStorage.chunkCount, contextChunkCount],
    overLimit: () => Promise.resolve(null),
    withinLimit: async () => {
      const transcriptChunkRefs = Array.from(
    { length: input.transcriptStorage.chunkCount },
    (_value, chunkIndex) =>
      input.db
        .collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION)
        .doc(
          toTranscriptChunkId(
            input.readySession.id,
            chunkIndex,
            input.transcriptStorage.snapshotId
          )
        )
  );
  const contextChunkRefs = (contextStorage?.chunkIds ?? []).map((chunkId) =>
    input.db.collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION).doc(chunkId)
  );
  const transcriptSnapshots = [];
  for (const chunkRef of transcriptChunkRefs) {
    transcriptSnapshots.push(await input.transaction.get(chunkRef));
  }
  const contextSnapshots = [];
  for (const chunkRef of contextChunkRefs) {
    contextSnapshots.push(await input.transaction.get(chunkRef));
  }

  for (const [chunkIndex, snapshot] of transcriptSnapshots.entries()) {
    const data = snapshot.data();
    if (
      !snapshot.exists ||
      data?.['sessionId'] !== input.readySession.id ||
      data['sessionGenerationId'] !== input.readySession.generationId ||
      data['sourceAccountId'] !== input.readySession.sourceAccountId ||
      data['sourceAccountGeneration'] !== input.readySession.sourceAccountGeneration ||
      data['preparationAttempt'] !== input.attempt ||
      data['preparationClaimId'] !== input.claimId ||
      data['snapshotId'] !== input.transcriptStorage.snapshotId ||
      data['chunkIndex'] !== chunkIndex ||
      typeof data['text'] !== 'string' ||
      !pendingChunkExpiresAfter(data['expireAt'], input.now)
    ) {
      return null;
    }
  }
  for (const [chunkIndex, snapshot] of contextSnapshots.entries()) {
    const data = snapshot.data();
    const expectedChunkId = toContextChunkId(
      input.readySession.id,
      /* v8 ignore start -- ts-type: contextSnapshots cannot contain entries when contextStorage is undefined; noUncheckedIndexedAccess requires this fallback @preserve */
      contextStorage?.snapshotId ?? '',
      /* v8 ignore stop @preserve */
      chunkIndex
    );
    if (
      !snapshot.exists ||
      snapshot.id !== expectedChunkId ||
      data?.['sessionId'] !== input.readySession.id ||
      data['userId'] !== input.readySession.userId ||
      data['sessionGenerationId'] !== input.readySession.generationId ||
      data['sourceAccountId'] !== input.readySession.sourceAccountId ||
      data['sourceAccountGeneration'] !== input.readySession.sourceAccountGeneration ||
      data['preparationAttempt'] !== input.attempt ||
      data['preparationClaimId'] !== input.claimId ||
      data['snapshotId'] !== contextStorage?.snapshotId ||
      data['chunkIndex'] !== chunkIndex ||
      !pendingChunkExpiresAfter(data['expireAt'], input.now)
    ) {
      return null;
    }
  }
      return [...transcriptChunkRefs, ...contextChunkRefs];
    },
  });
}

async function saveTranscriptChunks(
  db: ReturnType<typeof getFirestore>,
  session: ConversationAssistantSession
): Promise<TranscriptChunkStorage>;
async function saveTranscriptChunks(
  db: ReturnType<typeof getFirestore>,
  session: ConversationAssistantSession,
  fence: { attempt: number; claimId: string; now: string }
): Promise<TranscriptChunkStorage | null>;
async function saveTranscriptChunks(
  db: ReturnType<typeof getFirestore>,
  session: ConversationAssistantSession,
  fence?: { attempt: number; claimId: string; now: string }
): Promise<TranscriptChunkStorage | null> {
  const chunks = splitTranscriptText(session.transcriptText);
  return await resolveConversationAssistantInitialPreparationChunkLimit({
    chunkCounts: fence === undefined ? [] : [chunks.length],
    overLimit: () => Promise.resolve(null),
    withinLimit: async () => {
      const snapshotId = chunks.length === 0 ? '' : session.transcriptSha256.trim();
  const storage: TranscriptChunkStorage = {
    type: 'chunks',
    chunkCount: chunks.length,
    chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
    byteLength: Buffer.byteLength(session.transcriptText, 'utf8'),
    ...(snapshotId.length > 0 ? { snapshotId } : {}),
  };
  const chunkCollection = db.collection(
    WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION
  );
  const pendingExpireAt =
    fence === undefined
      ? undefined
      : computeExpireAt(CONVERSATION_ASSISTANT_INITIAL_PREPARATION_CHUNK_TTL_MS);
  for (const [chunkIndex, text] of chunks.entries()) {
    const chunkRef = chunkCollection.doc(
      toTranscriptChunkId(session.id, chunkIndex, storage.snapshotId)
    );
    const chunkDocument = {
      sessionId: session.id,
      sessionGenerationId: session.generationId ?? null,
      ...(typeof session.sourceAccountId === 'string'
        ? { sourceAccountId: session.sourceAccountId }
        : {}),
      ...(typeof session.sourceAccountGeneration === 'string'
        ? { sourceAccountGeneration: session.sourceAccountGeneration }
        : {}),
      ...(fence !== undefined
        ? {
            preparationAttempt: fence.attempt,
            preparationClaimId: fence.claimId,
            expireAt: pendingExpireAt,
          }
        : {}),
      ...(storage.snapshotId !== undefined ? { snapshotId: storage.snapshotId } : {}),
      chunkIndex,
      text,
    };
    if (fence === undefined) {
      await chunkRef.set(chunkDocument);
      continue;
    }
    const sessionRef = db
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(session.id);
    const saved = await db.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(sessionRef);
      if (!sessionSnapshot.exists) return false;
      const current = toSession(sessionSnapshot.id, sessionSnapshot.data());
      if (
        current.userId !== session.userId ||
        current.deletionStartedAt !== undefined ||
        current.generationId !== session.generationId ||
        current.preparationAttempt !== fence.attempt ||
        current.preparationClaimId !== fence.claimId ||
        !preparationLeaseIsActive(current, fence.now)
      ) {
        return false;
      }
      if (!(await sourceAccountAllowsPrivatePreparation(transaction, db, current))) {
        return false;
      }
      const pendingContextStorage = parsePendingContextStorage(
        sessionSnapshot.data()?.['pendingContextStorage']
      );
      if (
        session.status === 'ready' &&
        session.contextSnapshotId !== undefined &&
        (pendingContextStorage === null ||
          pendingContextStorage.chunkCount + chunks.length >
            CONVERSATION_ASSISTANT_INITIAL_PREPARATION_MAX_FINALIZATION_CHUNKS)
      ) {
        return false;
      }
      transaction.set(chunkRef, chunkDocument);
      return true;
    });
    if (!saved) {
      await deleteTranscriptChunks(
        db,
        session.id,
        storage,
        session.generationId,
        fence
      );
      return null;
    }
  }
      return storage;
    },
  });
}

async function deleteTranscriptChunks(
  db: ReturnType<typeof getFirestore>,
  sessionId: string,
  storage: TranscriptChunkStorage,
  expectedGenerationId?: string,
  expectedFence?: { attempt: number; claimId: string; now?: string }
): Promise<void> {
  const collection = db.collection(WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION);
  for (let chunkIndex = 0; chunkIndex < storage.chunkCount; chunkIndex += 1) {
    const chunkRef = collection.doc(toTranscriptChunkId(sessionId, chunkIndex, storage.snapshotId));
    await deleteDocumentIfCurrentMatches(
      db,
      chunkRef,
      (data) =>
        documentBelongsToGeneration(data, expectedGenerationId) &&
        (expectedFence === undefined ||
          (data?.['preparationAttempt'] === expectedFence.attempt &&
            data['preparationClaimId'] === expectedFence.claimId))
    );
  }
}

async function deleteContextSnapshotForGeneration(
  db: ReturnType<typeof getFirestore>,
  sessionId: string,
  userId: string,
  snapshotId: string,
  expectedGenerationId?: string
): Promise<void> {
  const collection = db.collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION);
  const snapshot = await collection
    .where('sessionId', '==', sessionId)
    .where('snapshotId', '==', snapshotId)
    .get();
  for (const document of snapshot.docs) {
    await deleteDocumentIfCurrentMatches(
      db,
      document.ref,
      (data) =>
        data?.['userId'] === userId &&
        data['snapshotId'] === snapshotId &&
        documentBelongsToGeneration(data, expectedGenerationId)
    );
  }
}

function documentBelongsToGeneration(
  data: Record<string, unknown> | undefined,
  expectedGenerationId: string | undefined
): boolean {
  const storedGenerationId = data?.['sessionGenerationId'];
  return expectedGenerationId === undefined
    ? typeof storedGenerationId !== 'string'
    : storedGenerationId === expectedGenerationId;
}

async function deleteGenerationDocuments(
  db: ReturnType<typeof getFirestore>,
  collectionName: string,
  sessionId: string,
  expectedGenerationId: string | undefined
): Promise<void> {
  const collection = db.collection(collectionName);
  if (expectedGenerationId !== undefined) {
    let deletedDocumentCount: number;
    do {
      const snapshot = await collection
        .where('sessionId', '==', sessionId)
        .where('sessionGenerationId', '==', expectedGenerationId)
        .limit(CASCADE_DELETE_BATCH_SIZE)
        .get();
      deletedDocumentCount = snapshot.size;
      if (snapshot.empty) continue;
      await deleteDocumentsIfCurrentMatch(db, snapshot.docs, (data) =>
        documentBelongsToGeneration(data, expectedGenerationId)
      );
    } while (deletedDocumentCount > 0);
    return;
  }

  let cursor: string | undefined;
  let scannedDocumentCount: number;
  do {
    let query = collection
      .where('sessionId', '==', sessionId)
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(CASCADE_DELETE_BATCH_SIZE);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snapshot = await query.get();
    scannedDocumentCount = snapshot.size;
    const documents = snapshot.docs.filter((document) =>
      documentBelongsToGeneration(document.data(), undefined)
    );
    if (documents.length > 0) {
      await deleteDocumentsIfCurrentMatch(db, documents, (data) =>
        documentBelongsToGeneration(data, undefined)
      );
    }
    cursor = snapshot.docs.at(-1)?.id;
  } while (scannedDocumentCount === CASCADE_DELETE_BATCH_SIZE && cursor !== undefined);
}

async function deleteDocumentIfCurrentMatches(
  db: ReturnType<typeof getFirestore>,
  documentRef: FirebaseFirestore.DocumentReference,
  predicate: (data: Record<string, unknown> | undefined) => boolean
): Promise<boolean> {
  return await db.runTransaction(async (transaction) => {
    const current = await transaction.get(documentRef);
    if (!current.exists || !predicate(current.data())) return false;
    transaction.delete(documentRef);
    return true;
  });
}

async function deleteDocumentsIfCurrentMatch(
  db: ReturnType<typeof getFirestore>,
  documents: FirebaseFirestore.QueryDocumentSnapshot[],
  predicate: (data: Record<string, unknown> | undefined) => boolean
): Promise<void> {
  for (const document of documents) {
    await deleteDocumentIfCurrentMatches(db, document.ref, predicate);
  }
}

function splitTranscriptText(transcriptText: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of transcriptText) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (currentBytes + charBytes > TRANSCRIPT_CHUNK_MAX_BYTES && current.length > 0) {
      chunks.push(current);
      current = char;
      currentBytes = charBytes;
      continue;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function toTranscriptChunkId(sessionId: string, chunkIndex: number, snapshotId?: string): string {
  const prefix = snapshotId === undefined ? sessionId : `${sessionId}_${snapshotId}`;
  return `${prefix}_${String(chunkIndex).padStart(6, '0')}`;
}

type ConversationAssistantContextSnapshot = Pick<
  ConversationAssistantContextResult,
  'messages' | 'omittedMessages'
>;

type ContextChunkKind = 'included' | 'omitted';

interface ConversationAssistantContextChunk extends ConversationAssistantContextSnapshot {
  kind: ContextChunkKind;
  start: number;
  end: number;
}

function splitContextSnapshot(
  snapshot: ConversationAssistantContextSnapshot
): ConversationAssistantContextChunk[] {
  return [
    ...splitContextItems(snapshot.messages).map((messages, chunkIndex, chunks) => {
      const start = countPreviousItems(chunks, chunkIndex);
      return {
        kind: 'included' as const,
        start,
        end: start + messages.length,
        messages,
        omittedMessages: [],
      };
    }),
    ...splitContextItems(snapshot.omittedMessages).map((omittedMessages, chunkIndex, chunks) => {
      const start = countPreviousItems(chunks, chunkIndex);
      return {
        kind: 'omitted' as const,
        start,
        end: start + omittedMessages.length,
        messages: [],
        omittedMessages,
      };
    }),
  ];
}

function splitContextItems<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2;
  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
    if (current.length > 0 && currentBytes + itemBytes > CONTEXT_CHUNK_MAX_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function countPreviousItems(chunks: unknown[][], chunkIndex: number): number {
  return chunks.slice(0, chunkIndex).reduce((total, chunk) => total + chunk.length, 0);
}

function toContextChunkId(sessionId: string, snapshotId: string, chunkIndex: number): string {
  return `${sessionId}_${snapshotId}_${String(chunkIndex).padStart(6, '0')}`;
}

function parseContextChunk(
  id: string,
  data: Record<string, unknown> | undefined
): { chunkIndex: number } & ConversationAssistantContextChunk {
  const chunkIndex = data?.['chunkIndex'];
  const kind = data?.['kind'];
  const start = data?.['start'];
  const end = data?.['end'];
  const messages = data?.['messages'];
  const omittedMessages = data?.['omittedMessages'];
  if (
    !isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    (kind !== 'included' && kind !== 'omitted') ||
    !isInteger(start) ||
    start < 0 ||
    !isInteger(end) ||
    end <= start ||
    !Array.isArray(messages)
  ) {
    throw new Error(`Invalid context chunk ${id}`);
  }
  return {
    chunkIndex,
    kind,
    start,
    end,
    messages: messages.map((message, index) => parseContextMessage(id, index, message)),
    omittedMessages: Array.isArray(omittedMessages)
      ? omittedMessages.map((message, index) => parseOmittedContextMessage(id, index, message))
      : [],
  };
}

async function loadContextChunksForPage(
  db: ReturnType<typeof getFirestore>,
  sessionId: string,
  snapshotId: string,
  kind: ContextChunkKind,
  cursor: number,
  limit: number
): Promise<({ chunkIndex: number } & ConversationAssistantContextChunk)[]> {
  const snapshot = await db
    .collection(WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION)
    .where('sessionId', '==', sessionId)
    .where('snapshotId', '==', snapshotId)
    .where('kind', '==', kind)
    .where('end', '>', cursor)
    .orderBy('end', 'asc')
    .limit(limit)
    .get();
  return snapshot.docs.map((document) => parseContextChunk(document.id, document.data()));
}

function sliceIncludedContextPage(
  chunks: ({ chunkIndex: number } & ConversationAssistantContextChunk)[],
  cursor: number,
  limit: number
): ConversationAssistantContextResult['messages'] {
  return chunks
    .flatMap((chunk) => chunk.messages.slice(Math.max(0, cursor - chunk.start)))
    .slice(0, limit);
}

function sliceOmittedContextPage(
  chunks: ({ chunkIndex: number } & ConversationAssistantContextChunk)[],
  cursor: number,
  limit: number
): ConversationAssistantContextResult['omittedMessages'] {
  return chunks
    .flatMap((chunk) => chunk.omittedMessages.slice(Math.max(0, cursor - chunk.start)))
    .slice(0, limit);
}

function expectedContextPageLength(cursor: number, totalCount: number, limit: number): number {
  return Math.min(limit, Math.max(0, totalCount - cursor));
}

function parseContextMessage(
  chunkId: string,
  index: number,
  value: unknown
): ConversationAssistantContextResult['messages'][number] {
  if (!isRecord(value)) {
    throw new Error(`Invalid context message ${String(index)} in ${chunkId}`);
  }
  const id = value['id'];
  const eventTimestamp = value['eventTimestamp'];
  const importedAt = value['importedAt'];
  const direction = value['direction'];
  const speakerLabel = value['speakerLabel'];
  const messageType = value['messageType'];
  const contentKind = value['contentKind'];
  const content = value['content'];
  const reactions = value['reactions'];
  if (
    typeof id !== 'string' ||
    typeof eventTimestamp !== 'string' ||
    typeof importedAt !== 'string' ||
    (direction !== 'incoming' && direction !== 'outgoing') ||
    typeof speakerLabel !== 'string' ||
    typeof messageType !== 'string' ||
    (contentKind !== 'text' && contentKind !== 'transcription') ||
    typeof content !== 'string'
  ) {
    throw new Error(`Invalid context message ${String(index)} in ${chunkId}`);
  }
  const parsed: ConversationAssistantContextResult['messages'][number] = {
    id,
    eventTimestamp,
    importedAt,
    direction,
    speakerLabel,
    messageType:
      messageType as ConversationAssistantContextResult['messages'][number]['messageType'],
    contentKind,
    content,
  };
  if (Array.isArray(reactions)) {
    parsed.reactions = reactions.map((reaction, reactionIndex) =>
      parseReactionSummary(chunkId, index, reactionIndex, reaction)
    );
  }
  return parsed;
}

function parseOmittedContextMessage(
  chunkId: string,
  index: number,
  value: unknown
): ConversationAssistantContextResult['omittedMessages'][number] {
  if (!isRecord(value)) {
    throw new Error(`Invalid omitted context message ${String(index)} in ${chunkId}`);
  }
  const id = value['id'];
  const eventTimestamp = value['eventTimestamp'];
  const importedAt = value['importedAt'];
  const direction = value['direction'];
  const speakerLabel = value['speakerLabel'];
  const messageType = value['messageType'];
  const omissionReason = value['omissionReason'];
  if (
    typeof id !== 'string' ||
    typeof eventTimestamp !== 'string' ||
    typeof importedAt !== 'string' ||
    (direction !== 'incoming' && direction !== 'outgoing') ||
    typeof speakerLabel !== 'string' ||
    typeof messageType !== 'string' ||
    !isOmissionReason(omissionReason)
  ) {
    throw new Error(`Invalid omitted context message ${String(index)} in ${chunkId}`);
  }
  const parsed: ConversationAssistantContextResult['omittedMessages'][number] = {
    id,
    eventTimestamp,
    importedAt,
    direction,
    speakerLabel,
    messageType:
      messageType as ConversationAssistantContextResult['messages'][number]['messageType'],
    omissionReason,
  };
  const contentKind = value['contentKind'];
  if (contentKind === 'text' || contentKind === 'transcription') {
    parsed.contentKind = contentKind;
  }
  if (typeof value['content'] === 'string') {
    parsed.content = value['content'];
  }
  const reactions = value['reactions'];
  if (Array.isArray(reactions)) {
    parsed.reactions = reactions.map((reaction, reactionIndex) =>
      parseReactionSummary(chunkId, index, reactionIndex, reaction)
    );
  }
  if (value['reaction'] !== undefined) {
    parsed.reaction = parseOmittedReactionReference(chunkId, index, value['reaction']);
  }
  return parsed;
}

function parseOmittedReactionReference(
  chunkId: string,
  messageIndex: number,
  value: unknown
): NonNullable<ConversationAssistantContextResult['omittedMessages'][number]['reaction']> {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid reaction reference for omitted context message ${String(messageIndex)} in ${chunkId}`
    );
  }
  const emoji = value['emoji'];
  const targetMessageId = value['targetMessageId'];
  const targetMatrixEventId = value['targetMatrixEventId'];
  if (
    typeof emoji !== 'string' ||
    (typeof targetMessageId !== 'string' && typeof targetMatrixEventId !== 'string')
  ) {
    throw new Error(
      `Invalid reaction reference for omitted context message ${String(messageIndex)} in ${chunkId}`
    );
  }
  return {
    emoji,
    ...(typeof targetMessageId === 'string' ? { targetMessageId } : {}),
    ...(typeof targetMatrixEventId === 'string' ? { targetMatrixEventId } : {}),
  };
}

function isOmissionReason(
  value: unknown
): value is ConversationAssistantContextResult['omittedMessages'][number]['omissionReason'] {
  return (
    value === 'media_only' ||
    value === 'failed_transcription' ||
    value === 'pending_transcription' ||
    value === 'non_text' ||
    value === 'over_limit'
  );
}

function parseReactionSummary(
  chunkId: string,
  messageIndex: number,
  reactionIndex: number,
  value: unknown
): NonNullable<ConversationAssistantContextResult['messages'][number]['reactions']>[number] {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid reaction ${String(reactionIndex)} for context message ${String(messageIndex)} in ${chunkId}`
    );
  }
  const id = value['id'];
  const emoji = value['emoji'];
  const direction = value['direction'];
  const eventTimestamp = value['eventTimestamp'];
  if (
    typeof id !== 'string' ||
    typeof emoji !== 'string' ||
    (direction !== 'incoming' && direction !== 'outgoing') ||
    typeof eventTimestamp !== 'string'
  ) {
    throw new Error(
      `Invalid reaction ${String(reactionIndex)} for context message ${String(messageIndex)} in ${chunkId}`
    );
  }
  return {
    id,
    emoji,
    direction,
    eventTimestamp,
    ...(typeof value['senderKey'] === 'string' ? { senderKey: value['senderKey'] } : {}),
    ...(typeof value['senderDisplayName'] === 'string'
      ? { senderDisplayName: value['senderDisplayName'] }
      : {}),
    ...(typeof value['senderPhoneNumber'] === 'string'
      ? { senderPhoneNumber: value['senderPhoneNumber'] }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function toTurn(id: string, data: Record<string, unknown> | undefined): ConversationAssistantTurn {
  const turn = data as Partial<ConversationAssistantTurn> | undefined;
  const projected: ConversationAssistantTurn = {
    id,
    /* v8 ignore start -- test-infra: FakeFirestore where('sessionId', '==', value) cannot return documents that omit sessionId before hydration @preserve */
    sessionId: turn?.sessionId ?? '',
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- upstream: Firestore equality query on userId guarantees a matching string before hydration @preserve */
    userId: turn?.userId ?? '',
    /* v8 ignore stop @preserve */
    role: turn?.role === 'assistant' ? 'assistant' : 'user',
    text: turn?.text ?? '',
    createdAt: turn?.createdAt ?? '',
  };
  if (turn?.usage !== undefined) {
    projected.usage = turn.usage;
  }
  if (turn?.error !== undefined) {
    projected.error = turn.error;
  }
  if (isInteger(turn?.sequence) && turn.sequence >= 0) {
    projected.sequence = turn.sequence;
  }
  if (isInteger(turn?.conversationRevision) && turn.conversationRevision >= 0) {
    projected.conversationRevision = turn.conversationRevision;
  }
  if (typeof turn?.requestId === 'string') {
    projected.requestId = turn.requestId;
  }
  if (turn?.kind === 'message' || turn?.kind === 'context_attachment_question') {
    projected.kind = turn.kind;
  }
  if (typeof turn?.contextAttachmentId === 'string') {
    projected.contextAttachmentId = turn.contextAttachmentId;
  }
  const contextAttachment = toTurnContextAttachmentSummary(turn?.contextAttachment);
  if (contextAttachment !== undefined) {
    projected.contextAttachment = contextAttachment;
  }
  if (typeof turn?.acknowledgment === 'string') {
    projected.acknowledgment = turn.acknowledgment;
  }
  return projected;
}

function compareConversationAssistantTurns(
  left: ConversationAssistantTurn,
  right: ConversationAssistantTurn
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    const sequenceComparison = left.sequence - right.sequence;
    if (sequenceComparison !== 0) return sequenceComparison;
  }
  const createdComparison = left.createdAt.localeCompare(right.createdAt);
  return createdComparison === 0 ? left.id.localeCompare(right.id) : createdComparison;
}

function toTurnContextAttachmentSummary(
  value: unknown
): ConversationAssistantTurn['contextAttachment'] {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['capturedAt'] !== 'string'
  ) {
    return undefined;
  }
  const captureRange = toStoredDateRange(value['captureRange']);
  const counts = value['counts'];
  const omitted = value['omitted'];
  if (captureRange === undefined || !isRecord(counts) || !isRecord(omitted)) return undefined;
  const countFields = [
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
  const omittedFields = [
    'mediaOnly',
    'failedTranscriptions',
    'pendingTranscriptions',
    'nonText',
    'overLimit',
  ] as const;
  if (
    countFields.some((field) => !isInteger(counts[field]) || counts[field] < 0) ||
    omittedFields.some((field) => !isInteger(omitted[field]) || omitted[field] < 0)
  ) {
    return undefined;
  }
  const eventRange = toStoredDateRange(value['eventRange']);
  return {
    id: value['id'],
    capturedAt: value['capturedAt'],
    captureRange,
    ...(eventRange === undefined ? {} : { eventRange }),
    counts: {
      included: counts['included'] as number,
      excluded: counts['excluded'] as number,
      newlyAvailable: counts['newlyAvailable'] as number,
      edited: counts['edited'] as number,
      redacted: counts['redacted'] as number,
      deleted: counts['deleted'] as number,
      reactionsChanged: counts['reactionsChanged'] as number,
      lateIngested: counts['lateIngested'] as number,
      completedTranscriptions: counts['completedTranscriptions'] as number,
    },
    omitted: {
      mediaOnly: omitted['mediaOnly'] as number,
      failedTranscriptions: omitted['failedTranscriptions'] as number,
      pendingTranscriptions: omitted['pendingTranscriptions'] as number,
      nonText: omitted['nonText'] as number,
      overLimit: omitted['overLimit'] as number,
    },
  };
}

function toStoredDateRange(value: unknown): { from: string; to: string } | undefined {
  return isRecord(value) && typeof value['from'] === 'string' && typeof value['to'] === 'string'
    ? { from: value['from'], to: value['to'] }
    : undefined;
}
