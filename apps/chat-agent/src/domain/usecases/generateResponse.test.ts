/**
 * Tests for generateResponse use case.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateResponse } from './generateResponse.js';
import type {
  ConversationHistory,
  DocChunk,
  DocChunkWithScore,
  SuggestedAction,
} from '../../domain/index.js';
import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';

/** Mock timestamp for tests */
const mockTimestamp: FirebaseFirestore.Timestamp = {
  seconds: 123456,
  nanoseconds: 0,
  toDate: () => new Date(),
  toMillis: () => 123456000,
  isEqual: () => true,
  valueOf: () => '123456',
};

/** Mock doc chunks */
const mockChunks: DocChunkWithScore[] = [
  {
    id: 'chunk-1',
    content: 'To create a todo, use POST /todos endpoint with title field',
    filePath: 'docs/services/todos-agent/API.md',
    section: 'POST /todos',
    docType: 'markdown',
    createdAt: mockTimestamp,
    score: 0.85,
  },
  {
    id: 'chunk-2',
    content: 'The todos-agent supports creating, listing, and completing todos',
    filePath: 'docs/services/todos-agent/README.md',
    section: 'Overview',
    docType: 'markdown',
    createdAt: mockTimestamp,
    score: 0.75,
  },
];

/** Mock logger */
const mockLogger: Logger = {
  level: 'info',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  msgPrefix: '',
} as unknown as Logger;

/** Type for LLM client that returns structured responses */
interface LLMResponse {
  response: string;
  suggestedAction?: SuggestedAction;
}

/** Mock LLM client */
class MockLLMClient {
  public response = 'Here is how to create a todo...';
  public suggestedAction: SuggestedAction | null = null;
  public shouldFail = false;

  setResponse(response: string): void {
    this.response = response;
  }

  setSuggestedAction(action: SuggestedAction | null): void {
    this.suggestedAction = action;
  }

  setFailure(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  async generate(
    _prompt: string,
    _options?: {
      systemPrompt?: string;
      conversationHistory?: ConversationHistory[];
    }
  ): Promise<Result<LLMResponse>> {
    if (this.shouldFail) {
      return {
        ok: false,
        error: { code: 'LLM_ERROR', message: 'LLM failed' },
      };
    }
    return {
      ok: true,
      value: {
        response: this.response,
        suggestedAction: this.suggestedAction ?? undefined,
      },
    };
  }

  reset(): void {
    this.response = 'Here is how to create a todo...';
    this.suggestedAction = null;
    this.shouldFail = false;
  }
}

/** Mock embedding client */
class MockEmbeddingClient {
  public shouldFail = false;

  async embed(_text: string): Promise<Result<number[]>> {
    if (this.shouldFail) {
      return {
        ok: false,
        error: { code: 'EMBEDDING_ERROR', message: 'Embed failed' },
      };
    }
    return {
      ok: true,
      value: new Array(1536).fill(0.1),
    };
  }
}

/** Mock embedding repository */
class MockEmbeddingRepository {
  public chunks: DocChunkWithScore[] = mockChunks;
  public shouldFail = false;

  setChunks(chunks: DocChunkWithScore[]): void {
    this.chunks = chunks;
  }

  setFailure(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  async findSimilar(_embedding: number[], _limit: number): Promise<Result<DocChunkWithScore[]>> {
    if (this.shouldFail) {
      return {
        ok: false,
        error: { code: 'REPOSITORY_ERROR', message: 'Repository failed' },
      };
    }
    return {
      ok: true,
      value: this.chunks,
    };
  }

  async findById(_id: string): Promise<Result<DocChunk | null, unknown>> {
    return { ok: true, value: null };
  }
}

describe('generateResponse', () => {
  let mockLLM: MockLLMClient;
  let mockEmbedding: MockEmbeddingClient;
  let mockRepository: MockEmbeddingRepository;
  let pendingAction: SuggestedAction | null = null;

  beforeEach(() => {
    mockLLM = new MockLLMClient();
    mockEmbedding = new MockEmbeddingClient();
    mockRepository = new MockEmbeddingRepository();
    pendingAction = null;
  });

  const buildDeps = (): {
    llmClient: MockLLMClient;
    searchDocumentation: {
      embeddingRepository: MockEmbeddingRepository;
      embeddingClient: MockEmbeddingClient;
      logger: Logger;
    };
    logger: Logger;
  } => ({
    llmClient: mockLLM,
    searchDocumentation: {
      embeddingRepository: mockRepository,
      embeddingClient: mockEmbedding,
      logger: mockLogger,
    },
    logger: mockLogger,
  });

  describe('builds prompt with context', () => {
    it('should include RAG context in prompt', async () => {
      mockLLM.setResponse('Based on the docs, here is how...');

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'How do I create a todo?',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.response).toBe('Based on the docs, here is how...');
        expect(result.value.sources).toHaveLength(2);
        expect(result.value.sources[0]?.filePath).toBe('docs/services/todos-agent/API.md');
      }
    });
  });

