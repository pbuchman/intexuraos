import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';

const mocks = vi.hoisted(() => ({ createUserServiceClient: vi.fn() }));

vi.mock('@intexuraos/internal-clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@intexuraos/internal-clients')>()),
  createUserServiceClient: mocks.createUserServiceClient,
}));

const { initServices, resetServices } = await import('../services.js');

const config: Config = {
  port: 8119,
  gcpProjectId: 'test-project',
  authJwksUrl: 'https://auth.test/jwks',
  authIssuer: 'https://auth.test/',
  authAudience: 'test-audience',
  internalAuthToken: 'internal-token',
  userServiceUrl: 'https://user-service.test',
  messageDigestServiceUrl: 'https://message-digest.test',
  whatsappServiceUrl: 'https://whatsapp.test',
  llmUsageServiceUrl: 'https://llm-usage.test',
  openRouterAppApiKey: 'platform-openrouter-key',
  environment: 'test',
};

describe('Fishing service wiring', () => {
  beforeEach(() => {
    setFirestore(createFakeFirestore() as unknown as Parameters<typeof setFirestore>[0]);
    mocks.createUserServiceClient.mockReturnValue({});
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  it('passes the platform OpenRouter key to user-service for chat fallback', () => {
    initServices(config);

    expect(mocks.createUserServiceClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://user-service.test',
        platformOpenRouterApiKey: 'platform-openrouter-key',
      })
    );
  });
});
