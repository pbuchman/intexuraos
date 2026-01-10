/**
 * Tests for research routes.
 * Uses real JWT signing with jose library for proper authentication.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { err, ok } from '@intexuraos/common-core';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { buildServer } from '../server.js';
import { resetServices, type ServiceContainer, setServices } from '../services.js';
import {
  createFakeContextInferrer,
  createFakeInputValidator,
  createFailingSynthesizer,
  createFakeLlmResearchProvider,
  createFailingLlmResearchProvider,
  createFakeSynthesizer,
  createFakeTitleGenerator,
  FakeLlmCallPublisher,
  FakeNotificationSender,
  FakePricingRepository,
  FakeResearchEventPublisher,
  FakeResearchRepository,
  FakeUserServiceClient,
} from './fakes.js';
import type { Research } from '../domain/research/index.js';
import type { InputValidationProvider } from '../infra/llm/InputValidationAdapter.js';

const fakePricingContext = new FakePricingContext();

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';
const TEST_USER_ID = 'auth0|test-user-123';
const OTHER_USER_ID = 'auth0|other-user-456';

function createTestResearch(overrides?: Partial<Research>): Research {
  return {
    id: 'test-research-123',
    userId: TEST_USER_ID,
    title: 'Test Research',
    prompt: 'Test prompt',
    selectedModels: [LlmModels.Gemini25Pro],
    synthesisModel: LlmModels.Gemini25Pro,
    status: 'pending',
    llmResults: [
      {
        provider: LlmProviders.Google,
        model: 'gemini-2.0-flash-exp',
        status: 'pending',
      },
    ],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Research Routes - Unauthenticated', () => {
  let app: FastifyInstance;
  let fakeRepo: FakeResearchRepository;

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

    fakeRepo = new FakeResearchRepository();
    const fakeUserServiceClient = new FakeUserServiceClient();
    const fakeResearchEventPublisher = new FakeResearchEventPublisher();
    const fakeNotificationSender = new FakeNotificationSender();
    const fakeLlmCallPublisher = new FakeLlmCallPublisher();
    const services: ServiceContainer = {
      researchRepo: fakeRepo,
      pricingRepo: new FakePricingRepository(),
      pricingContext: fakePricingContext,
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: fakeResearchEventPublisher,
      llmCallPublisher: fakeLlmCallPublisher,
      userServiceClient: fakeUserServiceClient,
      imageServiceClient: null,
      notificationSender: fakeNotificationSender,
      shareStorage: null,
      shareConfig: null,
      webAppUrl: 'https://app.example.com',
      createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
      createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
      createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
      createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
      createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  it('POST /research returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/research',
      payload: {
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /research returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/research',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /research/:id returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/research/test-id',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /research/draft returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/research/draft',
      payload: {
        prompt: 'Test prompt',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('PATCH /research/:id returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/research/test-id',
      payload: {
        prompt: 'Updated prompt',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('DELETE /research/:id returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/research/test-id',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /research/:id/confirm returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/research/test-id/confirm',
      payload: { action: 'proceed' },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /research/:id/retry returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/research/test-id/retry',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('Research Routes - Authenticated', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  let fakeRepo: FakeResearchRepository;
  let fakeUserServiceClient: FakeUserServiceClient;
  let fakeResearchEventPublisher: FakeResearchEventPublisher;
  let fakeNotificationSender: FakeNotificationSender;

  async function createToken(sub: string): Promise<string> {
    const builder = new jose.SignJWT({ sub })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(INTEXURAOS_AUTH_AUDIENCE)
      .setExpirationTime('1h');

    return await builder.sign(privateKey);
  }

  beforeAll(async () => {
    const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
    privateKey = privKey;

    const publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = 'test-key-1';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    jwksServer = Fastify({ logger: false });

    jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
      return await reply.send({
        keys: [publicKeyJwk],
      });
    });

    await jwksServer.listen({ port: 0, host: '127.0.0.1' });
    const address = jwksServer.server.address();
    if (address !== null && typeof address === 'object') {
      jwksUrl = `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = jwksUrl;
    process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;

    clearJwksCache();

    fakeRepo = new FakeResearchRepository();
    fakeUserServiceClient = new FakeUserServiceClient();
    fakeResearchEventPublisher = new FakeResearchEventPublisher();
    fakeNotificationSender = new FakeNotificationSender();
    const fakeLlmCallPublisher = new FakeLlmCallPublisher();
    const services: ServiceContainer = {
      researchRepo: fakeRepo,
      pricingRepo: new FakePricingRepository(),
      pricingContext: fakePricingContext,
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: fakeResearchEventPublisher,
      llmCallPublisher: fakeLlmCallPublisher,
      userServiceClient: fakeUserServiceClient,
      imageServiceClient: null,
      notificationSender: fakeNotificationSender,
      shareStorage: null,
      shareConfig: null,
      webAppUrl: 'https://app.example.com',
      createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
      createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
      createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
      createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
      createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('POST /research', () => {
    it('creates research with valid auth', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
          selectedModels: [LlmModels.Gemini25Pro],
          synthesisModel: LlmModels.Gemini25Pro,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('generated-id-123');
      expect(body.data.userId).toBe(TEST_USER_ID);
      expect(body.data.prompt).toBe('Test prompt');
      expect(fakeResearchEventPublisher.getPublishedEvents()).toHaveLength(1);
      expect(fakeResearchEventPublisher.getPublishedEvents()[0]?.triggeredBy).toBe('create');
    });

    it('creates research with external reports', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
          selectedModels: [LlmModels.Gemini25Pro],
          synthesisModel: LlmModels.ClaudeOpus45,
          inputContexts: [{ content: 'Input context content', label: 'Custom Label' }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.inputContexts).toHaveLength(1);
    });

    it('returns 500 on save failure', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeRepo.setFailNextSave(true);

      const response = await app.inject({
        method: 'POST',
        url: '/research',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
          selectedModels: [LlmModels.Gemini25Pro],
          synthesisModel: LlmModels.Gemini25Pro,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /research/draft', () => {
    it.skip('creates draft with Google API key (title generation)', async () => {
      // Skipped: Would require mocking Gemini API calls
      // Title generation is tested indirectly through integration tests
    });

    it('creates draft without Google API key (fallback title)', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/draft',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'This is a test prompt that will be used as fallback title',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);

      const saved = fakeRepo.getAll()[0];
      expect(saved).toBeDefined();
      if (saved !== undefined) {
        expect(saved.status).toBe('draft');
        expect(saved.title).toBe('This is a test prompt that will be used as fallback title');
      }
    });

    it('creates draft with optional fields', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/draft',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
          selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
          synthesisModel: LlmModels.ClaudeOpus45,
          inputContexts: [{ content: 'Test context', label: 'Test Label' }],
        },
      });

      expect(response.statusCode).toBe(201);

      const saved = fakeRepo.getAll()[0];
      expect(saved).toBeDefined();
      if (saved !== undefined) {
        expect(saved.selectedModels).toEqual([LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch]);
        expect(saved.synthesisModel).toBe(LlmModels.ClaudeOpus45);
        expect(saved.inputContexts).toHaveLength(1);
      }
    });

    it('creates draft without models when not provided (no defaults)', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/draft',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(201);

      const saved = fakeRepo.getAll()[0];
      expect(saved).toBeDefined();
      if (saved !== undefined) {
        expect(saved.selectedModels).toEqual([]);
        expect(saved.synthesisModel).toBe(LlmModels.Gemini25Pro);
      }
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/research/draft',
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 500 on save failure', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeRepo.setFailNextSave(true);

      const response = await app.inject({
        method: 'POST',
        url: '/research/draft',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /research/:id', () => {
    it('updates draft research', async () => {
      const token = await createToken(TEST_USER_ID);
      const draft = createTestResearch({
        id: 'draft-123',
        status: 'draft',
        prompt: 'Original prompt',
        title: 'Original Title',
      });
      fakeRepo.addResearch(draft);

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/draft-123',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Updated prompt',
          selectedModels: [LlmModels.ClaudeOpus45],
          synthesisModel: LlmModels.Gemini25Pro,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.prompt).toBe('Updated prompt');
      expect(body.data.selectedModels).toEqual([LlmModels.ClaudeOpus45]);
      expect(body.data.synthesisModel).toBe(LlmModels.Gemini25Pro);
      expect(body.data.llmResults).toHaveLength(1);
      expect(body.data.llmResults[0]?.provider).toBe(LlmProviders.Anthropic);
      expect(body.data.llmResults[0]?.status).toBe('pending');
    });

    it('regenerates llmResults when selectedModels changes', async () => {
      const token = await createToken(TEST_USER_ID);
      const draft = createTestResearch({
        id: 'draft-456',
        status: 'draft',
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
        ],
      });
      fakeRepo.addResearch(draft);

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/draft-456',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
          selectedModels: [LlmModels.O4MiniDeepResearch, LlmModels.ClaudeOpus45],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.data.selectedModels).toEqual([
        LlmModels.O4MiniDeepResearch,
        LlmModels.ClaudeOpus45,
      ]);
      expect(body.data.llmResults).toHaveLength(2);
      expect(body.data.llmResults[0]?.provider).toBe(LlmProviders.OpenAI);
      expect(body.data.llmResults[1]?.provider).toBe(LlmProviders.Anthropic);
      expect(body.data.llmResults.every((r) => r.status === 'pending')).toBe(true);
    });

    it('regenerates title when prompt changes', async () => {
      const token = await createToken(TEST_USER_ID);
      const draft = createTestResearch({
        id: 'draft-123',
        status: 'draft',
        prompt: 'Old prompt',
        title: 'Old Title',
      });
      fakeRepo.addResearch(draft);

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/draft-123',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'New prompt for title generation test that is long enough',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.title).not.toBe('Old Title');
      expect(body.data.title).toBe('New prompt for title generation test that is long enough');
    });

    it('returns 404 when research not found', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/nonexistent',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Updated prompt',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 when not owner', async () => {
      const token = await createToken(OTHER_USER_ID);
      const draft = createTestResearch({
        id: 'draft-123',
        userId: TEST_USER_ID,
        status: 'draft',
      });
      fakeRepo.addResearch(draft);

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/draft-123',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Updated prompt',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 409 when trying to update non-draft', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
      });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/research-123',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Updated prompt',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/research/draft-123',
        payload: {
          prompt: 'Updated prompt',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('updates draft with external reports', async () => {
      const token = await createToken(TEST_USER_ID);
      const draft = createTestResearch({
        id: 'draft-123',
        status: 'draft',
        prompt: 'Original prompt',
      });
      fakeRepo.addResearch(draft);

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/draft-123',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Updated prompt with input contexts',
          inputContexts: [
            { content: 'Input context content', label: 'gpt-4' },
            { content: 'Another context without label' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.inputContexts).toHaveLength(2);
      expect(body.data.inputContexts?.[0]?.content).toBe('Input context content');
      expect(body.data.inputContexts?.[0]?.label).toBe('gpt-4');
      expect(body.data.inputContexts?.[1]?.content).toBe('Another context without label');
      expect(body.data.inputContexts?.[1]?.label).toBeUndefined();
    });

    it('returns 500 when update fails', async () => {
      const token = await createToken(TEST_USER_ID);
      const draft = createTestResearch({
        id: 'draft-123',
        status: 'draft',
      });
      fakeRepo.addResearch(draft);
      fakeRepo.setFailNextUpdate(true);

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/draft-123',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Updated prompt',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when findById fails after update', async () => {
      const token = await createToken(TEST_USER_ID);
      const draft = createTestResearch({
        id: 'draft-123',
        status: 'draft',
      });
      fakeRepo.addResearch(draft);

      const originalUpdate = fakeRepo.update.bind(fakeRepo);
      let updateCalled = false;
      fakeRepo.update = async (
        ...args: Parameters<typeof fakeRepo.update>
      ): ReturnType<typeof fakeRepo.update> => {
        const result = await originalUpdate(...args);
        if (!updateCalled) {
          updateCalled = true;
          fakeRepo.setFailNextFind(true);
        }
        return result;
      };

      const response = await app.inject({
        method: 'PATCH',
        url: '/research/draft-123',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Updated prompt',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /research', () => {
    it('returns empty list when no researches', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'GET',
        url: '/research',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { items: Research[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(0);
    });

    it('returns user researches', async () => {
      const token = await createToken(TEST_USER_ID);

      fakeRepo.addResearch(createTestResearch({ id: 'research-1' }));
      fakeRepo.addResearch(createTestResearch({ id: 'research-2' }));

      const response = await app.inject({
        method: 'GET',
        url: '/research',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { items: Research[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(2);
    });

    it('supports limit and cursor params', async () => {
      const token = await createToken(TEST_USER_ID);

      fakeRepo.addResearch(createTestResearch({ id: 'research-1' }));
      fakeRepo.addResearch(createTestResearch({ id: 'research-2' }));
      fakeRepo.addResearch(createTestResearch({ id: 'research-3' }));

      const response = await app.inject({
        method: 'GET',
        url: '/research?limit=2&cursor=abc',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 500 on repo failure', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeRepo.setFailNextFind(true);

      const response = await app.inject({
        method: 'GET',
        url: '/research',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /research/:id', () => {
    it('returns research when found', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch();
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'GET',
        url: `/research/${research.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(research.id);
    });

    it('returns 404 when not found', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'GET',
        url: '/research/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 for other users research', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ userId: OTHER_USER_ID });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'GET',
        url: `/research/${research.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 500 on repo failure', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeRepo.setFailNextFind(true);

      const response = await app.inject({
        method: 'GET',
        url: '/research/test-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /research/:id/approve', () => {
    it('approves draft research and triggers processing', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ status: 'draft' });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/approve`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('pending');
      expect(fakeResearchEventPublisher.getPublishedEvents()).toHaveLength(1);
      expect(fakeResearchEventPublisher.getPublishedEvents()[0]?.triggeredBy).toBe('approve');
    });

    it('returns 401 without auth', async () => {
      const research = createTestResearch({ status: 'draft' });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/approve`,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 when research not found', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/nonexistent-id/approve',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 for other users research', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ userId: OTHER_USER_ID, status: 'draft' });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/approve`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 409 when research is not in draft status', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ status: 'pending' });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/approve`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 500 on repo find failure', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeRepo.setFailNextFind(true);

      const response = await app.inject({
        method: 'POST',
        url: '/research/test-id/approve',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 on repo update failure', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ status: 'draft' });
      fakeRepo.addResearch(research);
      fakeRepo.setFailNextUpdate(true);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/approve`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /research/:id', () => {
    it('deletes research when owned by user', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch();
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'DELETE',
        url: `/research/${research.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: null };
      expect(body.success).toBe(true);
      expect(fakeRepo.getAll()).toHaveLength(0);
    });

    it('returns 404 when not found', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'DELETE',
        url: '/research/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 for other users research', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ userId: OTHER_USER_ID });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'DELETE',
        url: `/research/${research.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 500 on delete failure', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch();
      fakeRepo.addResearch(research);
      fakeRepo.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/research/${research.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /research/:id/enhance', () => {
    function createCompletedResearch(overrides?: Partial<Research>): Research {
      return createTestResearch({
        status: 'completed',
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Google result',
          },
        ],
        completedAt: '2024-01-01T00:05:00Z',
        ...overrides,
      });
    }

    it('creates enhanced research with additional LLMs', async () => {
      const token = await createToken(TEST_USER_ID);
      const source = createCompletedResearch();
      fakeRepo.addResearch(source);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${source.id}/enhance`,
        headers: { authorization: `Bearer ${token}` },
        payload: { additionalModels: [LlmModels.ClaudeOpus45] },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.sourceResearchId).toBe(source.id);
      expect(body.data.selectedModels).toContain(LlmModels.ClaudeOpus45);
    });

    it('returns 404 when source research not found', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/nonexistent/enhance',
        headers: { authorization: `Bearer ${token}` },
        payload: { additionalModels: [LlmModels.ClaudeOpus45] },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 for other users research', async () => {
      const token = await createToken(TEST_USER_ID);
      const source = createCompletedResearch({ userId: OTHER_USER_ID });
      fakeRepo.addResearch(source);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${source.id}/enhance`,
        headers: { authorization: `Bearer ${token}` },
        payload: { additionalModels: [LlmModels.ClaudeOpus45] },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 409 when source research is not completed', async () => {
      const token = await createToken(TEST_USER_ID);
      const source = createTestResearch({ status: 'processing' });
      fakeRepo.addResearch(source);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${source.id}/enhance`,
        headers: { authorization: `Bearer ${token}` },
        payload: { additionalModels: [LlmModels.ClaudeOpus45] },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 409 when no changes provided', async () => {
      const token = await createToken(TEST_USER_ID);
      const source = createCompletedResearch();
      fakeRepo.addResearch(source);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${source.id}/enhance`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('creates enhanced research with new synthesis LLM', async () => {
      const token = await createToken(TEST_USER_ID);
      const source = createCompletedResearch();
      fakeRepo.addResearch(source);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${source.id}/enhance`,
        headers: { authorization: `Bearer ${token}` },
        payload: { synthesisModel: LlmModels.ClaudeOpus45 },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.synthesisModel).toBe(LlmModels.ClaudeOpus45);
    });

    it('creates enhanced research with additional contexts', async () => {
      const token = await createToken(TEST_USER_ID);
      const source = createCompletedResearch();
      fakeRepo.addResearch(source);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${source.id}/enhance`,
        headers: { authorization: `Bearer ${token}` },
        payload: { additionalContexts: [{ content: 'Additional context' }] },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.inputContexts?.length).toBeGreaterThan(0);
    });

    it('creates enhanced research with removed contexts', async () => {
      const token = await createToken(TEST_USER_ID);
      const source = createCompletedResearch({
        inputContexts: [{ id: 'ctx-1', content: 'Context', addedAt: '2024-01-01T00:00:00Z' }],
      });
      fakeRepo.addResearch(source);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${source.id}/enhance`,
        headers: { authorization: `Bearer ${token}` },
        payload: { removeContextIds: ['ctx-1'] },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
    });

    it('returns 500 when save fails', async () => {
      const token = await createToken(TEST_USER_ID);
      const source = createCompletedResearch();
      fakeRepo.addResearch(source);
      fakeRepo.setFailNextSave(true);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${source.id}/enhance`,
        headers: { authorization: `Bearer ${token}` },
        payload: { additionalModels: [LlmModels.ClaudeOpus45] },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /research/:id/share', () => {
    function createSharedResearch(overrides?: Partial<Research>): Research {
      return createTestResearch({
        status: 'completed',
        shareInfo: {
          shareToken: 'abc123',
          slug: 'test-research',
          shareUrl: 'https://example.com/share/test.html',
          sharedAt: '2024-01-01T12:00:00Z',
          gcsPath: 'research/abc123-test-research.html',
        },
        ...overrides,
      });
    }

    it('removes share when owned by user', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createSharedResearch();
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'DELETE',
        url: `/research/${research.id}/share`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 404 when research not found', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'DELETE',
        url: '/research/nonexistent-id/share',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 for other users research', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createSharedResearch({ userId: OTHER_USER_ID });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'DELETE',
        url: `/research/${research.id}/share`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 409 when research is not shared', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ status: 'completed' });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'DELETE',
        url: `/research/${research.id}/share`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('POST /research/:id/confirm', () => {
    function createAwaitingConfirmationResearch(overrides?: Partial<Research>): Research {
      return createTestResearch({
        status: 'awaiting_confirmation',
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Google result',
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'failed',
            error: 'Rate limit',
          },
        ],
        partialFailure: {
          failedModels: [LlmModels.O4MiniDeepResearch],
          detectedAt: '2024-01-01T10:00:00Z',
          retryCount: 0,
        },
        ...overrides,
      });
    }

    it('proceeds with synthesis when action is proceed', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { action: string; message: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('proceed');

      const updatedResearch = fakeRepo.getAll().find((r) => r.id === research.id);
      expect(updatedResearch?.status).toBe('completed');
      expect(updatedResearch?.partialFailure?.userDecision).toBe('proceed');
    });

    it('retries failed providers when action is retry', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch();
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'retry' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { action: string; message: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('retry');
      expect(body.data.message).toContain(LlmModels.O4MiniDeepResearch);

      const updatedResearch = fakeRepo.getAll().find((r) => r.id === research.id);
      expect(updatedResearch?.status).toBe('retrying');
    });

    it('cancels research when action is cancel', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch();
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'cancel' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { action: string; message: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('cancel');
      expect(body.data.message).toBe('Research cancelled');

      const updatedResearch = fakeRepo.getAll().find((r) => r.id === research.id);
      expect(updatedResearch?.status).toBe('failed');
      expect(updatedResearch?.synthesisError).toBe('Cancelled by user');
      expect(updatedResearch?.partialFailure?.userDecision).toBe('cancel');
    });

    it('returns 404 when research not found', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/nonexistent-id/confirm',
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 when user does not own research', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch({ userId: OTHER_USER_ID });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 409 when research status is not awaiting_confirmation', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ status: 'processing' });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 409 when partialFailure is missing', async () => {
      const token = await createToken(TEST_USER_ID);
      const research: Research = {
        id: 'test-research-123',
        userId: TEST_USER_ID,
        title: 'Test Research',
        prompt: 'Test prompt',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        status: 'awaiting_confirmation',
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Result',
          },
        ],
        startedAt: new Date().toISOString(),
      };
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('partial failure');
    });

    it('returns 503 when synthesis API key is missing for proceed', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {});

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns 500 when getApiKeys fails for proceed', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setFailNextGetApiKeys(true);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when findById fails', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch();
      fakeRepo.addResearch(research);
      fakeRepo.setFailNextFind(true);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('sends notification on successful proceed', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'proceed' },
      });

      const notifications = fakeNotificationSender.getSentNotifications();
      expect(notifications.length).toBe(1);
      expect(notifications[0]?.userId).toBe(TEST_USER_ID);
      expect(notifications[0]?.researchId).toBe(research.id);
    });

    it('returns 500 when synthesis fails for proceed', async () => {
      await app.close();
      resetServices();

      const newFakeRepo = new FakeResearchRepository();
      const newFakeUserServiceClient = new FakeUserServiceClient();
      const newFakeResearchEventPublisher = new FakeResearchEventPublisher();
      const newFakeNotificationSender = new FakeNotificationSender();
      const newFakeLlmCallPublisher = new FakeLlmCallPublisher();
      const services: ServiceContainer = {
        researchRepo: newFakeRepo,
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: newFakeResearchEventPublisher,
        llmCallPublisher: newFakeLlmCallPublisher,
        userServiceClient: newFakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: newFakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFailingSynthesizer('LLM API unavailable'),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
      createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
      };
      setServices(services);

      const newApp = await buildServer();
      try {
        const token = await createToken(TEST_USER_ID);
        const research = createAwaitingConfirmationResearch({
          inputContexts: [
            { id: 'ctx-1', content: 'Input context', addedAt: '2024-01-01T10:00:00Z' },
          ],
        });
        newFakeRepo.addResearch(research);
        newFakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

        const response = await newApp.inject({
          method: 'POST',
          url: `/research/${research.id}/confirm`,
          headers: { authorization: `Bearer ${token}` },
          payload: { action: 'proceed' },
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
        expect(body.error.message).toContain('LLM API unavailable');

        const updatedResearch = newFakeRepo.getAll().find((r) => r.id === research.id);
        expect(updatedResearch?.status).toBe('failed');
        expect(updatedResearch?.synthesisError).toContain('LLM API unavailable');
      } finally {
        await newApp.close();
        app = await buildServer();
      }
    });

    it('returns 500 when retry fails due to max retries exceeded', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createAwaitingConfirmationResearch({
        partialFailure: {
          failedModels: [LlmModels.O4MiniDeepResearch],
          detectedAt: '2024-01-01T10:00:00Z',
          retryCount: 2,
        },
      });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/confirm`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action: 'retry' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('Maximum retry attempts exceeded');

      const updatedResearch = fakeRepo.getAll().find((r) => r.id === research.id);
      expect(updatedResearch?.status).toBe('failed');
      expect(updatedResearch?.synthesisError).toBe('Maximum retry attempts exceeded');
    });
  });

  describe('POST /research/:id/retry', () => {
    function createFailedResearch(overrides?: Partial<Research>): Research {
      return createTestResearch({
        status: 'failed',
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Google result',
          },
          {
            provider: LlmProviders.OpenAI,
            model: LlmModels.O4MiniDeepResearch,
            status: 'failed',
            error: 'Rate limit',
          },
        ],
        ...overrides,
      });
    }

    it('retries failed LLMs when status is failed', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createFailedResearch();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { action: string; message: string; retriedModels?: string[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('retried_llms');
      expect(body.data.retriedModels).toContain(LlmModels.O4MiniDeepResearch);

      const updatedResearch = fakeRepo.getAll().find((r) => r.id === research.id);
      expect(updatedResearch?.status).toBe('retrying');
    });

    it('re-runs synthesis when LLMs succeeded but synthesis failed', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({
        status: 'failed',
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Result 1',
          },
          {
            provider: LlmProviders.OpenAI,
            model: 'o4-mini',
            status: 'completed',
            result: 'Result 2',
          },
        ],
        synthesisError: 'Synthesis failed',
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { action: string; message: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('retried_synthesis');

      const updatedResearch = fakeRepo.getAll().find((r) => r.id === research.id);
      expect(updatedResearch?.status).toBe('completed');
    });

    it('returns success when research is already completed (idempotent)', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ status: 'completed' });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { action: string; message: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('already_completed');
    });

    it('returns 404 when research not found', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/nonexistent-id/retry',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 when user does not own research', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createFailedResearch({ userId: OTHER_USER_ID });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 409 when research status is processing', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createTestResearch({ status: 'processing' });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 503 when synthesis API key is missing', async () => {
      const token = await createToken(TEST_USER_ID);
      const research = createFailedResearch();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {});

      const response = await app.inject({
        method: 'POST',
        url: `/research/${research.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns 500 when synthesis fails during retry', async () => {
      const services: ServiceContainer = {
        researchRepo: fakeRepo,
        generateId: () => 'new-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        userServiceClient: fakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: new FakeNotificationSender(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFailingSynthesizer('LLM API unavailable'),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
      createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
      };
      setServices(services);

      const newApp = await buildServer();
      try {
        const token = await createToken(TEST_USER_ID);
        const research = createTestResearch({
          status: 'failed',
          llmResults: [
            {
              provider: LlmProviders.Google,
              model: LlmModels.Gemini20Flash,
              status: 'completed',
              result: 'Result 1',
            },
            {
              provider: LlmProviders.OpenAI,
              model: 'o4-mini',
              status: 'completed',
              result: 'Result 2',
            },
          ],
          synthesisError: 'Previous failure',
        });
        fakeRepo.addResearch(research);
        fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

        const response = await newApp.inject({
          method: 'POST',
          url: `/research/${research.id}/retry`,
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
      } finally {
        await newApp.close();
      }
    });
  });

  describe('POST /research/validate-input', () => {
    it('validates input and returns quality assessment', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'test-google-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/research/validate-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt for validation',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { quality: number; reason: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.quality).toBe(2);
      expect(body.data.reason).toBe('Test quality validation');
    });

    it('validates input with improvement request', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'test-google-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/research/validate-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
          includeImprovement: true,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { quality: number; reason: string; improvedPrompt?: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.quality).toBe(2);
    });

    it('returns improved prompt when quality is WEAK_BUT_VALID and improvement succeeds', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'test-google-key' });

      // Create a validator that returns quality=1 and succeeds on improvement
      const weakValidator: InputValidationProvider = {
        async validateInput(_prompt: string) {
          return ok({
            quality: 1,
            reason: 'Weak but valid',
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
        async improveInput(prompt: string) {
          return ok({
            improvedPrompt: `Much better: ${prompt}`,
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
      };

      const newServices: ServiceContainer = {
        researchRepo: fakeRepo,
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: fakeResearchEventPublisher,
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: fakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: fakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
        createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => weakValidator,
      };
      setServices(newServices);

      const newApp = await buildServer();
      try {
        const response = await newApp.inject({
          method: 'POST',
          url: '/research/validate-input',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            prompt: 'Weak prompt',
            includeImprovement: true,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { quality: number; reason: string; improvedPrompt: string | null };
        };
        expect(body.success).toBe(true);
        expect(body.data.quality).toBe(1);
        expect(body.data.reason).toBe('Weak but valid');
        expect(body.data.improvedPrompt).toBe('Much better: Weak prompt');
      } finally {
        await newApp.close();
        setServices({
          researchRepo: fakeRepo,
          pricingRepo: new FakePricingRepository(),
          pricingContext: fakePricingContext,
          generateId: (): string => 'generated-id-123',
          researchEventPublisher: fakeResearchEventPublisher,
          llmCallPublisher: new FakeLlmCallPublisher(),
          userServiceClient: fakeUserServiceClient,
          imageServiceClient: null,
          notificationSender: fakeNotificationSender,
          shareStorage: null,
          shareConfig: null,
          webAppUrl: 'https://app.example.com',
          createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
          createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
          createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
          createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
          createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
        });
      }
    });

    it('does not improve when quality is WEAK_BUT_VALID but includeImprovement is false', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'test-google-key' });

      // Create a validator that returns quality=1
      const weakValidator: InputValidationProvider = {
        async validateInput(_prompt: string) {
          return ok({
            quality: 1,
            reason: 'Weak but valid',
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
        async improveInput(prompt: string) {
          return ok({
            improvedPrompt: `Much better: ${prompt}`,
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
      };

      const newServices: ServiceContainer = {
        researchRepo: fakeRepo,
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: fakeResearchEventPublisher,
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: fakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: fakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
        createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => weakValidator,
      };
      setServices(newServices);

      const newApp = await buildServer();
      try {
        const response = await newApp.inject({
          method: 'POST',
          url: '/research/validate-input',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            prompt: 'Weak prompt',
            includeImprovement: false, // Explicitly false
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { quality: number; reason: string; improvedPrompt: string | null };
        };
        expect(body.success).toBe(true);
        expect(body.data.quality).toBe(1);
        expect(body.data.reason).toBe('Weak but valid');
        expect(body.data.improvedPrompt).toBe(null); // Should be null when improvement not requested
      } finally {
        await newApp.close();
        setServices({
          researchRepo: fakeRepo,
          pricingRepo: new FakePricingRepository(),
          pricingContext: fakePricingContext,
          generateId: (): string => 'generated-id-123',
          researchEventPublisher: fakeResearchEventPublisher,
          llmCallPublisher: new FakeLlmCallPublisher(),
          userServiceClient: fakeUserServiceClient,
          imageServiceClient: null,
          notificationSender: fakeNotificationSender,
          shareStorage: null,
          shareConfig: null,
          webAppUrl: 'https://app.example.com',
          createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
          createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
          createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
          createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
          createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
        });
      }
    });

    it('handles improvement failure when quality is WEAK_BUT_VALID', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'test-google-key' });

      // Create a validator that returns quality=1 and fails on improvement
      const weakValidator: InputValidationProvider = {
        async validateInput(_prompt: string) {
          return ok({
            quality: 1,
            reason: 'Weak prompt',
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
        async improveInput(_prompt: string) {
          return err({
            code: 'API_ERROR',
            message: 'Improvement failed',
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
      };

      const newServices: ServiceContainer = {
        researchRepo: fakeRepo,
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: fakeResearchEventPublisher,
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: fakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: fakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
        createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => weakValidator,
      };
      setServices(newServices);

      const newApp = await buildServer();
      try {
        const response = await newApp.inject({
          method: 'POST',
          url: '/research/validate-input',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            prompt: 'Weak prompt',
            includeImprovement: true,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { quality: number; reason: string; improvedPrompt: string | null };
        };
        expect(body.success).toBe(true);
        expect(body.data.quality).toBe(1);
        expect(body.data.reason).toBe('Weak prompt');
        expect(body.data.improvedPrompt).toBe(null); // Should be null when improvement fails
      } finally {
        await newApp.close();
        setServices({
          researchRepo: fakeRepo,
          pricingRepo: new FakePricingRepository(),
          pricingContext: fakePricingContext,
          generateId: (): string => 'generated-id-123',
          researchEventPublisher: fakeResearchEventPublisher,
          llmCallPublisher: new FakeLlmCallPublisher(),
          userServiceClient: fakeUserServiceClient,
          imageServiceClient: null,
          notificationSender: fakeNotificationSender,
          shareStorage: null,
          shareConfig: null,
          webAppUrl: 'https://app.example.com',
          createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
          createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
          createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
          createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
          createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
        });
      }
    });

    it('returns GOOD quality when validation fails (silent degradation)', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'test-google-key' });

      // Create a validator that fails on validation
      const failingValidator: InputValidationProvider = {
        async validateInput(_prompt: string) {
          return err({
            code: 'API_ERROR',
            message: 'Validation failed',
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
        async improveInput(_prompt: string) {
          return ok({
            improvedPrompt: 'Improved',
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
      };

      const newServices: ServiceContainer = {
        researchRepo: fakeRepo,
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: fakeResearchEventPublisher,
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: fakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: fakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
        createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => failingValidator,
      };
      setServices(newServices);

      const newApp = await buildServer();
      try {
        const response = await newApp.inject({
          method: 'POST',
          url: '/research/validate-input',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            prompt: 'Test prompt',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { quality: number; reason: string; improvedPrompt: string | null };
        };
        expect(body.success).toBe(true);
        expect(body.data.quality).toBe(2); // Silent degradation returns GOOD
        expect(body.data.reason).toBe('Validation unavailable');
        expect(body.data.improvedPrompt).toBe(null);
      } finally {
        await newApp.close();
        setServices({
          researchRepo: fakeRepo,
          pricingRepo: new FakePricingRepository(),
          pricingContext: fakePricingContext,
          generateId: (): string => 'generated-id-123',
          researchEventPublisher: fakeResearchEventPublisher,
          llmCallPublisher: new FakeLlmCallPublisher(),
          userServiceClient: fakeUserServiceClient,
          imageServiceClient: null,
          notificationSender: fakeNotificationSender,
          shareStorage: null,
          shareConfig: null,
          webAppUrl: 'https://app.example.com',
          createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
          createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
          createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
          createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
          createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
        });
      }
    });

    it('returns MISCONFIGURED when Google key is missing', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {});

      const response = await app.inject({
        method: 'POST',
        url: '/research/validate-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/research/validate-input',
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('validates request body schema', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/validate-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          // Missing required prompt field
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('POST /research/improve-input', () => {
    it('improves input and returns improved prompt', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'test-google-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/research/improve-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { improvedPrompt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.improvedPrompt).toBe('Improved: Test prompt');
    });

    it('returns original prompt when improvement fails', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'test-google-key' });

      // Create a validator that fails on improvement
      const failingValidator: InputValidationProvider = {
        async validateInput(_prompt: string) {
          return ok({
            quality: 2,
            reason: 'Good',
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
        async improveInput(_prompt: string) {
          return err({
            code: 'API_ERROR',
            message: 'Improvement failed',
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          });
        },
      };

      const newServices: ServiceContainer = {
        researchRepo: fakeRepo,
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: fakeResearchEventPublisher,
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: fakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: fakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
        createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => failingValidator,
      };
      setServices(newServices);

      const newApp = await buildServer();
      try {
        const response = await newApp.inject({
          method: 'POST',
          url: '/research/improve-input',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            prompt: 'Original prompt',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { improvedPrompt: string };
        };
        expect(body.success).toBe(true);
        expect(body.data.improvedPrompt).toBe('Original prompt'); // Should return original when improvement fails
      } finally {
        await newApp.close();
        setServices({
          researchRepo: fakeRepo,
          pricingRepo: new FakePricingRepository(),
          pricingContext: fakePricingContext,
          generateId: (): string => 'generated-id-123',
          researchEventPublisher: fakeResearchEventPublisher,
          llmCallPublisher: new FakeLlmCallPublisher(),
          userServiceClient: fakeUserServiceClient,
          imageServiceClient: null,
          notificationSender: fakeNotificationSender,
          shareStorage: null,
          shareConfig: null,
          webAppUrl: 'https://app.example.com',
          createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
          createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
          createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
          createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
          createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
        });
      }
    });

    it('returns MISCONFIGURED when Google key is missing', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {});

      const response = await app.inject({
        method: 'POST',
        url: '/research/improve-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/research/improve-input',
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('validates request body schema', async () => {
      const token = await createToken(TEST_USER_ID);

      const response = await app.inject({
        method: 'POST',
        url: '/research/improve-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          // Missing required prompt field
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns INTERNAL_ERROR when user service fails', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setFailNextGetApiKeys(true);

      const response = await app.inject({
        method: 'POST',
        url: '/research/improve-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /research/validate-input - additional coverage', () => {
    it('returns INTERNAL_ERROR when user service fails', async () => {
      const token = await createToken(TEST_USER_ID);
      fakeUserServiceClient.setFailNextGetApiKeys(true);

      const response = await app.inject({
        method: 'POST',
        url: '/research/validate-input',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});

describe('System Endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

    const fakeRepo = new FakeResearchRepository();
    const fakeUserServiceClient = new FakeUserServiceClient();
    const fakeResearchEventPublisher = new FakeResearchEventPublisher();
    const fakeNotificationSender = new FakeNotificationSender();
    const fakeLlmCallPublisher = new FakeLlmCallPublisher();
    const services: ServiceContainer = {
      researchRepo: fakeRepo,
      pricingRepo: new FakePricingRepository(),
      pricingContext: fakePricingContext,
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: fakeResearchEventPublisher,
      llmCallPublisher: fakeLlmCallPublisher,
      userServiceClient: fakeUserServiceClient,
      imageServiceClient: null,
      notificationSender: fakeNotificationSender,
      shareStorage: null,
      shareConfig: null,
      webAppUrl: 'https://app.example.com',
      createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
      createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
      createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
      createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
      createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  it('GET /health returns 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
  });

  it('GET /openapi.json returns OpenAPI spec', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { openapi: string };
    expect(body.openapi).toBeDefined();
  });
});

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeRepo: FakeResearchRepository;
  const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;
    process.env['INTEXURAOS_WEB_APP_URL'] = 'https://app.example.com';

    fakeRepo = new FakeResearchRepository();
    const fakeUserServiceClient = new FakeUserServiceClient();
    const fakeResearchEventPublisher = new FakeResearchEventPublisher();
    const fakeNotificationSender = new FakeNotificationSender();
    const fakeLlmCallPublisher = new FakeLlmCallPublisher();
    const services: ServiceContainer = {
      researchRepo: fakeRepo,
      pricingRepo: new FakePricingRepository(),
      pricingContext: fakePricingContext,
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: fakeResearchEventPublisher,
      llmCallPublisher: fakeLlmCallPublisher,
      userServiceClient: fakeUserServiceClient,
      imageServiceClient: null,
      notificationSender: fakeNotificationSender,
      shareStorage: null,
      shareConfig: null,
      webAppUrl: 'https://app.example.com',
      createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
      createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
      createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
      createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
      createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
    };
    setServices(services);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('POST /internal/research/draft', () => {
    it('creates draft research with valid internal auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/research/draft',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          userId: TEST_USER_ID,
          title: 'Test Draft Research',
          prompt: 'Test prompt content',
          selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('generated-id-123');
      expect(body.data.userId).toBe(TEST_USER_ID);
      expect(body.data.title).toBe('Test Draft Research');
      expect(body.data.status).toBe('draft');
      expect(body.data.selectedModels).toEqual([
        LlmModels.Gemini25Pro,
        LlmModels.O4MiniDeepResearch,
      ]);
    });

    it('creates draft research with sourceActionId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/research/draft',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          userId: TEST_USER_ID,
          title: 'Test Draft Research',
          prompt: 'Test prompt content',
          selectedModels: [LlmModels.ClaudeOpus45],
          sourceActionId: 'action-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.sourceActionId).toBe('action-123');
    });

    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/research/draft',
        payload: {
          userId: TEST_USER_ID,
          title: 'Test Draft Research',
          prompt: 'Test prompt content',
          selectedModels: [LlmModels.Gemini25Pro],
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Internal-Auth header has wrong value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/research/draft',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: {
          userId: TEST_USER_ID,
          title: 'Test Draft Research',
          prompt: 'Test prompt content',
          selectedModels: [LlmModels.Gemini25Pro],
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

      const response = await app.inject({
        method: 'POST',
        url: '/internal/research/draft',
        headers: { 'x-internal-auth': 'any-token' },
        payload: {
          userId: TEST_USER_ID,
          title: 'Test Draft Research',
          prompt: 'Test prompt content',
          selectedModels: [LlmModels.Gemini25Pro],
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 500 on save failure', async () => {
      fakeRepo.setFailNextSave(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/research/draft',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          userId: TEST_USER_ID,
          title: 'Test Draft Research',
          prompt: 'Test prompt content',
          selectedModels: [LlmModels.Gemini25Pro],
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /internal/llm/pubsub/process-research', () => {
    function encodePubSubMessage(data: object): string {
      return Buffer.from(JSON.stringify(data)).toString('base64');
    }

    it('returns 401 without auth headers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-research',
        payload: {
          message: {
            data: encodePubSubMessage({
              type: 'research.process',
              researchId: 'test-research-123',
              userId: TEST_USER_ID,
              triggeredBy: 'create',
            }),
            messageId: 'msg-123',
            publishTime: new Date().toISOString(),
          },
          subscription: 'projects/test/subscriptions/test-sub',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('accepts Pub/Sub push with from header', async () => {
      const research = createTestResearch({ status: 'pending' });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-research',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage({
              type: 'research.process',
              researchId: research.id,
              userId: TEST_USER_ID,
              triggeredBy: 'create',
            }),
            messageId: 'msg-123',
            publishTime: new Date().toISOString(),
          },
          subscription: 'projects/test/subscriptions/test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('accepts direct call with x-internal-auth header', async () => {
      const research = createTestResearch({ status: 'pending' });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-research',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          message: {
            data: encodePubSubMessage({
              type: 'research.process',
              researchId: research.id,
              userId: TEST_USER_ID,
              triggeredBy: 'create',
            }),
            messageId: 'msg-123',
            publishTime: new Date().toISOString(),
          },
          subscription: 'projects/test/subscriptions/test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 200 with error for invalid message format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-research',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: 'invalid-base64-that-is-not-json!!!',
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid message format');
    });

    it('returns 200 with error for unexpected event type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-research',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage({ type: 'some.other.event' }),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unexpected event type');
    });

    it('returns 200 with error for non-existent research', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-research',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage({
              type: 'research.process',
              researchId: 'non-existent-id',
              userId: TEST_USER_ID,
              triggeredBy: 'create',
            }),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Research not found');
    });
  });

  describe('POST /internal/llm/pubsub/report-analytics', () => {
    function encodePubSubMessage(data: object): string {
      return Buffer.from(JSON.stringify(data)).toString('base64');
    }

    it('returns 401 without auth headers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/report-analytics',
        payload: {
          message: {
            data: encodePubSubMessage({
              type: 'llm.report',
              researchId: 'test-research-123',
              userId: TEST_USER_ID,
              provider: LlmProviders.Google,
              model: 'gemini-2.0-flash-exp',
              inputTokens: 100,
              outputTokens: 200,
              durationMs: 1000,
            }),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts Pub/Sub push and reports analytics', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/report-analytics',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage({
              type: 'llm.report',
              researchId: 'test-research-123',
              userId: TEST_USER_ID,
              provider: LlmProviders.Google,
              model: 'gemini-2.0-flash-exp',
              inputTokens: 100,
              outputTokens: 200,
              durationMs: 1000,
            }),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 200 even for invalid message format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/report-analytics',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: 'not-valid-base64!!!',
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('returns 200 for unexpected event type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/report-analytics',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage({ type: 'some.other.event' }),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(false);
    });
  });

  describe('POST /internal/llm/pubsub/process-llm-call', () => {
    let fakeUserServiceClient: FakeUserServiceClient;
    let fakeNotificationSender: FakeNotificationSender;

    function encodePubSubMessage(data: object): string {
      return Buffer.from(JSON.stringify(data)).toString('base64');
    }

    function createLlmCallEvent(
      overrides?: Partial<{
        type: string;
        researchId: string;
        userId: string;
        model: string;
        prompt: string;
      }>
    ): object {
      return {
        type: 'llm.call',
        researchId: 'research-123',
        userId: TEST_USER_ID,
        model: LlmModels.Gemini25Pro,
        prompt: 'Test prompt',
        ...overrides,
      };
    }

    function createResearchWithLlmResults(): Research {
      return createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
          { provider: LlmProviders.OpenAI, model: LlmModels.O4MiniDeepResearch, status: 'pending' },
        ],
      });
    }

    beforeEach(() => {
      fakeUserServiceClient = new FakeUserServiceClient();
      fakeNotificationSender = new FakeNotificationSender();
      const fakeLlmCallPublisher = new FakeLlmCallPublisher();
      const services: ServiceContainer = {
        researchRepo: fakeRepo,
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: fakeLlmCallPublisher,
        userServiceClient: fakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: fakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFakeLlmResearchProvider(),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
      createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
      };
      setServices(services);
    });

    it('returns 401 without auth headers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts Pub/Sub push with from header', async () => {
      const research = createResearchWithLlmResults();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {
        google: 'google-key',
        openai: 'openai-key',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts request with x-internal-auth header', async () => {
      const research = createResearchWithLlmResults();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {
        google: 'google-key',
        openai: 'openai-key',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns error for invalid message format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: 'not-valid-base64!!!',
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid message format');
    });

    it('returns error for unexpected event type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage({ type: 'some.other.event' }),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unexpected event type');
    });

    it('returns error when research not found', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Research not found');
    });

    it('skips already completed LLM calls (idempotency)', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini25Pro,
            status: 'completed',
            result: 'Already done',
          },
        ],
      });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('skips already failed LLM calls (idempotency)', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini25Pro,
            status: 'failed',
            error: 'Previous error',
          },
        ],
      });
      fakeRepo.addResearch(research);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns error when API keys fetch fails', async () => {
      const research = createResearchWithLlmResults();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setFailNextGetApiKeys(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Failed to fetch API keys');

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.llmResults[0]?.status).toBe('failed');
    });

    it('returns error when API key is missing for provider', async () => {
      const research = createResearchWithLlmResults();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { openai: 'openai-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent({ model: LlmModels.Gemini25Pro })),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('API key missing');

      const failures = fakeNotificationSender.getSentFailures();
      expect(failures.length).toBe(1);
      expect(failures[0]?.model).toBe(LlmModels.Gemini25Pro);
    });

    it('processes LLM call and updates result on success', async () => {
      const research = createResearchWithLlmResults();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {
        google: 'google-key',
        openai: 'openai-key',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const updatedResearch = fakeRepo.getAll()[0];
      const googleResult = updatedResearch?.llmResults.find(
        (r) => r.provider === LlmProviders.Google
      );
      expect(googleResult?.status).toBe('completed');
      expect(googleResult?.result).toBeDefined();
    });

    it('triggers synthesis when all LLMs complete successfully', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
        ],
        inputContexts: [{ id: 'ctx-1', content: 'Input context', addedAt: '2024-01-01T10:00:00Z' }],
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.status).toBe('completed');
      expect(updatedResearch?.synthesizedResult).toBeDefined();
    });

    it('skips synthesis when single LLM completes without external reports', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
        ],
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.status).toBe('completed');
      expect(updatedResearch?.synthesizedResult).toBeUndefined();
    });

    it('sends notification on successful synthesis', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.Gemini25Pro,
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
        ],
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      const notifications = fakeNotificationSender.getSentNotifications();
      expect(notifications.length).toBe(1);
      expect(notifications[0]?.userId).toBe(TEST_USER_ID);
    });

    it('marks research as failed when all LLMs fail', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
        ],
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {});

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.llmResults[0]?.status).toBe('failed');
    });

    it('handles partial failure when some LLMs complete and others fail', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini25Pro,
            status: 'completed',
            result: 'Done',
          },
          { provider: LlmProviders.OpenAI, model: LlmModels.O4MiniDeepResearch, status: 'pending' },
        ],
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {});

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent({ model: LlmModels.O4MiniDeepResearch })),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.status).toBe('awaiting_confirmation');
      expect(updatedResearch?.partialFailure?.failedModels).toContain(LlmModels.O4MiniDeepResearch);
    });

    it('handles partial failure when LLM succeeds but another already failed', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro, LlmModels.O4MiniDeepResearch],
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini25Pro,
            status: 'failed',
            error: 'Previous failure',
          },
          { provider: LlmProviders.OpenAI, model: LlmModels.O4MiniDeepResearch, status: 'pending' },
        ],
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { openai: 'openai-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent({ model: LlmModels.O4MiniDeepResearch })),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.status).toBe('awaiting_confirmation');
      expect(updatedResearch?.partialFailure?.failedModels).toContain(LlmModels.Gemini25Pro);
      expect(
        updatedResearch?.llmResults.find((r) => r.provider === LlmProviders.OpenAI)?.status
      ).toBe('completed');
    });

    it('fails synthesis when synthesis API key missing after LLM completion', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro],
        synthesisModel: LlmModels.ClaudeOpus45,
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
        ],
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.status).toBe('failed');
      expect(updatedResearch?.synthesisError).toContain('API key required');
    });

    it('handles all_failed completion action when LLM call fails', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedModels: [LlmModels.Gemini25Pro],
        llmResults: [
          { provider: LlmProviders.Google, model: LlmModels.Gemini25Pro, status: 'pending' },
        ],
      });
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, { google: 'google-key' });

      // Override createResearchProvider to return a failing provider
      const services: ServiceContainer = {
        researchRepo: fakeRepo,
        pricingRepo: new FakePricingRepository(),
        pricingContext: fakePricingContext,
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: new FakeLlmCallPublisher(),
        userServiceClient: fakeUserServiceClient,
        imageServiceClient: null,
        notificationSender: fakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        webAppUrl: 'https://app.example.com',
        createResearchProvider: (_model, _apiKey, _userId, _pricing, _logger) => createFailingLlmResearchProvider('LLM API error'),
        createSynthesizer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeSynthesizer(),
        createTitleGenerator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeTitleGenerator(),
        createContextInferrer: (_model, _apiKey, _userId, _pricing, _logger) => createFakeContextInferrer(),
      createInputValidator: (_model, _apiKey, _userId, _pricing, _logger) => createFakeInputValidator(),
      };
      setServices(services);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const updatedResearch = fakeRepo.getAll()[0];
      const result = updatedResearch?.llmResults[0];
      expect(result?.status).toBe('failed');
      expect(result?.error).toBe('LLM API error');

      // Verify notification was sent for the failure
      const failures = fakeNotificationSender.getSentFailures();
      expect(failures.length).toBe(1);
      expect(failures[0]?.model).toBe(LlmModels.Gemini25Pro);
    });

    it('handles unexpected exception during LLM call processing', async () => {
      const research = createResearchWithLlmResults();
      fakeRepo.addResearch(research);
      fakeUserServiceClient.setApiKeys(TEST_USER_ID, {
        google: 'google-key',
        openai: 'openai-key',
      });

      // Configure repository to throw an exception during updateLlmResult
      fakeRepo.setFailNextUpdateLlmResult(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/llm/pubsub/process-llm-call',
        headers: { from: 'noreply@google.com' },
        payload: {
          message: {
            data: encodePubSubMessage(createLlmCallEvent()),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unexpected repository error');

      // Verify the LLM result was updated to failed status
      const updatedResearch = fakeRepo.getAll()[0];
      const result = updatedResearch?.llmResults.find((r) => r.model === LlmModels.Gemini25Pro);
      expect(result?.status).toBe('failed');
      expect(result?.error).toContain('Unexpected repository error');
    });
  });

});
