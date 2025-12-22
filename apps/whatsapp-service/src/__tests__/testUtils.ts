/**
 * Shared test utilities for whatsapp-service tests.
 */
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

export const testConfig: Config = {
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
export function createSignature(payload: string, secret: string): string {
  const hash = createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hash}`;
}

/**
 * Create a sample WhatsApp webhook payload.
 */
export function createWebhookPayload(): object {
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

export interface TestContext {
  app: FastifyInstance;
  webhookEventRepository: FakeWhatsAppWebhookEventRepository;
  userMappingRepository: FakeWhatsAppUserMappingRepository;
  notionConnectionRepository: FakeNotionConnectionRepository;
}

/**
 * Setup test environment with mock services.
 */
export function setupTestContext(): TestContext {
  const context: TestContext = {
    app: null as unknown as FastifyInstance,
    webhookEventRepository: null as unknown as FakeWhatsAppWebhookEventRepository,
    userMappingRepository: null as unknown as FakeWhatsAppUserMappingRepository,
    notionConnectionRepository: null as unknown as FakeNotionConnectionRepository,
  };

  beforeEach(async () => {
    context.webhookEventRepository = new FakeWhatsAppWebhookEventRepository();
    context.userMappingRepository = new FakeWhatsAppUserMappingRepository();
    context.notionConnectionRepository = new FakeNotionConnectionRepository();

    setServices({
      webhookEventRepository: context.webhookEventRepository,
      userMappingRepository: context.userMappingRepository,
      notionConnectionRepository: context.notionConnectionRepository,
      inboxNotesRepository: null,
    });

    process.env['VITEST'] = 'true';
    process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = testConfig.verifyToken;
    process.env['PRAXOS_WHATSAPP_APP_SECRET'] = testConfig.appSecret;
    process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'] = testConfig.accessToken;
    process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'] = testConfig.allowedPhoneNumberIds.join(',');

    context.app = await buildServer(testConfig);
  });

  afterEach(async () => {
    await context.app.close();
    resetServices();
    delete process.env['VITEST'];
    delete process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_APP_SECRET'];
    delete process.env['PRAXOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_PHONE_NUMBER_ID'];
  });

  return context;
}

export { describe, it, expect, beforeEach, afterEach };
