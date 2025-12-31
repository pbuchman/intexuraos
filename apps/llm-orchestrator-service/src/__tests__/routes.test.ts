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
import { FakeResearchRepository } from './fakes.js';
import type { Research } from '../domain/research/index.js';

const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH_AUDIENCE = 'urn:intexuraos:api';
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
    process.env['AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['AUTH_AUDIENCE'] = 'urn:intexuraos:api';

    fakeRepo = new FakeResearchRepository();
    const services: ServiceContainer = {
      researchRepo: fakeRepo,
      generateId: (): string => 'generated-id-123',
      processResearchAsync: (): void => {
        /* noop */
      },
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
});

describe('Research Routes - Authenticated', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;
  const issuer = `https://${AUTH0_DOMAIN}/`;

  let fakeRepo: FakeResearchRepository;
  let processResearchCalled: boolean;

  async function createToken(sub: string): Promise<string> {
    const builder = new jose.SignJWT({ sub })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(AUTH_AUDIENCE)
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
    process.env['AUTH_JWKS_URL'] = jwksUrl;
    process.env['AUTH_ISSUER'] = issuer;
    process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;

    clearJwksCache();

    fakeRepo = new FakeResearchRepository();
    processResearchCalled = false;
    const services: ServiceContainer = {
      researchRepo: fakeRepo,
      generateId: (): string => 'generated-id-123',
      processResearchAsync: (): void => {
        processResearchCalled = true;
      },
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

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: Research };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('generated-id-123');
      expect(body.data.userId).toBe(TEST_USER_ID);
      expect(body.data.prompt).toBe('Test prompt');
      expect(processResearchCalled).toBe(true);
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

      expect(response.statusCode).toBe(200);
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
});

describe('System Endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['AUTH_AUDIENCE'] = 'urn:intexuraos:api';

    const fakeRepo = new FakeResearchRepository();
    const services: ServiceContainer = {
      researchRepo: fakeRepo,
      generateId: (): string => 'generated-id-123',
      processResearchAsync: (): void => {
        /* noop */
      },
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
