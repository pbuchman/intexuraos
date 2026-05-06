import type { Timestamp } from '@intexuraos/infra-firestore';

export type FishingEvidenceSourceType = 'knowledge_page' | 'digest' | 'raw_message';
export type FishingChatRole = 'user' | 'assistant';
export type FishingAnswerConfidence = 'high' | 'medium' | 'low';

export interface FishingMessageCitation {
  sourceId: string;
  sourceType: FishingEvidenceSourceType;
  title: string;
  quote: string;
  usedFor: string;
  url?: string;
  date?: string;
  pageId?: string;
}

export interface FishingChat {
  id: string;
  userId: string;
  title: string;
  lastMessagePreview: string;
  lastMessageAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FishingChatMessage {
  id: string;
  chatId: string;
  userId: string;
  role: FishingChatRole;
  content: string;
  citations: FishingMessageCitation[];
  confidence?: FishingAnswerConfidence;
  createdAt: Timestamp;
}
