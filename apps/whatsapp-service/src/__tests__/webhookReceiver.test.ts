/**
 * Tests for webhook event receiver:
 * - POST /whatsapp/webhooks
 */
import { createHmac } from 'node:crypto';
import {
  describe,
  it,
  expect,
  setupTestContext,
  testConfig,
  createSignature,
  createWebhookPayload,
} from './testUtils.js';

describe('POST /whatsapp/webhooks (webhook event receiver)', () => {
  const ctx = setupTestContext();

  it('accepts valid webhook payload with correct signature', async () => {
    const payload = createWebhookPayload();
    const payloadString = JSON.stringify(payload);
    const signature = createSignature(payloadString, testConfig.appSecret);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: payloadString,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { received: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.received).toBe(true);
  });

  it('persists webhook event to Firestore', async () => {
    const payload = createWebhookPayload();
    const payloadString = JSON.stringify(payload);
    const signature = createSignature(payloadString, testConfig.appSecret);

    await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: payloadString,
    });

    const events = ctx.webhookEventRepository.getAll();
    expect(events.length).toBe(1);
    expect(events[0]?.signatureValid).toBe(true);
    expect(events[0]?.phoneNumberId).toBe('123456789012345');
    expect(events[0]?.receivedAt).toBeDefined();
  });

  it('returns 401 when signature header is missing', async () => {
    const payload = createWebhookPayload();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
      },
      payload: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('Missing');
  });

  it('returns 403 when signature is invalid', async () => {
    const payload = createWebhookPayload();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid-signature',
      },
      payload: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('Invalid');
  });

  it('returns 403 when signature format is wrong (no sha256= prefix)', async () => {
    const payload = createWebhookPayload();
    const payloadString = JSON.stringify(payload);
    const hash = createHmac('sha256', testConfig.appSecret).update(payloadString).digest('hex');

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': hash, // Missing sha256= prefix
      },
      payload: payloadString,
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 403 when signature is computed with wrong secret', async () => {
    const payload = createWebhookPayload();
    const payloadString = JSON.stringify(payload);
    const signature = createSignature(payloadString, 'wrong-secret');

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: payloadString,
    });

    expect(response.statusCode).toBe(403);
  });

  it('handles empty signature header with 401', async () => {
    const payload = createWebhookPayload();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': '',
      },
      payload: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(401);
  });

  it('does not persist event when signature is invalid', async () => {
    const payload = createWebhookPayload();

    await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid',
      },
      payload: JSON.stringify(payload),
    });

    const events = ctx.webhookEventRepository.getAll();
    expect(events.length).toBe(0);
  });

  it('returns 403 when waba_id is not in allowed list', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'unknown-waba-id-not-allowed',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15551234567',
                  phone_number_id: '123456789012345', // Valid phone number ID
                },
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid.XXXXX',
                    timestamp: '1234567890',
                    type: 'text',
                    text: { body: 'Test' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const payloadString = JSON.stringify(payload);
    const signature = createSignature(payloadString, testConfig.appSecret);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: payloadString,
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('waba_id');
    expect(body.error.message).toContain('not allowed');

    // Should not persist event when waba_id doesn't match
    const events = ctx.webhookEventRepository.getAll();
    expect(events.length).toBe(0);
  });

  it('returns 403 when phone_number_id is not in allowed list', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398', // Valid WABA ID
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15551234567',
                  phone_number_id: 'unknown-phone-id-not-allowed',
                },
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid.XXXXX',
                    timestamp: '1234567890',
                    type: 'text',
                    text: { body: 'Test' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const payloadString = JSON.stringify(payload);
    const signature = createSignature(payloadString, testConfig.appSecret);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: payloadString,
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('phone_number_id');
    expect(body.error.message).toContain('not allowed');

    // Should not persist event when phone_number_id doesn't match
    const events = ctx.webhookEventRepository.getAll();
    expect(events.length).toBe(0);
  });

  it('handles status updates correctly', async () => {
    const statusPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398', // Valid WABA ID
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15559876543',
                  phone_number_id: '987654321098765', // Valid phone number ID
                },
                statuses: [
                  {
                    id: 'wamid.XXXXX',
                    status: 'delivered',
                    timestamp: '1234567890',
                    recipient_id: '15551234567',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const payloadString = JSON.stringify(statusPayload);
    const signature = createSignature(payloadString, testConfig.appSecret);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/whatsapp/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: payloadString,
    });

    expect(response.statusCode).toBe(200);
    const events = ctx.webhookEventRepository.getAll();
    expect(events[0]?.phoneNumberId).toBe('987654321098765');
  });
});
