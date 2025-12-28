/**
 * Tests for Notion integration routes:
 * - POST /notion/connect
 * - GET /notion/status
 * - DELETE /notion/disconnect
 */
import { describe, it, expect, setupTestContext, createToken } from './testUtils.js';

describe('Notion Integration Routes', () => {
  const ctx = setupTestContext();

  describe('POST /notion/connect', () => {
    it('connects successfully, validates page access, and includes page info in response', async () => {
      const token = await createToken({ sub: 'user-123' });

      // Set up the page in the mock before attempting to connect
      ctx.notionApi.setPage('page-123', 'Prompt Vault', 'Test content');

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
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
        url: '/notion/connect',
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

    it('returns 400 INVALID_REQUEST when notionToken is missing', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
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

    it('returns 400 INVALID_REQUEST when promptVaultPageId is missing', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-notion-token',
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

    it('returns 400 INVALID_REQUEST when promptVaultPageId is empty string', async () => {
      const token = await createToken({ sub: 'user-empty-page-id' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-notion-token',
          promptVaultPageId: '',
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

    it('returns 401 UNAUTHORIZED when Notion token is invalid', async () => {
      const token = await createToken({ sub: 'user-unauthorized' });

      // Set up the page but mark the token as unauthorized
      ctx.notionApi.setPage('page-unauth', 'Test Page', 'Test content');
      ctx.notionApi.setTokenUnauthorized('invalid-notion-token');

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'invalid-notion-token',
          promptVaultPageId: 'page-unauth',
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

    it('returns 502 DOWNSTREAM_ERROR when Notion API returns unexpected error', async () => {
      const token = await createToken({ sub: 'user-downstream' });

      // Set up an unexpected error from the Notion API
      ctx.notionApi.setNextError({ code: 'RATE_LIMITED', message: 'Too many requests' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'valid-token',
          promptVaultPageId: 'any-page',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 502 DOWNSTREAM_ERROR when repository fails to save', async () => {
      const token = await createToken({ sub: 'user-repo-fail' });

      // Set up a valid page but make the repository fail
      ctx.notionApi.setPage('page-save-fail', 'Test Page', 'Test content');
      ctx.connectionRepository.setFailNextSave(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'valid-token',
          promptVaultPageId: 'page-save-fail',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('GET /notion/status', () => {
    it('shows connected=false when not configured', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notion/status',
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

      // Set up the page in the mock before attempting to connect
      ctx.notionApi.setPage('page-456', 'Test Page', 'Test content');

      // First connect
      await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-456',
        },
      });

      // Then check status
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notion/status',
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

    it('returns 502 DOWNSTREAM_ERROR when repository fails to get connection', async () => {
      const token = await createToken({ sub: 'user-status-fail' });
      ctx.connectionRepository.setFailNextGet(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notion/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('DELETE /notion/disconnect', () => {
    it('disconnects successfully', async () => {
      const token = await createToken({ sub: 'user-789' });

      // Set up the page in the mock before attempting to connect
      ctx.notionApi.setPage('page-789', 'Test Page', 'Test content');

      // First connect
      await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-789',
        },
      });

      // Then disconnect
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/notion/disconnect',
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

    it('returns 502 DOWNSTREAM_ERROR when repository fails to disconnect', async () => {
      const token = await createToken({ sub: 'user-disconnect-fail' });

      // Set up a connection first
      ctx.notionApi.setPage('page-disconnect', 'Test Page', 'Test content');
      await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
          promptVaultPageId: 'page-disconnect',
        },
      });

      // Make the repository fail on disconnect
      ctx.connectionRepository.setFailNextDisconnect(true);

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/notion/disconnect',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });
});
