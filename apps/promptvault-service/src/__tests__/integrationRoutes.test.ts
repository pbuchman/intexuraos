/**
 * Tests for Notion integration routes:
 * - POST /v1/integrations/notion/connect
 * - GET /v1/integrations/notion/status
 * - POST /v1/integrations/notion/disconnect
 */
import { describe, it, expect, setupTestContext, createToken } from './testUtils.js';

describe('Notion Integration Routes', () => {
  const ctx = setupTestContext();

  describe('POST /v1/integrations/notion/connect', () => {
    it('connects successfully, validates page access, and includes page info in response', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
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
      expect(body.data.pageTitle).toBe('Prompt Vault');
      expect(body.data.pageUrl).toContain('page-123');
      expect(body.diagnostics.requestId).toBeDefined();

      // Verify token is NOT in response
      const bodyStr = response.body;
      expect(bodyStr).not.toContain('secret-notion-token');
    });

    it('returns 400 INVALID_REQUEST when page is not accessible (not shared with integration)', async () => {
      const token = await createToken({ sub: 'user-inaccessible' });

      ctx.notionApi.setPageInaccessible('inaccessible-page-id');

      const response = await ctx.app.inject({
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

      ctx.notionApi.setTokenInvalid('bad-notion-token');

      const response = await ctx.app.inject({
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

      const response = await ctx.app.inject({
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

      const response = await ctx.app.inject({
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
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-456',
        },
      });

      // Then check status
      const response = await ctx.app.inject({
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
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/integrations/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-789',
        },
      });

      // Then disconnect
      const response = await ctx.app.inject({
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
});
