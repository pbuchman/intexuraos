/**
 * Tests for webhook verification:
 * - GET /whatsapp/webhooks (Meta webhook verification)
 */
import { describe, expect, it, setupTestContext, testConfig } from './testUtils.js';

describe('GET /whatsapp/webhooks (webhook verification)', () => {
  const ctx = setupTestContext();

  it('returns challenge when verify token matches', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/whatsapp/webhooks',
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': testConfig.verifyToken,
        'hub.challenge': 'challenge-12345',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('challenge-12345');
    expect(response.headers['content-type']).toContain('text/plain');
  });

  it('returns 403 when verify token does not match', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/whatsapp/webhooks',
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-12345',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when hub.mode is not subscribe', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/whatsapp/webhooks',
      query: {
        'hub.mode': 'unsubscribe',
        'hub.verify_token': testConfig.verifyToken,
        'hub.challenge': 'challenge-12345',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when verify token is missing', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/whatsapp/webhooks',
      query: {
        'hub.mode': 'subscribe',
        'hub.challenge': 'challenge-12345',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when challenge is missing', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/whatsapp/webhooks',
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': testConfig.verifyToken,
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
