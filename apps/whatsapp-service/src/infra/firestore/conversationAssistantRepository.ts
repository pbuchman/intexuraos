import { getErrorMessage } from '@intexuraos/common-core';
import { FieldPath, getFirestore } from '@intexuraos/infra-firestore';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import type { ConversationAssistantRepository } from '../../domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantSession,
  ConversationAssistantTurn,
} from '../../domain/conversation-assistant/types.js';

export const WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION =
  'whatsapp_conversation_assistant_sessions';
export const WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION =
  'whatsapp_conversation_assistant_turns';

export function createConversationAssistantRepository(): ConversationAssistantRepository {
  return {
    async saveSession(session: ConversationAssistantSession): Promise<void> {
      try {
        await getFirestore()
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(session.id)
          .set(session);
      } catch (error) {
        throw new Error(
          `Failed to save Conversation Assistant session: ${getErrorMessage(error)}`
        );
      }
    },

    async getSessionById(sessionId: string): Promise<ConversationAssistantSession | null> {
      try {
        const doc = await getFirestore()
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(sessionId)
          .get();
        if (!doc.exists) {
          return null;
        }
        return toSession(doc.id, doc.data());
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
        const sessionRef = db
          .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
          .doc(input.sessionId);
        return await db.runTransaction(async (transaction) => {
          const sessionDoc = await transaction.get(sessionRef);
          if (!sessionDoc.exists) {
            return null;
          }
          const session = toSession(sessionDoc.id, sessionDoc.data());
          if (session.userId !== input.userId) {
            return null;
          }
          const turnsSnapshot = await transaction.get(
            db
              .collection(WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION)
              .where('sessionId', '==', input.sessionId)
              .where('userId', '==', input.userId)
              .orderBy('createdAt', 'asc')
              .orderBy(FieldPath.documentId(), 'asc')
          );
          return {
            session,
            turns: turnsSnapshot.docs.map((doc) => toTurn(doc.id, doc.data())),
          };
        });
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

function toSession(
  id: string,
  data: Record<string, unknown> | undefined
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
    transcriptText: session?.transcriptText ?? '',
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
