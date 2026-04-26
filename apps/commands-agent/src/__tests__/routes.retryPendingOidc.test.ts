/**
 * Verifies that the /internal/retry-pending route accepts a valid Google
 * OIDC bearer (after INT-1531). The verifier is mocked at module scope so the
 * route can take the scheduler-oidc strategy branch without a real JWKS server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const mockVerify = vi.hoisted(() => vi.fn());
vi.mock('@intexuraos/internal-clients', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@intexuraos/internal-clients');
  return {
    ...actual,
    createGoogleOidcVerifier: vi.fn(() => mockVerify),
  };
});

import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeCommandRepository,
  FakeActionsAgentClient,
  FakeClassifier,
  FakeUserServiceClient,
  FakeEventPublisher,
  createFakeServices,
} from './fakes.js';

describe('POST /internal/retry-pending — OIDC scheduler branch', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://example.test/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://example.test/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:test';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-auth-token';
    process.env['INTEXURAOS_SERVICE_URL'] = 'https://commands-agent.example';

    mockVerify.mockReset();
    const fakeUserServiceClient = new FakeUserServiceClient();
    fakeUserServiceClient.setApiKeys('user-1', { google: 'test-gemini-key' });
    setServices(
      createFakeServices({
        commandRepository: new FakeCommandRepository(),
        actionsAgentClient: new FakeActionsAgentClient(),
        classifier: new FakeClassifier(),
        userServiceClient: fakeUserServiceClient,
        eventPublisher: new FakeEventPublisher(),
      })
    );
  });

  afterEach(async () => {
    await app?.close();
    resetServices();
  });

  it('takes the scheduler-oidc strategy branch when verifier accepts the bearer (INT-1531)', async () => {
    mockVerify.mockResolvedValue({
      valid: true,
      subject: 'cloud-scheduler@proj.iam.gserviceaccount.com',
    });
    app = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/retry-pending',
      headers: { authorization: 'Bearer real-google-oidc-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith('Bearer real-google-oidc-token');
  });
});
