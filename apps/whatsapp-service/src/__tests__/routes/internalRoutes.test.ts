import {
  describe,
  expect,
  it,
  setupTestContext,
} from '../testUtils.js';

describe('WhatsApp internal routes', () => {
  const ctx = setupTestContext();

  it('rejects retry-pending requests without internal auth', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/webhooks/retry-pending',
      headers: {
        'content-type': 'application/json',
      },
      payload: JSON.stringify({}),
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects retry-pending requests with validation errors', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/webhooks/retry-pending',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': 'test-internal-token',
      },
      payload: JSON.stringify({ eventIds: [''] }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('runs retry-pending with an empty default body', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/webhooks/retry-pending',
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        processed: 0,
        skipped: 0,
        failed: 0,
        total: 0,
        events: [],
      },
    });
  });
});
