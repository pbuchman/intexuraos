/**
 * Tests for Notion integration routes:
 * - POST /notion/connect
 * - GET /notion/status
 * - DELETE /notion/disconnect
 */
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('Notion Integration Routes', () => {
  const ctx = setupTestContext();

  describe('POST /notion/connect', () => {
    it('returns 401 UNAUTHORIZED when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        payload: {
          notionToken: 'secret-notion-token',
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

    it('connects successfully and validates token', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-notion-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          connected: boolean;
          createdAt: string;
          updatedAt: string;
        };
        diagnostics: { requestId: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(true);
      expect(body.data.createdAt).toBeDefined();
      expect(body.data.updatedAt).toBeDefined();
      expect(body.diagnostics.requestId).toBeDefined();

      // Verify token is NOT in response
      const bodyStr = response.body;
      expect(bodyStr).not.toContain('secret-notion-token');
    });

    it('returns 400 INVALID_REQUEST when notionToken is missing', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
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

    it('returns 401 UNAUTHORIZED when Notion token is invalid', async () => {
      const token = await createToken({ sub: 'user-unauthorized' });

      ctx.notionApi.setTokenUnauthorized('invalid-notion-token');

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'invalid-notion-token',
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

      ctx.connectionRepository.setFailNextSave(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'valid-token',
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

      // First connect
      await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
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
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.configured).toBe(true);
      expect(body.data.connected).toBe(true);
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
    it('returns 401 UNAUTHORIZED when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/notion/disconnect',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('disconnects successfully', async () => {
      const token = await createToken({ sub: 'user-789' });

      // First connect
      await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
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
      await ctx.app.inject({
        method: 'POST',
        url: '/notion/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          notionToken: 'secret-token',
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
