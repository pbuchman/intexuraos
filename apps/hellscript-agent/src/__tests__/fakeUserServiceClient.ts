import type { UserServiceClient, DecryptedApiKeys, OAuthTokenResult, OAuthProvider, UserServiceError } from '@intexuraos/internal-clients';
import type { Result } from '@intexuraos/common-core';
import type { LlmGenerateClient, GenerateResult } from '@intexuraos/llm-factory';
import type { LLMError, LlmProvider } from '@intexuraos/llm-contract';

type GenerateResponse =
  | { ok: true; value: GenerateResult }
  | { ok: false; error: LLMError };

/**
 * A controllable fake LlmGenerateClient using a response queue.
 *
 * Tests enqueue responses via:
 *  - enqueueIntentJson(json)      → next call returns that intent as JSON
 *  - enqueueDraftContent(text)    → next call returns that content string
 *  - enqueueError(err)            → next call returns a failure result
 *
 * After the queue is exhausted, calls return a default append_thought intent.
 */
export class FakeLlmGenerateClient implements LlmGenerateClient {
  private queue: GenerateResponse[] = [];

  private static makeResult(content: string): GenerateResult {
    return {
      content,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
    };
  }

  enqueueIntentJson(intent: { kind: string; payload: Record<string, unknown>; fallbackReason?: string }): void {
    this.queue.push({ ok: true, value: FakeLlmGenerateClient.makeResult(JSON.stringify(intent)) });
  }

  enqueueDraftContent(content: string): void {
    this.queue.push({ ok: true, value: FakeLlmGenerateClient.makeResult(content) });
  }

  enqueueError(error: LLMError): void {
    this.queue.push({ ok: false, error });
  }

  async generate(_prompt: string): Promise<Result<GenerateResult, LLMError>> {
    const next = this.queue.shift();
    if (next !== undefined) {
      return next;
    }
    // Default: return append_thought intent JSON
    return {
      ok: true,
      value: FakeLlmGenerateClient.makeResult(
        JSON.stringify({ kind: 'append_thought', payload: { text: 'default' } })
      ),
    };
  }
}

export class FakeUserServiceClient implements UserServiceClient {
  private fakeLlmClient: FakeLlmGenerateClient;
  private getLlmClientError: UserServiceError | null = null;

  constructor(fakeLlmClient: FakeLlmGenerateClient) {
    this.fakeLlmClient = fakeLlmClient;
  }

  getLlmGenerateClient(): FakeLlmGenerateClient {
    return this.fakeLlmClient;
  }

  simulateGetLlmClientError(error: UserServiceError): void {
    this.getLlmClientError = error;
  }

  async getLlmClient(_userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
    if (this.getLlmClientError !== null) {
      const error = this.getLlmClientError;
      this.getLlmClientError = null;
      return { ok: false, error };
    }
    return { ok: true, value: this.fakeLlmClient };
  }

  async getApiKeys(_userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
    return { ok: true, value: {} };
  }

  async reportLlmSuccess(_userId: string, _provider: LlmProvider): Promise<void> {
    // no-op
  }

  async getOAuthToken(
    _userId: string,
    _provider: OAuthProvider
  ): Promise<Result<OAuthTokenResult, UserServiceError>> {
    return {
      ok: false,
      error: { code: 'OAUTH_NOT_CONFIGURED', message: 'Not configured in fake' },
    };
  }

  async resolveGitHubUsername(
    _gitHubUsername: string
  ): Promise<Result<{ userId: string } | null, UserServiceError>> {
    return { ok: true, value: null };
  }

  async getUserTimezone(_userId: string): Promise<string | undefined> {
    return undefined;
  }
}
