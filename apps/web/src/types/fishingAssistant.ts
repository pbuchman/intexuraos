export type FishingContentType =
  | 'recipe'
  | 'guide'
  | 'species'
  | 'theory'
  | 'additive'
  | 'qna'
  | 'other';

export type FishingKnowledgeIndexingStatus = 'pending' | 'ready' | 'failed';
export type FishingEvidenceSourceType = 'knowledge_page' | 'digest' | 'raw_message';
export type FishingChatRole = 'user' | 'assistant';
export type FishingAnswerConfidence = 'high' | 'medium' | 'low';

export interface FishingKnowledgeFolder {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly sortOrder: number;
  readonly pageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FishingKnowledgePage {
  readonly id: string;
  readonly userId: string;
  readonly folderId: string;
  readonly title: string;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly contentType: FishingContentType;
  readonly indexingStatus: FishingKnowledgeIndexingStatus;
  readonly chunkCount: number;
  readonly indexingError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FishingMessageCitation {
  readonly sourceId: string;
  readonly sourceType: FishingEvidenceSourceType;
  readonly title: string;
  readonly quote: string;
  readonly usedFor: string;
  readonly url?: string;
  readonly date?: string;
  readonly pageId?: string;
}

export interface FishingChat {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly lastMessagePreview: string;
  readonly lastMessageAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FishingChatMessage {
  readonly id: string;
  readonly chatId: string;
  readonly userId: string;
  readonly role: FishingChatRole;
  readonly content: string;
  readonly citations: readonly FishingMessageCitation[];
  readonly confidence?: FishingAnswerConfidence;
  readonly createdAt: string;
}

export interface CreateFishingKnowledgeFolderInput {
  readonly name: string;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
}

export interface UpdateFishingKnowledgeFolderInput {
  readonly name: string;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
}

export interface CreateFishingKnowledgePageInput {
  readonly folderId: string;
  readonly rawText: string;
}

export interface UpdateFishingKnowledgePageInput {
  readonly rawText: string;
}

export interface SendFishingChatMessageResponse {
  readonly chat: FishingChat;
  readonly message: FishingChatMessage;
}
