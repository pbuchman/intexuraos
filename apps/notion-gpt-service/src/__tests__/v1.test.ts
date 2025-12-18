import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { buildServer } from '../server.js';
import { clearStore } from '../stub/store.js';
import { clearJwksCache } from '@praxos/common';

describe('notion-gpt-service v1 endpoints', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;

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
  });

  beforeEach(async () => {
    clearStore();
    clearJwksCache();
    app = await buildServer();
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

  describe('POST /v1/tools/notion/note', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
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

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('creates note with id and url', async () => {
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
        url: '/v1/tools/notion/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'My Note',
          content: 'Note content here',
          idempotencyKey: 'idem-key-001',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          created: { id: string; url: string; title: string };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.created.id).toBeDefined();
      expect(body.data.created.id.length).toBeGreaterThan(0);
      expect(body.data.created.url).toBeDefined();
      expect(body.data.created.url).toContain('notion.so');
      expect(body.data.created.title).toBe('My Note');
    });

    it('returns same id/url for same idempotencyKey (idempotency)', async () => {
      const token = await createToken({ sub: 'user-idempotency' });

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

      // Create note first time
      const response1 = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Idempotent Note',
          content: 'Content',
          idempotencyKey: 'same-key-123',
        },
      });

      const body1 = JSON.parse(response1.body) as {
        data: { created: { id: string; url: string } };
      };
      const firstId = body1.data.created.id;
      const firstUrl = body1.data.created.url;

      // Create note second time with same key
      const response2 = await app.inject({
        method: 'POST',
        url: '/v1/tools/notion/note',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Different Title',
          content: 'Different Content',
          idempotencyKey: 'same-key-123',
        },
      });

      const body2 = JSON.parse(response2.body) as {
        data: { created: { id: string; url: string } };
      };

      expect(body2.data.created.id).toBe(firstId);
      expect(body2.data.created.url).toBe(firstUrl);
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
      expect(body.status).toBe('ok');
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
