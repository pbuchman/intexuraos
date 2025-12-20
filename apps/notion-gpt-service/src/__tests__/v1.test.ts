import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import { clearJwksCache } from '@praxos/common';
import { FakeNotionConnectionRepository } from '@praxos/infra-firestore';
import { MockNotionApiAdapter } from '@praxos/infra-notion';

describe('notion-gpt-service v1 endpoints', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;

  // Test adapter instances
  let connectionRepository: FakeNotionConnectionRepository;
  let notionApi: MockNotionApiAdapter;

  const issuer = 'https://test-issuer.example.com/';
  const audience = 'test-audience';

  async function createToken(
    claims: Record<string, unknown>,
    options?: { expiresIn?: string }
  ): Promise<string> {
    const builder = new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience);

    if (options?.expiresIn !== undefined) {
      builder.setExpirationTime(options.expiresIn);
    } else {
      builder.setExpirationTime('1h');
    }

    return await builder.sign(privateKey);
  }

  beforeAll(async () => {
    // Generate RSA key pair for testing
    const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
    privateKey = privKey;

    // Export public key as JWK
    const publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = 'test-key-1';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    // Start local JWKS server
    jwksServer = Fastify({ logger: false });

    jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
      return await reply.send({
        keys: [publicKeyJwk],
      });
    });

    await jwksServer.listen({ port: 0, host: '127.0.0.1' });
    const address = jwksServer.server.address();
    if (address !== null && typeof address === 'object') {
      const jwksUrl = `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;

      // Set environment variables for JWT auth
      process.env['AUTH_JWKS_URL'] = jwksUrl;
      process.env['AUTH_ISSUER'] = issuer;
      process.env['AUTH_AUDIENCE'] = audience;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
    delete process.env['AUTH_JWKS_URL'];
    delete process.env['AUTH_ISSUER'];
    delete process.env['AUTH_AUDIENCE'];
    delete process.env['SERVICE_URL'];
  });

  beforeEach(async () => {
    // Create fresh test adapters from infra packages
    connectionRepository = new FakeNotionConnectionRepository();
    notionApi = new MockNotionApiAdapter();

    // Inject test adapters via DI
    setServices({
      connectionRepository,
      notionApi,
    });

    process.env['SERVICE_URL'] = 'https://notion-test.example.com';
    clearJwksCache();
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('Authentication', () => {
    it('returns 401 UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/notion/status',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED when Authorization header is invalid format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/notion/status',
        headers: {
          authorization: 'InvalidFormat',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED for invalid JWT', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/notion/status',
        headers: {
          authorization: 'Bearer invalid-jwt-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED for expired JWT', async () => {
      const token = await createToken({ sub: 'user-123' }, { expiresIn: '-1s' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/notion/status',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('expired');
    });

    it('returns 401 UNAUTHORIZED for JWT missing sub claim', async () => {
      const token = await createToken({});

      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/notion/status',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('sub');
    });

    it('accepts valid JWT and extracts userId from sub', async () => {
      const token = await createToken({ sub: 'auth0|user-abc123' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/notion/status',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { configured: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.configured).toBe(false);
    });
  });

  describe('POST /v1/integrations/notion/connect', () => {
    it('connects successfully and does not leak token', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-notion-token',
          promptVaultPageId: 'page-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          connected: boolean;
          promptVaultPageId: string;
        };
        diagnostics: { requestId: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(true);
      expect(body.data.promptVaultPageId).toBe('page-123');
      expect(body.diagnostics.requestId).toBeDefined();

      // Verify token is NOT in response
      const bodyStr = response.body;
      expect(bodyStr).not.toContain('secret-notion-token');
    });

    it('returns 400 INVALID_REQUEST when notionToken is missing', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          promptVaultPageId: 'page-123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('GET /v1/integrations/notion/status', () => {
    it('shows connected=false when not configured', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/notion/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { configured: boolean; connected: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.configured).toBe(false);
      expect(body.data.connected).toBe(false);
    });

    it('shows connected=true after connect', async () => {
      const token = await createToken({ sub: 'user-456' });

      // First connect
      await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-456',
        },
      });

      // Then check status
      const response = await app.inject({
        method: 'GET',
        url: '/v1/integrations/notion/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          configured: boolean;
          connected: boolean;
          promptVaultPageId: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.configured).toBe(true);
      expect(body.data.connected).toBe(true);
      expect(body.data.promptVaultPageId).toBe('page-456');
    });
  });

  describe('POST /v1/integrations/notion/disconnect', () => {
    it('disconnects successfully', async () => {
      const token = await createToken({ sub: 'user-789' });

      // First connect
      await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-789',
        },
      });

      // Then disconnect
      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/disconnect',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { connected: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(false);
    });
  });

  describe('GET /v1/tools/notion/promptvault/main-page', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-main' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/tools/notion/promptvault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns page preview when connected', async () => {
      const token = await createToken({ sub: 'user-preview' });

      // First connect
      await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'vault-page-id',
        },
      });

      // Then get main page
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tools/notion/promptvault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          page: { id: string; title: string; url: string };
          preview: { blocks: unknown[] };
        };
        diagnostics: { requestId: string; durationMs: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.page.id).toBe('vault-page-id');
      expect(body.data.page.title).toBe('Prompt Vault');
      expect(body.data.preview.blocks).toHaveLength(4);
      expect(body.diagnostics.requestId).toBeDefined();
      expect(body.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /v1/tools/notion/note (legacy endpoint - REMOVED)', () => {
    it('returns 404 for the removed endpoint', async () => {
      const token = await createToken({ sub: 'user-note' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Note',
          content: 'Test content',
          idempotencyKey: 'key-123',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/tools/notion/promptvault/note', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-note' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Note',
          prompt: 'Test prompt content',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('creates note with pageId, url, and title in response', async () => {
      const token = await createToken({ sub: 'user-create-note' });

      // First connect
      await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-id',
        },
      });

      // Create note
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'My Note',
          prompt: 'My prompt content here',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { pageId: string; url: string; title: string };
        diagnostics: { requestId: string; durationMs: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.pageId).toBeDefined();
      expect(body.data.pageId.length).toBeGreaterThan(0);
      expect(body.data.url).toBeDefined();
      expect(body.data.url).toContain('notion.so');
      expect(body.data.title).toBe('My Note');
      expect(body.diagnostics.requestId).toBeDefined();
      expect(body.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('stores prompt verbatim (no trimming or normalization)', async () => {
      const token = await createToken({ sub: 'user-verbatim' });

      // Connect
      await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-id',
        },
      });

      // Prompt with whitespace, newlines, special chars that must be preserved
      const verbatimPrompt = '  \n\nYou are an assistant.  \n\n  Use markdown.\n\n  ';

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Verbatim Test',
          prompt: verbatimPrompt,
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify the mock captured the exact prompt
      const captured = notionApi.getLastCapturedNote();
      expect(captured).toBeDefined();
      expect(captured?.params.prompt).toBe(verbatimPrompt);
      expect(captured?.params.userId).toBe('user-verbatim');
    });

    it('passes correct userId to Notion adapter', async () => {
      const userId = 'auth0|specific-user-id-123';
      const token = await createToken({ sub: userId });

      // Connect
      await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-id',
        },
      });

      await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'User ID Test',
          prompt: 'Some prompt',
        },
      });

      const captured = notionApi.getLastCapturedNote();
      expect(captured?.params.userId).toBe(userId);
    });

    it('rejects requests with extra fields (strict schema)', async () => {
      const token = await createToken({ sub: 'user-strict' });

      // Connect
      await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-id',
        },
      });

      // Try to create note with extra field
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test',
          prompt: 'Test prompt',
          extraField: 'should be rejected',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects requests with missing title', async () => {
      const token = await createToken({ sub: 'user-missing-title' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; details: { errors: { path: string }[] } };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.details.errors.some((e) => e.path === 'title')).toBe(true);
    });

    it('rejects requests with missing prompt', async () => {
      const token = await createToken({ sub: 'user-missing-prompt' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Title',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; details: { errors: { path: string }[] } };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.details.errors.some((e) => e.path === 'prompt')).toBe(true);
    });

    it('rejects title exceeding max length (200 chars)', async () => {
      const token = await createToken({ sub: 'user-long-title' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'x'.repeat(201),
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('accepts title at max length (200 chars)', async () => {
      const token = await createToken({ sub: 'user-max-title' });

      // Connect first
      await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-id',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'x'.repeat(200),
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejects empty title', async () => {
      const token = await createToken({ sub: 'user-empty-title' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: '',
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects empty prompt', async () => {
      const token = await createToken({ sub: 'user-empty-prompt' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Title',
          prompt: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('requires auth (401 without token)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/note',
        payload: {
          title: 'Test',
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /v1/webhooks/notion', () => {
    it('accepts any JSON and returns ok (no auth required)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/notion',
        payload: {
          type: 'page_updated',
          data: { pageId: 'some-page' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { received: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);
    });
  });

  describe('System endpoints', () => {
    it('GET /health returns raw health response (not wrapped)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        status: string;
        serviceName: string;
        checks: unknown[];
      };
      // Health is NOT wrapped in success/data envelope
      expect(body.status).toBeDefined();
      expect(body.serviceName).toBe('notion-gpt-service');
      expect(body.checks).toBeDefined();
      expect((body as { success?: boolean }).success).toBeUndefined();
    });

    it('GET /openapi.json returns OpenAPI spec', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        openapi: string;
        info: { title: string };
        components: { securitySchemes: unknown };
      };
      expect(body.openapi).toMatch(/^3\./);
      expect(body.info.title).toBe('notion-gpt-service');
      expect(body.components.securitySchemes).toBeDefined();
    });
  });
});
