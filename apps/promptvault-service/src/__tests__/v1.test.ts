import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import { clearJwksCache } from '@praxos/common';
import { FakeNotionConnectionRepository } from '@praxos/infra-firestore';
import { MockNotionApiAdapter, createNotionPromptRepository } from '@praxos/infra-notion';

describe('promptvault-service v1 endpoints', () => {
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
      // Set environment variables for JWT auth
      process.env['AUTH_JWKS_URL'] =
        `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
      process.env['AUTH_ISSUER'] = issuer;
      process.env['AUTH_AUDIENCE'] = audience;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
    delete process.env['AUTH_JWKS_URL'];
    delete process.env['AUTH_ISSUER'];
    delete process.env['AUTH_AUDIENCE'];
  });

  beforeEach(async () => {
    // Create fresh test adapters from infra packages
    connectionRepository = new FakeNotionConnectionRepository();
    notionApi = new MockNotionApiAdapter();

    // Inject test adapters via DI
    setServices({
      connectionRepository,
      notionApi,
      promptRepository: createNotionPromptRepository(connectionRepository, notionApi),
    });

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
    it('connects successfully, validates page access, and includes page info in response', async () => {
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
          pageTitle: string;
          pageUrl: string;
        };
        diagnostics: { requestId: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(true);
      expect(body.data.promptVaultPageId).toBe('page-123');
      // Verify page info from validation is included
      expect(body.data.pageTitle).toBe('Prompt Vault');
      expect(body.data.pageUrl).toContain('page-123');
      expect(body.diagnostics.requestId).toBeDefined();

      // Verify token is NOT in response
      const bodyStr = response.body;
      expect(bodyStr).not.toContain('secret-notion-token');
    });

    it('returns 400 INVALID_REQUEST when page is not accessible (not shared with integration)', async () => {
      const token = await createToken({ sub: 'user-inaccessible' });

      // Configure the mock to return NOT_FOUND for this page
      notionApi.setPageInaccessible('inaccessible-page-id');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'valid-token',
          promptVaultPageId: 'inaccessible-page-id',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string; details?: { pageId: string } };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('Could not access page');
      expect(body.error.message).toContain('shared with your Notion integration');
      expect(body.error.details?.pageId).toBe('inaccessible-page-id');
    });

    it('returns 401 UNAUTHORIZED when Notion token is invalid', async () => {
      const token = await createToken({ sub: 'user-bad-notion' });

      // Configure the mock to treat this token as invalid
      notionApi.setTokenInvalid('bad-notion-token');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'bad-notion-token',
          promptVaultPageId: 'some-page-id',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Invalid Notion token');
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

  describe('GET /v1/tools/notion/promptvault/prompts (listPrompts)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-list-prompts' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/tools/notion/promptvault/prompts',
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

    it('returns empty list when connected but no prompts exist', async () => {
      const token = await createToken({ sub: 'user-empty-list' });

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
        method: 'GET',
        url: '/v1/tools/notion/promptvault/prompts',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { prompts: unknown[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompts).toHaveLength(0);
    });
  });

  describe('POST /v1/tools/notion/promptvault/prompts (createPrompt)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-create-prompt' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Prompt',
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

    it('creates prompt successfully', async () => {
      const token = await createToken({ sub: 'user-create-prompt-success' });

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
        url: '/v1/tools/notion/promptvault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'My New Prompt',
          prompt: 'This is my prompt content',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          prompt: { id: string; title: string; prompt: string };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompt.id).toBeDefined();
      expect(body.data.prompt.title).toBe('My New Prompt');
      expect(body.data.prompt.prompt).toBe('This is my prompt content');
    });

    it('rejects requests with missing title', async () => {
      const token = await createToken({ sub: 'user-missing-title' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
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

    it('rejects requests with missing prompt', async () => {
      const token = await createToken({ sub: 'user-missing-prompt' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Title',
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

    it('rejects title exceeding max length (200 chars)', async () => {
      const token = await createToken({ sub: 'user-long-title' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/prompts',
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
  });

  describe('GET /v1/tools/notion/promptvault/prompts/:promptId (getPrompt)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-get-prompt' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/tools/notion/promptvault/prompts/some-prompt-id',
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

    it('returns NOT_FOUND for non-existent prompt', async () => {
      const token = await createToken({ sub: 'user-get-nonexistent' });

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
        method: 'GET',
        url: '/v1/tools/notion/promptvault/prompts/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /v1/tools/notion/promptvault/prompts/:promptId (updatePrompt)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-update-prompt' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/tools/notion/promptvault/prompts/some-prompt-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Updated Title',
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

    it('rejects empty update (no title or prompt)', async () => {
      const token = await createToken({ sub: 'user-empty-update' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/tools/notion/promptvault/prompts/some-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns NOT_FOUND for non-existent prompt', async () => {
      const token = await createToken({ sub: 'user-update-nonexistent' });

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
        method: 'PATCH',
        url: '/v1/tools/notion/promptvault/prompts/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'New Title',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
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
      expect(body.serviceName).toBe('promptvault-service');
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
      expect(body.info.title).toBe('PromptVaultService');
      expect(body.components.securitySchemes).toBeDefined();
    });
  });
});
