/**
 * Tests for webhook routes:
 * - POST /v1/webhooks/notion
 */
import { describe, it, expect, setupTestContext } from './testUtils.js';

describe('POST /v1/webhooks/notion', () => {
  const ctx = setupTestContext();

  it('accepts any JSON and returns ok (no auth required)', async () => {
    const response = await ctx.app.inject({
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
