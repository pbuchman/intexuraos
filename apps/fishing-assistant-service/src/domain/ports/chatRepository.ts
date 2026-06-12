import type { Result } from '@intexuraos/common-core';
import type {
  FishingAnswerConfidence,
  FishingChat,
  FishingChatMessage,
  FishingChatRole,
  FishingMessageCitation,
} from '../models/chat.js';

export type ChatRepositoryError =
  | { code: 'FIRESTORE_ERROR'; message: string }
  | { code: 'NOT_FOUND'; message: string };

export interface CreateFishingChatInput {
  id: string;
  userId: string;
  title: string;
}

export interface UpdateFishingChatInput {
  chatId: string;
  userId: string;
  title?: string;
  lastMessagePreview?: string;
}

export interface CreateFishingChatMessageInput {
  id: string;
  chatId: string;
  userId: string;
  role: FishingChatRole;
  content: string;
  citations?: FishingMessageCitation[];
  confidence?: FishingAnswerConfidence;
}

export interface FishingChatRepository {
  createChat(input: CreateFishingChatInput): Promise<Result<FishingChat, ChatRepositoryError>>;
  listChatsByUserId(userId: string): Promise<Result<FishingChat[], ChatRepositoryError>>;
  getChatByIdForUser(input: {
    userId: string;
    chatId: string;
  }): Promise<Result<FishingChat | null, ChatRepositoryError>>;
  updateChat(input: UpdateFishingChatInput): Promise<Result<FishingChat, ChatRepositoryError>>;
  createMessage(
    input: CreateFishingChatMessageInput
  ): Promise<Result<FishingChatMessage, ChatRepositoryError>>;
  listMessagesForChat(input: {
    userId: string;
    chatId: string;
  }): Promise<Result<FishingChatMessage[], ChatRepositoryError>>;
}
