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
});
