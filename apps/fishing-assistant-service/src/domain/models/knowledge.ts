import type { Timestamp } from '@intexuraos/infra-firestore';
import type { FishingContentType } from '../chunking/types.js';

export type KnowledgeIndexingStatus = 'pending' | 'ready' | 'failed';

export interface KnowledgeFolder {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  pageCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface KnowledgePage {
  id: string;
  userId: string;
  folderId: string;
  title: string;
  rawText: string;
  normalizedText: string;
  contentType: FishingContentType;
  indexingStatus: KnowledgeIndexingStatus;
  chunkCount: number;
  indexingError?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface KnowledgeChunk {
  id: string;
  userId: string;
  pageId: string;
  folderId: string;
  title: string;
  heading: string | null;
  index: number;
  text: string;
  searchableText: string;
  contentType: FishingContentType;
  embeddingModel: string;
  createdAt: Timestamp;
}

export interface KnowledgeChunkMatch extends KnowledgeChunk {
  vectorScore: number;
}
