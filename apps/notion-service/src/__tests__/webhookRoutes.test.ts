/**
 * Tests for webhook routes:
 * - POST /notion-webhooks
 */
import { describe, it, expect, setupTestContext } from './testUtils.js';

describe('POST /notion-webhooks', () => {
  const ctx = setupTestContext();

  it('accepts any JSON and returns ok (no auth required)', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/notion-webhooks',
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

  it('returns 400 validation error when payload is not an object', async () => {
    // Send an array instead of an object - arrays fail z.record() validation
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/notion-webhooks',
      payload: ['array', 'not', 'object'],
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string; details?: { errors: unknown[] } };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toBe('Validation failed');
  });
});
