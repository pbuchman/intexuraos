/**
 * Tests for WhatsApp user mapping routes:
 * - POST /whatsapp/connect
 * - GET /whatsapp/status
 * - DELETE /whatsapp/disconnect
 */
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('WhatsApp Mapping Routes', () => {
  const ctx = setupTestContext();

  describe('POST /whatsapp/connect', () => {
    it('returns 401 when no authorization header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
        payload: {
          phoneNumbers: ['+12125551234'],
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
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+12125551234'],
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
      expect(body.data.phoneNumbers).toEqual(['12125551234']);
      expect(body.data.connected).toBe(true);
    });

    it('returns 400 when phoneNumbers is empty', async () => {
      const token = await createToken({ sub: 'user-123' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
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
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+12125551111'],
        },
      });

      // Update mapping
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+12125552222'],
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
      expect(body.data.phoneNumbers).toEqual(['12125552222']);
    });

    it('returns 400 when phone number format is invalid', async () => {
      const token = await createToken({ sub: 'user-invalid-phone' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['invalid-not-a-phone'],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Invalid phone number format');
    });

    it('returns 409 when phone number is already mapped to another user', async () => {
      // Enable phone uniqueness enforcement in the fake repository
      ctx.userMappingRepository.setEnforcePhoneUniqueness(true);

      // First user claims the phone number
      const token1 = await createToken({ sub: 'user-first' });
      await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token1}` },
        payload: {
          phoneNumbers: ['+12125559999'],
        },
      });

      // Second user tries to claim the same phone number
      const token2 = await createToken({ sub: 'user-second' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token2}` },
        payload: {
          phoneNumbers: ['+12125559999'],
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already mapped');
    });

    it('returns 502 when saveMapping fails with downstream error', async () => {
      const token = await createToken({ sub: 'user-save-error' });

      // Configure the fake to fail saveMapping with INTERNAL_ERROR
      ctx.userMappingRepository.setFailSaveMapping(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+12125558888'],
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

  describe('GET /whatsapp/status', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/status',
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
        url: '/whatsapp/status',
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
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+12125553333'],
        },
      });

      // Get status
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/status',
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
      expect(body.data.phoneNumbers).toEqual(['12125553333']);
      expect(body.data.connected).toBe(true);
    });

    it('returns 502 when getMapping fails with downstream error', async () => {
      const token = await createToken({ sub: 'user-downstream-error' });

      // Configure the fake to fail getMapping
      ctx.userMappingRepository.setFailGetMapping(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/status',
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

  describe('DELETE /whatsapp/disconnect', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/whatsapp/disconnect',
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
        url: '/whatsapp/disconnect',
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
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+12125554444'],
        },
      });

      // Disconnect
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/whatsapp/disconnect',
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
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+12125555555'],
        },
      });

      // Disconnect
      await ctx.app.inject({
        method: 'DELETE',
        url: '/whatsapp/disconnect',
        headers: { authorization: `Bearer ${token}` },
      });

      // Verify status shows disconnected
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/status',
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

    it('returns 502 when disconnectMapping fails with downstream error', async () => {
      const token = await createToken({ sub: 'user-disconnect-error' });

      // Create mapping first
      await ctx.app.inject({
        method: 'POST',
        url: '/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          phoneNumbers: ['+12125556666'],
        },
      });

      // Configure the fake to fail disconnectMapping with INTERNAL_ERROR (not NOT_FOUND)
      ctx.userMappingRepository.setFailDisconnect(true);

      // Try to disconnect
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/whatsapp/disconnect',
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
