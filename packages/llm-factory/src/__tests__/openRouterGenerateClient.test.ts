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

vi.mock('@intexuraos/infra-openrouter', () => ({
  createOpenRouterClient: vi.fn(() => ({
    generate: mockOrGenerate,
    generateChat: mockOrGenerateChat,
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

  it('returns an object with a generate method', () => {
    const client = createOpenRouterGenerateClient(baseConfig);
    expect(client.generate).toBeDefined();
    expect(typeof client.generate).toBe('function');
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

  it('forwards cache-aware chat messages to the underlying OpenRouter client', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Transcript follows:' },
          {
            type: 'text' as const,
            text: 'Stable transcript',
            cache_control: { type: 'ephemeral' as const },
          },
        ],
      },
      { role: 'user' as const, content: 'What does this show?' },
    ];
    const expectedResult = {
      content: 'It shows a stable transcript.',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        costUsd: 0.002,
        cachedTokens: 80,
        cacheWriteTokens: 20,
      },
    };
    mockOrGenerateChat.mockResolvedValue(ok(expectedResult));

    const client = createOpenRouterGenerateClient(baseConfig);
    expect(client.generateChat).toBeDefined();
    const generateChat = client.generateChat;
    if (generateChat === undefined) {
      throw new Error('OpenRouter generateChat missing');
    }
    const result = await generateChat(messages, {
      promptType: 'whatsapp-conversation-assistant',
      sessionId: 'whatsapp_conv_session_123',
      correlation: { sessionId: 'session-123' },
    });

    expect(mockOrGenerateChat).toHaveBeenCalledWith(messages, {
      promptType: 'whatsapp-conversation-assistant',
      sessionId: 'whatsapp_conv_session_123',
      correlation: { sessionId: 'session-123' },
    });
    expect(result).toEqual(ok(expectedResult));
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
});
