import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import {
  FakeWhatsAppWebhookEventRepository,
  FakeWhatsAppUserMappingRepository,
  FakeNotionConnectionRepository,
} from '@praxos/infra-firestore';
import type { Config } from '../config.js';

describe('whatsapp-service endpoints', () => {
  let app: FastifyInstance;
  let webhookEventRepository: FakeWhatsAppWebhookEventRepository;
  let userMappingRepository: FakeWhatsAppUserMappingRepository;
  let notionConnectionRepository: FakeNotionConnectionRepository;

  const testConfig: Config = {
    verifyToken: 'test-verify-token-12345',
    appSecret: 'test-app-secret-67890',
    accessToken: 'test-access-token',
    allowedPhoneNumberIds: ['test-phone-id'],
    port: 8080,
    host: '0.0.0.0',
  };

  /**
   * Create a valid HMAC-SHA256 signature for a payload.
   */
  function createSignature(payload: string, secret: string): string {
    const hash = createHmac('sha256', secret).update(payload).digest('hex');
    return `sha256=${hash}`;
  }

  /**
   * Create a sample WhatsApp webhook payload.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function createWebhookPayload(): any {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_ID',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1234567890',
                  phone_number_id: '123456789012345',
                },
                contacts: [
                  {
                    wa_id: '15551234567',
                    profile: {
                      name: 'Test User',
                    },
                  },
                ],
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid.HBgNMTU1NTEyMzQ1Njc4FQIAEhgUM0VCMDRBNzYwREQ0RjMwMjYzMDcA',
                    timestamp: '1234567890',
                    type: 'text',
                    text: {
                      body: 'Hello, World!',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  beforeEach(async () => {
    // Create fresh test adapters
    webhookEventRepository = new FakeWhatsAppWebhookEventRepository();
    userMappingRepository = new FakeWhatsAppUserMappingRepository();
    notionConnectionRepository = new FakeNotionConnectionRepository();

    // Inject test adapters via DI
    setServices({
      webhookEventRepository,
      userMappingRepository,
      notionConnectionRepository,
      inboxNotesRepository: null,
    });

    // Set test environment to skip real Firestore health check
    process.env['VITEST'] = 'true';
    process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = testConfig.verifyToken;
    process.env['PRAXOS_WHATSAPP_APP_SECRET'] = testConfig.appSecret;
    process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'] = testConfig.accessToken;
    process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'] = testConfig.allowedPhoneNumberIds.join(',');

    app = await buildServer(testConfig);
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['VITEST'];
    delete process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_APP_SECRET'];
    delete process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'];
  });

  describe('GET /health', () => {
    it('returns health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        status: string;
        serviceName: string;
        version: string;
        checks: unknown[];
      };
      expect(body.status).toBeDefined();
      expect(body.serviceName).toBe('whatsapp-service');
      expect(body.checks).toBeDefined();
    });
  });
  describe('GET /docs', () => {
    it('returns Swagger UI', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs',
      });

      // Swagger UI redirects or returns HTML
      expect([200, 302]).toContain(response.statusCode);
    });
  });

  describe('GET /openapi.json', () => {
    it('returns OpenAPI specification', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        openapi: string;
        info: { title: string };
      };
      expect(body.openapi).toMatch(/^3\./);
      expect(body.info.title).toBe('whatsapp-service');
    });
  });

  describe('GET /webhooks/whatsapp (webhook verification)', () => {
    it('returns challenge when verify token matches', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
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
      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
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
      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
        query: {
          'hub.mode': 'unsubscribe',
          'hub.verify_token': testConfig.verifyToken,
          'hub.challenge': 'challenge-12345',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when verify token is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
        query: {
          'hub.mode': 'subscribe',
          'hub.challenge': 'challenge-12345',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when challenge is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': testConfig.verifyToken,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /webhooks/whatsapp (webhook event receiver)', () => {
    it('accepts valid webhook payload with correct signature', async () => {
      const payload = createWebhookPayload();
      const payloadString = JSON.stringify(payload);
      const signature = createSignature(payloadString, testConfig.appSecret);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
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

      await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        payload: payloadString,
      });

      const events = webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.signatureValid).toBe(true);
      expect(events[0]?.phoneNumberId).toBe('123456789012345');
      expect(events[0]?.receivedAt).toBeDefined();
    });

    it('returns 401 when signature header is missing', async () => {
      const payload = createWebhookPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
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

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
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

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
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

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
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

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
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

      await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=invalid',
        },
        payload: JSON.stringify(payload),
      });

      const events = webhookEventRepository.getAll();
      expect(events.length).toBe(0);
    });

    it('handles status updates correctly', async () => {
      const statusPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA_ID',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1234567890',
                    phone_number_id: '987654321098765',
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

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        payload: payloadString,
      });

      expect(response.statusCode).toBe(200);
      const events = webhookEventRepository.getAll();
      expect(events[0]?.phoneNumberId).toBe('987654321098765');
    });
  });
});

describe('signature validation', () => {
  it('validates correct signature', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const secret = 'test-secret';
    const hash = createHmac('sha256', secret).update(payload).digest('hex');
    const signature = `sha256=${hash}`;

    expect(validateWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects invalid signature', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const secret = 'test-secret';

    expect(validateWebhookSignature(payload, 'sha256=invalid', secret)).toBe(false);
  });

  it('rejects signature without sha256= prefix', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const secret = 'test-secret';
    const hash = createHmac('sha256', secret).update(payload).digest('hex');

    expect(validateWebhookSignature(payload, hash, secret)).toBe(false);
  });

  it('rejects signature with different secret', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const payload = 'test payload';
    const hash = createHmac('sha256', 'secret1').update(payload).digest('hex');
    const signature = `sha256=${hash}`;

    expect(validateWebhookSignature(payload, signature, 'secret2')).toBe(false);
  });

  it('rejects signature with modified payload', async () => {
    const { validateWebhookSignature } = await import('../signature.js');
    const secret = 'test-secret';
    const hash = createHmac('sha256', secret).update('original payload').digest('hex');
    const signature = `sha256=${hash}`;

    expect(validateWebhookSignature('modified payload', signature, secret)).toBe(false);
  });
});

describe('config validation', () => {
  it('validates required env vars', async () => {
    const { validateConfigEnv } = await import('../config.js');

    // Save current values
    const savedVerify = process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    const savedSecret = process.env['PRAXOS_WHATSAPP_APP_SECRET'];

    // Clear env vars
    delete process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_APP_SECRET'];

    const missing = validateConfigEnv();
    expect(missing).toContain('PRAXOS_WHATSAPP_VERIFY_TOKEN');
    expect(missing).toContain('PRAXOS_WHATSAPP_APP_SECRET');

    // Restore
    if (savedVerify !== undefined) {
      process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = savedVerify;
    }
    if (savedSecret !== undefined) {
      process.env['PRAXOS_WHATSAPP_APP_SECRET'] = savedSecret;
    }
  });

  it('returns empty array when all required vars present', async () => {
    const { validateConfigEnv } = await import('../config.js');

    process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = 'test';
    process.env['PRAXOS_WHATSAPP_APP_SECRET'] = 'test';
    process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'] = 'test';
    process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'] = 'test';

    const missing = validateConfigEnv();
    expect(missing).toHaveLength(0);
  });
});
