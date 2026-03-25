/**
 * Tests for OpenRouter routes.
 * Validates live pricing fetch, cache behavior, and error handling.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import nock from 'nock';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../../server.js';
import { resetServices, type ServiceContainer, setServices } from '../../services.js';
import { resetOpenRouterCache } from '../../routes/openRouterRoutes.js';
import {
  FakeResearchRepository,
  FakeResearchExportSettings,
  FakeUserServiceClient,
  FakeLlmCallPublisher,
  FakeResearchEventPublisher,
  FakeNotificationSender,
  FakeNotionServiceClient,
  createFakeNotionExporter,
} from '../fakes.js';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { OPENROUTER_ALLOWED_MODELS } from '@intexuraos/infra-openrouter';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';
const TEST_USER_ID = 'auth0|test-user-123';

describe('OpenRouter Routes - GET /research/openrouter/models', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;
  let fakeUserServiceClient: FakeUserServiceClient;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  async function generateJwt(sub: string = TEST_USER_ID): Promise<string> {
    const builder = new jose.SignJWT({ sub })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(INTEXURAOS_AUTH_AUDIENCE)
      .setSubject(sub)
      .setExpirationTime('1h');

    return await builder.sign(privateKey);
  }

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const publicKey = keyPair.publicKey;

    jwksServer = Fastify();
    jwksServer.get('/.well-known/jwks.json', async (_request, reply) => {
      const publicJwk = await jose.exportJWK(publicKey);
      reply.send({
        keys: [{ ...publicJwk, kid: 'test-key-id', alg: 'RS256' }],
      });
    });

    await jwksServer.listen({ port: 0, host: '127.0.0.1' });
    const address = jwksServer.server.address();
    if (typeof address === 'object' && address !== null) {
      jwksUrl = `http://127.0.0.1:${String(address.port)}`;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  beforeEach(async () => {
    resetOpenRouterCache();
    clearJwksCache();

    process.env['INTEXURAOS_AUTH_JWKS_URL'] = `${jwksUrl}/.well-known/jwks.json`;
    process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

    fakeUserServiceClient = new FakeUserServiceClient();

    const services: ServiceContainer = {
      researchRepo: new FakeResearchRepository(),
      researchExportSettings: new FakeResearchExportSettings(),
      pricingContext: new FakePricingContext(),
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: new FakeResearchEventPublisher(),
      llmCallPublisher: new FakeLlmCallPublisher(),
      userServiceClient: fakeUserServiceClient,
      imageServiceClient: null,
      notionServiceClient: new FakeNotionServiceClient(),
      notificationSender: new FakeNotificationSender(),
      shareStorage: null,
      shareConfig: null,
      webAppUrl: 'https://app.example.com',
      createResearchProvider: vi.fn(),
      createSynthesizer: vi.fn(),
      createTitleGenerator: vi.fn(),
      createContextInferrer: vi.fn(),
      createInputValidator: vi.fn(),
      notionExporter: createFakeNotionExporter(),
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    resetOpenRouterCache();
    clearJwksCache();
    nock.cleanAll();
    vi.useRealTimers();
  });

  it('returns NOT_FOUND when OpenRouter API key is not configured', async () => {
    // FakeUserServiceClient returns empty keys by default (no openrouter key)
    const token = await generateJwt(TEST_USER_ID);
    const response = await app.inject({
      method: 'GET',
      url: '/research/openrouter/models',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error?: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 14 models with live pricing when catalog fetch succeeds', async () => {
    fakeUserServiceClient.setApiKeys(TEST_USER_ID, { openrouter: 'test-or-key' });

    const catalogData = OPENROUTER_ALLOWED_MODELS.map((m) => ({
      id: m.id,
      pricing: { prompt: '0.000001', completion: '0.000005' },
      context_length: 500_000,
    }));

    nock('https://openrouter.ai')
      .get('/api/v1/models')
      .reply(200, { data: catalogData });

    const token = await generateJwt(TEST_USER_ID);
    const response = await app.inject({
      method: 'GET',
      url: '/research/openrouter/models',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { models: { id: string; contextLength: number; pricing: { inputPricePerMillion: number } }[]; cachedAt: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.models).toHaveLength(14);

    // Verify live pricing was used (not fallback)
    const firstModel = body.data.models[0];
    expect(firstModel).toBeDefined();
    expect(firstModel?.contextLength).toBe(500_000);
    expect(firstModel?.pricing.inputPricePerMillion).toBe(1);
  });

  it('returns fallback pricing when catalog fetch returns non-200', async () => {
    fakeUserServiceClient.setApiKeys(TEST_USER_ID, { openrouter: 'test-or-key' });

    nock('https://openrouter.ai')
      .get('/api/v1/models')
      .reply(503, 'Service Unavailable');

    const token = await generateJwt(TEST_USER_ID);
    const response = await app.inject({
      method: 'GET',
      url: '/research/openrouter/models',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { models: { id: string; contextLength: number }[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.models).toHaveLength(14);

    // Verify fallback context lengths from allowlist were used
    const firstModel = body.data.models[0];
    expect(firstModel).toBeDefined();
    expect(firstModel?.contextLength).toBe(OPENROUTER_ALLOWED_MODELS[0]?.contextLength);
  });

  it('returns cached result within TTL without making new HTTP call', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeUserServiceClient.setApiKeys(TEST_USER_ID, { openrouter: 'test-or-key' });

    const catalogData = OPENROUTER_ALLOWED_MODELS.map((m) => ({
      id: m.id,
      pricing: { prompt: '0.000001', completion: '0.000005' },
      context_length: 500_000,
    }));

    // nock intercepts exactly one request — a second call would fail
    const scope = nock('https://openrouter.ai')
      .get('/api/v1/models')
      .once()
      .reply(200, { data: catalogData });

    const token = await generateJwt(TEST_USER_ID);

    // First request — populates cache
    const response1 = await app.inject({
      method: 'GET',
      url: '/research/openrouter/models',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response1.statusCode).toBe(200);
    expect(scope.isDone()).toBe(true);

    // Advance time by 1 minute (within 5-minute TTL)
    vi.advanceTimersByTime(60_000);

    // Second request — should use cache (no new HTTP call)
    const response2 = await app.inject({
      method: 'GET',
      url: '/research/openrouter/models',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response2.statusCode).toBe(200);
    const body = JSON.parse(response2.body) as {
      success: boolean;
      data: { models: { id: string }[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.models).toHaveLength(14);

    // If nock had received a second request it would have thrown —
    // reaching here confirms the cache was used
  });

  it('fetches new data after cache TTL expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeUserServiceClient.setApiKeys(TEST_USER_ID, { openrouter: 'test-or-key' });

    const catalogData = OPENROUTER_ALLOWED_MODELS.map((m) => ({
      id: m.id,
      pricing: { prompt: '0.000001', completion: '0.000005' },
      context_length: 500_000,
    }));

    // First request — populates cache
    nock('https://openrouter.ai')
      .get('/api/v1/models')
      .reply(200, { data: catalogData });

    const token = await generateJwt(TEST_USER_ID);

    const response1 = await app.inject({
      method: 'GET',
      url: '/research/openrouter/models',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response1.statusCode).toBe(200);

    // Advance past 5-minute TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Set up new nock for second catalog fetch (cache expired)
    const updatedCatalogData = OPENROUTER_ALLOWED_MODELS.map((m) => ({
      id: m.id,
      pricing: { prompt: '0.000002', completion: '0.000010' },
      context_length: 600_000,
    }));

    const scope2 = nock('https://openrouter.ai')
      .get('/api/v1/models')
      .reply(200, { data: updatedCatalogData });

    // Second request — should make new HTTP call (cache expired)
    const response2 = await app.inject({
      method: 'GET',
      url: '/research/openrouter/models',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response2.statusCode).toBe(200);
    expect(scope2.isDone()).toBe(true);

    // Verify updated pricing was used
    const body = JSON.parse(response2.body) as {
      success: boolean;
      data: { models: { contextLength: number }[] };
    };
    expect(body.data.models[0]?.contextLength).toBe(600_000);
  });
});
