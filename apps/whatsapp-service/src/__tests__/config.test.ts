/**
 * Tests for config validation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('config validation', () => {
  let savedVerify: string | undefined;
  let savedSecret: string | undefined;
  let savedAccess: string | undefined;
  let savedWaba: string | undefined;
  let savedPhone: string | undefined;
  let savedIntexMessageIngestTopic: string | undefined;
  let savedAudioStoredTopic: string | undefined;
  let savedLlmUsageServiceUrl: string | undefined;
  let savedUserServiceUrl: string | undefined;
  let savedMessageDigestServiceUrl: string | undefined;
  let savedMatrixOutboundAdapterUrl: string | undefined;
  let savedMatrixOutboundAdapterAuthToken: string | undefined;
  let savedMatrixOutboundCfAccessClientId: string | undefined;
  let savedMatrixOutboundCfAccessClientSecret: string | undefined;
  let savedOpenRouterAppApiKey: string | undefined;
  let savedConversationAssistantModel: string | undefined;

  beforeEach(() => {
    savedVerify = process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    savedSecret = process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    savedAccess = process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    savedWaba = process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    savedPhone = process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
    savedIntexMessageIngestTopic =
      process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'];
    savedAudioStoredTopic = process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'];
    savedLlmUsageServiceUrl = process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
    savedUserServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'];
    savedMessageDigestServiceUrl = process.env['INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL'];
    process.env['INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL'] =
      'http://message-digest-service.test';
    savedMatrixOutboundAdapterUrl = process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'];
    savedMatrixOutboundAdapterAuthToken =
      process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'];
    savedMatrixOutboundCfAccessClientId =
      process.env['INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_ID'];
    savedMatrixOutboundCfAccessClientSecret =
      process.env['INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_SECRET'];
    savedOpenRouterAppApiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
    process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'platform-openrouter-key';
    savedConversationAssistantModel =
      process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'];
  });

  afterEach(() => {
    // Restore
    if (savedVerify !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = savedVerify;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    }
    if (savedSecret !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = savedSecret;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    }
    if (savedAccess !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = savedAccess;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    }
    if (savedWaba !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = savedWaba;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    }
    if (savedPhone !== undefined) {
      process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = savedPhone;
    } else {
      delete process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
    }
    if (savedIntexMessageIngestTopic !== undefined) {
      process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'] =
        savedIntexMessageIngestTopic;
    } else {
      delete process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'];
    }
    if (savedAudioStoredTopic !== undefined) {
      process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'] = savedAudioStoredTopic;
    } else {
      delete process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'];
    }
    if (savedLlmUsageServiceUrl !== undefined) {
      process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = savedLlmUsageServiceUrl;
    } else {
      delete process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
    }
    if (savedUserServiceUrl !== undefined) {
      process.env['INTEXURAOS_USER_SERVICE_URL'] = savedUserServiceUrl;
    } else {
      delete process.env['INTEXURAOS_USER_SERVICE_URL'];
    }
    if (savedMessageDigestServiceUrl !== undefined) {
      process.env['INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL'] = savedMessageDigestServiceUrl;
    } else {
      delete process.env['INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL'];
    }
    if (savedMatrixOutboundAdapterUrl !== undefined) {
      process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'] = savedMatrixOutboundAdapterUrl;
    } else {
      delete process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'];
    }
    if (savedMatrixOutboundAdapterAuthToken !== undefined) {
      process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'] =
        savedMatrixOutboundAdapterAuthToken;
    } else {
      delete process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'];
    }
    if (savedMatrixOutboundCfAccessClientId !== undefined) {
      process.env['INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_ID'] =
        savedMatrixOutboundCfAccessClientId;
    } else {
      delete process.env['INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_ID'];
    }
    if (savedMatrixOutboundCfAccessClientSecret !== undefined) {
      process.env['INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_SECRET'] =
        savedMatrixOutboundCfAccessClientSecret;
    } else {
      delete process.env['INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_SECRET'];
    }
    if (savedOpenRouterAppApiKey !== undefined) {
      process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = savedOpenRouterAppApiKey;
    } else {
      delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
    }
    if (savedConversationAssistantModel !== undefined) {
      process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'] =
        savedConversationAssistantModel;
    } else {
      delete process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'];
    }
  });

  it('validates required env vars', async () => {
    const { validateConfigEnv } = await import('../config.js');

    delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    delete process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
    delete process.env['INTEXURAOS_USER_SERVICE_URL'];
    delete process.env['INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL'];
    delete process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'];
    delete process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];

    const missing = validateConfigEnv();
    expect(missing).toContain('INTEXURAOS_WHATSAPP_VERIFY_TOKEN');
    expect(missing).toContain('INTEXURAOS_WHATSAPP_APP_SECRET');
    expect(missing).toContain('INTEXURAOS_WHATSAPP_WABA_ID');
    expect(missing).toContain('INTEXURAOS_LLM_USAGE_SERVICE_URL');
    expect(missing).toContain('INTEXURAOS_USER_SERVICE_URL');
    expect(missing).toContain('INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL');
    expect(missing).toContain('INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL');
    expect(missing).toContain('INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN');
    expect(missing).toContain('INTEXURAOS_OPENROUTER_APP_API_KEY');
    expect(missing).not.toContain('INTEXURAOS_CONVERSATION_ASSISTANT_MODEL');
    expect(missing).not.toContain('INTEXURAOS_PRIVATE_WHATSAPP_SOURCE_ACCOUNT_ID');
    expect(missing).not.toContain('INTEXURAOS_PRIVATE_WHATSAPP_OWNER_USER_ID');
  });

  it('adds Matrix corpus variables to the required environment set only when enabled', async () => {
    const { validateConfigEnv } = await import('../config.js');
    process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED'] = 'true';
    delete process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'];

    expect(validateConfigEnv()).toContain('INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID');

    delete process.env['INTEXURAOS_MATRIX_CORPUS_ENABLED'];
    delete process.env['INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID'];
  });

  it('requires Cloudflare service credentials only for the HTTPS production adapter', async () => {
    const { validateConfigEnv } = await import('../config.js');
    process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'] =
      'https://dev.intexuraos.cloud/api/matrix-outbound';
    process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'] = 'matrix-token';
    delete process.env['INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_ID'];
    delete process.env['INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_SECRET'];

    expect(validateConfigEnv()).toEqual(
      expect.arrayContaining([
        'INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_ID',
        'INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_SECRET',
      ])
    );

    process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'] = 'http://127.0.0.1:8099';
    expect(validateConfigEnv()).not.toEqual(
      expect.arrayContaining([
        'INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_ID',
        'INTEXURAOS_MATRIX_OUTBOUND_CF_ACCESS_CLIENT_SECRET',
      ])
    );
  });

  it('returns empty array when all required vars present', async () => {
    const { validateConfigEnv } = await import('../config.js');

    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'] = 'test';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'] = 'test';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'] = 'test';
    process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'] = 'test';
    process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'] = 'test';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-auth-token';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://llm-usage.test';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service.test';
    process.env['INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL'] =
      'http://message-digest-service.test';
    process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'] = 'http://matrix-adapter.test';
    process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'] = 'matrix-adapter-token';
    process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'platform-openrouter-key';
    process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'] =
      'or:minimax/minimax-m3';

    const missing = validateConfigEnv();
    expect(missing).toHaveLength(0);
  });

  it('treats empty string as missing', async () => {
    const { validateConfigEnv } = await import('../config.js');

    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = '';
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'] = 'test';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'] = 'test';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'] = 'test';
    process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'] = 'test';
    process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'] = 'test';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-auth-token';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://llm-usage.test';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service.test';
    process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL'] = 'http://matrix-adapter.test';
    process.env['INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN'] = 'matrix-adapter-token';
    process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'platform-openrouter-key';
    process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'] =
      'or:minimax/minimax-m3';

    const missing = validateConfigEnv();
    expect(missing).toContain('INTEXURAOS_WHATSAPP_VERIFY_TOKEN');
  });

  it('loadConfig throws when required vars are missing', async () => {
    const { loadConfig } = await import('../config.js');

    delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    delete process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    delete process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
    delete process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'];
    delete process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'];
    delete process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'];
    delete process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    delete process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
    delete process.env['INTEXURAOS_USER_SERVICE_URL'];

    expect(() => loadConfig()).toThrow();
  });

  it('loadConfig parses comma-separated IDs', async () => {
    const { loadConfig } = await import('../config.js');

    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = 'waba1,waba2';
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = '123,456,789';
    process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'] = 'test-bucket';
    process.env['GOOGLE_APPLICATION_CREDENTIALS'] = '/safe/runtime-sa-key.json';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'] = 'test-cleanup';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'] = 'test-cleanup-sub';
    process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'] = 'test-intex-message-ingest';
    process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'] = 'test-audio-stored';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-auth-token';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://llm-usage.test';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service.test';
    process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] = 'platform-openrouter-key';
    delete process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'];

    const config = loadConfig();
    expect(config.allowedWabaIds).toEqual(['waba1', 'waba2']);
    expect(config.allowedPhoneNumberIds).toEqual(['123', '456', '789']);
    expect(config.googleApplicationCredentialsFile).toBe('/safe/runtime-sa-key.json');
    expect(config.llmUsageServiceUrl).toBe('http://llm-usage.test');
    expect(config.userServiceUrl).toBe('http://user-service.test');
    expect(config.messageDigestServiceUrl).toBe('http://message-digest-service.test');
    expect(config.platformOpenRouterApiKey).toBe('platform-openrouter-key');
    expect(config.conversationAssistantModel).toBe('or:minimax/minimax-m3');
  });

  it('loadConfig defaults blank Conversation Assistant model env to MiniMax M3', async () => {
    const { loadConfig } = await import('../config.js');

    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = 'waba1';
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = '123';
    process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'] = 'test-bucket';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'] = 'test-cleanup';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'] = 'test-cleanup-sub';
    process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'] = 'test-intex-message-ingest';
    process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'] = 'test-audio-stored';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-auth-token';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://llm-usage.test';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service.test';
    process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'] = '   ';

    const config = loadConfig();
    expect(config.conversationAssistantModel).toBe('or:minimax/minimax-m3');
  });

  it('loadConfig rejects unsupported configured Conversation Assistant models', async () => {
    const { loadConfig } = await import('../config.js');

    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = 'waba1';
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = '123';
    process.env['INTEXURAOS_WHATSAPP_MEDIA_BUCKET'] = 'test-bucket';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'] = 'test-cleanup';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'] = 'test-cleanup-sub';
    process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'] = 'test-intex-message-ingest';
    process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'] = 'test-audio-stored';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-auth-token';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://llm-usage.test';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service.test';
    process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'] = 'or:unknown/model';

    expect(() => loadConfig()).toThrow('Unsupported Conversation Assistant model configured');
  });
});

describe('parseWhatsAppMatrixCorpusConfig', () => {
  const privateKey = JSON.stringify({
    kty: 'OKP',
    crv: 'Ed25519',
    kid: 'matrix-test-v1',
    x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });
  const enabledEnv = {
    INTEXURAOS_ENVIRONMENT: 'dev',
    INTEXURAOS_MATRIX_CORPUS_ENABLED: 'true',
    INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'home-dev',
    INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'home-dev',
    INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: 'synthetic-user',
    INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING: 'synthetic-room',
    INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING: 'synthetic-account',
    INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING: 'synthetic-sender',
    INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY: 'h'.repeat(32),
    INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION: 'matrix-test-v1',
    INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY: privateKey,
  } as const;

  it.each([undefined, '', '   ', 'false'])(
    'returns the closed disabled object for enable flag %s',
    async (enabled) => {
      const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

      expect(
        parseWhatsAppMatrixCorpusConfig({
          ...enabledEnv,
          INTEXURAOS_MATRIX_CORPUS_ENABLED: enabled,
        })
      ).toEqual({ enabled: false, runtimeAudience: 'disabled' });
    }
  );

  it('parses the complete Home Dev configuration without widening its shape', async () => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

    expect(parseWhatsAppMatrixCorpusConfig(enabledEnv)).toEqual({
      enabled: true,
      runtimeAudience: 'home-dev',
      evaluatorBindingHmacKey: 'h'.repeat(32),
      configuredEvaluatorUserId: 'synthetic-user',
      matrixRoomBinding: 'synthetic-room',
      whatsappAccountBinding: 'synthetic-account',
      whatsappSenderBinding: 'synthetic-sender',
      signingKeyVersion: 'matrix-test-v1',
      signingKeyMaterial: privateKey,
    });
  });

  it('parses the exact Hetzner production configuration', async () => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

    expect(
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_ENVIRONMENT: 'prod',
        INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'hetzner-prod',
        INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'hetzner-prod',
      })
    ).toMatchObject({ enabled: true, runtimeAudience: 'hetzner-prod' });
  });

  it('rejects a mixed production and Home Dev runtime tuple', async () => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

    expect(() =>
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_ENVIRONMENT: 'prod',
        INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME: 'home-dev',
        INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: 'hetzner-prod',
      })
    ).toThrow('INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME');
  });

  it('accepts a canonical Auth0 Firebase subject for the Home Dev evaluator', async () => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

    expect(
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: 'auth0|operator_1',
      })
    ).toMatchObject({
      enabled: true,
      configuredEvaluatorUserId: 'auth0|operator_1',
    });
  });

  it.each([
    'INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME',
    'INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE',
    'INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID',
    'INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING',
    'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING',
    'INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING',
    'INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_KEY_VERSION',
    'INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY',
  ] as const)('rejects enabled mode when %s is missing or blank', async (name) => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');
    const missing = { ...enabledEnv, [name]: '   ' };

    expect(() => parseWhatsAppMatrixCorpusConfig(missing)).toThrow(name);
  });

  it.each(['dev', 'prod', 'production', 'staging', 'unknown'])(
    'rejects feature audience %s',
    async (runtimeAudience) => {
      const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

      expect(() =>
        parseWhatsAppMatrixCorpusConfig({
          ...enabledEnv,
          INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE: runtimeAudience,
        })
      ).toThrow('INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE');
    }
  );

  it.each(['production', 'staging', 'unknown'])(
    'rejects unknown environment %s even with the Home Dev audience',
    async (environment) => {
      const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

      expect(() =>
        parseWhatsAppMatrixCorpusConfig({
          ...enabledEnv,
          INTEXURAOS_ENVIRONMENT: environment,
        })
      ).toThrow('INTEXURAOS_ENVIRONMENT');
    }
  );

  it.each([
    ['invalid JSON', 'not-json'],
    ['JSON array', '[]'],
    [
      'wrong key version',
      JSON.stringify({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'other-v1',
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ],
    [
      'public key instead of private key',
      JSON.stringify({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'matrix-test-v1',
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ],
    [
      'non-string public component',
      JSON.stringify({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'matrix-test-v1',
        x: 3,
        d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ],
    [
      'non-canonical private component',
      JSON.stringify({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'matrix-test-v1',
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        d: 'short',
      }),
    ],
  ])('rejects %s without echoing key material', async (_name, keyMaterial) => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

    expect(() =>
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY: keyMaterial,
      })
    ).toThrow('INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY');
    try {
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY: keyMaterial,
      });
    } catch (error) {
      expect(String(error)).not.toContain(keyMaterial);
      expect(String(error)).not.toContain('synthetic-user');
    }
  });

  it('rejects oversized and trim-changing sensitive values without echoing them', async () => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');
    const sensitive = ` ${'s'.repeat(513)}`;

    expect(() =>
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: sensitive,
      })
    ).toThrow('INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID');
    try {
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: sensitive,
      });
    } catch (error) {
      expect(String(error)).not.toContain(sensitive);
    }
  });

  it('rejects an evaluator identifier that cannot pass the route authority schema', async () => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

    expect(() =>
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID: 'unsafe/user',
      })
    ).toThrow('INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID');
  });

  it('rejects an unknown enable value rather than silently disabling', async () => {
    const { parseWhatsAppMatrixCorpusConfig } = await import('../config.js');

    expect(() =>
      parseWhatsAppMatrixCorpusConfig({
        ...enabledEnv,
        INTEXURAOS_MATRIX_CORPUS_ENABLED: 'yes',
      })
    ).toThrow('INTEXURAOS_MATRIX_CORPUS_ENABLED');
  });
});
