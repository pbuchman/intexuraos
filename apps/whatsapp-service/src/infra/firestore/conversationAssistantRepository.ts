import { getErrorMessage } from '@intexuraos/common-core';
import { FieldPath, getFirestore } from '@intexuraos/infra-firestore';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import type { ConversationAssistantRepository } from '../../domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from '../../domain/conversation-assistant/types.js';
import { DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL } from '../../domain/conversation-assistant/roleInference.js';

export const WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION =
  'whatsapp_conversation_assistant_sessions';
export const WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION =
  'whatsapp_conversation_assistant_transcript_chunks';
export const WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION =
  'whatsapp_conversation_assistant_turns';
export const TRANSCRIPT_CHUNK_MAX_BYTES = 200_000;

interface TranscriptChunkStorage {
  type: 'chunks';
  chunkCount: number;
  chunkSizeBytes: number;
  byteLength: number;
}

export function createConversationAssistantRepository(): ConversationAssistantRepository {
  return {
    async saveSession(session: ConversationAssistantSession): Promise<void> {
      try {
        const db = getFirestore();
        const chunks = splitTranscriptText(session.transcriptText);
        const transcriptStorage: TranscriptChunkStorage = {
          type: 'chunks',
          chunkCount: chunks.length,
          chunkSizeBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
          byteLength: Buffer.byteLength(session.transcriptText, 'utf8'),
        };
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(session.id);
        const chunkCollection = db.collection(
          WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION
        );

        for (const [chunkIndex, text] of chunks.entries()) {
          await chunkCollection.doc(toTranscriptChunkId(session.id, chunkIndex)).set({
            sessionId: session.id,
            chunkIndex,
            text,
          });
        }
        await sessionRef.set(toSessionDocument(session, transcriptStorage));
      } catch (error) {
        throw new Error(
          `Failed to save Conversation Assistant session: ${getErrorMessage(error)}`
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
    status: session?.status === 'archived' ? 'archived' : 'active',
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
        .doc(toTranscriptChunkId(sessionId, chunkIndex))
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
  };
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

function toTranscriptChunkId(sessionId: string, chunkIndex: number): string {
  return `${sessionId}_${String(chunkIndex).padStart(6, '0')}`;
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
