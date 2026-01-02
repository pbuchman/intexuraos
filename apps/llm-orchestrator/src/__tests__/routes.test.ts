/**
 * Tests for research routes.
 * Uses real JWT signing with jose library for proper authentication.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';
import { resetServices, type ServiceContainer, setServices } from '../services.js';
import {
  createFailingSynthesizer,
  createFakeLlmProviders,
  createFakeLlmResearchProvider,
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
    selectedLlms: ['google'],
    synthesisLlm: 'google',
    status: 'pending',
    llmResults: [
      {
        provider: 'google',
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
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: fakeResearchEventPublisher,
      llmCallPublisher: fakeLlmCallPublisher,
      userServiceClient: fakeUserServiceClient,
      notificationSender: fakeNotificationSender,
      shareStorage: null,
      shareConfig: null,
      createLlmProviders: () => createFakeLlmProviders(),
      createResearchProvider: () => createFakeLlmResearchProvider(),
      createSynthesizer: () => createFakeSynthesizer(),
      createTitleGenerator: () => createFakeTitleGenerator(),
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
        selectedLlms: ['google'],
        synthesisLlm: 'google',
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
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: fakeResearchEventPublisher,
      llmCallPublisher: fakeLlmCallPublisher,
      userServiceClient: fakeUserServiceClient,
      notificationSender: fakeNotificationSender,
      shareStorage: null,
      shareConfig: null,
      createLlmProviders: () => createFakeLlmProviders(),
      createResearchProvider: () => createFakeLlmResearchProvider(),
      createSynthesizer: () => createFakeSynthesizer(),
      createTitleGenerator: () => createFakeTitleGenerator(),
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
          selectedLlms: ['google'],
          synthesisLlm: 'google',
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
          selectedLlms: ['google'],
          synthesisLlm: 'anthropic',
          externalReports: [{ content: 'External report content', model: 'Custom Model' }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.externalReports).toHaveLength(1);
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
          selectedLlms: ['google'],
          synthesisLlm: 'google',
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
          selectedLlms: ['google', 'openai'],
          synthesisLlm: 'anthropic',
          externalReports: [{ content: 'Test report', model: 'Test Model' }],
        },
      });

      expect(response.statusCode).toBe(201);

      const saved = fakeRepo.getAll()[0];
      expect(saved).toBeDefined();
      if (saved !== undefined) {
        expect(saved.selectedLlms).toEqual(['google', 'openai']);
        expect(saved.synthesisLlm).toBe('anthropic');
        expect(saved.externalReports).toHaveLength(1);
      }
    });

    it('uses default LLMs when not provided', async () => {
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
        expect(saved.selectedLlms).toEqual(['google', 'openai', 'anthropic']);
        expect(saved.synthesisLlm).toBe('google');
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
          selectedLlms: ['anthropic'],
          synthesisLlm: 'google',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.prompt).toBe('Updated prompt');
      expect(body.data.selectedLlms).toEqual(['anthropic']);
      expect(body.data.synthesisLlm).toBe('google');
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
          prompt: 'Updated prompt with external reports',
          externalReports: [
            { content: 'External report content', model: 'gpt-4' },
            { content: 'Another report without model' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.externalReports).toHaveLength(2);
      expect(body.data.externalReports?.[0]?.content).toBe('External report content');
      expect(body.data.externalReports?.[0]?.model).toBe('gpt-4');
      expect(body.data.externalReports?.[1]?.content).toBe('Another report without model');
      expect(body.data.externalReports?.[1]?.model).toBeUndefined();
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
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Google result',
          },
          {
            provider: 'openai',
            model: 'o4-mini-deep-research',
            status: 'failed',
            error: 'Rate limit',
          },
        ],
        partialFailure: {
          failedProviders: ['openai'],
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
      expect(body.data.message).toContain('openai');

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
        selectedLlms: ['google'],
        synthesisLlm: 'google',
        status: 'awaiting_confirmation',
        llmResults: [
          { provider: 'google', model: 'gemini-2.0-flash', status: 'completed', result: 'Result' },
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
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: newFakeResearchEventPublisher,
        llmCallPublisher: newFakeLlmCallPublisher,
        userServiceClient: newFakeUserServiceClient,
        notificationSender: newFakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        createLlmProviders: () => createFakeLlmProviders(),
        createResearchProvider: () => createFakeLlmResearchProvider(),
        createSynthesizer: () => createFailingSynthesizer('LLM API unavailable'),
        createTitleGenerator: () => createFakeTitleGenerator(),
      };
      setServices(services);

      const newApp = await buildServer();
      try {
        const token = await createToken(TEST_USER_ID);
        const research = createAwaitingConfirmationResearch();
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
          failedProviders: ['openai'],
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
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: fakeResearchEventPublisher,
      llmCallPublisher: fakeLlmCallPublisher,
      userServiceClient: fakeUserServiceClient,
      notificationSender: fakeNotificationSender,
      shareStorage: null,
      shareConfig: null,
      createLlmProviders: () => createFakeLlmProviders(),
      createResearchProvider: () => createFakeLlmResearchProvider(),
      createSynthesizer: () => createFakeSynthesizer(),
      createTitleGenerator: () => createFakeTitleGenerator(),
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
      generateId: (): string => 'generated-id-123',
      researchEventPublisher: fakeResearchEventPublisher,
      llmCallPublisher: fakeLlmCallPublisher,
      userServiceClient: fakeUserServiceClient,
      notificationSender: fakeNotificationSender,
      shareStorage: null,
      shareConfig: null,
      createLlmProviders: () => createFakeLlmProviders(),
      createResearchProvider: () => createFakeLlmResearchProvider(),
      createSynthesizer: () => createFakeSynthesizer(),
      createTitleGenerator: () => createFakeTitleGenerator(),
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
          selectedLlms: ['google', 'openai'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('generated-id-123');
      expect(body.data.userId).toBe(TEST_USER_ID);
      expect(body.data.title).toBe('Test Draft Research');
      expect(body.data.status).toBe('draft');
      expect(body.data.selectedLlms).toEqual(['google', 'openai']);
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
          selectedLlms: ['anthropic'],
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
          selectedLlms: ['google'],
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
          selectedLlms: ['google'],
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
          selectedLlms: ['google'],
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
          selectedLlms: ['google'],
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
              provider: 'google',
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
              provider: 'google',
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
        provider: string;
        prompt: string;
      }>
    ): object {
      return {
        type: 'llm.call',
        researchId: 'research-123',
        userId: TEST_USER_ID,
        provider: 'google',
        prompt: 'Test prompt',
        ...overrides,
      };
    }

    function createResearchWithLlmResults(): Research {
      return createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedLlms: ['google', 'openai'],
        llmResults: [
          { provider: 'google', model: 'gemini-2.0-flash', status: 'pending' },
          { provider: 'openai', model: 'o4-mini-deep-research', status: 'pending' },
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
        generateId: (): string => 'generated-id-123',
        researchEventPublisher: new FakeResearchEventPublisher(),
        llmCallPublisher: fakeLlmCallPublisher,
        userServiceClient: fakeUserServiceClient,
        notificationSender: fakeNotificationSender,
        shareStorage: null,
        shareConfig: null,
        createLlmProviders: () => createFakeLlmProviders(),
        createResearchProvider: () => createFakeLlmResearchProvider(),
        createSynthesizer: () => createFakeSynthesizer(),
        createTitleGenerator: () => createFakeTitleGenerator(),
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
        selectedLlms: ['google'],
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
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
        selectedLlms: ['google'],
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
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
            data: encodePubSubMessage(createLlmCallEvent({ provider: 'google' })),
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
      expect(failures[0]?.provider).toBe('google');
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
      const googleResult = updatedResearch?.llmResults.find((r) => r.provider === 'google');
      expect(googleResult?.status).toBe('completed');
      expect(googleResult?.result).toBeDefined();
    });

    it('triggers synthesis when all LLMs complete successfully', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedLlms: ['google'],
        synthesisLlm: 'google',
        llmResults: [{ provider: 'google', model: 'gemini-2.0-flash', status: 'pending' }],
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

    it('sends notification on successful synthesis', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedLlms: ['google'],
        synthesisLlm: 'google',
        llmResults: [{ provider: 'google', model: 'gemini-2.0-flash', status: 'pending' }],
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
        selectedLlms: ['google'],
        llmResults: [{ provider: 'google', model: 'gemini-2.0-flash', status: 'pending' }],
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
        selectedLlms: ['google', 'openai'],
        llmResults: [
          { provider: 'google', model: 'gemini-2.0-flash', status: 'completed', result: 'Done' },
          { provider: 'openai', model: 'o4-mini-deep-research', status: 'pending' },
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
            data: encodePubSubMessage(createLlmCallEvent({ provider: 'openai' })),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.status).toBe('awaiting_confirmation');
      expect(updatedResearch?.partialFailure?.failedProviders).toContain('openai');
    });

    it('handles partial failure when LLM succeeds but another already failed', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedLlms: ['google', 'openai'],
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'failed',
            error: 'Previous failure',
          },
          { provider: 'openai', model: 'o4-mini-deep-research', status: 'pending' },
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
            data: encodePubSubMessage(createLlmCallEvent({ provider: 'openai' })),
            messageId: 'msg-123',
          },
          subscription: 'test-sub',
        },
      });

      expect(response.statusCode).toBe(200);

      const updatedResearch = fakeRepo.getAll()[0];
      expect(updatedResearch?.status).toBe('awaiting_confirmation');
      expect(updatedResearch?.partialFailure?.failedProviders).toContain('google');
      expect(updatedResearch?.llmResults.find((r) => r.provider === 'openai')?.status).toBe(
        'completed'
      );
    });

    it('fails synthesis when synthesis API key missing after LLM completion', async () => {
      const research = createTestResearch({
        id: 'research-123',
        status: 'processing',
        selectedLlms: ['google'],
        synthesisLlm: 'anthropic',
        llmResults: [{ provider: 'google', model: 'gemini-2.0-flash', status: 'pending' }],
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
  });
});
