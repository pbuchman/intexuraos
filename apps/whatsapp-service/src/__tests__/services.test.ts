import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@intexuraos/common-core';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';

const mocks = vi.hoisted(() => ({
  createUserServiceClient: vi.fn(),
  getApiKeys: vi.fn(),
  createLlmClient: vi.fn(),
}));

vi.mock('@intexuraos/internal-clients', () => ({
  createUserServiceClient: mocks.createUserServiceClient,
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: mocks.createLlmClient,
}));

const { createConversationAssistantLlmClientFactory } = await import('../services.js');

describe('whatsapp-service service wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeys.mockResolvedValue(ok({ openrouter: 'user-openrouter-key' }));
    mocks.createUserServiceClient.mockReturnValue({ getApiKeys: mocks.getApiKeys });
    mocks.createLlmClient.mockReturnValue({
      generate: vi.fn(),
      generateChat: vi.fn(),
      generateChatStream: vi.fn(),
    });
  });

  it('creates Conversation Assistant LLM clients with the user OpenRouter key only', async () => {
    const factory = createConversationAssistantLlmClientFactory({
      mediaBucket: 'bucket',
      gcpProjectId: 'project',
      mediaCleanupTopic: 'cleanup',
      audioStoredTopic: 'audio',
      intexMessageIngestTopic: 'intex',
      whatsappAccessToken: 'whatsapp-token',
      whatsappPhoneNumberId: 'phone-id',
      webAgentUrl: 'https://web-agent.test',
      internalAuthToken: 'internal-token',
      llmUsageServiceUrl: 'https://llm-usage.test',
      userServiceUrl: 'https://user-service.test',
      conversationAssistantModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
      matrixOutboundAdapterBaseUrl: 'https://matrix-adapter.test',
      matrixOutboundAdapterAuthToken: 'matrix-adapter-token',
    });

    const result = await factory.createLlmClientForUser(
      'user-123',
      'or:anthropic/claude-sonnet-5'
    );

    expect(result.ok).toBe(true);
    expect(mocks.createUserServiceClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://user-service.test',
        internalAuthToken: 'internal-token',
      })
    );
    expect(mocks.getApiKeys).toHaveBeenCalledWith('user-123');
    expect(mocks.createLlmClient).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'user-openrouter-key',
        model: 'or:anthropic/claude-sonnet-5',
        userId: 'user-123',
        ownerType: 'user',
      })
    );
    expect(JSON.stringify(mocks.createLlmClient.mock.calls)).not.toContain('poison-app-key');
  });
});
