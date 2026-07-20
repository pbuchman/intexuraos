import { getErrorMessage } from '@intexuraos/common-core';
import { FieldPath, getFirestore } from '@intexuraos/infra-firestore';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import type { ConversationAssistantRepository } from '../../domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantContextResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from '../../domain/conversation-assistant/types.js';
import { DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL } from '../../domain/conversation-assistant/roleInference.js';

export const WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION =
  'whatsapp_conversation_assistant_sessions';
export const WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION =
  'whatsapp_conversation_assistant_transcript_chunks';
export const WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION =
  'whatsapp_conversation_assistant_context_chunks';
export const WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION =
  'whatsapp_conversation_assistant_turns';
export const TRANSCRIPT_CHUNK_MAX_BYTES = 200_000;
export const CONTEXT_CHUNK_MAX_BYTES = 200_000;

interface TranscriptChunkStorage {
  type: 'chunks';
  chunkCount: number;
  chunkSizeBytes: number;
  byteLength: number;
  snapshotId?: string;
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
        throw new Error(
          `Failed to save Conversation Assistant session: ${getErrorMessage(error)}`
        );
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
        const result = await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          if (snapshot.exists) {
            return { status: 'existing' as const, data: snapshot.data() };
          }
          transaction.set(sessionRef, toSessionDocument(session, emptyTranscriptStorage()));
          return { status: 'created' as const };
        });
        if (result.status === 'created') {
          return { status: 'created', session };
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
        return await toHydratedSession(db, doc.id, doc.data());
      } catch (error) {
        throw new Error(
          `Failed to load Conversation Assistant session: ${getErrorMessage(error)}`
        );
      }
    },

    async getSessionSnapshotById(
      input: { sessionId: string; userId: string }
    ): Promise<{ session: ConversationAssistantSession; turns: ConversationAssistantTurn[] } | null> {
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
        if (sessionWithoutTranscript.userId !== input.userId) {
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
          turns: turnsSnapshot.docs.map((doc) => toTurn(doc.id, doc.data())),
        };
      } catch (error) {
        throw new Error(
          `Failed to load Conversation Assistant session snapshot: ${getErrorMessage(error)}`
        );
      }
    },

    async listSessionsByUserId(userId: string): Promise<ConversationAssistantSession[]> {
      try {
        const snapshot = await getFirestore()
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .where('userId', '==', userId)
          .orderBy('updatedAt', 'desc')
          .orderBy(FieldPath.documentId(), 'desc')
          .get();
        return snapshot.docs.map((doc) => toSession(doc.id, doc.data()));
      } catch (error) {
        throw new Error(
          `Failed to list Conversation Assistant sessions: ${getErrorMessage(error)}`
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
          if (session.userId !== input.userId) {
            return { status: 'not_found' as const };
          }
          if (
            session.status !== 'preparing' ||
            session.preparationAttempt !== input.attempt
          ) {
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
          const storage = parseTranscriptStorage(snapshot.data()?.['transcriptStorage']) ??
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
        const transcriptStorage = await saveTranscriptChunks(db, input.session);
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.session.id);
        return await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(sessionRef);
          if (!snapshot.exists) {
            return false;
          }
          const current = toSession(snapshot.id, snapshot.data());
          if (
            current.preparationAttempt !== input.attempt ||
            current.preparationClaimId !== input.claimId
          ) {
            return false;
          }
          transaction.set(sessionRef, toSessionDocument(input.session, transcriptStorage));
          return true;
        });
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
          if (session.userId !== input.userId) {
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
          const storage = parseTranscriptStorage(snapshot.data()?.['transcriptStorage']) ??
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
          if (session.userId !== input.userId) {
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
          const storage = parseTranscriptStorage(snapshot.data()?.['transcriptStorage']) ??
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
      contextSnapshot: Pick<
        ConversationAssistantContextResult,
        'messages' | 'omittedMessages'
      >
    ): Promise<void> {
      try {
        const collection = getFirestore().collection(
          WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION
        );
        const existing = await collection
          .where('sessionId', '==', sessionId)
          .where('snapshotId', '==', snapshotId)
          .get();
        const chunks = splitContextSnapshot(contextSnapshot);
        const expectedIds = new Set<string>();

        for (const [chunkIndex, chunk] of chunks.entries()) {
          const chunkId = toContextChunkId(sessionId, snapshotId, chunkIndex);
          expectedIds.add(chunkId);
          await collection.doc(chunkId).set({
            sessionId,
            userId,
            snapshotId,
            chunkIndex,
            kind: chunk.kind,
            start: chunk.start,
            end: chunk.end,
            messages: chunk.messages,
            omittedMessages: chunk.omittedMessages,
          });
        }
        for (const document of existing.docs) {
          if (!expectedIds.has(document.id)) {
            await collection.doc(document.id).delete();
          }
        }
      } catch (error) {
        throw new Error(
          `Failed to save Conversation Assistant context: ${getErrorMessage(error)}`
        );
      }
    },

    async deleteContextSnapshot(
      sessionId: string,
      userId: string,
      snapshotId: string
    ): Promise<void> {
      try {
        const collection = getFirestore().collection(
          WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION
        );
        const snapshot = await collection
          .where('sessionId', '==', sessionId)
          .where('snapshotId', '==', snapshotId)
          .get();
        for (const document of snapshot.docs) {
          if (document.data()['userId'] === userId) {
            await collection.doc(document.id).delete();
          }
        }
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
        const messages = sliceIncludedContextPage(
          messageChunks,
          input.messageCursor,
          input.limit
        );
        const omittedMessages = sliceOmittedContextPage(
          omittedChunks,
          input.omittedCursor,
          input.limit
        );
        return {
          messages,
          omittedMessages,
          snapshotAvailable:
            messages.length === expectedContextPageLength(
              input.messageCursor,
              input.messageCount,
              input.limit
            ) &&
            omittedMessages.length === expectedContextPageLength(
              input.omittedCursor,
              input.omittedMessageCount,
              input.limit
            ),
        };
      } catch (error) {
        throw new Error(
          `Failed to load Conversation Assistant context: ${getErrorMessage(error)}`
        );
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

    async listTurnsBySessionId(sessionId: string): Promise<ConversationAssistantTurn[]> {
      try {
        const snapshot = await getFirestore()
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
          .where('sessionId', '==', sessionId)
          .orderBy('createdAt', 'asc')
          .orderBy(FieldPath.documentId(), 'asc')
          .get();
        return snapshot.docs.map((doc) => toTurn(doc.id, doc.data()));
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
      session?.status === 'preparing' || session?.status === 'failed' || session?.status === 'ready'
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
      typeof session?.assistantRoleLabel === 'string' && session.assistantRoleLabel.trim().length > 0
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
  if (typeof session?.preparationClaimId === 'string') {
    projected.preparationClaimId = session.preparationClaimId;
  }
  if (typeof session?.preparationLeaseExpiresAt === 'string') {
    projected.preparationLeaseExpiresAt = session.preparationLeaseExpiresAt;
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

async function saveTranscriptChunks(
  db: ReturnType<typeof getFirestore>,
  session: ConversationAssistantSession
): Promise<TranscriptChunkStorage> {
  const chunks = splitTranscriptText(session.transcriptText);
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
  for (const [chunkIndex, text] of chunks.entries()) {
    await chunkCollection.doc(toTranscriptChunkId(session.id, chunkIndex, storage.snapshotId)).set({
      sessionId: session.id,
      ...(storage.snapshotId !== undefined ? { snapshotId: storage.snapshotId } : {}),
      chunkIndex,
      text,
    });
  }
  return storage;
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

function toTranscriptChunkId(
  sessionId: string,
  chunkIndex: number,
  snapshotId?: string
): string {
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
  return chunks
    .slice(0, chunkIndex)
    .reduce((total, chunk) => total + chunk.length, 0);
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
    messageType: messageType as ConversationAssistantContextResult['messages'][number]['messageType'],
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
    messageType: messageType as ConversationAssistantContextResult['messages'][number]['messageType'],
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
): NonNullable<
  ConversationAssistantContextResult['omittedMessages'][number]['reaction']
> {
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
    userId: turn?.userId ?? '',
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
  return projected;
}
