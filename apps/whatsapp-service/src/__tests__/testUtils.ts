/**
 * Shared test utilities for whatsapp-service tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { createHmac } from 'node:crypto';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import { clearJwksCache } from '@intexuraos/common';
import {
  FakeWhatsAppWebhookEventRepository,
  FakeWhatsAppUserMappingRepository,
  FakeNotionConnectionRepository,
} from './fakes.js';
import type { Config } from '../config.js';

export const issuer = 'https://test-issuer.example.com/';
export const audience = 'test-audience';

let jwksServer: FastifyInstance;
let privateKey: jose.KeyLike;

/**
 * Create a signed JWT token for tests.
 */
export async function createToken(
  claims: Record<string, unknown>,
  options?: { expiresIn?: string }
): Promise<string> {
  const builder = new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience);

  if (options?.expiresIn !== undefined) {
    builder.setExpirationTime(options.expiresIn);
  } else {
    builder.setExpirationTime('1h');
  }

  return await builder.sign(privateKey);
}

/**
 * Setup global JWKS server for all tests.
 * Call this once in beforeAll.
 */
export async function setupJwksServer(): Promise<void> {
  const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
  privateKey = privKey;

  const publicKeyJwk = await jose.exportJWK(publicKey);
  publicKeyJwk.kid = 'test-key-1';
  publicKeyJwk.alg = 'RS256';
  publicKeyJwk.use = 'sig';

  jwksServer = Fastify({ logger: false });

  jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
    return await reply.send({ keys: [publicKeyJwk] });
  });

  await jwksServer.listen({ port: 0, host: '127.0.0.1' });
  const address = jwksServer.server.address();
  if (address !== null && typeof address === 'object') {
    process.env['AUTH_JWKS_URL'] = `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    process.env['AUTH_ISSUER'] = issuer;
    process.env['AUTH_AUDIENCE'] = audience;
  }
}

/**
 * Teardown JWKS server.
 * Call this in afterAll.
 */
export async function teardownJwksServer(): Promise<void> {
  await jwksServer.close();
  delete process.env['AUTH_JWKS_URL'];
  delete process.env['AUTH_ISSUER'];
  delete process.env['AUTH_AUDIENCE'];
}

export const testConfig: Config = {
  verifyToken: 'test-verify-token-12345',
  appSecret: 'test-app-secret-67890',
  accessToken: 'test-access-token',
  allowedWabaIds: ['102290129340398', '419561257915477'],
  allowedPhoneNumberIds: ['123456789012345', '987654321098765'],
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
 * Uses IDs that match testConfig.allowedWabaIds and testConfig.allowedPhoneNumberIds.
 */
export function createWebhookPayload(): object {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398', // Must match testConfig.allowedWabaIds
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551234567',
                phone_number_id: '123456789012345', // Must match testConfig.allowedPhoneNumberIds
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

  beforeAll(async () => {
    await setupJwksServer();
  });

  afterAll(async () => {
    await teardownJwksServer();
  });

  beforeEach(async () => {
    context.webhookEventRepository = new FakeWhatsAppWebhookEventRepository();
    context.userMappingRepository = new FakeWhatsAppUserMappingRepository();
    context.notionConnectionRepository = new FakeNotionConnectionRepository();

    setServices({
      webhookEventRepository: context.webhookEventRepository,
      userMappingRepository: context.userMappingRepository,
      notionConnectionRepository: context.notionConnectionRepository,
    });

    clearJwksCache();
    process.env['VITEST'] = 'true';
    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = testConfig.verifyToken;
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = testConfig.appSecret;
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = testConfig.accessToken;
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = testConfig.allowedWabaIds.join(',');
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = testConfig.allowedPhoneNumberIds.join(',');

    context.app = await buildServer(testConfig);
  });

  afterEach(async () => {
    await context.app.close();
    resetServices();
    delete process.env['VITEST'];
    delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    delete process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    delete process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
  });

  return context;
}

export { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach };
