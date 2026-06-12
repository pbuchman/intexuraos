import { err, ok, type Result } from '@intexuraos/common-core';
import { chunkPage } from '../chunking/chunkPage.js';
import type { KnowledgePage } from '../models/knowledge.js';
import type { KnowledgeEmbeddingClient } from '../ports/embeddingClient.js';
import type {
  KnowledgeChunkCreateInput,
  KnowledgeChunkRepository,
  KnowledgePageRepository,
  KnowledgeRepositoryError,
} from '../ports/knowledgeRepositories.js';

const MAX_PAGE_CHUNKS = 120;
const EMBEDDING_MODEL = 'text-embedding-3-small';

export type KnowledgePageIndexingError =
  | KnowledgeRepositoryError
  | { code: 'PAGE_TOO_LARGE'; message: string }
  | { code: 'EMBEDDING_FAILED'; message: string };

export interface KnowledgePageIndexingDeps {
  pageRepository: KnowledgePageRepository;
  chunkRepository: KnowledgeChunkRepository;
  embeddingClient: KnowledgeEmbeddingClient;
  generateId: () => string;
}

export interface CreateKnowledgePageInput {
  userId: string;
  folderId: string;
  rawText: string;
}

export interface UpdateKnowledgePageInput {
  userId: string;
  pageId: string;
  rawText: string;
}

export interface ReindexKnowledgePageInput {
  userId: string;
  pageId: string;
}

interface IndexedContent {
  title: string;
  normalizedText: string;
  contentType: KnowledgeChunkCreateInput['contentType'];
  chunks: Omit<KnowledgeChunkCreateInput, 'id' | 'userId' | 'pageId' | 'folderId' | 'title' | 'embedding' | 'embeddingModel'>[];
}

async function prepareContent(rawText: string): Promise<Result<IndexedContent, KnowledgePageIndexingError>> {
  const chunked = await chunkPage({ rawText });
  if (chunked.chunks.length > MAX_PAGE_CHUNKS) {
    return err({
      code: 'PAGE_TOO_LARGE',
      message: `Knowledge page creates ${String(chunked.chunks.length)} chunks; maximum is ${String(MAX_PAGE_CHUNKS)}.`,
    });
  }

  return ok({
    title: chunked.title,
    normalizedText: chunked.normalizedText,
    contentType: chunked.contentType,
    chunks: chunked.chunks.map((chunk) => ({
      heading: chunk.heading,
      index: chunk.index,
      text: chunk.text,
      searchableText: chunk.searchableText,
      contentType: chunk.contentType,
    })),
  });
}

function buildChunkInputs(input: {
  deps: KnowledgePageIndexingDeps;
  userId: string;
  pageId: string;
  folderId: string;
  title: string;
  content: IndexedContent;
  embeddings: number[][];
}): Result<KnowledgeChunkCreateInput[], KnowledgePageIndexingError> {
  if (input.embeddings.length !== input.content.chunks.length) {
    return err({ code: 'EMBEDDING_FAILED', message: 'Embedding result count did not match chunk count.' });
  }

  const chunks: KnowledgeChunkCreateInput[] = [];
  for (const chunk of input.content.chunks) {
    const embedding = input.embeddings[chunk.index];
    if (embedding === undefined) {
      return err({ code: 'EMBEDDING_FAILED', message: 'Embedding result count did not match chunk count.' });
    }
    chunks.push({
      id: input.deps.generateId(),
      userId: input.userId,
      pageId: input.pageId,
      folderId: input.folderId,
      title: input.title,
      heading: chunk.heading,
      index: chunk.index,
      text: chunk.text,
      searchableText: chunk.searchableText,
      contentType: chunk.contentType,
      embedding,
      embeddingModel: EMBEDDING_MODEL,
    });
  }
  return ok(chunks);
}

