import type { Timestamp } from '@intexuraos/infra-firestore';
import type { FishingChat, FishingChatMessage } from '../domain/models/chat.js';
import type { KnowledgeFolder, KnowledgePage } from '../domain/models/knowledge.js';

function timestampToIso(timestamp: Timestamp): string {
  return timestamp.toDate().toISOString();
}

export interface KnowledgeFolderResponse {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly sortOrder: number;
  readonly pageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgePageResponse {
  readonly id: string;
  readonly userId: string;
  readonly folderId: string;
  readonly title: string;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly contentType: KnowledgePage['contentType'];
  readonly indexingStatus: KnowledgePage['indexingStatus'];
  readonly chunkCount: number;
  readonly indexingError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FishingChatResponse {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly lastMessagePreview: string;
  readonly lastMessageAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FishingChatMessageResponse {
  readonly id: string;
  readonly chatId: string;
  readonly userId: string;
  readonly role: FishingChatMessage['role'];
  readonly content: string;
  readonly citations: FishingChatMessage['citations'];
  readonly confidence?: FishingChatMessage['confidence'];
  readonly createdAt: string;
}

export function serializeKnowledgeFolder(folder: KnowledgeFolder): KnowledgeFolderResponse {
  return {
    id: folder.id,
    userId: folder.userId,
    name: folder.name,
    parentId: folder.parentId,
    sortOrder: folder.sortOrder,
    pageCount: folder.pageCount,
    createdAt: timestampToIso(folder.createdAt),
    updatedAt: timestampToIso(folder.updatedAt),
  };
}

export function serializeKnowledgePage(page: KnowledgePage): KnowledgePageResponse {
  return {
    id: page.id,
    userId: page.userId,
    folderId: page.folderId,
    title: page.title,
    rawText: page.rawText,
    normalizedText: page.normalizedText,
    contentType: page.contentType,
    indexingStatus: page.indexingStatus,
    chunkCount: page.chunkCount,
    ...(page.indexingError !== undefined ? { indexingError: page.indexingError } : {}),
    createdAt: timestampToIso(page.createdAt),
    updatedAt: timestampToIso(page.updatedAt),
  };
}

export function serializeFishingChat(chat: FishingChat): FishingChatResponse {
  return {
    id: chat.id,
    userId: chat.userId,
    title: chat.title,
    lastMessagePreview: chat.lastMessagePreview,
    lastMessageAt: timestampToIso(chat.lastMessageAt),
    createdAt: timestampToIso(chat.createdAt),
    updatedAt: timestampToIso(chat.updatedAt),
  };
}

export function serializeFishingChatMessage(message: FishingChatMessage): FishingChatMessageResponse {
  return {
    id: message.id,
    chatId: message.chatId,
    userId: message.userId,
    role: message.role,
    content: message.content,
    citations: message.citations,
    ...(message.confidence !== undefined ? { confidence: message.confidence } : {}),
    createdAt: timestampToIso(message.createdAt),
  };
}
