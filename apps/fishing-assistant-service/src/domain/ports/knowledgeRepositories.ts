import type { Result } from '@intexuraos/common-core';
import type { FishingContentType } from '../chunking/types.js';
import type {
  KnowledgeChunk,
  KnowledgeChunkMatch,
  KnowledgeFolder,
  KnowledgeIndexingStatus,
  KnowledgePage,
} from '../models/knowledge.js';

export type KnowledgeRepositoryError =
  | { code: 'FIRESTORE_ERROR'; message: string }
  | { code: 'NOT_FOUND'; message: string };

export interface KnowledgeFolderCreateInput {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

export interface KnowledgePageCreateInput {
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
}

export interface KnowledgeChunkCreateInput {
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
  embedding: number[];
  embeddingModel: string;
}

export interface FindByIdForUserInput {
  userId: string;
  folderId: string;
}

export interface FindPageByIdForUserInput {
  userId: string;
  pageId: string;
}

export interface DeletePageForUserInput {
  userId: string;
  pageId: string;
}

export interface FindChunksByPageIdInput {
  userId: string;
  pageId: string;
}

export interface ReplaceChunksForPageInput {
  userId: string;
  pageId: string;
  chunks: KnowledgeChunkCreateInput[];
}

export interface FindNearestChunksInput {
  userId: string;
  embedding: number[];
  limit: number;
}

export interface KnowledgeFolderRepository {
  create(input: KnowledgeFolderCreateInput): Promise<Result<KnowledgeFolder, KnowledgeRepositoryError>>;
  getByIdForUser(input: FindByIdForUserInput): Promise<Result<KnowledgeFolder | null, KnowledgeRepositoryError>>;
  listByUserId(userId: string): Promise<Result<KnowledgeFolder[], KnowledgeRepositoryError>>;
  adjustPageCount(input: { userId: string; folderId: string; delta: number }): Promise<Result<void, KnowledgeRepositoryError>>;
}

export interface KnowledgePageRepository {
  create(input: KnowledgePageCreateInput): Promise<Result<KnowledgePage, KnowledgeRepositoryError>>;
  getByIdForUser(input: FindPageByIdForUserInput): Promise<Result<KnowledgePage | null, KnowledgeRepositoryError>>;
  deleteForUser(input: DeletePageForUserInput): Promise<Result<void, KnowledgeRepositoryError>>;
}

export interface KnowledgeChunkRepository {
  replaceForPage(input: ReplaceChunksForPageInput): Promise<Result<void, KnowledgeRepositoryError>>;
  findByPageId(input: FindChunksByPageIdInput): Promise<Result<KnowledgeChunk[], KnowledgeRepositoryError>>;
  deleteByPageId(input: FindChunksByPageIdInput): Promise<Result<void, KnowledgeRepositoryError>>;
  findNearestByUserId(input: FindNearestChunksInput): Promise<Result<KnowledgeChunkMatch[], KnowledgeRepositoryError>>;
}
