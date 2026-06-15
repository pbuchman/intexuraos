import { err, getErrorMessage, ok, type Logger, type Result } from '@intexuraos/common-core';
import { Timestamp, type Firestore } from '@intexuraos/infra-firestore';
import type {
  FishingAnswerConfidence,
  FishingChat,
  FishingChatMessage,
  FishingChatRole,
  FishingMessageCitation,
} from '../../domain/models/chat.js';
import type {
  ChatRepositoryError,
  CreateFishingChatInput,
  CreateFishingChatMessageInput,
  FishingChatRepository,
  UpdateFishingChatInput,
} from '../../domain/ports/chatRepository.js';
import {
  FISHING_CHATS_COLLECTION,
  FISHING_CHAT_MESSAGES_COLLECTION,
} from './collections.js';

export interface FirestoreChatRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

function toTimestamp(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.fromMillis(0);
}

function toRole(value: unknown): FishingChatRole {
  return value === 'assistant' ? 'assistant' : 'user';
}

function toConfidence(value: unknown): FishingAnswerConfidence | undefined {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : undefined;
}

function toCitations(value: unknown): FishingMessageCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const sourceId = record['sourceId'];
    const sourceType = record['sourceType'];
    const title = record['title'];
    const quote = record['quote'];
    const usedFor = record['usedFor'];
    if (
      typeof sourceId !== 'string' ||
      typeof sourceType !== 'string' ||
      typeof title !== 'string' ||
      typeof quote !== 'string' ||
      typeof usedFor !== 'string'
    ) {
      return [];
    }

    return [
      {
        sourceId,
        sourceType: sourceType as FishingMessageCitation['sourceType'],
        title,
        quote,
        usedFor,
        ...(typeof record['url'] === 'string' ? { url: record['url'] } : {}),
        ...(typeof record['date'] === 'string' ? { date: record['date'] } : {}),
        ...(typeof record['pageId'] === 'string' ? { pageId: record['pageId'] } : {}),
      },
    ];
  });
}

function toChat(id: string, data: Record<string, unknown>): FishingChat {
  return {
    id,
    userId: typeof data['userId'] === 'string' ? data['userId'] : '',
    title: typeof data['title'] === 'string' ? data['title'] : 'New Chat',
    lastMessagePreview:
      typeof data['lastMessagePreview'] === 'string' ? data['lastMessagePreview'] : '',
    lastMessageAt: toTimestamp(data['lastMessageAt']),
    createdAt: toTimestamp(data['createdAt']),
    updatedAt: toTimestamp(data['updatedAt']),
  };
}

function toMessage(id: string, data: Record<string, unknown>): FishingChatMessage {
  const confidence = toConfidence(data['confidence']);
  return {
    id,
    /* v8 ignore start -- upstream: prior Firestore equality filters validate string identifiers before mapping; fallback is defensive for corrupted docs @preserve */
    chatId: typeof data['chatId'] === 'string' ? data['chatId'] : '',
    userId: typeof data['userId'] === 'string' ? data['userId'] : '',
    /* v8 ignore stop @preserve */
    role: toRole(data['role']),
    content: typeof data['content'] === 'string' ? data['content'] : '',
    citations: toCitations(data['citations']),
    createdAt: toTimestamp(data['createdAt']),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function summarizeMessage(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`;
}

export class FirestoreChatRepository implements FishingChatRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreChatRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async createChat(input: CreateFishingChatInput): Promise<Result<FishingChat, ChatRepositoryError>> {
    try {
      const now = Timestamp.now();
      const chat = {
        userId: input.userId,
        title: input.title,
        lastMessagePreview: '',
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await this.firestore.collection(FISHING_CHATS_COLLECTION).doc(input.id).set(chat);
      return ok(toChat(input.id, chat));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to create fishing chat');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async listChatsByUserId(userId: string): Promise<Result<FishingChat[], ChatRepositoryError>> {
    try {
      const snapshot = await this.firestore
        .collection(FISHING_CHATS_COLLECTION)
        .where('userId', '==', userId)
        .orderBy('lastMessageAt', 'desc')
        .get();

      return ok(
        snapshot.docs.map((doc) => toChat(doc.id, doc.data() as Record<string, unknown>))
      );
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), userId }, 'Failed to list fishing chats');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async getChatByIdForUser(input: {
    userId: string;
    chatId: string;
  }): Promise<Result<FishingChat | null, ChatRepositoryError>> {
    try {
      const doc = await this.firestore.collection(FISHING_CHATS_COLLECTION).doc(input.chatId).get();
      if (!doc.exists) {
        return ok(null);
      }
      const chat = toChat(doc.id, doc.data() as Record<string, unknown>);
      return ok(chat.userId === input.userId ? chat : null);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to get fishing chat');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async updateChat(input: UpdateFishingChatInput): Promise<Result<FishingChat, ChatRepositoryError>> {
    try {
      const existing = await this.getChatByIdForUser({
        userId: input.userId,
        chatId: input.chatId,
      });
      if (!existing.ok) return existing;
      if (existing.value === null) {
        return err({ code: 'NOT_FOUND', message: `Fishing chat ${input.chatId} not found` });
      }

      const update = {
        title: input.title ?? existing.value.title,
        lastMessagePreview: input.lastMessagePreview ?? existing.value.lastMessagePreview,
        lastMessageAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        userId: existing.value.userId,
        createdAt: existing.value.createdAt,
      };
      await this.firestore.collection(FISHING_CHATS_COLLECTION).doc(input.chatId).set(update);
      return ok(toChat(input.chatId, update));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to update fishing chat');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async createMessage(
    input: CreateFishingChatMessageInput
  ): Promise<Result<FishingChatMessage, ChatRepositoryError>> {
    try {
      const message = {
        chatId: input.chatId,
        userId: input.userId,
        role: input.role,
        content: input.content,
        citations: input.citations ?? [],
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        createdAt: Timestamp.now(),
      };
      await this.firestore
        .collection(FISHING_CHAT_MESSAGES_COLLECTION)
        .doc(input.id)
        .set(message);

      const chatUpdate = await this.updateChat({
        userId: input.userId,
        chatId: input.chatId,
        lastMessagePreview: summarizeMessage(input.content),
      });
      if (!chatUpdate.ok) return chatUpdate;

      return ok(toMessage(input.id, message));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to create fishing chat message');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async listMessagesForChat(input: {
    userId: string;
    chatId: string;
  }): Promise<Result<FishingChatMessage[], ChatRepositoryError>> {
    try {
      const chat = await this.getChatByIdForUser(input);
      if (!chat.ok) return chat;
      if (chat.value === null) {
        return err({ code: 'NOT_FOUND', message: `Fishing chat ${input.chatId} not found` });
      }

      const snapshot = await this.firestore
        .collection(FISHING_CHAT_MESSAGES_COLLECTION)
        .where('userId', '==', input.userId)
        .where('chatId', '==', input.chatId)
        .orderBy('createdAt', 'asc')
        .get();

      return ok(
        snapshot.docs.map((doc) => toMessage(doc.id, doc.data() as Record<string, unknown>))
      );
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to list fishing chat messages');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreChatRepository(
  deps: FirestoreChatRepositoryDeps
): FishingChatRepository {
  return new FirestoreChatRepository(deps);
}
