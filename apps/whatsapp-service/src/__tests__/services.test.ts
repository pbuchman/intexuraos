import { generateKeyPairSync } from 'node:crypto';

import { createFakeFirestore } from '@intexuraos/infra-firestore';
import { ok } from '@intexuraos/common-core';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createUserServiceClient: vi.fn(),
  getApiKeys: vi.fn(),
  createLlmClient: vi.fn(),
  turnRequestRepositoryOptions: [] as unknown[],
}));

vi.mock('@intexuraos/internal-clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@intexuraos/internal-clients')>()),
  createUserServiceClient: mocks.createUserServiceClient,
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: mocks.createLlmClient,
}));

vi.mock(
  '../infra/firestore/conversationAssistantTurnRequestRepository.js',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('../infra/firestore/conversationAssistantTurnRequestRepository.js')
      >();
    return {
      ...original,
      createConversationAssistantTurnRequestRepository(
        options?: unknown
      ): ReturnType<typeof original.createConversationAssistantTurnRequestRepository> {
        mocks.turnRequestRepositoryOptions.push(options);
        return original.createConversationAssistantTurnRequestRepository(
          options as Parameters<
            typeof original.createConversationAssistantTurnRequestRepository
          >[0]
        );
      },
    };
  }
);

const {
  composeWhatsAppMatrixCorpusFeature,
  createConversationAssistantLlmClientFactory,
  createWhatsAppMatrixCorpusRuntime,
  getServices,
  initServices,
  resetServices,
} = await import('../services.js');

describe('whatsapp-service service wiring', () => {
  beforeEach(() => {
    resetServices();
    vi.clearAllMocks();
    mocks.getApiKeys.mockResolvedValue(ok({ openrouter: 'user-openrouter-key' }));
    mocks.createUserServiceClient.mockReturnValue({ getApiKeys: mocks.getApiKeys });
    mocks.createLlmClient.mockReturnValue({
      generate: vi.fn(),
      generateChat: vi.fn(),
      generateChatStream: vi.fn(),
    });
  });

  afterEach(() => {
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
  });

  it('wires physical erasure and one shared content-free operational telemetry instance', () => {
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'project';
    initServices({
      mediaBucket: 'bucket',
      gcpProjectId: 'project',
      mediaCleanupTopic: 'cleanup',
      audioStoredTopic: 'audio',
      intexMessageIngestTopic: 'intex',
      webhookProcessTopic: 'process',
      whatsappAccessToken: 'whatsapp-token',
      whatsappPhoneNumberId: 'phone-id',
      webAgentUrl: 'https://web-agent.test',
      internalAuthToken: 'internal-token',
      llmUsageServiceUrl: 'https://llm-usage.test',
      userServiceUrl: 'https://user-service.test',
      conversationAssistantModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
      matrixOutboundAdapterBaseUrl: 'https://matrix-adapter.test',
      matrixOutboundAdapterAuthToken: 'matrix-adapter-token',
      intexAgentBaseUrl: 'https://intex-agent.test',
      matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
    });

    const services = getServices();

    expect(services.privateWhatsAppErasureRepository).toBeDefined();
    expect(services.privateWhatsAppErasurePublisher).toBe(services.eventPublisher);
    expect(services.conversationAssistantOperationalTelemetry).toBeDefined();
    expect(services.conversationAssistantContextAttachmentRepository).toBeDefined();
    expect(mocks.turnRequestRepositoryOptions).toContainEqual({
      telemetry: services.conversationAssistantOperationalTelemetry,
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
      intexAgentBaseUrl: 'https://intex-agent.test',
      matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
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

  it('does not construct any Matrix corpus dependency while the feature is disabled', () => {
    const createEnabled = vi.fn(() => ({ marker: 'must-not-exist' }));

    expect(
      composeWhatsAppMatrixCorpusFeature(
        { enabled: false, runtimeAudience: 'disabled' },
        createEnabled
      )
    ).toBeNull();
    expect(createEnabled).not.toHaveBeenCalled();
  });

  it('constructs the enabled Home Dev Matrix corpus runtime exactly once', () => {
    const runtime = { marker: 'home-dev-runtime' };
    const createEnabled = vi.fn(() => runtime);
    const config = {
      enabled: true as const,
      runtimeAudience: 'hetzner-prod' as const,
      evaluatorBindingHmacKey: 'h'.repeat(32),
      configuredEvaluatorUserId: 'synthetic-user',
      matrixRoomBinding: 'synthetic-room',
      whatsappAccountBinding: 'synthetic-account',
      whatsappSenderBinding: 'synthetic-sender',
      signingKeyVersion: 'matrix-test-v1',
      signingKeyMaterial: 'synthetic-private-jwk',
    };

    expect(composeWhatsAppMatrixCorpusFeature(config, createEnabled)).toBe(runtime);
    expect(createEnabled).toHaveBeenCalledTimes(1);
    expect(createEnabled).toHaveBeenCalledWith(config);
  });

  it('composes the production control plane without starting timers or making live calls', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const intexAgent = {
      getTurnTerminal: vi.fn(),
      getCurrentAcceptance: vi.fn(),
      getControlStatus: vi.fn(),
      postTerminalControl: vi.fn(),
    };
    const eventPublisher = { publishMatrixCorpusIngest: vi.fn() };
    const scheduler = { setInterval: vi.fn(), clearInterval: vi.fn() };
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const config = {
      enabled: true as const,
      runtimeAudience: 'hetzner-prod' as const,
      evaluatorBindingHmacKey: 'h'.repeat(32),
      configuredEvaluatorUserId: 'synthetic-user',
      matrixRoomBinding: 'synthetic-room',
      whatsappAccountBinding: 'synthetic-account',
      whatsappSenderBinding: 'synthetic-sender',
      signingKeyVersion: 'matrix-test-v1',
      signingKeyMaterial: 'injected-in-this-test',
    };

    const runtime = createWhatsAppMatrixCorpusRuntime({
      config,
      serviceConfig: {
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
        intexAgentBaseUrl: 'https://intex-agent.test',
        matrixCorpus: config,
      },
      eventPublisher: eventPublisher as never,
      dependencies: {
        firestore: createFakeFirestore() as never,
        intexAgent,
        privateKey,
        logger: logger as never,
        scheduler,
        now: () => '2026-07-20T10:00:00.000Z',
        workerNonce: 'synthetic-worker',
      },
    });

    expect(runtime.routes.gate).toMatchObject({
      enabled: true,
      runtimeAudience: 'hetzner-prod',
      evaluator: { userId: 'synthetic-user' },
    });
    expect(runtime.routes.gate.evaluator.matrixRoomBindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(scheduler.setInterval).not.toHaveBeenCalled();
    expect(intexAgent.getCurrentAcceptance).not.toHaveBeenCalled();
    expect(intexAgent.getControlStatus).not.toHaveBeenCalled();
    expect(intexAgent.postTerminalControl).not.toHaveBeenCalled();
    expect(eventPublisher.publishMatrixCorpusIngest).not.toHaveBeenCalled();
  });
});
