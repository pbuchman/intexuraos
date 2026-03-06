/**
 * Fake implementations for testing.
 */
import { vi } from 'vitest';
import type { ServiceContainer } from '../services.js';
import { setServices, resetServices } from '../services.js';
import type {
  EmbeddingRepositoryPort,
  DocChunk,
  DocChunkWithScore,
  SuggestedAction,
} from '../domain/index.js';
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LLMResponse, LLMError } from '../domain/usecases/generateResponse.js';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { LLMError as LlmContractError } from '@intexuraos/llm-contract';
import type {
  UserServiceClient,
  DecryptedApiKeys as UserApiKeys,
  UserServiceError,
  OAuthProvider,
} from '@intexuraos/internal-clients';
import type { GuestRateLimiter } from '../infra/rateLimit/index.js';

/**
 * Fake embedding repository for testing.
 */
export class FakeEmbeddingRepository implements EmbeddingRepositoryPort {
  private chunks: Map<string, DocChunk> = new Map<string, DocChunk>();
  private searchResults: DocChunkWithScore[] = [];

  setChunks(chunks: DocChunk[]): void {
    this.chunks = new Map(chunks.map((c) => [c.id, c]));
  }

  setSearchResults(results: DocChunkWithScore[]): void {
    this.searchResults = results;
  }

  async findSimilar(
    _embedding: number[],
    _limit: number
  ): Promise<Result<DocChunkWithScore[], unknown>> {
    return {
      ok: true,
      value: this.searchResults,
    };
  }

  async findById(id: string): Promise<Result<DocChunk | null, unknown>> {
    return {
      ok: true,
      value: this.chunks.get(id) ?? null,
    };
  }
}

/**
 * Fake embedding client for testing.
 */
export class FakeEmbeddingClient {
  private mockEmbedding: number[] = new Array(1536).fill(0.1);
  private shouldFail = false;
  private failMessage = 'Embedding failed';

  setMockEmbedding(embedding: number[]): void {
    this.mockEmbedding = embedding;
  }

  setFailure(shouldFail: boolean, message = 'Embedding failed'): void {
    this.shouldFail = shouldFail;
    this.failMessage = message;
  }

  async embed(_text: string): Promise<Result<number[]>> {
    if (this.shouldFail) {
      return {
        ok: false,
        error: new Error(this.failMessage),
      };
    }
    return {
      ok: true,
      value: [...this.mockEmbedding],
    };
  }
}

/**
 * Fake LLM client for testing.
 */
export class FakeLLMClient {
  public response = 'Here is a response';
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
      conversationHistory?: { role: string; content: string }[];
    }
  ): Promise<Result<LLMResponse, LLMError>> {
    if (this.shouldFail) {
      return {
        ok: false,
        error: { code: 'LLM_ERROR', message: 'LLM failed' },
      };
    }
    const baseValue = {
      response: this.response,
    };
    if (this.suggestedAction !== null) {
      Object.assign(baseValue, { suggestedAction: this.suggestedAction });
    }
    return {
      ok: true,
      value: baseValue as LLMResponse,
    };
  }

  reset(): void {
    this.response = 'Here is a response';
    this.suggestedAction = null;
    this.shouldFail = false;
  }
}

/** Mock logger for testing. */
export const mockLogger: {
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
} = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/**
 * Fake LlmGenerateClient for testing.
 * This is the low-level client returned by userServiceClient.getLlmClient().
 */
export class FakeLlmGenerateClient implements LlmGenerateClient {
  public response = 'Here is a response';
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
    _prompt: string
  ): Promise<
    Result<
      { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } },
      LlmContractError
    >
  > {
    if (this.shouldFail) {
      return err({ code: 'API_ERROR', message: 'LLM failed' });
    }
    // Build response content, optionally with action annotation
    let content = this.response;
    if (this.suggestedAction !== null) {
      content += ` [ACTION: ${this.suggestedAction.type} ${JSON.stringify(this.suggestedAction.payload)}]`;
    }
    return ok({
      content,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        costUsd: 0.0001,
      },
    });
  }

  reset(): void {
    this.response = 'Here is a response';
    this.suggestedAction = null;
    this.shouldFail = false;
  }
}

/**
 * Fake UserServiceClient for testing.
 * Returns a FakeLlmGenerateClient when getLlmClient() is called.
 */
export class FakeUserServiceClient implements UserServiceClient {
  private llmGenerateClient: FakeLlmGenerateClient;
  private failNext = false;

  constructor(llmGenerateClient: FakeLlmGenerateClient) {
    this.llmGenerateClient = llmGenerateClient;
  }

  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }

  async getApiKeys(_userId: string): Promise<Result<UserApiKeys, UserServiceError>> {
    return ok({});
  }

  async getLlmClient(_userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
    if (this.failNext) {
      this.failNext = false;
      return err({ code: 'NETWORK_ERROR', message: 'Simulated network error' });
    }
    return ok(this.llmGenerateClient);
  }

  async reportLlmSuccess(
    _userId: string,
    _provider: import('@intexuraos/llm-contract').LlmProvider
  ): Promise<void> {
    // Best effort - silently ignore in tests
  }

  async getOAuthToken(
    _userId: string,
    _provider: OAuthProvider
  ): Promise<Result<{ accessToken: string; email: string }, UserServiceError>> {
    return err({
      code: 'CONNECTION_NOT_FOUND',
      message: 'OAuth not configured in fake',
    });
  }

  async resolveGitHubUsername(): Promise<Result<{ userId: string } | null, UserServiceError>> {
    return ok(null);
  }
}

/**
 * Fake GuestRateLimiter for testing.
 */
export class FakeGuestRateLimiter implements GuestRateLimiter {
  private shouldBlock = false;
  private blockMessage = 'Rate limit exceeded';

  setBlock(block: boolean, message = 'Rate limit exceeded'): void {
    this.shouldBlock = block;
    this.blockMessage = message;
  }

  check(_sessionId: string): Result<void, { message: string }> {
    if (this.shouldBlock) {
      return err({ message: this.blockMessage });
    }
    return ok(undefined);
  }

  record(_sessionId: string): void {
    // No-op for tests
  }

  getUsage(_sessionId: string): { count: number; remaining: number } | null {
    return { count: 0, remaining: 100 };
  }
}

/**
 * Set up fake services for testing.
 * Returns both the ServiceContainer and the fake clients for test control.
 */
export function setupFakeServices(): ServiceContainer & {
  llmGenerateClient: FakeLlmGenerateClient;
  fakeUserServiceClient: FakeUserServiceClient;
  fakeGuestRateLimiter: FakeGuestRateLimiter;
  guestLlmClient: FakeLlmGenerateClient;
} {
  const llmGenerateClient = new FakeLlmGenerateClient();
  const fakeUserServiceClient = new FakeUserServiceClient(llmGenerateClient);
  const fakeGuestRateLimiter = new FakeGuestRateLimiter();
  const guestLlmClient = new FakeLlmGenerateClient();

  const services: ServiceContainer = {
    generateId: () => `test-${crypto.randomUUID()}`,
    embeddingRepository: new FakeEmbeddingRepository(),
    embeddingClient: new FakeEmbeddingClient(),
    userServiceClient: fakeUserServiceClient,
    logger: mockLogger as unknown as import('pino').Logger,
    guestRateLimiter: fakeGuestRateLimiter,
    guestLlmClient,
  };
  setServices(services);
  return { ...services, llmGenerateClient, fakeUserServiceClient, fakeGuestRateLimiter, guestLlmClient };
}

/**
 * Reset services after testing.
 */
export function resetFakeServices(): void {
  resetServices();
}
