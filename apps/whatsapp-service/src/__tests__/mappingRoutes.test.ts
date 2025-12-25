/**
 * Tests for WhatsApp user mapping routes:
 * - POST /v1/whatsapp/connect
 * - GET /v1/whatsapp/status
 * - DELETE /v1/whatsapp/disconnect
 */
import { describe, it, expect, setupTestContext, createToken } from './testUtils.js';

describe('WhatsApp Mapping Routes', () => {
  const ctx = setupTestContext();

  describe('POST /v1/whatsapp/connect', () => {
    it('returns 401 when no authorization header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/whatsapp/connect',
        payload: {
          phoneNumbers: ['+15551234567'],
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

    it('creates mapping successfully with valid input', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+15551234567'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          phoneNumbers: string[];
          connected: boolean;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.phoneNumbers).toEqual(['+15551234567']);
      expect(body.data.connected).toBe(true);
    });

    it('returns 400 when phoneNumbers is empty', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: [],
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

    it('updates existing mapping for same user', async () => {
      const token = await createToken({ sub: 'user-456' });

      // Create initial mapping
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+15551111111'],
        },
      });

      // Update mapping
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+15552222222'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          phoneNumbers: string[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.phoneNumbers).toEqual(['+15552222222']);
    });
  });

  describe('GET /v1/whatsapp/status', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/whatsapp/status',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns null when no mapping exists', async () => {
      const token = await createToken({ sub: 'user-no-mapping' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/whatsapp/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: null;
      };
      expect(body.success).toBe(true);
      expect(body.data).toBeNull();
    });

    it('returns mapping when it exists', async () => {
      const token = await createToken({ sub: 'user-with-mapping' });

      // Create mapping first
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+15553333333'],
        },
      });

      // Get status
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/whatsapp/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          phoneNumbers: string[];
          connected: boolean;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.phoneNumbers).toEqual(['+15553333333']);
      expect(body.data.connected).toBe(true);
    });
  });

  describe('DELETE /v1/whatsapp/disconnect', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/v1/whatsapp/disconnect',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 when no mapping exists', async () => {
      const token = await createToken({ sub: 'user-no-mapping-delete' });

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/v1/whatsapp/disconnect',
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

    it('disconnects mapping successfully', async () => {
      const token = await createToken({ sub: 'user-to-disconnect' });

      // Create mapping first
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+15554444444'],
        },
      });

      // Disconnect
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/v1/whatsapp/disconnect',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          phoneNumbers: string[];
          connected: boolean;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(false);
    });

    it('verifies mapping is disconnected after disconnect', async () => {
      const token = await createToken({ sub: 'user-verify-disconnect' });

      // Create mapping
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+15555555555'],
        },
      });

      // Disconnect
      await ctx.app.inject({
        method: 'DELETE',
        url: '/v1/whatsapp/disconnect',
        headers: { authorization: `Bearer ${token}` },
      });

      // Verify status shows disconnected
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/whatsapp/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          connected: boolean;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(false);
    });
  });
});
