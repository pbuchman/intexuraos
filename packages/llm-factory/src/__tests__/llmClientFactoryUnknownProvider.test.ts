/**
 * Standalone test that covers the `default` arm of the provider-dispatch switch
 * in `createLlmClient`. Reaching that branch requires `getProviderForModel` to
 * return a provider value that none of the case clauses handle (e.g. OpenRouter
 * for a static model — no static model maps to OpenRouter today, so the only
 * way to exercise the path is to mock the contract module). Lives in its own
 * file because vi.mock is hoisted per-file and must be set up before the
 * subject module is imported.
 */
import { describe, expect, it, vi } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { IntexuraOSError, type Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@intexuraos/llm-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/llm-contract')>();
  return {
    ...actual,
    // Force a static, valid model to report an OpenRouter provider so the
    // default arm of the provider switch in createLlmClient executes.
    getProviderForModel: vi.fn(() => actual.LlmProviders.OpenRouter),
  };
});

const { createLlmClient } = await import('../llmClientFactory.js');

describe('createLlmClient — default-arm coverage', () => {
  it('throws IntexuraOSError(INVALID_REQUEST) when getProviderForModel returns an unhandled provider', () => {
    let captured: unknown;
    try {
      createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.GPT4oMini, // valid static model — but mocked provider returns OpenRouter
        userId: 'user-123',
        logger: mockLogger,
        usageSink: new FakeUsageSink(),
      });
    } catch (e) {
      captured = e;
    }
    expect(captured).toBeInstanceOf(IntexuraOSError);
    const err = captured as IntexuraOSError;
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.message).toContain(LlmProviders.OpenRouter);
  });
});