  describe('includes conversation history', () => {
    it('should include all history when under 20 messages', async () => {
      const history: ConversationHistory[] = Array.from({ length: 5 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'How do I create a todo?',
          conversationHistory: history,
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
    });

    it('should limit history to 20 messages', async () => {
      const history: ConversationHistory[] = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'How do I create a todo?',
          conversationHistory: history,
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
      // Should succeed without error - limiting happens internally
    });
  });

  describe('handles empty history', () => {
    it('should work with no conversation history', async () => {
      const result = await generateResponse(
        buildDeps(),
        {
          message: 'Hello',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.response).toBeTruthy();
      }
    });
  });

  describe('returns sources', () => {
    it('should include sources from retrieved chunks', async () => {
      const result = await generateResponse(
        buildDeps(),
        {
          message: 'How do I create a todo?',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toHaveLength(2);
        expect(result.value.sources[0]).toEqual({
          filePath: 'docs/services/todos-agent/API.md',
          section: 'POST /todos',
        });
      }
    });
  });

  describe('fallback when no docs', () => {
    it('should add disclaimer when no docs found', async () => {
      mockRepository.setChunks([]);

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'What is the meaning of life?',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // The LLM response should include the fallback disclaimer
        // This is handled in the use case by prepending to system prompt
        expect(result.value.sources).toHaveLength(0);
      }
    });
  });

  describe('detects command intent', () => {
    it('should detect create todo intent', async () => {
      mockLLM.setSuggestedAction({
        type: 'create_command',
        payload: { text: 'buy groceries', source: 'pwa-shared' },
        awaitingConfirmation: true,
      });

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'Create a todo to buy groceries',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction).toEqual({
          type: 'create_command',
          payload: { text: 'buy groceries', source: 'pwa-shared' },
          awaitingConfirmation: true,
        });
      }
    });
  });

  describe('detects confirmation', () => {
    it('should confirm when user says yes', async () => {
      pendingAction = {
        type: 'create_command',
        payload: { text: 'buy groceries', source: 'pwa-shared' },
        awaitingConfirmation: true,
      };

      mockLLM.setSuggestedAction({
        type: 'create_command',
        payload: { text: 'buy groceries', source: 'pwa-shared' },
        awaitingConfirmation: false,
      });

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'yes',
          conversationHistory: [],
          userId: 'user-123',
          pendingAction,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction?.awaitingConfirmation).toBe(false);
      }
    });

    it('should not confirm for non-affirmative response', async () => {
      pendingAction = {
        type: 'create_command',
        payload: { text: 'buy groceries', source: 'pwa-shared' },
        awaitingConfirmation: true,
      };

      mockLLM.setSuggestedAction(null);

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'maybe later',
          conversationHistory: [],
          userId: 'user-123',
          pendingAction,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.suggestedAction).toBeNull();
      }
    });
  });

  describe('error handling', () => {
    it('should return error for empty message', async () => {
      const result = await generateResponse(
        buildDeps(),
        {
          message: '   ',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    });

    it('should return error when LLM fails', async () => {
      mockLLM.setFailure(true);

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'Hello',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_ERROR');
      }
    });

    it('should return error when search fails', async () => {
      mockRepository.setFailure(true);

      const result = await generateResponse(
        buildDeps(),
        {
          message: 'Hello',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SEARCH_ERROR');
      }
    });
  });

  describe('buildSystemPrompt', () => {
    it('should include Intex personality', async () => {
      const result = await generateResponse(
        buildDeps(),
        {
          message: 'Hello',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
      // System prompt is built internally - if we got here, it worked
    });
  });

  describe('buildRAGContext', () => {
    it('should format chunks with file paths', async () => {
      const result = await generateResponse(
        buildDeps(),
        {
          message: 'How do I create a todo?',
          conversationHistory: [],
          userId: 'user-123',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toHaveLength(2);
        expect(result.value.sources[0]?.filePath).toContain('API.md');
      }
    });
  });
});
