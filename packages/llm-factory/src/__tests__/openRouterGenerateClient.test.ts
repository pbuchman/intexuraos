import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink = new FakeUsageSink();

const mockOrGenerate = vi.fn();
const mockOrGenerateChat = vi.fn();
const mockOrGenerateChatStream = vi.fn();

vi.mock('@intexuraos/infra-openrouter', () => ({
  createOpenRouterClient: vi.fn(() => ({
    generate: mockOrGenerate,
    generateChat: mockOrGenerateChat,
    generateChatStream: mockOrGenerateChatStream,
  })),
}));

const { createOpenRouterGenerateClient } = await import('../openRouterGenerateClient.js');

const baseConfig = {
  apiKey: 'test-key',
  model: 'or:google/gemma-4-31b-it:free' as unknown as import('@intexuraos/llm-contract').LLMModel,
  userId: 'user-123',
  logger: mockLogger,
  usageSink: mockUsageSink,
};

describe('createOpenRouterGenerateClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an object with a generate method', async () => {
    const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
    const client = createOpenRouterGenerateClient(baseConfig);
    expect(client.generate).toBeDefined();
    expect(typeof client.generate).toBe('function');
    expect(client.generateChat).toBeDefined();
    expect(typeof client.generateChat).toBe('function');
    expect(client.generateChatStream).toBeDefined();
    expect(typeof client.generateChatStream).toBe('function');
    expect(createOpenRouterClient).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'google/gemma-4-31b-it:free',
        evidenceModelId: 'or:google/gemma-4-31b-it:free',
      })
    );
  });

  it('satisfies the LlmGenerateClient interface by generating successfully', async () => {
    const expectedResult = {
      content: 'Hello from OpenRouter',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
    };
    mockOrGenerate.mockResolvedValue(ok(expectedResult));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('Say hello', { promptType: 'test-prompt' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expectedResult);
    }
  });

  it('forwards per-call correlation to the underlying OpenRouter client', async () => {
    mockOrGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    const client = createOpenRouterGenerateClient(baseConfig);
    await client.generate('hi', {
      promptType: 'test-prompt',
      correlation: { researchId: 'r-1' },
    });

    expect(mockOrGenerate).toHaveBeenCalledWith('hi', {
      promptType: 'test-prompt',
      correlation: { researchId: 'r-1' },
    });
  });

  it('forwards chat messages and options to the underlying OpenRouter client', async () => {
    const expectedResult = {
      content: 'Chat reply',
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        costUsd: 0.001,
        cachedTokens: 9,
        cacheWriteTokens: 3,
      },
    };
    mockOrGenerateChat.mockResolvedValue(ok(expectedResult));

    const client = createOpenRouterGenerateClient(baseConfig);
    const messages = [
      {
        role: 'system' as const,
        content: [{ type: 'text' as const, text: 'Use the transcript only.' }],
      },
      {
        role: 'user' as const,
        content: 'What happened?',
      },
    ];

    const generateChat = client.generateChat;
    expect(generateChat).toBeDefined();
    if (generateChat === undefined) {
      throw new Error('generateChat should be defined for OpenRouter clients');
    }

    const result = await generateChat(messages, {
      promptType: 'whatsapp-conversation-assistant',
      sessionId: 'session-123',
      temperature: 0.1,
      responseFormat: { type: 'text' },
      correlation: { sessionId: 'session-123' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expectedResult);
    }

    expect(mockOrGenerateChat).toHaveBeenCalledWith(messages, {
      promptType: 'whatsapp-conversation-assistant',
      sessionId: 'session-123',
      temperature: 0.1,
      responseFormat: { type: 'text' },
      correlation: { sessionId: 'session-123' },
    });
  });

  it('forwards streaming chat messages, options, and event callback to OpenRouter', async () => {
    const expectedResult = {
      content: 'Stream reply',
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        costUsd: 0.001,
      },
    };
    mockOrGenerateChatStream.mockResolvedValue(ok(expectedResult));

    const client = createOpenRouterGenerateClient(baseConfig);
    const messages = [{ role: 'user' as const, content: 'What happened?' }];
    const onEvent = vi.fn();

    const generateChatStream = client.generateChatStream;
    expect(generateChatStream).toBeDefined();
    if (generateChatStream === undefined) {
      throw new Error('generateChatStream should be defined for OpenRouter clients');
    }

    const result = await generateChatStream(
      messages,
      {
        promptType: 'whatsapp-conversation-assistant',
        sessionId: 'session-123',
        temperature: 0.1,
        reasoning: { enabled: true },
        correlation: { sessionId: 'session-123' },
      },
      onEvent
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expectedResult);
    }
    expect(mockOrGenerateChatStream).toHaveBeenCalledWith(
      messages,
      {
        promptType: 'whatsapp-conversation-assistant',
        sessionId: 'session-123',
        temperature: 0.1,
        reasoning: { enabled: true },
        correlation: { sessionId: 'session-123' },
      },
      onEvent
    );
  });

  it('strips the or: prefix before passing model to createOpenRouterClient', async () => {
    const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
    mockOrGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    createOpenRouterGenerateClient(baseConfig);

    expect(createOpenRouterClient).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'google/gemma-4-31b-it:free' })
    );
  });

  it('passes through non-or: prefixed model as-is to createOpenRouterClient', async () => {
    const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
    mockOrGenerate.mockResolvedValue(
      ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
    );

    createOpenRouterGenerateClient({
      ...baseConfig,
      model:
        'anthropic/claude-sonnet-4.6' as unknown as import('@intexuraos/llm-contract').LLMModel,
    });

    expect(createOpenRouterClient).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-sonnet-4.6' })
    );
  });

  it('passes through errors from OpenRouter generate unchanged', async () => {
    mockOrGenerate.mockResolvedValue(err({ code: 'INVALID_KEY', message: 'Bad API key' }));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('test prompt', { promptType: 'test-prompt' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_KEY');
      expect(result.error.message).toBe('Bad API key');
    }
  });

  it('passes through RATE_LIMITED errors from OpenRouter unchanged', async () => {
    mockOrGenerate.mockResolvedValue(err({ code: 'RATE_LIMITED', message: 'Too many requests' }));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('test prompt', { promptType: 'test-prompt' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED');
      expect(result.error.message).toBe('Too many requests');
    }
  });

  it('passes through TIMEOUT errors from OpenRouter unchanged', async () => {
    mockOrGenerate.mockResolvedValue(err({ code: 'TIMEOUT', message: 'Request timed out' }));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('test prompt', { promptType: 'test-prompt' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TIMEOUT');
    }
  });

  it('passes through OVERLOADED errors from OpenRouter unchanged', async () => {
    mockOrGenerate.mockResolvedValue(err({ code: 'OVERLOADED', message: 'Server overloaded' }));

    const client = createOpenRouterGenerateClient(baseConfig);
    const result = await client.generate('test prompt', { promptType: 'test-prompt' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('OVERLOADED');
    }
  });

  describe('ownerType propagation', () => {
    it('forwards ownerType to createOpenRouterClient when set to user', async () => {
      const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
      mockOrGenerate.mockResolvedValue(
        ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
      );

      createOpenRouterGenerateClient({ ...baseConfig, ownerType: 'user' });

      expect(createOpenRouterClient).toHaveBeenCalledWith(
        expect.objectContaining({ ownerType: 'user' })
      );
    });

    it('omits ownerType from createOpenRouterClient call when not configured', async () => {
      const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');
      mockOrGenerate.mockResolvedValue(
        ok({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } })
      );

      createOpenRouterGenerateClient(baseConfig);

      const callArg = vi.mocked(createOpenRouterClient).mock.calls[0]?.[0] as unknown as Record<
        string,
        unknown
      >;
      expect(callArg?.['ownerType']).toBeUndefined();
    });
  });

  it('forwards the bounded request policy to the OpenRouter client', async () => {
    const { createOpenRouterClient } = await import('@intexuraos/infra-openrouter');

    createOpenRouterGenerateClient({
      ...baseConfig,
      timeoutMs: 45_000,
      maxAttempts: 2,
      deadlineAtMs: 123_456,
    });

    expect(createOpenRouterClient).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 45_000, maxAttempts: 2, deadlineAtMs: 123_456 })
    );
  });
});
