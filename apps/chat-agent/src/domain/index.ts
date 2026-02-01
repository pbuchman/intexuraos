/**
 * Domain layer exports for chat-agent.
 */
export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ConversationHistory,
  DocSource,
  SuggestedAction,
} from './models/chatMessage.js';
export type {
  DocChunk,
  DocChunkWithScore,
  EmbeddingRepositoryPort,
} from './models/docChunk.js';
export type { EmbeddingRepositoryPort as EmbeddingRepository } from './ports/embeddingRepository.js';
export { searchDocumentation } from './usecases/searchDocumentation.js';
export type {
  SearchDocumentationDeps,
  SearchOptions,
  EmbeddingClient,
} from './usecases/searchDocumentation.js';
export type { SearchError, SearchErrorCode } from './usecases/searchDocumentation.js';