async function indexExistingPage(input: {
  deps: KnowledgePageIndexingDeps;
  page: KnowledgePage;
  rawText: string;
}): Promise<Result<KnowledgePage, KnowledgePageIndexingError>> {
  const contentResult = await prepareContent(input.rawText);
  if (!contentResult.ok) return contentResult;

  const content = contentResult.value;
  const embeddingResult = await input.deps.embeddingClient.embedTexts({
    userId: input.page.userId,
    texts: content.chunks.map((chunk) => chunk.searchableText),
  });

  if (!embeddingResult.ok) {
    const pageResult = await input.deps.pageRepository.updateForUser({
      userId: input.page.userId,
      pageId: input.page.id,
      title: content.title,
      rawText: input.rawText,
      normalizedText: content.normalizedText,
      contentType: content.contentType,
      indexingStatus: 'failed',
      indexingError: embeddingResult.error.message,
      chunkCount: 0,
    });
    if (!pageResult.ok) return pageResult;
    const deleteResult = await input.deps.chunkRepository.replaceForPage({
      userId: input.page.userId,
      pageId: input.page.id,
      chunks: [],
    });
    if (!deleteResult.ok) return deleteResult;
    return pageResult;
  }

  const chunksResult = buildChunkInputs({
    deps: input.deps,
    userId: input.page.userId,
    pageId: input.page.id,
    folderId: input.page.folderId,
    title: content.title,
    content,
    embeddings: embeddingResult.value,
  });
  if (!chunksResult.ok) return chunksResult;

  const pageResult = await input.deps.pageRepository.updateForUser({
    userId: input.page.userId,
    pageId: input.page.id,
    title: content.title,
    rawText: input.rawText,
    normalizedText: content.normalizedText,
    contentType: content.contentType,
    indexingStatus: 'ready',
    indexingError: null,
    chunkCount: chunksResult.value.length,
  });
  if (!pageResult.ok) return pageResult;

  const chunksWriteResult = await input.deps.chunkRepository.replaceForPage({
    userId: input.page.userId,
    pageId: input.page.id,
    chunks: chunksResult.value,
  });
  if (!chunksWriteResult.ok) return chunksWriteResult;

  return pageResult;
}

export async function createKnowledgePage(
  deps: KnowledgePageIndexingDeps,
  input: CreateKnowledgePageInput
): Promise<Result<KnowledgePage, KnowledgePageIndexingError>> {
  const contentResult = await prepareContent(input.rawText);
  if (!contentResult.ok) return contentResult;

  const pageId = deps.generateId();
  const content = contentResult.value;
  const embeddingResult = await deps.embeddingClient.embedTexts({
    userId: input.userId,
    texts: content.chunks.map((chunk) => chunk.searchableText),
  });

  if (!embeddingResult.ok) {
    return await deps.pageRepository.create({
      id: pageId,
      userId: input.userId,
      folderId: input.folderId,
      title: content.title,
      rawText: input.rawText,
      normalizedText: content.normalizedText,
      contentType: content.contentType,
      indexingStatus: 'failed',
      indexingError: embeddingResult.error.message,
      chunkCount: 0,
    });
  }

  const chunksResult = buildChunkInputs({
    deps,
    userId: input.userId,
    pageId,
    folderId: input.folderId,
    title: content.title,
    content,
    embeddings: embeddingResult.value,
  });
  if (!chunksResult.ok) return chunksResult;

  const pageResult = await deps.pageRepository.create({
    id: pageId,
    userId: input.userId,
    folderId: input.folderId,
    title: content.title,
    rawText: input.rawText,
    normalizedText: content.normalizedText,
    contentType: content.contentType,
    indexingStatus: 'ready',
    chunkCount: chunksResult.value.length,
  });
  if (!pageResult.ok) return pageResult;

  const chunksWriteResult = await deps.chunkRepository.replaceForPage({
    userId: input.userId,
    pageId,
    chunks: chunksResult.value,
  });
  if (!chunksWriteResult.ok) return chunksWriteResult;

  return pageResult;
}

export async function updateKnowledgePage(
  deps: KnowledgePageIndexingDeps,
  input: UpdateKnowledgePageInput
): Promise<Result<KnowledgePage, KnowledgePageIndexingError>> {
  const pageResult = await deps.pageRepository.getByIdForUser({
    userId: input.userId,
    pageId: input.pageId,
  });
  if (!pageResult.ok) return pageResult;
  if (pageResult.value === null) {
    return err({ code: 'NOT_FOUND', message: `Fishing knowledge page ${input.pageId} not found` });
  }

  return await indexExistingPage({
    deps,
    page: pageResult.value,
    rawText: input.rawText,
  });
}

export async function reindexKnowledgePage(
  deps: KnowledgePageIndexingDeps,
  input: ReindexKnowledgePageInput
): Promise<Result<KnowledgePage, KnowledgePageIndexingError>> {
  const pageResult = await deps.pageRepository.getByIdForUser({
    userId: input.userId,
    pageId: input.pageId,
  });
  if (!pageResult.ok) return pageResult;
  if (pageResult.value === null) {
    return err({ code: 'NOT_FOUND', message: `Fishing knowledge page ${input.pageId} not found` });
  }

  return await indexExistingPage({
    deps,
    page: pageResult.value,
    rawText: pageResult.value.rawText,
  });
}
