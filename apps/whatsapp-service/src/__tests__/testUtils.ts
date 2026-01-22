/**
 * Shared test utilities for whatsapp-service tests.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { createHmac } from 'node:crypto';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import { clearJwksCache } from '@intexuraos/common-http';
import {
  FakeEventPublisher,
  FakeLinkPreviewFetcherPort,
  FakeMediaStorage,
  FakeMessageSender,
  FakeOutboundMessageRepository,
  FakeSpeechTranscriptionPort,
  FakeThumbnailGeneratorPort,
  FakeWhatsAppCloudApiPort,
  FakeWhatsAppMessageRepository,
  FakeWhatsAppUserMappingRepository,
  FakeWhatsAppWebhookEventRepository,
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
    process.env['INTEXURAOS_AUTH_JWKS_URL'] =
      `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = audience;
  }
}

/**
 * Teardown JWKS server.
 * Call this in afterAll.
 */
export async function teardownJwksServer(): Promise<void> {
  await jwksServer.close();
  delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
  delete process.env['INTEXURAOS_AUTH_ISSUER'];
  delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
}

export const testConfig: Config = {
  verifyToken: 'test-verify-token-12345',
  appSecret: 'test-app-secret-67890',
  accessToken: 'test-access-token',
  allowedWabaIds: ['102290129340398', '419561257915477'],
  allowedPhoneNumberIds: ['123456789012345', '987654321098765'],
  mediaBucket: 'test-media-bucket',
  mediaCleanupTopic: 'test-media-cleanup',
  mediaCleanupSubscription: 'test-media-cleanup-sub',
  speechmaticsApiKey: 'test-speechmatics-api-key',
  gcpProjectId: 'test-project',
  webAgentUrl: 'https://web-agent.example.com',
  internalAuthToken: 'test-internal-auth-token',
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

/**
 * Create a WhatsApp image message webhook payload.
 * Uses IDs that match testConfig.allowedWabaIds and testConfig.allowedPhoneNumberIds.
 */
export function createImageWebhookPayload(options?: {
  caption?: string;
  mediaId?: string;
}): object {
  const mediaId = options?.mediaId ?? 'test-media-id-12345';
  const imageMessage: {
    from: string;
    id: string;
    timestamp: string;
    type: string;
    image: {
      id: string;
      mime_type: string;
      sha256: string;
      caption?: string;
    };
  } = {
    from: '15551234567',
    id: 'wamid.image.HBgNMTU1NTEyMzQ1Njc4FQIAEhgUM0VCMDRBNzYwREQ0RjMwMjYzMDcA',
    timestamp: '1234567890',
    type: 'image',
    image: {
      id: mediaId,
      mime_type: 'image/jpeg',
      sha256: 'abc123def456',
    },
  };

  if (options?.caption !== undefined) {
    imageMessage.image.caption = options.caption;
  }

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551234567',
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
              messages: [imageMessage],
            },
          },
        ],
      },
    ],
  };
}

/**
 * Create a WhatsApp text message webhook payload with reply context.
 * Used to test approval reply handling when a user replies to a previous message.
 */
export function createReplyWebhookPayload(options: {
  replyToWamid: string;
  messageText?: string;
  messageId?: string;
}): object {
  const messageText = options.messageText ?? 'Yes, approved!';
  const messageId = options.messageId ?? 'wamid.reply.HBgNMTU1NTEyMzQ1Njc4FQIAEhgUM0VCMDRBNzYwREQ0RjMwMjYzMDcA';

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551234567',
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
                  id: messageId,
                  timestamp: '1234567890',
                  type: 'text',
                  text: {
                    body: messageText,
                  },
                  context: {
                    from: '15550987654', // Business phone number
                    id: options.replyToWamid, // The wamid being replied to
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

/**
 * Create a WhatsApp audio message webhook payload.
 * Uses IDs that match testConfig.allowedWabaIds and testConfig.allowedPhoneNumberIds.
 */
export function createAudioWebhookPayload(options?: { mediaId?: string }): object {
  const mediaId = options?.mediaId ?? 'test-audio-id-12345';
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551234567',
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
                  id: 'wamid.audio.HBgNMTU1NTEyMzQ1Njc4FQIAEhgUM0VCMDRBNzYwREQ0RjMwMjYzMDcA',
                  timestamp: '1234567890',
                  type: 'audio',
                  audio: {
                    id: mediaId,
                    mime_type: 'audio/ogg',
                    sha256: 'xyz789abc',
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

/**
 * Create a WhatsApp reaction webhook payload.
 * Used to test reaction-based approval/rejection handling.
 */
export function createReactionWebhookPayload(options: {
  emoji: string;
  messageId: string; // The wamid being reacted to
  reactionMessageId?: string; // The ID of the reaction message itself
}): object {
  const reactionMessageId =
    options.reactionMessageId ??
    'wamid.reaction.HBgNMTU1NTEyMzQ1Njc4FQIAEhgUM0VCMDRBNzYwREQ0RjMwMjYzMDcA';

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551234567',
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
                  id: reactionMessageId,
                  timestamp: '1234567890',
                  type: 'reaction',
                  reaction: {
                    emoji: options.emoji,
                    message_id: options.messageId,
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
  messageRepository: FakeWhatsAppMessageRepository;
  mediaStorage: FakeMediaStorage;
  eventPublisher: FakeEventPublisher;
  whatsappCloudApi: FakeWhatsAppCloudApiPort;
  outboundMessageRepository: FakeOutboundMessageRepository;
}

/**
 * Setup test environment with mock services.
 */
export function setupTestContext(): TestContext {
  const context: TestContext = {
    app: null as unknown as FastifyInstance,
    webhookEventRepository: null as unknown as FakeWhatsAppWebhookEventRepository,
    userMappingRepository: null as unknown as FakeWhatsAppUserMappingRepository,
    messageRepository: null as unknown as FakeWhatsAppMessageRepository,
    mediaStorage: null as unknown as FakeMediaStorage,
    eventPublisher: null as unknown as FakeEventPublisher,
    whatsappCloudApi: null as unknown as FakeWhatsAppCloudApiPort,
    outboundMessageRepository: null as unknown as FakeOutboundMessageRepository,
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
    context.messageRepository = new FakeWhatsAppMessageRepository();
    context.mediaStorage = new FakeMediaStorage();
    context.eventPublisher = new FakeEventPublisher();
    context.whatsappCloudApi = new FakeWhatsAppCloudApiPort();
    context.outboundMessageRepository = new FakeOutboundMessageRepository();

    setServices({
      webhookEventRepository: context.webhookEventRepository,
      userMappingRepository: context.userMappingRepository,
      messageRepository: context.messageRepository,
      mediaStorage: context.mediaStorage,
      eventPublisher: context.eventPublisher,
      messageSender: new FakeMessageSender(),
      transcriptionService: new FakeSpeechTranscriptionPort(),
      whatsappCloudApi: context.whatsappCloudApi,
      thumbnailGenerator: new FakeThumbnailGeneratorPort(),
      linkPreviewFetcher: new FakeLinkPreviewFetcherPort(),
      outboundMessageRepository: context.outboundMessageRepository,
    });

    clearJwksCache();
    process.env['VITEST'] = 'true';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
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
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    delete process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    delete process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
  });

  return context;
}

export { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach };
