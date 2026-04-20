/**
 * Tests for WhatsApp notification preferences routes:
 * - GET /whatsapp/preferences
 * - PUT /whatsapp/preferences
 *
 * Privacy contract (INT-1418): notificationLevel must NEVER appear in
 * the /whatsapp/status response.
 */
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('WhatsApp Preferences Routes', () => {
  const ctx = setupTestContext();

  describe('GET /whatsapp/preferences', () => {
    it('returns 401 when no authorization header', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/preferences',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns { notificationLevel: "all" } by default', async () => {
      const token = await createToken({ sub: 'user-default' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notificationLevel: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.notificationLevel).toBe('all');
    });

    it('returns the stored level after a PUT', async () => {
      const token = await createToken({ sub: 'user-1' });

      // Update the level via PUT
      const putResponse = await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
        payload: { notificationLevel: 'important' },
      });
      expect(putResponse.statusCode).toBe(200);

      // Read it back via GET
      const getResponse = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(getResponse.statusCode).toBe(200);
      const body = JSON.parse(getResponse.body) as {
        success: boolean;
        data: { notificationLevel: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.notificationLevel).toBe('important');
    });

    it('returns 502 when getPreferences fails with downstream error', async () => {
      const token = await createToken({ sub: 'user-downstream' });
      ctx.notificationPreferencesRepository.failNext({
        code: 'INTERNAL_ERROR',
        message: 'Simulated getPreferences failure',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/preferences',
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

  describe('PUT /whatsapp/preferences', () => {
    it('returns 401 when no authorization header', async () => {
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
        payload: { notificationLevel: 'important' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 400 when notificationLevel is missing (empty body)', async () => {
      const token = await createToken({ sub: 'user-missing' });

      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
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

    it('returns 400 when notificationLevel is an unknown value', async () => {
      const token = await createToken({ sub: 'user-bad-value' });

      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
        payload: { notificationLevel: 'loud' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 200 with the new value and is readable via GET', async () => {
      const token = await createToken({ sub: 'user-put-get' });

      const putResponse = await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
        payload: { notificationLevel: 'important' },
      });

      expect(putResponse.statusCode).toBe(200);
      const putBody = JSON.parse(putResponse.body) as {
        success: boolean;
        data: { notificationLevel: string };
      };
      expect(putBody.success).toBe(true);
      expect(putBody.data.notificationLevel).toBe('important');

      // Verify GET returns the same value
      const getResponse = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(getResponse.statusCode).toBe(200);
      const getBody = JSON.parse(getResponse.body) as {
        success: boolean;
        data: { notificationLevel: string };
      };
      expect(getBody.data.notificationLevel).toBe('important');
    });

    it('returns 502 when savePreferences fails with downstream error', async () => {
      const token = await createToken({ sub: 'user-save-downstream' });
      ctx.notificationPreferencesRepository.failNext({
        code: 'INTERNAL_ERROR',
        message: 'Simulated savePreferences failure',
      });

      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
        payload: { notificationLevel: 'important' },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('supports switching back from important to all', async () => {
      const token = await createToken({ sub: 'user-switch' });

      await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
        payload: { notificationLevel: 'important' },
      });

      const switchResponse = await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
        payload: { notificationLevel: 'all' },
      });

      expect(switchResponse.statusCode).toBe(200);
      const body = JSON.parse(switchResponse.body) as {
        success: boolean;
        data: { notificationLevel: string };
      };
      expect(body.data.notificationLevel).toBe('all');
    });
  });

  describe('Privacy contract — INT-1418', () => {
    it('notificationLevel never appears in /whatsapp/status response', async () => {
      const token = await createToken({ sub: 'user-1' });

      // Seed a mapping so /whatsapp/status returns real data (not null)
      ctx.userMappingRepository.setMappingForPhone('+12125551234', 'user-1');

      // Set notificationLevel to 'important' via PUT
      const putResponse = await ctx.app.inject({
        method: 'PUT',
        url: '/whatsapp/preferences',
        headers: { authorization: `Bearer ${token}` },
        payload: { notificationLevel: 'important' },
      });
      expect(putResponse.statusCode).toBe(200);

      // GET /whatsapp/status — must NOT include notificationLevel anywhere
      const statusResponse = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.body).not.toContain('notificationLevel');

      // Sanity check — status response should have real mapping data
      const statusBody = JSON.parse(statusResponse.body) as {
        success: boolean;
        data: { phoneNumbers?: string[]; connected?: boolean } | null;
      };
      expect(statusBody.success).toBe(true);
      expect(statusBody.data).not.toBeNull();
    });
  });
});
