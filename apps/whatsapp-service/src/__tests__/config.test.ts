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
    savedOpenRouterAppApiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
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

    const missing = validateConfigEnv();
    expect(missing).toContain('INTEXURAOS_WHATSAPP_VERIFY_TOKEN');
    expect(missing).toContain('INTEXURAOS_WHATSAPP_APP_SECRET');
    expect(missing).toContain('INTEXURAOS_WHATSAPP_WABA_ID');
    expect(missing).toContain('INTEXURAOS_LLM_USAGE_SERVICE_URL');
    expect(missing).toContain('INTEXURAOS_USER_SERVICE_URL');
    expect(missing).not.toContain('INTEXURAOS_OPENROUTER_APP_API_KEY');
    expect(missing).not.toContain('INTEXURAOS_CONVERSATION_ASSISTANT_MODEL');
    expect(missing).not.toContain('INTEXURAOS_PRIVATE_WHATSAPP_SOURCE_ACCOUNT_ID');
    expect(missing).not.toContain('INTEXURAOS_PRIVATE_WHATSAPP_OWNER_USER_ID');
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
    delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
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
    delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
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
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC'] = 'test-cleanup';
    process.env['INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION'] = 'test-cleanup-sub';
    process.env['INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC'] = 'test-intex-message-ingest';
    process.env['INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC'] = 'test-audio-stored';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
    process.env['INTEXURAOS_WEB_AGENT_URL'] = 'https://web-agent.example.com';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-auth-token';
    process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://llm-usage.test';
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://user-service.test';
    delete process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'];
    delete process.env['INTEXURAOS_CONVERSATION_ASSISTANT_MODEL'];

    const config = loadConfig();
    expect(config.allowedWabaIds).toEqual(['waba1', 'waba2']);
    expect(config.allowedPhoneNumberIds).toEqual(['123', '456', '789']);
    expect(config.llmUsageServiceUrl).toBe('http://llm-usage.test');
    expect(config.userServiceUrl).toBe('http://user-service.test');
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
