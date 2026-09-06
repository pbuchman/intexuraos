import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';

const mocks = vi.hoisted(() => ({
  storage: vi.fn(function StorageMock() {
    return { bucket: vi.fn() };
  }),
}));

vi.mock('@google-cloud/storage', () => ({ Storage: mocks.storage }));

const { buildServer } = await import('../server.js');
const { getServices, resetServices } = await import('../services.js');

const testConfig: Config = {
  verifyToken: 'test-verify-token-12345',
  appSecret: 'test-app-secret-67890',
  accessToken: 'test-access-token',
  allowedWabaIds: ['102290129340398'],
  allowedPhoneNumberIds: ['123456789012345'],
  mediaBucket: 'test-media-bucket',
  googleApplicationCredentialsFile: '/safe/runtime-sa-key.json',
  mediaCleanupTopic: 'test-media-cleanup',
  mediaCleanupSubscription: 'test-media-cleanup-sub',
  intexMessageIngestTopic: 'test-intex-message-ingest',
  audioStoredTopic: 'test-audio-stored',
  gcpProjectId: 'test-project',
  webAgentUrl: 'https://web-agent.example.com',
  internalAuthToken: 'test-internal-auth-token',
  llmUsageServiceUrl: 'http://llm-usage.test',
  userServiceUrl: 'http://user-service.test',
  platformOpenRouterApiKey: 'platform-openrouter-key',
  messageDigestServiceUrl: 'http://message-digest-service.test',
  conversationAssistantModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  port: 8080,
  host: '0.0.0.0',
  matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
};

describe('whatsapp-service server composition', () => {
  beforeEach(() => {
    resetServices();
    vi.clearAllMocks();
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
  });

  afterEach(() => {
    resetServices();
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
  });

  it('passes the validated runtime credential to GCS storage', async () => {
    const app = await buildServer(testConfig);
    getServices();

    expect(mocks.storage).toHaveBeenCalledWith({
      projectId: 'test-project',
      keyFilename: '/safe/runtime-sa-key.json',
    });

    await app.close();
  });
});
