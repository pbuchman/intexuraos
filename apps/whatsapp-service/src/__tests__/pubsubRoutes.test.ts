/**
 * Tests for Pub/Sub push subscription routes.
 * POST /internal/whatsapp/pubsub/send-message
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import {
  buildSendMessageEvent,
  MESSAGE_DIGEST_EVENT_MESSAGE,
} from '@intexuraos/whatsapp-pubsub-client';
import { buildServer } from '../server.js';
import { getServices, resetServices, setServices } from '../services.js';
import {
  FakeEventPublisher,
  FakeConversationAssistantContextAttachmentDeltaBuilder,
  FakeConversationAssistantContextAttachmentRepository,
  FakeConversationAssistantRepository,
  FakeConversationAssistantOperationalTelemetry,
  FakeLlmGenerateClient,
  FakePrivateWhatsAppRepository,
  FakeLinkPreviewFetcherPort,
  FakeMatrixOutboundGateway,
  FakeMediaStorage,
  FakeMessageSender,
  FakeNotificationPreferencesRepository,
  FakeOutboundMessageRepository,
  FakePhoneVerificationRepository,
  FakeThumbnailGeneratorPort,
  FakeWhatsAppCloudApiPort,
  FakeWhatsAppMessageRepository,
  FakeWhatsAppUserMappingRepository,
  FakeWhatsAppWebhookEventRepository,
} from './fakes.js';
import type { Config } from '../config.js';
import type { PrivateWhatsAppErasureRepository } from '../domain/whatsapp/ports/privateWhatsAppErasure.js';
import type { MessageDigestDeliveryAuthorizationClient } from '../domain/whatsapp/ports/messageDigestDeliveryAuthorization.js';
import { emptyPrivateWhatsAppErasureCounts } from '../domain/whatsapp/models/PrivateWhatsAppErasure.js';
import { notReadyMatrixCorpusIngress } from '../domain/matrixCorpus/ports/matrixCorpusIngress.js';
import type { ServiceContainer } from '../services.js';
import { isBoundedMessageDigestTemplateText } from '../routes/pubsubRoutes.js';
import { FakePdfConversationExporter } from './testUtils.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token-12345';

const testConfig: Config = {
  verifyToken: 'test-verify-token',
  appSecret: 'test-app-secret',
  accessToken: 'test-access-token',
  allowedWabaIds: ['102290129340398'],
  allowedPhoneNumberIds: ['123456789012345'],
  mediaBucket: 'test-media-bucket',
  mediaCleanupTopic: 'test-media-cleanup',
  mediaCleanupSubscription: 'test-media-cleanup-sub',
  intexMessageIngestTopic: 'test-intex-message-ingest',
  audioStoredTopic: 'test-audio-stored',
  gcpProjectId: 'test-project',
  webAgentUrl: 'https://web-agent.example.com',
  internalAuthToken: INTERNAL_AUTH_TOKEN,
  llmUsageServiceUrl: 'http://llm-usage.test',
  userServiceUrl: 'http://user-service.test',
  platformOpenRouterApiKey: 'platform-openrouter-key',
  messageDigestServiceUrl: 'http://message-digest-service.test',
  conversationAssistantModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  port: 8080,
  host: '0.0.0.0',
  matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
};

function encodeEvent(event: unknown): string {
  return Buffer.from(JSON.stringify(event)).toString('base64');
}

interface PubSubBody {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

function createPubSubBody(eventData: unknown): PubSubBody {
  return {
    message: {
      data: encodeEvent(eventData),
      messageId: 'msg-' + Date.now().toString(),
      publishTime: new Date().toISOString(),
    },
    subscription: 'projects/test/subscriptions/test-sub',
  };
}

function createPubSubBodyFromRawJson(rawJson: string): PubSubBody {
  return {
    message: {
      data: Buffer.from(rawJson, 'utf8').toString('base64'),
      messageId: 'msg-' + Date.now().toString(),
      publishTime: new Date().toISOString(),
    },
    subscription: 'projects/test/subscriptions/test-sub',
  };
}

function createMatrixSendEvent(
  userId: string,
  suffix: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    type: 'whatsapp.message.send',
    userId,
    message: `Synthetic Matrix reply ${suffix}`,
    correlationId: `imc_reply_${suffix}`,
    idempotencyKey: `imc_reply_publish_${suffix}`,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createMessageDigestSendEvent(
  userId: string,
  suffix: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    type: 'whatsapp.message.send',
    userId,
    message: MESSAGE_DIGEST_EVENT_MESSAGE,
    correlationId: `mdr_run_${suffix}`,
    idempotencyKey: `message-digest:mdr_run_${suffix}`,
    timestamp: '2026-07-28T07:00:00.000Z',
    important: true,
    presentation: {
      kind: 'message_digest_v1',
      digestName: `Daily digest ${suffix}`,
      digestExcerpt: 'Synthetic stable digest excerpt.',
      runUrlSuffix: `#/whatsapp/message-digests/md_definition_${suffix}/history/mdr_run_${suffix}`,
    },
    deliveryAuthorization: {
      kind: 'message_digest_delivery_v1',
      definitionId: `md_definition_${suffix}`,
      runId: `mdr_run_${suffix}`,
    },
    retainMessageText: false,
    ...overrides,
  };
}

describe('Pub/Sub Routes', () => {
  let app: FastifyInstance;
  let messageSender: FakeMessageSender;
  let mediaStorage: FakeMediaStorage;
  let messageRepository: FakeWhatsAppMessageRepository;
  let userMappingRepository: FakeWhatsAppUserMappingRepository;
  let outboundMessageRepository: FakeOutboundMessageRepository;
  let prefs: FakeNotificationPreferencesRepository;
  let eventPublisher: FakeEventPublisher;
  let whatsappCloudApi: FakeWhatsAppCloudApiPort;
  let privateWhatsAppRepository: FakePrivateWhatsAppRepository;
  let conversationAssistantRepository: FakeConversationAssistantRepository;
  let conversationAssistantContextAttachmentRepository: FakeConversationAssistantContextAttachmentRepository;
  let conversationAssistantContextAttachmentDeltaBuilder: FakeConversationAssistantContextAttachmentDeltaBuilder;
  let llmClient: FakeLlmGenerateClient;
  let privateWhatsAppErasureRepository: PrivateWhatsAppErasureRepository;
  let conversationAssistantOperationalTelemetry: FakeConversationAssistantOperationalTelemetry;
  let messageDigestDeliveryAuthorizationClient: MessageDigestDeliveryAuthorizationClient;

  beforeEach(async () => {
    messageSender = new FakeMessageSender();
    mediaStorage = new FakeMediaStorage();
    messageRepository = new FakeWhatsAppMessageRepository();
    userMappingRepository = new FakeWhatsAppUserMappingRepository();

    outboundMessageRepository = new FakeOutboundMessageRepository();
    prefs = new FakeNotificationPreferencesRepository();
    eventPublisher = new FakeEventPublisher();
    whatsappCloudApi = new FakeWhatsAppCloudApiPort();
    privateWhatsAppRepository = new FakePrivateWhatsAppRepository();
    conversationAssistantRepository = new FakeConversationAssistantRepository();
    conversationAssistantContextAttachmentRepository =
      new FakeConversationAssistantContextAttachmentRepository();
    conversationAssistantContextAttachmentDeltaBuilder =
      new FakeConversationAssistantContextAttachmentDeltaBuilder();
    llmClient = new FakeLlmGenerateClient();
    conversationAssistantOperationalTelemetry = new FakeConversationAssistantOperationalTelemetry();
    messageDigestDeliveryAuthorizationClient = {
      acquire: vi.fn().mockResolvedValue({
        ok: true,
        disposition: 'authorized',
        fence: 3,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
      release: vi.fn().mockResolvedValue({ ok: true }),
    };
    privateWhatsAppErasureRepository = {
      start: vi.fn(),
      get: vi.fn(),
      advanceOneBatch: vi.fn().mockResolvedValue(
        ok({
          status: 'advanced',
          request: {
            erasureRequestId: 'erase-1',
            userId: 'user-1',
            sourceAccountId: 'source-1',
            accountGeneration: 'generation-1',
            status: 'running',
            stage: 'source_messages',
            counts: { ...emptyPrivateWhatsAppErasureCounts(), sourceMessages: 2 },
            attempt: 2,
            createdAt: '2026-07-21T10:00:00.000Z',
            updatedAt: '2026-07-21T10:01:00.000Z',
          },
        })
      ),
      commitPrivateMediaBatch: vi.fn(),
    };

    setServices({
      webhookEventRepository: new FakeWhatsAppWebhookEventRepository(),
      userMappingRepository,
      messageRepository,
      mediaStorage,
      eventPublisher,
      messageSender,
      whatsappCloudApi,
      thumbnailGenerator: new FakeThumbnailGeneratorPort(),
      linkPreviewFetcher: new FakeLinkPreviewFetcherPort(),
      outboundMessageRepository,
      phoneVerificationRepository: new FakePhoneVerificationRepository(),
      notificationPreferencesRepository: prefs,
      privateWhatsAppRepository,
      matrixOutboundGateway: new FakeMatrixOutboundGateway(),
      conversationAssistantRepository,
      conversationAssistantContextAttachmentRepository,
      conversationAssistantContextAttachmentDeltaBuilder,
      conversationAssistantOperationalTelemetry,
      privateWhatsAppErasureRepository,
      privateWhatsAppErasurePublisher: eventPublisher,
      messageDigestDeliveryAuthorizationClient,
      llmClientFactory: {
        createLlmClientForUser: () => Promise.resolve({ ok: true, value: llmClient }),
      },
      conversationAssistantModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
    } as ServiceContainer & {
      privateWhatsAppErasureRepository: PrivateWhatsAppErasureRepository;
      privateWhatsAppErasurePublisher: FakeEventPublisher;
    });

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    process.env['VITEST'] = 'true';

    app = await buildServer(testConfig);
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['VITEST'];
  });

  describe('POST /internal/whatsapp/pubsub/send-message', () => {
    it('redacts private Matrix URL, headers, query, and raw errors in global server logs', async () => {
      await app.close();
      const logChunks: string[] = [];
      app = await buildServer(
        testConfig,
        new Writable({
          write(chunk, _encoding, callback): void {
            logChunks.push(String(chunk));
            callback();
          },
        })
      );
      app.get('/internal/matrix-corpus/private-error/:runId', async () => {
        throw new Error('WHATSAPP_MATRIX_RAW_ERROR_SENTINEL');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/internal/matrix-corpus/private-error/RUN_WHATSAPP_LOG_SENTINEL?value=QUERY_WHATSAPP_LOG_SENTINEL',
        headers: {
          'x-matrix-corpus-user-id': 'USER_WHATSAPP_HEADER_SENTINEL',
          'x-matrix-corpus-session-id': 'SESSION_WHATSAPP_HEADER_SENTINEL',
        },
      });
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(response.statusCode).toBe(500);
      const serializedLogs = logChunks.join('');
      expect(serializedLogs).toContain('/internal/matrix-corpus/[REDACTED]');
      for (const sentinel of [
        'RUN_WHATSAPP_LOG_SENTINEL',
        'QUERY_WHATSAPP_LOG_SENTINEL',
        'USER_WHATSAPP_HEADER_SENTINEL',
        'SESSION_WHATSAPP_HEADER_SENTINEL',
        'WHATSAPP_MATRIX_RAW_ERROR_SENTINEL',
      ]) {
        expect(serializedLogs).not.toContain(sentinel);
      }
    });

    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-123',
        message: 'Hello',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        payload: body,
      });

      expect(response.statusCode).toBe(401);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toContain('auth failed');
    });

    it('returns 401 when X-Internal-Auth header is invalid', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-123',
        message: 'Hello',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: body,
      });

      expect(response.statusCode).toBe(401);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toContain('auth failed');
    });

    describe('Pub/Sub OIDC authentication', () => {
      it('accepts Pub/Sub push with from: noreply@google.com header (no x-internal-auth)', async () => {
        await userMappingRepository.saveMapping('user-123', ['+48123456789']);

        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-123',
          message: 'Hello from Pub/Sub',
          correlationId: 'corr-pubsub',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: {
            'content-type': 'application/json',
            from: 'noreply@google.com',
          },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        const responseBody = JSON.parse(response.body) as { success: boolean };
        expect(responseBody.success).toBe(true);

        expect(messageSender.getSentMessages()).toHaveLength(1);
        expect(messageSender.getSentMessages()[0]?.phoneNumber).toBe('48123456789');
      });

      it('rejects direct calls without x-internal-auth or Pub/Sub from header', async () => {
        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-123',
          message: 'Hello',
          correlationId: 'corr-123',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: {
            'content-type': 'application/json',
          },
          payload: body,
        });

        expect(response.statusCode).toBe(401);
        const responseBody = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(responseBody.error.message).toContain('auth failed');
      });
    });

    it('returns 400 when message data is not valid base64', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          message: {
            data: '!!!not-base64!!!',
            messageId: 'msg-123',
            publishTime: new Date().toISOString(),
          },
          subscription: 'projects/test/subscriptions/test-sub',
        },
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to decode PubSub message');
    });

    it('returns 400 when message data is not valid JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          message: {
            data: Buffer.from('not json at all').toString('base64'),
            messageId: 'msg-123',
            publishTime: new Date().toISOString(),
          },
          subscription: 'projects/test/subscriptions/test-sub',
        },
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to decode PubSub message');
    });

    it('returns 400 when event type is not whatsapp.message.send', async () => {
      const body = createPubSubBody({
        type: 'unknown.event.type',
        userId: 'user-123',
        message: 'Hello',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Unexpected event type');
    });

    it('sends message and returns 200 on success', async () => {
      await userMappingRepository.saveMapping('user-123', ['+48123456789']);

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-123',
        message: 'Hello from test',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.body).toContain('success');
      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toEqual({
        phoneNumber: '48123456789',
        message: 'Hello from test',
      });
    });

    it('returns 200 with success when user is not connected (no WhatsApp mapping)', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-not-connected',
        message: 'Hello',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('returns 400 before phone lookup when userId is missing', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        message: 'Hello',
        correlationId: 'corr-missing-user',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Invalid send message event');
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('returns 400 before phone lookup when userId and correlationId are missing', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        message: 'Hello',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Invalid send message event');
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('returns 500 when message sending fails', async () => {
      await userMappingRepository.saveMapping('user-123', ['+48123456789']);
      messageSender.setFail(true, { code: 'INTERNAL_ERROR', message: 'WhatsApp API error' });

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-123',
        message: 'Hello',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(502);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('WhatsApp API error');
    });

    it('handles message without optional fields', async () => {
      await userMappingRepository.saveMapping('user-456', ['+15551234567']);

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-456',
        message: 'Minimal message',
        correlationId: 'corr-456',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.phoneNumber).toBe('15551234567');
    });

    it('returns 500 when findPhoneByUserId fails', async () => {
      userMappingRepository.setFailFindPhoneByUserId(true);

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-123',
        message: 'Hello',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to look up phone number');
    });

    it('sends interactive message with buttons when buttons are provided', async () => {
      await userMappingRepository.saveMapping('user-buttons', ['+48987654321']);

      const buttons = [
        { type: 'reply', reply: { id: 'approve:action-123:a3f2', title: 'Approve' } },
        { type: 'reply', reply: { id: 'cancel:action-123', title: 'Cancel' } },
        { type: 'reply', reply: { id: 'convert:action-123', title: 'Convert' } },
      ];

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-buttons',
        message: 'Please approve this action',
        buttons,
        correlationId: 'corr-buttons',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.phoneNumber).toBe('48987654321');
      expect(sentMessages[0]?.message).toBe('Please approve this action');
      expect(sentMessages[0]?.buttons).toEqual(buttons);
    });

    it('sends CTA URL message when ctaUrl is provided without buttons', async () => {
      await userMappingRepository.saveMapping('user-cta', ['+48987654321']);

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-cta',
        message: 'Task completed successfully',
        ctaUrl: {
          displayText: 'View progress',
          url: 'https://intexuraos.cloud/#/code-tasks/task-123',
        },
        correlationId: 'corr-cta',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.phoneNumber).toBe('48987654321');
      expect(sentMessages[0]?.message).toBe('Task completed successfully');
      expect(sentMessages[0]?.ctaUrl).toEqual({
        displayText: 'View progress',
        url: 'https://intexuraos.cloud/#/code-tasks/task-123',
      });
    });

    it('returns 500 when sendInteractiveMessage fails', async () => {
      await userMappingRepository.saveMapping('user-fail-buttons', ['+48987654321']);
      messageSender.setFail(true, {
        code: 'INTERNAL_ERROR',
        message: 'WhatsApp API error for buttons',
      });

      const buttons = [{ type: 'reply', reply: { id: 'btn-1', title: 'Test' } }];

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-fail-buttons',
        message: 'Test message',
        buttons,
        correlationId: 'corr-fail',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(502);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('WhatsApp API error for buttons');
    });

    it('sends CTA URL message when ctaUrl is provided', async () => {
      await userMappingRepository.saveMapping('user-cta', ['+48111222333']);

      const ctaUrl = {
        displayText: 'View pull request',
        url: 'https://github.com/owner/repo/pull/42',
      };

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-cta',
        message: 'PR ready for review',
        ctaUrl,
        correlationId: 'corr-cta',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.phoneNumber).toBe('48111222333');
      expect(sentMessages[0]?.message).toBe('PR ready for review');
      expect(sentMessages[0]?.ctaUrl).toEqual(ctaUrl);
      expect(sentMessages[0]?.buttons).toBeUndefined();
    });

    it('returns 500 when sendCtaUrlMessage fails', async () => {
      await userMappingRepository.saveMapping('user-cta-fail', ['+48111222333']);
      messageSender.setFail(true, {
        code: 'INTERNAL_ERROR',
        message: 'WhatsApp API error for CTA URL',
      });

      const ctaUrl = { displayText: 'View PR', url: 'https://github.com/owner/repo/pull/1' };

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-cta-fail',
        message: 'Test message',
        ctaUrl,
        correlationId: 'corr-cta-fail',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(502);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('WhatsApp API error for CTA URL');
    });

    it('returns 200 (ack) when WhatsApp API returns permanent 4xx error', async () => {
      await userMappingRepository.saveMapping('user-perm-err', ['+48111222333']);
      messageSender.setFail(true, {
        code: 'PERSISTENCE_ERROR',
        message: 'WhatsApp API error: 400 - body too long',
        httpStatus: 400,
      });

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-perm-err',
        message: 'Test message',
        correlationId: 'corr-perm-err',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('returns 502 when WhatsApp API returns 429 rate-limit error (transient)', async () => {
      await userMappingRepository.saveMapping('user-rate-limit', ['+48111222333']);
      messageSender.setFail(true, {
        code: 'PERSISTENCE_ERROR',
        message: 'WhatsApp API error: 429 - rate limit exceeded',
        httpStatus: 429,
      });

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-rate-limit',
        message: 'Test message',
        correlationId: 'corr-rate-limit',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 502 when WhatsApp API returns transient 5xx error', async () => {
      await userMappingRepository.saveMapping('user-transient', ['+48111222333']);
      messageSender.setFail(true, {
        code: 'PERSISTENCE_ERROR',
        message: 'WhatsApp API error: 500 - internal server error',
        httpStatus: 500,
      });

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-transient',
        message: 'Test message',
        correlationId: 'corr-transient',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 502 when error has no httpStatus (timeout/network)', async () => {
      await userMappingRepository.saveMapping('user-timeout', ['+48111222333']);
      messageSender.setFail(true, {
        code: 'PERSISTENCE_ERROR',
        message: 'WhatsApp request timed out after 30000ms',
      });

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-timeout',
        message: 'Test message',
        correlationId: 'corr-timeout',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(502);
    });

    it('logs warning when outbound message save fails (non-fatal)', async () => {
      await userMappingRepository.saveMapping('user-save-fail', ['+48123456789']);
      outboundMessageRepository.setFail(true, {
        code: 'PERSISTENCE_ERROR',
        message: 'Simulated Firestore write failure',
      });

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-save-fail',
        message: 'Hello save fail',
        correlationId: 'corr-save-fail',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      // Should still succeed — outbound save failure is non-fatal
      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      // Message should still have been sent
      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.phoneNumber).toBe('48123456789');
    });

    it('prefers ctaUrl over buttons when both are provided', async () => {
      await userMappingRepository.saveMapping('user-both', ['+48111222333']);

      const ctaUrl = { displayText: 'View PR', url: 'https://github.com/owner/repo/pull/99' };
      const buttons = [{ type: 'reply', reply: { id: 'btn-1', title: 'Test' } }];

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-both',
        message: 'Message with both',
        ctaUrl,
        buttons,
        correlationId: 'corr-both',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      // ctaUrl takes priority over buttons
      expect(sentMessages[0]?.ctaUrl).toEqual(ctaUrl);
      expect(sentMessages[0]?.buttons).toBeUndefined();
    });

    it('sends plain text message when buttons array is empty', async () => {
      await userMappingRepository.saveMapping('user-empty-btns', ['+48111222333']);

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-empty-btns',
        message: 'No buttons',
        buttons: [],
        correlationId: 'corr-empty-btns',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.buttons).toBeUndefined();
      expect(sentMessages[0]?.message).toBe('No buttons');
    });

    it('saves outbound message successfully after sending', async () => {
      await userMappingRepository.saveMapping('user-save-ok', ['+48111222333']);

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-save-ok',
        message: 'Save success',
        correlationId: 'corr-save-ok',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);

      const saved = outboundMessageRepository.getMessages();
      expect(saved).toHaveLength(1);
      expect(saved[0]?.correlationId).toBe('corr-save-ok');
      expect(saved[0]?.userId).toBe('user-save-ok');
      expect(saved[0]?.messageText).toBe('Save success');
    });

    it('uses the approved template, the first mapped number, and a content-minimal idempotent receipt', async () => {
      await userMappingRepository.saveMapping('user-digest-template', [
        '+48111222333',
        '+48999888777',
      ]);
      const event = createMessageDigestSendEvent('user-digest-template', 'template_001');

      const first = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });
      const redelivery = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect([first.statusCode, redelivery.statusCode]).toEqual([200, 200]);
      expect(messageSender.getSentMessages()).toEqual([
        {
          phoneNumber: '48111222333',
          message: 'Synthetic stable digest excerpt.',
          digestTemplate: {
            digestName: 'Daily digest template_001',
            digestExcerpt: 'Synthetic stable digest excerpt.',
            runUrlSuffix:
              '#/whatsapp/message-digests/md_definition_template_001/history/mdr_run_template_001',
          },
        },
      ]);
      expect(outboundMessageRepository.getMessages()).toHaveLength(1);
      expect(outboundMessageRepository.getMessages()[0]).not.toHaveProperty('messageText');
      expect(messageDigestDeliveryAuthorizationClient.acquire).toHaveBeenCalledTimes(3);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledTimes(2);
    });

    it('accepts a bounded v2 digest and preserves its scan-friendly hierarchy for the sender', async () => {
      await userMappingRepository.saveMapping('user-digest-v2', ['+48111222333']);
      const presentation = {
        kind: 'message_digest_v2',
        digestName: 'Grupa wędkarska SKOOL',
        windowLabel: '27 lip, 09:00 – 27 lip, 14:00',
        headline: 'Wyjazd wymaga potwierdzenia',
        digestBody: '🔴 WYMAGA UWAGI\nPotwierdź udział.\n\n📍 ZAWODY\nPod Krakowem.',
        runUrlSuffix: '#/whatsapp/message-digests/md_definition_v2/history/mdr_run_v2',
      };
      const event = createMessageDigestSendEvent('user-digest-v2', 'v2', { presentation });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(response.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toEqual([
        {
          phoneNumber: '48111222333',
          message: presentation.digestBody,
          digestTemplate: presentation,
        },
      ]);
      expect(outboundMessageRepository.getMessages()[0]).not.toHaveProperty('messageText');
    });

    it('rejects malformed v2 digest fields before resolving or sending to a phone number', async () => {
      await userMappingRepository.saveMapping('user-digest-v2-invalid', ['+48111222333']);
      const validPresentation = {
        kind: 'message_digest_v2',
        digestName: 'n'.repeat(80),
        windowLabel: 'w'.repeat(80),
        headline: 'h'.repeat(200),
        digestBody: `A\n\n${'b'.repeat(573)}`,
        runUrlSuffix:
          '#/whatsapp/message-digests/md_definition_v2_invalid/history/mdr_run_v2_invalid',
      };
      for (const [field, value] of [
        ['digestName', 'n'.repeat(81)],
        ['windowLabel', 'w'.repeat(81)],
        ['headline', 'h'.repeat(201)],
        ['digestBody', 'b'.repeat(577)],
        ['digestBody', 'unsafe\rbreak'],
      ] as const) {
        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody(
            createMessageDigestSendEvent('user-digest-v2-invalid', 'v2_invalid', {
              presentation: { ...validPresentation, [field]: value },
            })
          ),
        });
        expect(response.statusCode, `${field}:${String(value).slice(0, 20)}`).toBe(200);
      }
      expect(messageSender.getSentMessages()).toEqual([]);
    });

    it('authorizes a Message Digest after preflight and immediately before receipt reservation', async () => {
      await userMappingRepository.saveMapping('user-digest-authorized', ['+48111222333']);
      const mapping = vi.spyOn(userMappingRepository, 'getMapping');
      const preferences = vi.spyOn(prefs, 'getPreferences');
      const acquire = vi.mocked(messageDigestDeliveryAuthorizationClient.acquire);
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');
      const send = vi.spyOn(messageSender, 'sendMessageDigestTemplate');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-authorized', 'authorization_order')
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(acquire).toHaveBeenCalledWith({
        userId: 'user-digest-authorized',
        definitionId: 'md_definition_authorization_order',
        runId: 'mdr_run_authorization_order',
        idempotencyKey: 'message-digest:mdr_run_authorization_order',
        ownerDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
      expect(mapping.mock.invocationCallOrder[0]).toBeLessThan(
        acquire.mock.invocationCallOrder[0] as number
      );
      expect(preferences.mock.invocationCallOrder[0]).toBeLessThan(
        acquire.mock.invocationCallOrder[0] as number
      );
      expect(acquire.mock.invocationCallOrder[0]).toBeLessThan(
        reserve.mock.invocationCallOrder[0] as number
      );
      expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(
        acquire.mock.invocationCallOrder[1] as number
      );
      expect(acquire.mock.invocationCallOrder[1]).toBeLessThan(
        send.mock.invocationCallOrder[0] as number
      );
      expect(acquire.mock.calls[1]?.[0]).toEqual(acquire.mock.calls[0]?.[0]);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledWith(
        expect.objectContaining({
          definitionId: 'md_definition_authorization_order',
          runId: 'mdr_run_authorization_order',
          fence: 3,
        })
      );
    });

    it('binds Message Digest authorization and receipt reservation to the exact decoded JSON bytes', async () => {
      await userMappingRepository.saveMapping('user-digest-frozen-bytes', ['+48111222333']);
      const event = createMessageDigestSendEvent('user-digest-frozen-bytes', 'frozen_bytes');
      const rawJson = JSON.stringify(event, null, 2);
      const payloadDigest = createHash('sha256').update(rawJson, 'utf8').digest('hex');
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBodyFromRawJson(rawJson),
      });

      expect(response.statusCode).toBe(200);
      expect(messageDigestDeliveryAuthorizationClient.acquire).toHaveBeenCalledWith(
        expect.objectContaining({ payloadDigest })
      );
      expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ payloadDigest }));
    });

    it('suppresses changed Message Digest bytes before receipt reservation or provider send', async () => {
      await userMappingRepository.saveMapping('user-digest-changed-bytes', ['+48111222333']);
      const frozenEvent = createMessageDigestSendEvent(
        'user-digest-changed-bytes',
        'changed_bytes'
      );
      const frozenRawJson = JSON.stringify(frozenEvent);
      const frozenPayloadDigest = createHash('sha256')
        .update(frozenRawJson, 'utf8')
        .digest('hex');
      const changedRawJson = JSON.stringify(
        {
          ...frozenEvent,
          presentation: {
            ...(frozenEvent['presentation'] as Record<string, unknown>),
            digestExcerpt: 'Changed but structurally valid excerpt.',
          },
        },
        null,
        2
      );
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire).mockImplementation(
        async (identity) =>
          identity.payloadDigest === frozenPayloadDigest
            ? {
                ok: true,
                disposition: 'authorized',
                fence: 3,
                expiresAt: new Date(Date.now() + 120_000).toISOString(),
              }
            : { ok: true, disposition: 'denied' }
      );
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');
      const send = vi.spyOn(messageSender, 'sendMessageDigestTemplate');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBodyFromRawJson(changedRawJson),
      });

      expect(response.statusCode).toBe(200);
      expect(messageDigestDeliveryAuthorizationClient.acquire).toHaveBeenCalledOnce();
      expect(reserve).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('keeps ordinary Matrix delivery idempotency canonical across JSON serialization', async () => {
      await userMappingRepository.saveMapping('user-matrix-canonical-json', ['+48111222333']);
      const event = createMatrixSendEvent('user-matrix-canonical-json', 'canonical_json');
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');

      const compact = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBodyFromRawJson(JSON.stringify(event)),
      });
      const pretty = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBodyFromRawJson(JSON.stringify(event, null, 2)),
      });

      expect([compact.statusCode, pretty.statusCode]).toEqual([200, 200]);
      expect(reserve).toHaveBeenCalledTimes(2);
      expect(reserve.mock.calls[1]?.[0].payloadDigest).toBe(
        reserve.mock.calls[0]?.[0].payloadDigest
      );
      expect(messageSender.getSentMessages()).toHaveLength(1);
    });

    it('never sends when authorization expires and erasure starts during receipt reservation', async () => {
      await userMappingRepository.saveMapping('user-digest-expired-during-reservation', [
        '+48111222333',
      ]);
      const event = createMessageDigestSendEvent(
        'user-digest-expired-during-reservation',
        'expired_during_reservation'
      );
      const originalReserve = outboundMessageRepository.reserveIdempotentDelivery.bind(
        outboundMessageRepository
      );
      let notifyReservationEntered = (): void => undefined;
      const reservationEntered = new Promise<void>((resolve) => {
        notifyReservationEntered = resolve;
      });
      let unblockReservation = (): void => undefined;
      const reservationGate = new Promise<void>((resolve) => {
        unblockReservation = resolve;
      });
      vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery').mockImplementation(
        async (input) => {
          notifyReservationEntered();
          await reservationGate;
          return await originalReserve(input);
        }
      );
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire)
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 7,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        })
        .mockResolvedValueOnce({ ok: true, disposition: 'denied' });
      const send = vi.spyOn(messageSender, 'sendMessageDigestTemplate');

      const request = app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });
      await reservationEntered;
      unblockReservation();
      const response = await request;

      expect(response.statusCode).toBe(200);
      expect(messageDigestDeliveryAuthorizationClient.acquire).toHaveBeenCalledTimes(2);
      const acquiredIdentities = vi.mocked(messageDigestDeliveryAuthorizationClient.acquire).mock
        .calls;
      expect(acquiredIdentities[1]?.[0]).toEqual(acquiredIdentities[0]?.[0]);
      expect(send).not.toHaveBeenCalled();
      await expect(
        outboundMessageRepository.getIdempotentDeliveryState({
          userId: 'user-digest-expired-during-reservation',
          idempotencyKey: 'message-digest:mdr_run_expired_during_reservation',
        })
      ).resolves.toEqual(
        ok({
          status: 'failed',
          failedAt: expect.any(String),
          failureCode: 'DELIVERY_AUTHORIZATION_REVOKED',
        })
      );
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('fails closed when renewed authorization cannot cover the provider timeout', async () => {
      const nowMs = Date.parse('2026-07-28T08:00:00.000Z');
      vi.spyOn(Date, 'now').mockReturnValue(nowMs);
      await userMappingRepository.saveMapping('user-digest-short-renewal', ['+48111222333']);
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire)
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 11,
          expiresAt: new Date(nowMs + 120_000).toISOString(),
        })
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 11,
          expiresAt: new Date(nowMs + 32_500).toISOString(),
        });
      const send = vi.spyOn(messageSender, 'sendMessageDigestTemplate');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-short-renewal', 'short_renewal')
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageDigestDeliveryAuthorizationClient.acquire).toHaveBeenCalledTimes(2);
      expect(send).not.toHaveBeenCalled();
      await expect(
        outboundMessageRepository.getIdempotentDeliveryState({
          userId: 'user-digest-short-renewal',
          idempotencyKey: 'message-digest:mdr_run_short_renewal',
        })
      ).resolves.toEqual(
        ok({
          status: 'failed',
          failedAt: expect.any(String),
          failureCode: 'DELIVERY_AUTHORIZATION_UNAVAILABLE',
        })
      );
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('sends when renewed authorization covers the exact provider timeout and safety margin', async () => {
      const nowMs = Date.parse('2026-07-28T08:00:00.000Z');
      vi.spyOn(Date, 'now').mockReturnValue(nowMs);
      await userMappingRepository.saveMapping('user-digest-renewal-boundary', ['+48111222333']);
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire)
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 15,
          expiresAt: new Date(nowMs + 120_000).toISOString(),
        })
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 15,
          expiresAt: new Date(nowMs + 35_000).toISOString(),
        });
      const send = vi.spyOn(messageSender, 'sendMessageDigestTemplate');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-renewal-boundary', 'renewal_boundary')
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(send).toHaveBeenCalledOnce();
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledWith(
        expect.objectContaining({ fence: 15 })
      );
    });

    it('releases the latest fence when the same owner is reclaimed during renewal', async () => {
      await userMappingRepository.saveMapping('user-digest-renewal-reclaim', ['+48111222333']);
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire)
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 20,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        })
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 21,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-renewal-reclaim', 'renewal_reclaim')
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(1);
      const identities = vi.mocked(messageDigestDeliveryAuthorizationClient.acquire).mock.calls;
      expect(identities[1]?.[0]).toEqual(identities[0]?.[0]);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledWith(
        expect.objectContaining({ fence: 21 })
      );
      expect(messageDigestDeliveryAuthorizationClient.release).not.toHaveBeenCalledWith(
        expect.objectContaining({ fence: 20 })
      );
    });

    it.each([
      ['busy', { ok: true, disposition: 'busy' }],
      ['unavailable', { ok: false, code: 'unavailable' }],
      ['invalid', { ok: false, code: 'invalid_response' }],
    ] as const)(
      'records retryable failure and never sends when post-reservation renewal is %s',
      async (suffix, renewal) => {
        const userId = `user-digest-renewal-${suffix}`;
        await userMappingRepository.saveMapping(userId, ['+48111222333']);
        vi.mocked(messageDigestDeliveryAuthorizationClient.acquire)
          .mockResolvedValueOnce({
            ok: true,
            disposition: 'authorized',
            fence: 13,
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          })
          .mockResolvedValueOnce(renewal);
        const send = vi.spyOn(messageSender, 'sendMessageDigestTemplate');

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody(
            createMessageDigestSendEvent(userId, `renewal_${suffix}`)
          ),
        });

        expect(response.statusCode).toBe(503);
        expect(messageDigestDeliveryAuthorizationClient.acquire).toHaveBeenCalledTimes(2);
        expect(send).not.toHaveBeenCalled();
        await expect(
          outboundMessageRepository.getIdempotentDeliveryState({
            userId,
            idempotencyKey: `message-digest:mdr_run_renewal_${suffix}`,
          })
        ).resolves.toEqual(
          ok({
            status: 'failed',
            failedAt: expect.any(String),
            failureCode: 'DELIVERY_AUTHORIZATION_UNAVAILABLE',
          })
        );
        expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
      }
    );

    it('keeps one lease owner per handler for concurrent delivery of the exact same PubSub message', async () => {
      await userMappingRepository.saveMapping('user-digest-concurrent', ['+48111222333']);
      const body = createPubSubBody(
        createMessageDigestSendEvent('user-digest-concurrent', 'concurrent_same_push')
      );
      body.message.messageId = 'synthetic-identical-pubsub-message';

      let activeOwner: string | null = null;
      let activeFence = 0;
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire).mockImplementation(
        async (identity) => {
          if (activeOwner === null) {
            activeOwner = identity.ownerDigest;
            activeFence += 1;
            return {
              ok: true,
              disposition: 'authorized',
              fence: activeFence,
              expiresAt: new Date(Date.now() + 120_000).toISOString(),
            };
          }
          if (activeOwner === identity.ownerDigest) {
            return {
              ok: true,
              disposition: 'authorized',
              fence: activeFence,
              expiresAt: new Date(Date.now() + 120_000).toISOString(),
            };
          }
          return { ok: true, disposition: 'busy' };
        }
      );
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockImplementation(
        async (identity) => {
          if (activeOwner !== identity.ownerDigest || activeFence !== identity.fence) {
            return { ok: false, code: 'unavailable' };
          }
          activeOwner = null;
          return { ok: true };
        }
      );

      let notifyProviderEntered = (): void => undefined;
      const providerEntered = new Promise<void>((resolve) => {
        notifyProviderEntered = resolve;
      });
      let settleProvider = (_result: { ok: true; value: { wamid: string } }): void => undefined;
      const providerResult = new Promise<{ ok: true; value: { wamid: string } }>((resolve) => {
        settleProvider = resolve;
      });
      const send = vi
        .spyOn(messageSender, 'sendMessageDigestTemplate')
        .mockImplementation(async () => {
          notifyProviderEntered();
          return await providerResult;
        });

      const firstRequest = app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });
      await providerEntered;
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });
      const ownerWhileFirstProviderWasActive = activeOwner;
      settleProvider({ ok: true, value: { wamid: 'synthetic-concurrent-wamid' } });
      const firstResponse = await firstRequest;

      const acquiredOwners = vi
        .mocked(messageDigestDeliveryAuthorizationClient.acquire)
        .mock.calls.map(([identity]) => identity.ownerDigest);
      expect(acquiredOwners).toHaveLength(3);
      expect(new Set(acquiredOwners).size).toBe(2);
      expect(acquiredOwners[1]).toBe(acquiredOwners[0]);
      expect(secondResponse.statusCode).toBe(503);
      expect(firstResponse.statusCode).toBe(200);
      expect(ownerWhileFirstProviderWasActive).toBe(acquiredOwners[0]);
      expect(send).toHaveBeenCalledOnce();
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it.each([
      ['erased', { ok: true, disposition: 'denied' }],
      ['busy', { ok: true, disposition: 'busy' }],
      ['unavailable', { ok: false, code: 'unavailable' }],
    ] as const)(
      'does not reserve or send a delayed Message Digest when authorization is %s',
      async (_label, authorization) => {
        await userMappingRepository.saveMapping('user-digest-fenced', ['+48111222333']);
        vi.mocked(messageDigestDeliveryAuthorizationClient.acquire).mockResolvedValueOnce(
          authorization
        );
        const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody(
            createMessageDigestSendEvent('user-digest-fenced', `fenced_${_label}`)
          ),
        });

        expect(response.statusCode).toBe(_label === 'erased' ? 200 : 503);
        expect(reserve).not.toHaveBeenCalled();
        expect(messageSender.getSentMessages()).toHaveLength(0);
        expect(outboundMessageRepository.getMessages()).toHaveLength(0);
        expect(messageDigestDeliveryAuthorizationClient.release).not.toHaveBeenCalled();
      }
    );

    it('denies an exact frozen publisher event when erasure starts before delayed delivery', async () => {
      await userMappingRepository.saveMapping('user-digest-erasure-boundary', ['+48111222333']);
      let erasureStarted = false;
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire).mockImplementation(() =>
        Promise.resolve(
          erasureStarted
            ? { ok: true as const, disposition: 'denied' as const }
            : {
                ok: true as const,
                disposition: 'authorized' as const,
                fence: 1,
                expiresAt: '2026-07-28T07:02:00.000Z',
              }
        )
      );
      const frozen = buildSendMessageEvent({
        userId: 'user-digest-erasure-boundary',
        message: MESSAGE_DIGEST_EVENT_MESSAGE,
        correlationId: 'mdr_run_erasure_boundary',
        timestamp: '2026-07-28T07:00:00.000Z',
        idempotencyKey: 'message-digest:mdr_run_erasure_boundary',
        important: true,
        retainMessageText: false,
        presentation: {
          kind: 'message_digest_v1',
          digestName: 'Erasure boundary',
          digestExcerpt: 'Synthetic digest.',
          runUrlSuffix:
            '#/whatsapp/message-digests/md_definition_erasure_boundary/history/mdr_run_erasure_boundary',
        },
        deliveryAuthorization: {
          kind: 'message_digest_delivery_v1',
          definitionId: 'md_definition_erasure_boundary',
          runId: 'mdr_run_erasure_boundary',
        },
      });
      expect(frozen.ok).toBe(true);
      if (!frozen.ok) return;
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');

      erasureStarted = true;
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(frozen.value.event),
      });

      expect(response.statusCode).toBe(200);
      expect(reserve).not.toHaveBeenCalled();
      expect(messageSender.getSentMessages()).toHaveLength(0);
      expect(outboundMessageRepository.getMessages()).toHaveLength(0);
      expect(messageDigestDeliveryAuthorizationClient.release).not.toHaveBeenCalled();
    });

    it('makes a failed authorization release retryable after the resolved provider path', async () => {
      await userMappingRepository.saveMapping('user-digest-release-fail', ['+48111222333']);
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-release-fail', 'release_fail')
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(1);
      expect(outboundMessageRepository.getMessages()).toHaveLength(1);
    });

    it('releases its own authorization when an independently authorized receipt is already in flight', async () => {
      await userMappingRepository.saveMapping('user-digest-receipt-in-flight', [
        '+48111222333',
      ]);
      const body = createPubSubBody(
        createMessageDigestSendEvent('user-digest-receipt-in-flight', 'receipt_in_flight')
      );
      body.message.messageId = 'synthetic-receipt-in-flight-push';
      let notifyProviderEntered = (): void => undefined;
      const providerEntered = new Promise<void>((resolve) => {
        notifyProviderEntered = resolve;
      });
      let settleProvider = (_result: { ok: true; value: { wamid: string } }): void => undefined;
      const providerResult = new Promise<{ ok: true; value: { wamid: string } }>((resolve) => {
        settleProvider = resolve;
      });
      const send = vi
        .spyOn(messageSender, 'sendMessageDigestTemplate')
        .mockImplementation(async () => {
          notifyProviderEntered();
          return await providerResult;
        });

      const firstRequest = app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });
      await providerEntered;
      const duplicateResponse = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });
      const releasesBeforeProviderSettled = vi.mocked(
        messageDigestDeliveryAuthorizationClient.release
      ).mock.calls.length;
      settleProvider({ ok: true, value: { wamid: 'synthetic-receipt-in-flight-wamid' } });
      const firstResponse = await firstRequest;

      expect(duplicateResponse.statusCode).toBe(503);
      expect(firstResponse.statusCode).toBe(200);
      expect(send).toHaveBeenCalledOnce();
      expect(releasesBeforeProviderSettled).toBe(1);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledTimes(2);
    });

    it('releases authorization when Message Digest receipt completion fails', async () => {
      await userMappingRepository.saveMapping('user-digest-completion-fail', ['+48111222333']);
      outboundMessageRepository.setFailIdempotentCompletion(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-completion-fail', 'completion_fail')
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(1);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('releases authorization when Message Digest receipt completion throws', async () => {
      await userMappingRepository.saveMapping('user-digest-completion-throw', ['+48111222333']);
      vi.spyOn(outboundMessageRepository, 'completeIdempotentDelivery').mockRejectedValueOnce(
        new Error('synthetic completion exception')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-completion-throw', 'completion_throw')
        ),
      });

      expect(response.statusCode).toBe(500);
      expect(messageSender.getSentMessages()).toHaveLength(1);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('makes a thrown authorization release retryable after a settled Message Digest path', async () => {
      await userMappingRepository.saveMapping('user-digest-release-throw', ['+48111222333']);
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockRejectedValueOnce(
        new Error('synthetic release exception')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-release-throw', 'release_throw')
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(1);
      expect(outboundMessageRepository.getMessages()).toHaveLength(1);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('releases authorization after a terminal Message Digest mapping preflight', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-mapping-missing', 'mapping_missing')
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(0);
      expect(messageDigestDeliveryAuthorizationClient.acquire).toHaveBeenCalledOnce();
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('releases authorization when Message Digest receipt reservation fails', async () => {
      await userMappingRepository.saveMapping('user-digest-reservation-fail', ['+48111222333']);
      outboundMessageRepository.setFail(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-reservation-fail', 'reservation_fail')
        ),
      });

      expect(response.statusCode).toBe(500);
      expect(messageSender.getSentMessages()).toHaveLength(0);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('fails closed when the Message Digest authorization client is unavailable', async () => {
      await userMappingRepository.saveMapping('user-digest-no-authorization-client', [
        '+48111222333',
      ]);
      const {
        messageDigestDeliveryAuthorizationClient: _authorizationClient,
        ...withoutAuthorizationClient
      } = getServices();
      setServices(withoutAuthorizationClient);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent(
            'user-digest-no-authorization-client',
            'no_authorization_client'
          )
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('NACKs when the initial Message Digest authorization call throws', async () => {
      await userMappingRepository.saveMapping('user-digest-initial-acquire-throw', [
        '+48111222333',
      ]);
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire).mockRejectedValueOnce(
        new Error('synthetic initial acquire exception')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent(
            'user-digest-initial-acquire-throw',
            'initial_acquire_throw'
          )
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(0);
      expect(messageDigestDeliveryAuthorizationClient.release).not.toHaveBeenCalled();
    });

    it('NACKs when the renewed Message Digest authorization call throws', async () => {
      await userMappingRepository.saveMapping('user-digest-renewal-acquire-throw', [
        '+48111222333',
      ]);
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire)
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 31,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        })
        .mockRejectedValueOnce(new Error('synthetic renewal acquire exception'));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent(
            'user-digest-renewal-acquire-throw',
            'renewal_acquire_throw'
          )
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(0);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('NACKs when terminal preflight recording and authorization release both fail', async () => {
      await userMappingRepository.saveMapping('user-digest-empty-primary', []);
      vi.spyOn(outboundMessageRepository, 'markIdempotentDeliveryFailed').mockResolvedValueOnce({
        ok: false,
        code: 'PERSISTENCE_ERROR',
      });
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-empty-primary', 'empty_primary')
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('NACKs a rejected reservation when authorization release also fails', async () => {
      await userMappingRepository.saveMapping('user-digest-reserve-release-fail', [
        '+48111222333',
      ]);
      vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery').mockResolvedValueOnce({
        ok: false,
        code: 'PERSISTENCE_ERROR',
      });
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent(
            'user-digest-reserve-release-fail',
            'reserve_release_fail'
          )
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('NACKs a duplicate receipt when authorization release fails', async () => {
      await userMappingRepository.saveMapping('user-digest-duplicate-release-fail', [
        '+48111222333',
      ]);
      vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery').mockResolvedValueOnce({
        ok: true,
        disposition: 'duplicate_sent',
      });
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent(
            'user-digest-duplicate-release-fail',
            'duplicate_release_fail'
          )
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('NACKs a revoked renewal when authorization release fails', async () => {
      await userMappingRepository.saveMapping('user-digest-renewal-release-fail', [
        '+48111222333',
      ]);
      vi.mocked(messageDigestDeliveryAuthorizationClient.acquire)
        .mockResolvedValueOnce({
          ok: true,
          disposition: 'authorized',
          fence: 30,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        })
        .mockResolvedValueOnce({ ok: true, disposition: 'denied' });
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent(
            'user-digest-renewal-release-fail',
            'renewal_release_fail'
          )
        ),
      });

      expect(response.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('NACKs a thrown provider when ambiguity recording and authorization release fail', async () => {
      await userMappingRepository.saveMapping('user-digest-throw-failures', ['+48111222333']);
      messageSender.setThrow(true);
      vi.spyOn(outboundMessageRepository, 'markIdempotentDeliveryAmbiguous').mockResolvedValueOnce({
        ok: false,
        code: 'PERSISTENCE_ERROR',
      });
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-throw-failures', 'throw_failures')
        ),
      });

      expect(response.statusCode).toBe(503);
    });

    it('NACKs a permanent provider rejection when receipt and release recording fail', async () => {
      await userMappingRepository.saveMapping('user-digest-permanent-failures', [
        '+48111222333',
      ]);
      messageSender.setFail(true, {
        code: 'VALIDATION_ERROR',
        message: 'synthetic rejection',
        httpStatus: 400,
      });
      vi.spyOn(outboundMessageRepository, 'markIdempotentDeliveryFailed').mockResolvedValueOnce({
        ok: false,
        code: 'PERSISTENCE_ERROR',
      });
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-permanent-failures', 'permanent_failures')
        ),
      });

      expect(response.statusCode).toBe(503);
    });

    it('NACKs a transient provider failure when ambiguity and release recording fail', async () => {
      await userMappingRepository.saveMapping('user-digest-transient-failures', [
        '+48111222333',
      ]);
      messageSender.setFail(true, {
        code: 'INTERNAL_ERROR',
        message: 'synthetic unavailable',
        httpStatus: 503,
      });
      vi.spyOn(outboundMessageRepository, 'markIdempotentDeliveryAmbiguous').mockResolvedValueOnce({
        ok: false,
        code: 'PERSISTENCE_ERROR',
      });
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-digest-transient-failures', 'transient_failures')
        ),
      });

      expect(response.statusCode).toBe(503);
    });

    it('releases authorization in finally when receipt reservation throws', async () => {
      await userMappingRepository.saveMapping('user-digest-reservation-throw-release-fail', [
        '+48111222333',
      ]);
      vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery').mockRejectedValueOnce(
        new Error('synthetic reservation exception')
      );
      vi.mocked(messageDigestDeliveryAuthorizationClient.release).mockResolvedValueOnce({
        ok: false,
        code: 'unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent(
            'user-digest-reservation-throw-release-fail',
            'reservation_throw_release_fail'
          )
        ),
      });

      expect([500, 503]).toContain(response.statusCode);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it.each([
      [
        'permanent rejection',
        (): void =>
          messageSender.setFail(true, {
            code: 'VALIDATION_ERROR',
            message: 'synthetic rejection',
            httpStatus: 400,
          }),
      ],
      [
        'transient rejection',
        (): void =>
          messageSender.setFail(true, {
            code: 'INTERNAL_ERROR',
            message: 'synthetic unavailable',
            httpStatus: 503,
          }),
      ],
      ['thrown sender', (): void => messageSender.setThrow(true)],
    ] as const)('releases authorization after Message Digest sender %s', async (_label, arrange) => {
      const suffix = String(_label).replace(/[^A-Za-z0-9_-]/gu, '_');
      const userId = `user-digest-sender-${suffix}`;
      await userMappingRepository.saveMapping(userId, ['+48111222333']);
      arrange();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(createMessageDigestSendEvent(userId, `sender_${suffix}`)),
      });

      expect(response.statusCode).toBe(200);
      expect(messageDigestDeliveryAuthorizationClient.acquire).toHaveBeenCalledTimes(2);
      expect(messageDigestDeliveryAuthorizationClient.release).toHaveBeenCalledOnce();
    });

    it('omits message text from an ordinary outbound receipt when retention is explicitly disabled', async () => {
      await userMappingRepository.saveMapping('user-no-retention', ['+48111222333']);
      const event = createMessageDigestSendEvent('user-no-retention', 'no_retention');
      delete event['idempotencyKey'];
      delete event['presentation'];
      delete event['deliveryAuthorization'];
      delete event['important'];

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(response.statusCode).toBe(200);
      expect(outboundMessageRepository.getMessages()).toHaveLength(1);
      expect(outboundMessageRepository.getMessages()[0]).not.toHaveProperty('messageText');
    });

    it('rejects every unsafe control range in Message Digest template text', () => {
      for (const unsafeCharacter of [
        '\n',
        '\r',
        '\u001f',
        '\u007f',
        '\u009f',
        '\u202a',
        '\u202e',
        '\u2066',
        '\u2069',
      ]) {
        expect(isBoundedMessageDigestTemplateText(`unsafe${unsafeCharacter}`, 80)).toBe(false);
      }
      expect(isBoundedMessageDigestTemplateText('Safe digest', 80)).toBe(true);
    });

    it.each([
      [
        'unknown kind',
        {
          presentation: {
            kind: 'unknown',
            digestName: 'Daily digest',
            digestExcerpt: 'Digest excerpt',
            runUrlSuffix:
              '#/whatsapp/message-digests/md_definition_invalid/history/mdr_run_invalid',
          },
        },
      ],
      [
        'oversized name',
        {
          presentation: {
            kind: 'message_digest_v1',
            digestName: 'n'.repeat(81),
            digestExcerpt: 'Digest excerpt',
            runUrlSuffix:
              '#/whatsapp/message-digests/md_definition_invalid_oversized_name/history/mdr_run_invalid_oversized_name',
          },
        },
      ],
      [
        'oversized excerpt',
        {
          presentation: {
            kind: 'message_digest_v1',
            digestName: 'Daily digest',
            digestExcerpt: 'e'.repeat(877),
            runUrlSuffix:
              '#/whatsapp/message-digests/md_definition_invalid_oversized_excerpt/history/mdr_run_invalid_oversized_excerpt',
          },
        },
      ],
      [
        'unsafe URL suffix',
        {
          presentation: {
            kind: 'message_digest_v1',
            digestName: 'Daily digest',
            digestExcerpt: 'Digest excerpt',
            runUrlSuffix: 'https://attacker.example/private',
          },
        },
      ],
      ['retained content', { retainMessageText: true }],
      ['missing idempotency key', { idempotencyKey: undefined }],
      ['blank idempotency key', { idempotencyKey: '   ' }],
      ['missing important marker', { important: undefined }],
      ['false important marker', { important: false }],
      ['non-neutral event message', { message: 'Private digest summary' }],
      ['presentation without authorization', { deliveryAuthorization: undefined }],
      ['authorization without presentation', { presentation: undefined }],
      [
        'mismatched authorization definition',
        {
          deliveryAuthorization: {
            kind: 'message_digest_delivery_v1',
            definitionId: 'md_definition_other',
            runId: 'mdr_run_invalid_mismatched_authorization_definition',
          },
        },
      ],
      [
        'authorization with an extra field',
        {
          deliveryAuthorization: {
            kind: 'message_digest_delivery_v1',
            definitionId: 'md_definition_invalid_authorization_with_an_extra_field',
            runId: 'mdr_run_invalid_authorization_with_an_extra_field',
            phoneNumber: '+48111222333',
          },
        },
      ],
      [
        'free-form CTA',
        { ctaUrl: { displayText: 'Unsafe fallback', url: 'https://example.com' } },
      ],
      [
        'reply buttons',
        { buttons: [{ type: 'reply', reply: { id: 'unsafe', title: 'Unsafe' } }] },
      ],
    ])('rejects a malformed digest presentation before reservation: %s', async (_label, patch) => {
      await userMappingRepository.saveMapping('user-invalid-digest', ['+48111222333']);
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');
      const getMapping = vi.spyOn(userMappingRepository, 'getMapping');
      const getPreferences = vi.spyOn(prefs, 'getPreferences');
      const invalidSuffix = String(_label).replace(/[^A-Za-z0-9_-]/gu, '_');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMessageDigestSendEvent('user-invalid-digest', `invalid_${invalidSuffix}`, patch)
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(getMapping).not.toHaveBeenCalled();
      expect(getPreferences).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(messageSender.getSentMessages()).toHaveLength(0);
      expect(outboundMessageRepository.getMessages()).toHaveLength(0);
    });

    it('sends an exact idempotent Matrix delivery only once across Pub/Sub redelivery', async () => {
      await userMappingRepository.saveMapping('user-matrix-once', ['+48111222333']);
      const event = {
        type: 'whatsapp.message.send',
        userId: 'user-matrix-once',
        message: 'Synthetic Matrix reply',
        correlationId: 'imc_reply_digest_1',
        idempotencyKey: 'imc_reply_publish_1',
        buttons: [{ type: 'reply', reply: { id: 'matrix-ok', title: 'Continue' } }],
        timestamp: new Date().toISOString(),
      };

      const responses = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody(event),
        }),
        app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody(event),
        }),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(messageSender.getSentMessages()).toHaveLength(1);
      expect(outboundMessageRepository.getMessages()).toHaveLength(1);
    });

    it('reserves an idempotent delivery after mapping and preference decisions', async () => {
      await userMappingRepository.saveMapping('user-reservation-order', ['+48111222333']);
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');
      const mapping = vi.spyOn(userMappingRepository, 'getMapping');
      const preferences = vi.spyOn(prefs, 'getPreferences');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMatrixSendEvent('user-reservation-order', 'reservation_order', {
            important: true,
          })
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(reserve).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-reservation-order',
          idempotencyKey: 'imc_reply_publish_reservation_order',
        })
      );
      expect(mapping).toHaveBeenCalledWith('user-reservation-order');
      expect(preferences).toHaveBeenCalledWith('user-reservation-order');
      expect(mapping.mock.invocationCallOrder[0]).toBeLessThan(
        reserve.mock.invocationCallOrder[0] as number
      );
      expect(preferences.mock.invocationCallOrder[0]).toBeLessThan(
        reserve.mock.invocationCallOrder[0] as number
      );
    });

    it('does not reserve on transient mapping failure and lets redelivery acquire immediately', async () => {
      const userId = 'user-digest-transient-preflight';
      await userMappingRepository.saveMapping(userId, ['+48111222333']);
      const event = createMessageDigestSendEvent(userId, 'transient_preflight');
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');
      userMappingRepository.setFailGetMapping(true);

      const first = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(first.statusCode).toBe(500);
      expect(reserve).not.toHaveBeenCalled();
      userMappingRepository.setFailGetMapping(false);

      const redelivery = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(redelivery.statusCode).toBe(200);
      expect(reserve).toHaveBeenCalledOnce();
      expect(messageSender.getSentMessages()).toHaveLength(1);
    });

    it('persists terminal failed when the user has no WhatsApp mapping', async () => {
      const event = createMatrixSendEvent('user-digest-unmapped', 'digest_unmapped');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(response.statusCode).toBe(200);
      await expect(
        outboundMessageRepository.getIdempotentDeliveryState({
          userId: 'user-digest-unmapped',
          idempotencyKey: 'imc_reply_publish_digest_unmapped',
        })
      ).resolves.toMatchObject({
        ok: true,
        value: { status: 'failed', failureCode: 'MAPPING_MISSING' },
      });
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('sends an exact retry after a definitive pre-provider failure is authorized', async () => {
      const userId = 'user-digest-retry';
      const idempotencyKey = 'imc_reply_publish_digest_retry';
      const event = createMatrixSendEvent(userId, 'digest_retry');
      const reserve = vi.spyOn(outboundMessageRepository, 'reserveIdempotentDelivery');

      const first = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });
      const firstReservation = reserve.mock.calls[0]?.[0];
      expect(first.statusCode).toBe(200);
      expect(firstReservation).toEqual(
        expect.objectContaining({ userId, idempotencyKey, payloadDigest: expect.any(String) })
      );
      if (firstReservation === undefined) return;

      await userMappingRepository.saveMapping(userId, ['+48111222333']);
      await expect(
        outboundMessageRepository.authorizeIdempotentDeliveryRetry({
          userId,
          idempotencyKey,
          payloadDigest: firstReservation.payloadDigest,
          now: new Date().toISOString(),
        })
      ).resolves.toEqual({ ok: true, disposition: 'applied' });

      const retried = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(retried.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(1);
      await expect(
        outboundMessageRepository.getIdempotentDeliveryState({ userId, idempotencyKey })
      ).resolves.toMatchObject({ ok: true, value: { status: 'sent' } });
    });

    it('persists terminal failed for a disconnected first-number mapping', async () => {
      await userMappingRepository.saveMapping('user-digest-disconnected', ['+48111222333']);
      await userMappingRepository.disconnectMapping('user-digest-disconnected');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMatrixSendEvent('user-digest-disconnected', 'digest_disconnected')
        ),
      });

      expect(response.statusCode).toBe(200);
      await expect(
        outboundMessageRepository.getIdempotentDeliveryState({
          userId: 'user-digest-disconnected',
          idempotencyKey: 'imc_reply_publish_digest_disconnected',
        })
      ).resolves.toMatchObject({
        ok: true,
        value: { status: 'failed', failureCode: 'DISCONNECTED' },
      });
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('persists terminal failed when preferences definitively disable this delivery', async () => {
      await userMappingRepository.saveMapping('user-digest-disabled', ['+48111222333']);
      prefs.setLevel('user-digest-disabled', 'important');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMatrixSendEvent('user-digest-disabled', 'digest_disabled', {
            important: false,
          })
        ),
      });

      expect(response.statusCode).toBe(200);
      await expect(
        outboundMessageRepository.getIdempotentDeliveryState({
          userId: 'user-digest-disabled',
          idempotencyKey: 'imc_reply_publish_digest_disabled',
        })
      ).resolves.toMatchObject({
        ok: true,
        value: { status: 'failed', failureCode: 'DELIVERY_DISABLED' },
      });
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('persists terminal failed for a definitive sender rejection before any external effect', async () => {
      await userMappingRepository.saveMapping('user-digest-rejected', ['+48111222333']);
      messageSender.setFail(true, {
        code: 'VALIDATION_ERROR',
        message: 'synthetic definitive rejection',
        httpStatus: 400,
      });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(createMatrixSendEvent('user-digest-rejected', 'digest_rejected')),
      });

      expect(response.statusCode).toBe(200);
      await expect(
        outboundMessageRepository.getIdempotentDeliveryState({
          userId: 'user-digest-rejected',
          idempotencyKey: 'imc_reply_publish_digest_rejected',
        })
      ).resolves.toMatchObject({
        ok: true,
        value: { status: 'failed', failureCode: 'PROVIDER_REJECTED' },
      });
    });

    it('fails a Matrix delivery with an empty user id without exposing ordinary metadata', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(createMatrixSendEvent('', 'invalid_user')),
      });

      expect(response.statusCode).toBe(400);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('fails a Matrix delivery when phone lookup persistence fails', async () => {
      userMappingRepository.setFailGetMapping(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(createMatrixSendEvent('user-matrix-phone-fail', 'phone_fail')),
      });

      expect(response.statusCode).toBe(500);
    });

    it('skips a Matrix delivery when the user has no WhatsApp mapping', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(createMatrixSendEvent('user-matrix-unmapped', 'unmapped')),
      });

      expect(response.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('delivers a Matrix message after a notification-preferences read failure', async () => {
      await userMappingRepository.saveMapping('user-matrix-prefs-fail', ['+48111222333']);
      prefs.failNext({ code: 'PERSISTENCE_ERROR', message: 'private prefs failure' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(createMatrixSendEvent('user-matrix-prefs-fail', 'prefs_fail')),
      });

      expect(response.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(1);
    });

    it('drops a non-important Matrix message according to notification preferences', async () => {
      await userMappingRepository.saveMapping('user-matrix-drop', ['+48111222333']);
      prefs.setLevel('user-matrix-drop', 'important');

      const explicit = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMatrixSendEvent('user-matrix-drop', 'preferences_drop', { important: false })
        ),
      });
      const absent = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMatrixSendEvent('user-matrix-drop', 'preferences_drop_absent')
        ),
      });

      expect([explicit.statusCode, absent.statusCode]).toEqual([200, 200]);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('NACKs a Matrix delivery when its reservation cannot be persisted', async () => {
      await userMappingRepository.saveMapping('user-matrix-reserve-fail', ['+48111222333']);
      outboundMessageRepository.setFail(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          createMatrixSendEvent('user-matrix-reserve-fail', 'reserve_fail')
        ),
      });

      expect(response.statusCode).toBe(500);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('marks a thrown Matrix send as ambiguous without retrying blindly', async () => {
      await userMappingRepository.saveMapping('user-matrix-throw', ['+48111222333']);
      messageSender.setThrow(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(createMatrixSendEvent('user-matrix-throw', 'throw')),
      });

      expect(response.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('returns an internal error when an ordinary WhatsApp sender throws', async () => {
      await userMappingRepository.saveMapping('user-ordinary-throw', ['+48111222333']);
      messageSender.setThrow(true);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-ordinary-throw',
          message: 'Ordinary message',
          correlationId: 'ordinary_throw',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.statusCode).toBe(500);
      expect(messageSender.getSentMessages()).toHaveLength(0);
    });

    it('does not write Matrix delivery payload or identity sentinels to logs', async () => {
      await userMappingRepository.saveMapping('USER_LOG_PRIVATE_SENTINEL', ['+48123456001']);
      const info = vi.spyOn(app.log, 'info');
      const warn = vi.spyOn(app.log, 'warn');
      const error = vi.spyOn(app.log, 'error');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'USER_LOG_PRIVATE_SENTINEL',
          message: 'MESSAGE_LOG_PRIVATE_SENTINEL',
          correlationId: 'CORRELATION_LOG_PRIVATE_SENTINEL',
          idempotencyKey: 'IDEMPOTENCY_LOG_PRIVATE_SENTINEL',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.statusCode).toBe(200);
      const serializedLogs = JSON.stringify([info.mock.calls, warn.mock.calls, error.mock.calls]);
      expect(serializedLogs).toContain('matrix_corpus');
      for (const sentinel of [
        'USER_LOG_PRIVATE_SENTINEL',
        'MESSAGE_LOG_PRIVATE_SENTINEL',
        'CORRELATION_LOG_PRIVATE_SENTINEL',
        'IDEMPOTENCY_LOG_PRIVATE_SENTINEL',
        '+48123456001',
      ]) {
        expect(serializedLogs).not.toContain(sentinel);
      }
    });

    it('rejects an empty Matrix idempotency key before any WhatsApp send', async () => {
      await userMappingRepository.saveMapping('user-matrix-invalid-key', ['+48111222333']);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-matrix-invalid-key',
          message: 'Must not be sent',
          correlationId: 'imc_reply_invalid_key',
          idempotencyKey: '   ',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(0);
      expect(outboundMessageRepository.getMessages()).toHaveLength(0);
    });

    it('rejects a changed payload replay without sending a second Matrix message', async () => {
      await userMappingRepository.saveMapping('user-matrix-conflict', ['+48111222333']);
      const original = {
        type: 'whatsapp.message.send',
        userId: 'user-matrix-conflict',
        message: 'Original synthetic reply',
        correlationId: 'imc_reply_digest_2',
        idempotencyKey: 'imc_reply_publish_2',
        timestamp: new Date().toISOString(),
      };
      await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(original),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({ ...original, message: 'Changed synthetic reply' }),
      });

      expect(response.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(1);
    });

    it('does not blindly resend after an ambiguous Matrix delivery failure', async () => {
      await userMappingRepository.saveMapping('user-matrix-ambiguous', ['+48111222333']);
      const event = {
        type: 'whatsapp.message.send',
        userId: 'user-matrix-ambiguous',
        message: 'Synthetic reply with uncertain delivery',
        correlationId: 'imc_reply_digest_3',
        idempotencyKey: 'imc_reply_publish_3',
        timestamp: new Date().toISOString(),
      };
      messageSender.setFail(true, {
        code: 'INTERNAL_ERROR',
        message: 'PRIVATE_AMBIGUOUS_SEND_ERROR',
      });

      const first = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });
      messageSender.setFail(false);
      const replay = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(first.statusCode).toBe(200);
      expect(replay.statusCode).toBe(200);
      expect(messageSender.getSentMessages()).toHaveLength(0);
      await expect(
        outboundMessageRepository.getIdempotentDeliveryState({
          userId: 'user-matrix-ambiguous',
          idempotencyKey: 'imc_reply_publish_3',
        })
      ).resolves.toMatchObject({ ok: true, value: { status: 'ambiguous' } });
    });

    it('NACKs until a successful Matrix send with an incomplete receipt can be reconciled', async () => {
      await userMappingRepository.saveMapping('user-matrix-completion-failure', ['+48111222333']);
      const event = {
        type: 'whatsapp.message.send',
        userId: 'user-matrix-completion-failure',
        message: 'Synthetic reply with failed receipt completion',
        correlationId: 'imc_reply_digest_completion_failure',
        idempotencyKey: 'imc_reply_publish_completion_failure',
        timestamp: new Date().toISOString(),
      };
      outboundMessageRepository.setFailIdempotentCompletion(true);

      const first = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });
      outboundMessageRepository.setFailIdempotentCompletion(false);
      const replay = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(first.statusCode).toBe(503);
      expect(replay.statusCode).toBe(503);
      expect(messageSender.getSentMessages()).toHaveLength(1);
      expect(outboundMessageRepository.getMessages()).toHaveLength(0);
    });

    it('does not deduplicate ordinary messages that omit idempotencyKey', async () => {
      await userMappingRepository.saveMapping('user-ordinary-repeat', ['+48111222333']);
      const event = {
        type: 'whatsapp.message.send',
        userId: 'user-ordinary-repeat',
        message: 'Ordinary repeated message',
        correlationId: 'ordinary-correlation',
        timestamp: new Date().toISOString(),
      };

      await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });
      await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(event),
      });

      expect(messageSender.getSentMessages()).toHaveLength(2);
    });

    describe('important filtering', () => {
      it("delivers when level='all' and no important flag", async () => {
        await userMappingRepository.saveMapping('user-all', ['+48111111111']);
        // level defaults to 'all' on the fake

        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-all',
          message: 'Normal message',
          correlationId: 'corr-all',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        expect(messageSender.getSentMessages()).toHaveLength(1);
      });

      it("delivers when level='important' and important=true", async () => {
        await userMappingRepository.saveMapping('user-imp-yes', ['+48222222222']);
        prefs.setLevel('user-imp-yes', 'important');

        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-imp-yes',
          message: 'Critical alert',
          important: true,
          correlationId: 'corr-imp-yes',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        expect(messageSender.getSentMessages()).toHaveLength(1);
      });

      it("drops when level='important' and important absent", async () => {
        await userMappingRepository.saveMapping('user-imp-absent', ['+48333333333']);
        prefs.setLevel('user-imp-absent', 'important');

        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-imp-absent',
          message: 'Noisy message',
          correlationId: 'corr-imp-absent',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        const responseBody = JSON.parse(response.body) as { success: boolean };
        expect(responseBody.success).toBe(true);
        expect(messageSender.getSentMessages()).toHaveLength(0);
      });

      it("drops when level='important' and important=false", async () => {
        await userMappingRepository.saveMapping('user-imp-false', ['+48444444444']);
        prefs.setLevel('user-imp-false', 'important');

        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-imp-false',
          message: 'Explicit not important',
          important: false,
          correlationId: 'corr-imp-false',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        expect(messageSender.getSentMessages()).toHaveLength(0);
      });

      it('dropped message does not call outboundMessageRepository.save', async () => {
        await userMappingRepository.saveMapping('user-no-save', ['+48555555555']);
        prefs.setLevel('user-no-save', 'important');

        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-no-save',
          message: 'Drop me',
          correlationId: 'corr-no-save',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        expect(outboundMessageRepository.getMessages()).toHaveLength(0);
      });

      it('fails open: delivers when preferences read fails', async () => {
        await userMappingRepository.saveMapping('user-pref-err', ['+48666666666']);
        prefs.failNext({
          code: 'PERSISTENCE_ERROR',
          message: 'Simulated preferences read failure',
        });

        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-pref-err',
          message: 'Fail-open delivery',
          correlationId: 'corr-pref-err',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        // Falls back to 'all' → delivers
        expect(messageSender.getSentMessages()).toHaveLength(1);
      });
    });
  });

  describe('POST /internal/whatsapp/pubsub/media-cleanup', () => {
    it('returns 401 when X-Internal-Auth header is missing', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.media.cleanup',
        userId: 'user-123',
        messageId: 'msg-123',
        gcsPaths: ['path/to/file.jpg'],
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        payload: body,
      });

      expect(response.statusCode).toBe(401);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toContain('auth failed');
    });

    it('returns 401 when X-Internal-Auth header is invalid', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.media.cleanup',
        userId: 'user-123',
        messageId: 'msg-123',
        gcsPaths: ['path/to/file.jpg'],
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: body,
      });

      expect(response.statusCode).toBe(401);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toContain('auth failed');
    });

    describe('Pub/Sub OIDC authentication', () => {
      it('accepts Pub/Sub push with from: noreply@google.com header (no x-internal-auth)', async () => {
        const gcsPaths = ['path/to/file1.jpg', 'path/to/file2_thumb.jpg'];
        const body = createPubSubBody({
          type: 'whatsapp.media.cleanup',
          userId: 'user-123',
          messageId: 'msg-123',
          gcsPaths,
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/media-cleanup',
          headers: {
            'content-type': 'application/json',
            from: 'noreply@google.com',
            // NOTE: NO x-internal-auth header - should still work via OIDC
          },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        const responseBody = JSON.parse(response.body) as {
          success: boolean;
          data: { deletedCount: number };
        };
        expect(responseBody.success).toBe(true);
        expect(responseBody.data.deletedCount).toBe(2);
      });

      it('rejects direct calls without x-internal-auth or Pub/Sub from header', async () => {
        const body = createPubSubBody({
          type: 'whatsapp.media.cleanup',
          userId: 'user-123',
          messageId: 'msg-123',
          gcsPaths: ['path/to/file.jpg'],
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/media-cleanup',
          headers: {
            'content-type': 'application/json',
            // NO from: noreply@google.com
            // NO x-internal-auth
          },
          payload: body,
        });

        expect(response.statusCode).toBe(401);
        const responseBody = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(responseBody.error.message).toContain('auth failed');
      });
    });

    it('returns 400 when message data is not valid base64', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          message: {
            data: '!!!not-base64!!!',
            messageId: 'msg-123',
            publishTime: new Date().toISOString(),
          },
          subscription: 'projects/test/subscriptions/test-sub',
        },
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to decode PubSub message');
    });

    it('returns 400 when message data is not valid JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          message: {
            data: Buffer.from('not json at all').toString('base64'),
            messageId: 'msg-123',
            publishTime: new Date().toISOString(),
          },
          subscription: 'projects/test/subscriptions/test-sub',
        },
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to decode PubSub message');
    });

    it('returns 400 when event type is not whatsapp.media.cleanup', async () => {
      const body = createPubSubBody({
        type: 'unknown.event.type',
        userId: 'user-123',
        messageId: 'msg-123',
        gcsPaths: ['path/to/file.jpg'],
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Unexpected event type');
    });

    it('deletes files and returns 200 on success', async () => {
      const gcsPaths = ['path/to/file1.jpg', 'path/to/file2_thumb.jpg'];
      const body = createPubSubBody({
        type: 'whatsapp.media.cleanup',
        userId: 'user-123',
        messageId: 'msg-123',
        gcsPaths,
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        data: { deletedCount: number };
      };
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.deletedCount).toBe(2);

      const deletedPaths = mediaStorage.getDeletedPaths();
      expect(deletedPaths).toEqual(gcsPaths);
    });

    it('handles empty gcsPaths array', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.media.cleanup',
        userId: 'user-123',
        messageId: 'msg-123',
        gcsPaths: [],
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        data: { deletedCount: number };
      };
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.deletedCount).toBe(0);
    });

    it('continues cleanup when delete fails for some files', async () => {
      mediaStorage.setFailDelete(true);

      const gcsPaths = ['path/to/file1.jpg', 'path/to/file2_thumb.jpg'];
      const body = createPubSubBody({
        type: 'whatsapp.media.cleanup',
        userId: 'user-123',
        messageId: 'msg-123',
        gcsPaths,
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        data: { deletedCount: number };
      };
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.deletedCount).toBe(0);
    });

    it('returns 500 when delete throws an unexpected exception', async () => {
      mediaStorage.setThrowOnDelete(true);

      const gcsPaths = ['path/to/file1.jpg'];
      const body = createPubSubBody({
        type: 'whatsapp.media.cleanup',
        userId: 'user-123',
        messageId: 'msg-123',
        gcsPaths,
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/media-cleanup',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body);
      // console.log('Response body:', responseBody);
      expect(responseBody.error).toBeDefined();
      expect(responseBody.error.message).toBe('Cleanup failed');
    });
  });

  describe('POST /internal/whatsapp/pubsub/process-webhook', () => {
    const erasureEvent = {
      type: 'whatsapp.private-account.erasure' as const,
      sourceAccountId: 'source-1',
      userId: 'user-1',
      erasureRequestId: 'erase-1',
      attempt: 1,
    };

    it('wires Matrix corpus ingress into asynchronous webhook processing when enabled', async () => {
      setServices({
        ...getServices(),
        matrixCorpus: {
          routes: null as never,
          ingress: notReadyMatrixCorpusIngress,
          recoveryController: null as never,
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.webhook.process',
          eventId: 'event-matrix-enabled',
          payload: '{}',
          phoneNumberId: 'phone-matrix-enabled',
          receivedAt: new Date().toISOString(),
        }),
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejects a spoofable Pub/Sub From header for private erasure work', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: {
          'content-type': 'application/json',
          from: 'noreply@google.com',
        },
        payload: createPubSubBody(erasureEvent),
      });

      expect(response.statusCode).toBe(401);
      expect(privateWhatsAppErasureRepository.advanceOneBatch).not.toHaveBeenCalled();
    });

    it('advances one bounded private erasure batch, republishes, and records partial telemetry', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(erasureEvent),
      });

      expect(response.statusCode).toBe(200);
      expect(privateWhatsAppErasureRepository.advanceOneBatch).toHaveBeenCalledWith(
        expect.objectContaining({ expectedAttempt: 1, batchSize: 20 })
      );
      expect(eventPublisher.getPrivateWhatsAppErasureEvents()).toEqual([
        { ...erasureEvent, attempt: 2 },
      ]);
      expect(conversationAssistantOperationalTelemetry.records).toContainEqual({
        operation: 'privacy_erasure',
        outcome: 'partial',
        durationMs: expect.any(Number),
        count: 2,
      });
    });

    it('acknowledges malformed and stale private erasure work without publishing', async () => {
      const malformed = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({ ...erasureEvent, sourceAccountId: '', attempt: -1 }),
      });
      expect(malformed.statusCode).toBe(200);
      expect(privateWhatsAppErasureRepository.advanceOneBatch).not.toHaveBeenCalled();

      vi.mocked(privateWhatsAppErasureRepository.advanceOneBatch).mockResolvedValueOnce(
        ok({ status: 'stale' })
      );
      vi.mocked(privateWhatsAppErasureRepository.get).mockResolvedValueOnce(ok(null));
      const stale = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(erasureEvent),
      });
      expect(stale.statusCode).toBe(200);
      expect(eventPublisher.getPrivateWhatsAppErasureEvents()).toEqual([]);
    });

    it('returns 500 for retryable private erasure persistence and publish failures', async () => {
      vi.mocked(privateWhatsAppErasureRepository.advanceOneBatch).mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'private persistence detail' })
      );
      const persistenceFailure = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(erasureEvent),
      });
      expect(persistenceFailure.statusCode).toBe(500);
      expect(persistenceFailure.body).not.toContain('private persistence detail');

      eventPublisher.setPrivateWhatsAppErasureFailure('private publish detail');
      const publishFailure = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(erasureEvent),
      });
      expect(publishFailure.statusCode).toBe(500);
      expect(publishFailure.body).not.toContain('private publish detail');
    });

    it('requires both private erasure worker dependencies', async () => {
      const configured = getServices();
      for (const missingService of [
        'privateWhatsAppErasureRepository',
        'privateWhatsAppErasurePublisher',
      ] as const) {
        setServices({ ...configured, [missingService]: undefined });
        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/process-webhook',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody(erasureEvent),
        });
        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body).error).toMatchObject({
          code: 'INTERNAL_ERROR',
          message: 'Private WhatsApp erasure is not configured',
        });
      }
      setServices(configured);
    });

    async function seedQueuedContextAttachment(
      overrides: { attachmentId?: string; generationId?: string } = {}
    ): Promise<{ attachmentId: string; generationId: string }> {
      const attachmentId = overrides.attachmentId ?? 'attachment-worker-1';
      const generationId = overrides.generationId ?? 'generation-worker-1';
      conversationAssistantContextAttachmentRepository.setSession({
        userId: 'user-123',
        sessionId: 'session-worker-1',
        generationId,
      });
      const captured =
        await conversationAssistantContextAttachmentRepository.captureContextAttachment({
          attachmentId,
          userId: 'user-123',
          sessionId: 'session-worker-1',
          expectedSessionGenerationId: generationId,
          preparationRequestId: 'request-worker-1',
          preparationRequestFingerprint: 'fingerprint-worker-1',
        });
      if (captured.status !== 'created') throw new Error('Expected queued attachment');
      return { attachmentId, generationId };
    }

    function contextAttachmentPreparationEvent(input: {
      attachmentId: string;
      generationId: string;
      attempt?: number;
    }): Record<string, unknown> {
      return {
        type: 'whatsapp.conversation-assistant.context-attachment.prepare',
        userId: 'user-123',
        sessionId: 'session-worker-1',
        sessionGenerationId: input.generationId,
        attachmentId: input.attachmentId,
        attempt: input.attempt ?? 1,
      };
    }

    it('runs all Conversation Assistant workers when operational telemetry is disabled', async () => {
      const configured = getServices();
      const {
        conversationAssistantOperationalTelemetry: _operationalTelemetry,
        ...withoutOperationalTelemetry
      } = configured;
      setServices(withoutOperationalTelemetry);

      const erasure = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(erasureEvent),
      });
      const queued = await seedQueuedContextAttachment({ attachmentId: 'attachment-no-telemetry' });
      const attachmentPreparation = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          contextAttachmentPreparationEvent({
            attachmentId: queued.attachmentId,
            generationId: queued.generationId,
          })
        ),
      });
      const sessionPreparation = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.conversation-assistant.prepare',
          sessionId: 'missing-no-telemetry',
          userId: 'user-123',
          attempt: 1,
        }),
      });

      expect(erasure.statusCode).toBe(200);
      expect(attachmentPreparation.statusCode).toBe(200);
      expect(sessionPreparation.statusCode).toBe(200);
    });

    it('claims and completes one content-free context attachment preparation event', async () => {
      const queued = await seedQueuedContextAttachment();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          contextAttachmentPreparationEvent({
            attachmentId: queued.attachmentId,
            generationId: queued.generationId,
          })
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(
        conversationAssistantContextAttachmentRepository.getAttachment(queued.attachmentId)
      ).toMatchObject({ status: 'ready', preparationAttempt: 1 });
      expect(
        conversationAssistantContextAttachmentRepository.getSnapshot(queued.attachmentId)
      ).toBeDefined();
      expect(conversationAssistantOperationalTelemetry.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'attachment_preparation',
            outcome: 'zero',
            durationMs: expect.any(Number),
          }),
        ])
      );
    });

    it.each([
      { name: 'missing user', event: { userId: undefined } },
      { name: 'missing session', event: { sessionId: undefined } },
      { name: 'missing generation', event: { sessionGenerationId: undefined } },
      { name: 'missing attachment', event: { attachmentId: undefined } },
      { name: 'invalid attempt', event: { attempt: 0 } },
    ])(
      'acknowledges invalid attachment preparation with $name without claiming',
      async ({ event }) => {
        const queued = await seedQueuedContextAttachment();
        const completeEvent = contextAttachmentPreparationEvent({
          attachmentId: queued.attachmentId,
          generationId: queued.generationId,
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/process-webhook',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody({ ...completeEvent, ...event }),
        });

        expect(response.statusCode).toBe(200);
        expect(
          conversationAssistantContextAttachmentRepository.getAttachment(queued.attachmentId)
            ?.status
        ).toBe('queued');
      }
    );

    it.each([
      ['busy', 500],
      ['stale', 200],
      ['not_found', 200],
      ['expired', 200],
    ] as const)(
      'returns %s attachment preparation claim state with HTTP %s',
      async (claimState, expectedStatus) => {
        const queued = await seedQueuedContextAttachment();
        conversationAssistantContextAttachmentRepository.claimResultOverride = claimState;

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/process-webhook',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody(
            contextAttachmentPreparationEvent({
              attachmentId: queued.attachmentId,
              generationId: queued.generationId,
            })
          ),
        });

        expect(response.statusCode).toBe(expectedStatus);
      }
    );

    it('acknowledges a lost lease without letting the older worker publish ready state', async () => {
      const queued = await seedQueuedContextAttachment();
      conversationAssistantContextAttachmentRepository.persistenceResultOverride = 'stale';

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          contextAttachmentPreparationEvent({
            attachmentId: queued.attachmentId,
            generationId: queued.generationId,
          })
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(
        conversationAssistantContextAttachmentRepository.getAttachment(queued.attachmentId)?.status
      ).toBe('preparing');
    });

    it('persists a safe failed state when exact-cutoff preparation fails', async () => {
      const queued = await seedQueuedContextAttachment();
      conversationAssistantContextAttachmentDeltaBuilder.setFailure(
        'SOURCE_UNAVAILABLE',
        'provider detail that must not be returned'
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          contextAttachmentPreparationEvent({
            attachmentId: queued.attachmentId,
            generationId: queued.generationId,
          })
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(
        conversationAssistantContextAttachmentRepository.getAttachment(queued.attachmentId)
      ).toMatchObject({
        status: 'failed',
        preparationError: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'provider detail that must not be returned',
        },
      });
      expect(response.body).not.toContain('provider detail');
    });

    it('returns 500 on a persistence exception so Pub/Sub retries the same fenced event', async () => {
      const queued = await seedQueuedContextAttachment();
      conversationAssistantContextAttachmentRepository.throwOnClaim = true;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody(
          contextAttachmentPreparationEvent({
            attachmentId: queued.attachmentId,
            generationId: queued.generationId,
          })
        ),
      });

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('fake claim persistence failure');
    });

    it('requires both attachment worker dependencies', async () => {
      const queued = await seedQueuedContextAttachment();
      const configured = getServices();
      for (const missingService of [
        'conversationAssistantContextAttachmentRepository',
        'conversationAssistantContextAttachmentDeltaBuilder',
      ] as const) {
        setServices({ ...configured, [missingService]: undefined });
        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/process-webhook',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody(
            contextAttachmentPreparationEvent({
              attachmentId: queued.attachmentId,
              generationId: queued.generationId,
            })
          ),
        });
        expect(response.statusCode).toBe(500);
      }
    });

    it('prepares a queued Conversation Assistant context', async () => {
      privateWhatsAppRepository.setAccount({
        id: 'user-123',
        userId: 'user-123',
        sourceAccountId: 'source-123',
        phoneNumberNormalized: '48123456789',
        displayName: 'Test Number',
        status: 'active',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        schemaVersion: 1,
      });
      await privateWhatsAppRepository.storeIncomingMessage({
        sourceAccountId: 'source-123',
        userId: 'user-123',
        deliveryMode: 'backfill',
        receivedAt: '2026-06-30T10:00:00.000Z',
        chat: { matrixRoomId: '!direct', type: 'direct', displayName: 'Test Number' },
        message: {
          matrixRoomId: '!direct',
          matrixEventId: '$event-1',
          matrixSenderId: '@test:matrix.example',
          senderKey: 'phone:+48111111111',
          direction: 'incoming',
          type: 'text',
          text: 'Message for the frozen context.',
          eventTimestamp: '2026-06-30T10:00:00.000Z',
          rawMatrixEvent: {},
        },
      });
      await conversationAssistantRepository.saveSession({
        id: 'whatsapp_conv_session_prepare',
        userId: 'user-123',
        chatId: 'chat:source-123:!direct',
        chatDisplayName: 'Test Number',
        status: 'preparing',
        preparationStage: 'queued',
        preparationAttempt: 1,
        range: {
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        effectiveRange: {
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        model: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
        transcriptSha256: '',
        transcriptMessageCount: 0,
        transcriptText: '',
        assistantRoleLabel: 'Assistant',
        omitted: {
          mediaOnly: 0,
          failedTranscriptions: 0,
          pendingTranscriptions: 0,
          nonText: 0,
          overLimit: 0,
        },
        title: 'Test Number (2026-06-30 to 2026-07-01)',
        createdAt: '2026-06-30T12:00:00.000Z',
        updatedAt: '2026-06-30T12:00:00.000Z',
        creationRequestId: 'request-prepare',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.conversation-assistant.prepare',
          sessionId: 'whatsapp_conv_session_prepare',
          userId: 'user-123',
          attempt: 1,
        }),
      });

      expect(response.statusCode).toBe(200);
      const prepared = await conversationAssistantRepository.getSessionById(
        'whatsapp_conv_session_prepare'
      );
      expect(prepared?.status).toBe('ready');
      expect(prepared?.transcriptText).toContain('Message for the frozen context.');
    });

    it.each([
      { name: 'missing session id', event: { userId: 'user-123', attempt: 1 } },
      {
        name: 'missing user id',
        event: { sessionId: 'whatsapp_conv_session_prepare', attempt: 1 },
      },
      {
        name: 'non-integer attempt',
        event: {
          sessionId: 'whatsapp_conv_session_prepare',
          userId: 'user-123',
          attempt: 1.5,
        },
      },
      {
        name: 'non-positive attempt',
        event: {
          sessionId: 'whatsapp_conv_session_prepare',
          userId: 'user-123',
          attempt: 0,
        },
      },
    ])('acknowledges an invalid Conversation Assistant event with $name', async ({ event }) => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.conversation-assistant.prepare',
          ...event,
        }),
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejects each missing Conversation Assistant worker dependency', async () => {
      const configured = getServices();
      for (const missingService of [
        'conversationAssistantRepository',
        'llmClientFactory',
        'conversationAssistantModel',
      ] as const) {
        setServices({ ...configured, [missingService]: undefined });
        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/process-webhook',
          headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
          payload: createPubSubBody({
            type: 'whatsapp.conversation-assistant.prepare',
            sessionId: 'whatsapp_conv_session_prepare',
            userId: 'user-123',
            attempt: 1,
          }),
        });

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body).error).toMatchObject({
          code: 'INTERNAL_ERROR',
          message: 'Conversation Assistant services are not configured',
        });
      }
    });

    it('acknowledges a preparation request for a missing session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.conversation-assistant.prepare',
          sessionId: 'whatsapp_conv_session_missing',
          userId: 'user-123',
          attempt: 1,
        }),
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes an optional generation fence and configured PDF exporter to preparation', async () => {
      const pdfConversationExporter = new FakePdfConversationExporter();
      setServices({ ...getServices(), pdfConversationExporter });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.conversation-assistant.prepare',
          sessionId: 'whatsapp_conv_session_generation_fence_missing',
          userId: 'user-123',
          attempt: 1,
          generationId: 'generation-fence-1',
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(pdfConversationExporter.calls).toEqual([]);
    });

    it('returns 500 while another worker owns the active preparation claim', async () => {
      await conversationAssistantRepository.saveSession({
        id: 'whatsapp_conv_session_busy',
        userId: 'user-123',
        chatId: 'chat:source-123:!direct',
        chatDisplayName: 'Test Number',
        status: 'preparing',
        preparationStage: 'loading_messages',
        preparationAttempt: 1,
        preparationClaimId: 'existing-claim',
        preparationLeaseExpiresAt: '2999-01-01T00:00:00.000Z',
        range: {
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        effectiveRange: {
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        model: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
        transcriptSha256: '',
        transcriptMessageCount: 0,
        transcriptText: '',
        assistantRoleLabel: 'Assistant',
        omitted: {
          mediaOnly: 0,
          failedTranscriptions: 0,
          pendingTranscriptions: 0,
          nonText: 0,
          overLimit: 0,
        },
        title: 'Busy preparation',
        createdAt: '2026-06-30T12:00:00.000Z',
        updatedAt: '2026-06-30T12:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.conversation-assistant.prepare',
          sessionId: 'whatsapp_conv_session_busy',
          userId: 'user-123',
          attempt: 1,
        }),
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 401 when auth is missing', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.webhook.process',
        eventId: 'event-123',
        payload: '{}',
        phoneNumberId: 'phone-456',
        receivedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        payload: body,
      });

      expect(response.statusCode).toBe(401);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toContain('auth failed');
    });

    it('accepts Pub/Sub push with from: noreply@google.com header', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.webhook.process',
        eventId: 'event-123',
        payload: '{}',
        phoneNumberId: 'phone-456',
        receivedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: {
          'content-type': 'application/json',
          from: 'noreply@google.com',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('returns success when message data is invalid base64', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          message: {
            data: '!!!not-valid-json!!!',
            messageId: 'msg-123',
            publishTime: new Date().toISOString(),
          },
          subscription: 'projects/test/subscriptions/test-sub',
        },
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('returns success when event type is unexpected', async () => {
      const body = createPubSubBody({
        type: 'unknown.event.type',
        eventId: 'event-123',
        payload: '{}',
        phoneNumberId: 'phone-456',
        receivedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('returns success even when processing fails', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.webhook.process',
        eventId: 'event-123',
        payload: '{"invalid": "payload"}',
        phoneNumberId: 'phone-456',
        receivedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('NACKs a retryable webhook-processing persistence failure', async () => {
      await userMappingRepository.saveMapping('user-webhook-retryable', ['+15551234567']);
      messageRepository.setFailFindByWaMessageId(true);
      const payload = {
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
                    display_phone_number: '15550000000',
                    phone_number_id: '123456789012345',
                  },
                  contacts: [{ wa_id: '15551234567', profile: { name: 'Synthetic User' } }],
                  messages: [
                    {
                      from: '15551234567',
                      id: 'wamid.retryable.persistence',
                      timestamp: '1234567890',
                      type: 'text',
                      text: { body: 'Synthetic retryable message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.webhook.process',
          eventId: 'event-retryable-persistence',
          payload: JSON.stringify(payload),
          phoneNumberId: '123456789012345',
          receivedAt: new Date().toISOString(),
        }),
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error.code).toBe('INTERNAL_ERROR');
    });

    it('returns success and logs error when payload is not valid JSON', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.webhook.process',
        eventId: 'event-json-fail',
        payload: 'this is not valid JSON!!!',
        phoneNumberId: 'phone-456',
        receivedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('processes link preview extraction event', async () => {
      const messageId = 'msg-link-preview';
      const userId = 'user-link-preview';

      // Pre-populate a message
      messageRepository.setMessage({
        id: messageId,
        userId,
        waMessageId: 'wamid.linkpreview',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        text: 'Check out https://example.com',
        mediaType: 'text',
        timestamp: Date.now().toString(),
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-lp',
      });

      const body = createPubSubBody({
        type: 'whatsapp.linkpreview.extract',
        messageId,
        userId,
        text: 'Check out https://example.com',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      // Verify link preview was extracted
      const message = messageRepository.getMessageSync(messageId);
      expect(message?.linkPreview?.status).toBe('completed');
      expect(message?.linkPreview?.previews?.[0]?.url).toBe('https://example.com');
    });

    it('handles link preview extraction failure gracefully', async () => {
      const messageId = 'msg-link-preview-fail';
      const userId = 'user-link-preview-fail';

      // Pre-populate a message
      messageRepository.setMessage({
        id: messageId,
        userId,
        waMessageId: 'wamid.linkpreviewfail',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        text: 'Check out https://failing-site.com',
        mediaType: 'text',
        timestamp: Date.now().toString(),
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-lp-fail',
      });

      // Make the message repository throw during link preview update to simulate a failure
      messageRepository.setThrowOnGetMessage(true);

      const body = createPubSubBody({
        type: 'whatsapp.linkpreview.extract',
        messageId,
        userId,
        text: 'Check out https://failing-site.com',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      // Reset the flag
      messageRepository.setThrowOnGetMessage(false);

      // Should still return success (Pub/Sub ack pattern)
      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('acknowledges an exception before link preview extraction can start', async () => {
      vi.spyOn(messageRepository, 'updateLinkPreview').mockRejectedValueOnce(
        new Error('synthetic link preview initialization exception')
      );
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/process-webhook',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBody({
          type: 'whatsapp.linkpreview.extract',
          messageId: 'msg-link-preview-initialization-throw',
          userId: 'user-link-preview-initialization-throw',
          text: 'Check https://example.com',
          timestamp: new Date().toISOString(),
        }),
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /internal/whatsapp/pubsub/transcription-completed', () => {
    const setStoredAudioMessage = (
      overrides: Partial<Parameters<FakeWhatsAppMessageRepository['setMessage']>[0]> = {}
    ): void => {
      messageRepository.setMessage({
        id: 'stored-audio-1',
        userId: 'user-audio',
        waMessageId: 'wamid.voice.1',
        fromNumber: '15551234567',
        toNumber: '15557654321',
        text: '',
        mediaType: 'audio',
        media: {
          id: 'media-audio-1',
          mimeType: 'audio/ogg',
          fileSize: 1234,
        },
        gcsPath: 'whatsapp/user-audio/wamid.voice.1/media-audio-1.ogg',
        metadata: {
          senderName: 'Test User',
          phoneNumberId: '123456789012345',
        },
        timestamp: '1782669600',
        receivedAt: '2026-06-28T09:59:00.000Z',
        webhookEventId: 'event-audio-1',
        ...overrides,
      });
    };

    const setStoredVideoMessage = (
      overrides: Partial<Parameters<FakeWhatsAppMessageRepository['setMessage']>[0]> = {}
    ): void => {
      messageRepository.setMessage({
        id: 'stored-video-1',
        userId: 'user-video',
        waMessageId: 'wamid.video.1',
        fromNumber: '15551234567',
        toNumber: '15557654321',
        text: 'Original video caption',
        mediaType: 'video',
        media: {
          id: 'media-video-1',
          mimeType: 'video/mp4',
          fileSize: 4321,
        },
        gcsPath: 'whatsapp/user-video/wamid.video.1/media-video-1.mp4',
        metadata: {
          senderName: 'Test User',
          phoneNumberId: '123456789012345',
        },
        timestamp: '1782669600',
        receivedAt: '2026-06-28T09:59:00.000Z',
        webhookEventId: 'event-video-1',
        ...overrides,
      });
    };

    const storePrivateAudioMessage = async (
      overrides: {
        matrixEventId?: string;
        userId?: string;
        sourceAccountId?: string;
      } = {}
    ): Promise<string> => {
      const matrixEventId = overrides.matrixEventId ?? '$private-audio';
      const userId = overrides.userId ?? 'user-private';
      const stored = await privateWhatsAppRepository.storeIncomingMessage({
        sourceAccountId: overrides.sourceAccountId ?? 'private-source-123',
        userId,
        deliveryMode: 'live',
        receivedAt: '2026-06-28T09:59:30.000Z',
        chat: {
          matrixRoomId: '!private-room:matrix.example',
          type: 'direct',
          displayName: 'Alice',
        },
        message: {
          matrixRoomId: '!private-room:matrix.example',
          matrixEventId,
          matrixSenderId: '@alice:matrix.example',
          senderKey: 'matrix:@alice:matrix.example',
          direction: 'incoming',
          type: 'audio',
          eventTimestamp: '2026-06-28T09:59:00.000Z',
          eventDayKey: '2026-06-28',
          eventTimeZone: 'Europe/Warsaw',
          media: {
            mxcUri: `mxc://home-dev/${matrixEventId.replace('$', '')}`,
            mimeType: 'audio/ogg',
            storageStatus: 'stored',
            gcsPath: `whatsapp/private/${userId}/${matrixEventId.replace('$', '')}/audio.ogg`,
          },
          rawMatrixEvent: {
            type: 'm.room.message',
            event_id: matrixEventId,
          },
        },
      });
      expect(stored.ok).toBe(true);
      if (!stored.ok) throw new Error(stored.error.message);
      return stored.value.messageId;
    };

    it('returns 401 when auth is missing', async () => {
      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk and call Joanna.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        payload: body,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when transcription event JSON cannot be decoded', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: createPubSubBodyFromRawJson('{'),
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe('INVALID_REQUEST');
    });

    it('accepts Pub/Sub push auth and skips the reply when phone metadata is missing', async () => {
      setStoredAudioMessage({
        id: 'stored-audio-push',
        metadata: {
          senderName: 'Test User',
        },
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-push',
        jobId: 'job-push',
        status: 'completed',
        transcript: 'Walk the dog.',
        timestamp: '2026-06-28T10:02:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: {
          'content-type': 'application/json',
          from: 'noreply@google.com',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(messageRepository.getMessageSync('stored-audio-push')?.transcription).toEqual({
        status: 'completed',
        jobId: 'job-push',
        text: 'Walk the dog.',
        completedAt: '2026-06-28T10:02:00.000Z',
      });
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(1);
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
      expect(whatsappCloudApi.getMarkedAsReadWithTypingMessages()).toHaveLength(0);
    });

    it('returns 400 when the transcription event type is unexpected', async () => {
      const body = createPubSubBody({
        type: 'unknown.event.type',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Unexpected event type');
    });

    it('returns 400 when the transcription message source is unexpected', async () => {
      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'email',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Unexpected transcription message source');
    });

    it('returns 500 when the stored audio lookup fails', async () => {
      messageRepository.setFailFindById(true);

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to load audio message');
    });

    it('acks when the stored audio message is no longer present', async () => {
      const warnSpy = vi.spyOn(app.log, 'warn');
      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'missing-audio-message',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
      const matchingWarnCalls = warnSpy.mock.calls.filter(
        ([, message]) => message === 'Audio message not found for transcription completion'
      );
      expect(matchingWarnCalls).toEqual([
        [
          expect.objectContaining({
            userId: 'user-audio',
            messageId: 'missing-audio-message',
            [SKIP_SENTRY_KEY]: true,
          }),
          'Audio message not found for transcription completion',
        ],
      ]);
    });

    it('returns 400 when a completed transcription has no transcript text', async () => {
      setStoredAudioMessage();

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: '   ',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      expect(messageRepository.getMessageSync('stored-audio-1')?.transcription).toBeUndefined();
    });

    it('returns 500 when updating the transcription fails', async () => {
      setStoredAudioMessage();
      messageRepository.setFailUpdateTranscription(true);

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to update transcription');
    });

    it('returns 500 when publishing the transcript to Intex fails', async () => {
      setStoredAudioMessage();
      eventPublisher.setIntexMessageIngestFailure('Pub/Sub unavailable');

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to publish transcript to Intex');
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
    });

    it('acks the transcription when sending the reply fails after Intex ingest', async () => {
      setStoredAudioMessage();
      whatsappCloudApi.setFailSendMessage(true);

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(1);
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
      expect(whatsappCloudApi.getMarkedAsReadWithTypingMessages()).toEqual([
        { phoneNumberId: '123456789012345', messageId: 'wamid.voice.1' },
      ]);
    });

    it('continues after the typing indicator fails for an accepted transcript', async () => {
      setStoredAudioMessage();
      whatsappCloudApi.setFailMarkAsRead(true);

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(1);
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(1);
      expect(whatsappCloudApi.getMarkedAsReadWithTypingMessages()).toHaveLength(0);
    });

    it('acks the transcription when saving reply correlation fails after sending the reply', async () => {
      setStoredAudioMessage();
      outboundMessageRepository.setFail(true);

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk.',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(1);
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(1);
      expect(outboundMessageRepository.getMessages()).toHaveLength(0);
    });

    it('stores a completed transcription, replies with it, and sends it to Intex', async () => {
      setStoredAudioMessage();

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-1',
        jobId: 'job-123',
        status: 'completed',
        transcript: 'Buy milk and call Joanna.',
        summary: 'Errands and a call.',
        detectedLanguage: 'en',
        timestamp: '2026-06-28T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(messageRepository.getMessageSync('stored-audio-1')?.transcription).toEqual({
        status: 'completed',
        jobId: 'job-123',
        text: 'Buy milk and call Joanna.',
        summary: 'Errands and a call.',
        completedAt: '2026-06-28T10:00:00.000Z',
      });
      expect(whatsappCloudApi.getSentMessages()).toEqual([
        {
          phoneNumberId: '123456789012345',
          recipientPhone: '15551234567',
          message: 'Transcription:\nBuy milk and call Joanna.',
          replyToMessageId: 'wamid.voice.1',
          messageId: expect.any(String),
        },
      ]);
      expect(whatsappCloudApi.getMarkedAsReadWithTypingMessages()).toEqual([
        { phoneNumberId: '123456789012345', messageId: 'wamid.voice.1' },
      ]);
      expect(eventPublisher.getIntexMessageIngestEvents()).toEqual([
        {
          type: 'intex.message.ingest',
          userId: 'user-audio',
          messageId: 'wamid.voice.1',
          sourceType: 'whatsapp_audio_transcript',
          text: 'Buy milk and call Joanna.',
          whatsappSender: '15551234567',
          timestamp: '2026-06-28T10:00:00.000Z',
        },
      ]);
      const transcriptionReplyWamid = whatsappCloudApi.getSentMessages()[0]?.messageId;
      expect(outboundMessageRepository.getMessages()).toEqual([
        {
          wamid: transcriptionReplyWamid,
          correlationId: 'transcription:stored-audio-1:job-123',
          userId: 'user-audio',
          messageText: 'Transcription:\nBuy milk and call Joanna.',
          sentAt: expect.any(String),
          expiresAt: expect.any(Number),
        },
      ]);
    });

    it('stores a completed video transcription and sends it to Intex as video transcript', async () => {
      setStoredVideoMessage();

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'public_whatsapp',
        mediaKind: 'video',
        userId: 'user-video',
        messageId: 'stored-video-1',
        jobId: 'job-video-123',
        status: 'completed',
        transcript: 'Video transcript text.',
        timestamp: '2026-06-28T10:05:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(messageRepository.getMessageSync('stored-video-1')?.transcription).toEqual({
        status: 'completed',
        jobId: 'job-video-123',
        text: 'Video transcript text.',
        completedAt: '2026-06-28T10:05:00.000Z',
      });
      expect(eventPublisher.getIntexMessageIngestEvents()).toEqual([
        {
          type: 'intex.message.ingest',
          userId: 'user-video',
          messageId: 'wamid.video.1',
          sourceType: 'whatsapp_video_transcript',
          text: 'Video transcript text.',
          whatsappSender: '15551234567',
          timestamp: '2026-06-28T10:05:00.000Z',
        },
      ]);
      expect(whatsappCloudApi.getMarkedAsReadWithTypingMessages()).toEqual([
        { phoneNumberId: '123456789012345', messageId: 'wamid.video.1' },
      ]);
    });

    it('falls back to stored video media type when completed event omits mediaKind', async () => {
      setStoredVideoMessage();

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'public_whatsapp',
        userId: 'user-video',
        messageId: 'stored-video-1',
        jobId: 'job-video-123',
        status: 'completed',
        transcript: 'Video transcript without media kind.',
        timestamp: '2026-06-28T10:05:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(eventPublisher.getIntexMessageIngestEvents()).toEqual([
        {
          type: 'intex.message.ingest',
          userId: 'user-video',
          messageId: 'wamid.video.1',
          sourceType: 'whatsapp_video_transcript',
          text: 'Video transcript without media kind.',
          whatsappSender: '15551234567',
          timestamp: '2026-06-28T10:05:00.000Z',
        },
      ]);
    });

    it('stores a completed private WhatsApp transcription without Intex ingest or WhatsApp replies', async () => {
      const stored = await privateWhatsAppRepository.storeIncomingMessage({
        sourceAccountId: 'private-source-123',
        userId: 'user-private',
        deliveryMode: 'live',
        receivedAt: '2026-06-28T09:59:30.000Z',
        chat: {
          matrixRoomId: '!private-room:matrix.example',
          type: 'direct',
          displayName: 'Alice',
        },
        message: {
          matrixRoomId: '!private-room:matrix.example',
          matrixEventId: '$private-audio',
          matrixSenderId: '@alice:matrix.example',
          senderKey: 'matrix:@alice:matrix.example',
          direction: 'incoming',
          type: 'audio',
          eventTimestamp: '2026-06-28T09:59:00.000Z',
          eventDayKey: '2026-06-28',
          eventTimeZone: 'Europe/Warsaw',
          media: {
            mxcUri: 'mxc://home-dev/private-audio',
            mimeType: 'audio/ogg',
            storageStatus: 'stored',
            gcsPath: 'whatsapp/private/user-private/private-audio/audio.ogg',
          },
          rawMatrixEvent: {
            type: 'm.room.message',
            event_id: '$private-audio',
          },
        },
      });
      expect(stored.ok).toBe(true);
      if (!stored.ok) throw new Error(stored.error.message);

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId: stored.value.messageId,
        jobId: 'job-private-123',
        status: 'completed',
        transcript: 'Private voice note.',
        summary: 'Voice note summary.',
        detectedLanguage: 'en',
        timestamp: '2026-06-28T10:04:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const privateMessage = await privateWhatsAppRepository.getMessageById(stored.value.messageId);
      expect(privateMessage.ok).toBe(true);
      if (!privateMessage.ok) throw new Error(privateMessage.error.message);
      expect(privateMessage.value?.transcription).toEqual({
        status: 'completed',
        jobId: 'job-private-123',
        text: 'Private voice note.',
        summary: 'Voice note summary.',
        detectedLanguage: 'en',
        completedAt: '2026-06-28T10:04:00.000Z',
      });
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
    });

    it('stores a completed private WhatsApp transcription without optional metadata', async () => {
      const messageId = await storePrivateAudioMessage({
        matrixEventId: '$private-audio-minimal',
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId,
        jobId: 'job-private-minimal',
        status: 'completed',
        transcript: 'Private voice note without metadata.',
        timestamp: '2026-06-28T10:04:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const privateMessage = await privateWhatsAppRepository.getMessageById(messageId);
      expect(privateMessage.ok).toBe(true);
      if (!privateMessage.ok) throw new Error(privateMessage.error.message);
      expect(privateMessage.value?.transcription).toEqual({
        status: 'completed',
        jobId: 'job-private-minimal',
        text: 'Private voice note without metadata.',
        completedAt: '2026-06-28T10:04:00.000Z',
      });
    });

    it('returns 400 when a completed private WhatsApp transcription has no transcript text', async () => {
      const messageId = await storePrivateAudioMessage({
        matrixEventId: '$private-audio-blank-transcript',
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId,
        jobId: 'job-private-blank-transcript',
        status: 'completed',
        transcript: '   ',
        timestamp: '2026-06-28T10:04:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      const privateMessage = await privateWhatsAppRepository.getMessageById(messageId);
      expect(privateMessage.ok).toBe(true);
      if (!privateMessage.ok) throw new Error(privateMessage.error.message);
      expect(privateMessage.value?.transcription).toBeUndefined();
    });

    it('returns 500 when private WhatsApp transcription lookup fails', async () => {
      privateWhatsAppRepository.failNextMessageLookup({
        code: 'PERSISTENCE_ERROR',
        message: 'Simulated private lookup failure',
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId: 'missing-private-message',
        jobId: 'job-private-lookup-failure',
        status: 'completed',
        transcript: 'Private voice note.',
        timestamp: '2026-06-28T10:04:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to load private audio message');
    });

    it('acks private WhatsApp transcription completions when the message is missing', async () => {
      const warnSpy = vi.spyOn(app.log, 'warn');
      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId: 'missing-private-message',
        jobId: 'job-private-missing',
        status: 'completed',
        transcript: 'Private voice note.',
        timestamp: '2026-06-28T10:04:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
      const matchingWarnCalls = warnSpy.mock.calls.filter(
        ([, message]) =>
          message === 'Private WhatsApp audio message not found for transcription completion'
      );
      expect(matchingWarnCalls).toEqual([
        [
          expect.objectContaining({
            userId: 'user-private',
            messageId: 'missing-private-message',
            [SKIP_SENTRY_KEY]: true,
          }),
          'Private WhatsApp audio message not found for transcription completion',
        ],
      ]);
    });

    it('acks private WhatsApp transcription completions for wrong-user messages without Sentry suppression', async () => {
      const warnSpy = vi.spyOn(app.log, 'warn');
      const messageId = await storePrivateAudioMessage({
        matrixEventId: '$private-audio-wrong-user',
        userId: 'other-user',
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId,
        jobId: 'job-private-wrong-user',
        status: 'completed',
        transcript: 'Private voice note.',
        timestamp: '2026-06-28T10:04:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const matchingWarnCalls = warnSpy.mock.calls.filter(
        ([, message]) =>
          message === 'Private WhatsApp audio message user mismatch for transcription completion'
      );
      expect(matchingWarnCalls).toEqual([
        [
          expect.objectContaining({
            userId: 'user-private',
            messageId,
            storedUserId: 'other-user',
          }),
          'Private WhatsApp audio message user mismatch for transcription completion',
        ],
      ]);
      expect(matchingWarnCalls[0]?.[0]).not.toEqual(
        expect.objectContaining({ [SKIP_SENTRY_KEY]: true })
      );
    });

    it('stores a failed private WhatsApp transcription without Intex ingest or WhatsApp replies', async () => {
      const stored = await privateWhatsAppRepository.storeIncomingMessage({
        sourceAccountId: 'private-source-123',
        userId: 'user-private',
        deliveryMode: 'live',
        receivedAt: '2026-06-28T09:59:30.000Z',
        chat: {
          matrixRoomId: '!private-room:matrix.example',
          type: 'direct',
        },
        message: {
          matrixRoomId: '!private-room:matrix.example',
          matrixEventId: '$private-audio-failed',
          matrixSenderId: '@alice:matrix.example',
          senderKey: 'matrix:@alice:matrix.example',
          direction: 'incoming',
          type: 'audio',
          eventTimestamp: '2026-06-28T09:59:00.000Z',
          eventDayKey: '2026-06-28',
          eventTimeZone: 'Europe/Warsaw',
          media: {
            mxcUri: 'mxc://home-dev/private-audio-failed',
            mimeType: 'audio/ogg',
            storageStatus: 'stored',
            gcsPath: 'whatsapp/private/user-private/private-audio-failed/audio.ogg',
          },
          rawMatrixEvent: {
            type: 'm.room.message',
            event_id: '$private-audio-failed',
          },
        },
      });
      expect(stored.ok).toBe(true);
      if (!stored.ok) throw new Error(stored.error.message);

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId: stored.value.messageId,
        jobId: 'job-private-456',
        status: 'failed',
        error: 'Audio format was not supported',
        timestamp: '2026-06-28T10:05:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const privateMessage = await privateWhatsAppRepository.getMessageById(stored.value.messageId);
      expect(privateMessage.ok).toBe(true);
      if (!privateMessage.ok) throw new Error(privateMessage.error.message);
      expect(privateMessage.value?.transcription).toEqual({
        status: 'failed',
        jobId: 'job-private-456',
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Audio format was not supported',
        },
        completedAt: '2026-06-28T10:05:00.000Z',
      });
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
      expect(whatsappCloudApi.getSentMessages()).toHaveLength(0);
    });

    it('uses a default private WhatsApp transcription error when a failed event has no error text', async () => {
      const messageId = await storePrivateAudioMessage({
        matrixEventId: '$private-audio-default-error',
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId,
        jobId: 'job-private-default-error',
        status: 'failed',
        timestamp: '2026-06-28T10:05:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const privateMessage = await privateWhatsAppRepository.getMessageById(messageId);
      expect(privateMessage.ok).toBe(true);
      if (!privateMessage.ok) throw new Error(privateMessage.error.message);
      expect(privateMessage.value?.transcription).toEqual({
        status: 'failed',
        jobId: 'job-private-default-error',
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Transcription failed',
        },
        completedAt: '2026-06-28T10:05:00.000Z',
      });
    });

    it('returns 500 when storing a private WhatsApp transcription fails', async () => {
      const messageId = await storePrivateAudioMessage({
        matrixEventId: '$private-audio-update-failure',
      });
      privateWhatsAppRepository.failNext({
        code: 'PERSISTENCE_ERROR',
        message: 'Simulated private transcription update failure',
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageSource: 'private_whatsapp',
        userId: 'user-private',
        messageId,
        jobId: 'job-private-update-failure',
        status: 'completed',
        transcript: 'Private voice note.',
        timestamp: '2026-06-28T10:04:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(responseBody.error.message).toBe('Failed to update private transcription');
    });

    it('stores a failed transcription and replies with the failure without sending to Intex', async () => {
      setStoredAudioMessage({
        id: 'stored-audio-2',
        waMessageId: 'wamid.voice.2',
        media: {
          id: 'media-audio-2',
          mimeType: 'audio/ogg',
          fileSize: 1234,
        },
        gcsPath: 'whatsapp/user-audio/wamid.voice.2/media-audio-2.ogg',
        webhookEventId: 'event-audio-2',
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-2',
        jobId: 'job-456',
        status: 'failed',
        error: 'Audio format was not supported',
        timestamp: '2026-06-28T10:01:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(messageRepository.getMessageSync('stored-audio-2')?.transcription).toEqual({
        status: 'failed',
        jobId: 'job-456',
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Audio format was not supported',
        },
        completedAt: '2026-06-28T10:01:00.000Z',
      });
      expect(whatsappCloudApi.getSentMessages()).toEqual([
        {
          phoneNumberId: '123456789012345',
          recipientPhone: '15551234567',
          message: 'I could not transcribe this voice message. Please try again or send text.',
          replyToMessageId: 'wamid.voice.2',
          messageId: expect.any(String),
        },
      ]);
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
    });

    it('uses a default transcription error when a failed event has no error text', async () => {
      setStoredAudioMessage({
        id: 'stored-audio-3',
        waMessageId: 'wamid.voice.3',
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        userId: 'user-audio',
        messageId: 'stored-audio-3',
        jobId: 'job-789',
        status: 'failed',
        timestamp: '2026-06-28T10:03:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(messageRepository.getMessageSync('stored-audio-3')?.transcription).toMatchObject({
        status: 'failed',
        jobId: 'job-789',
        error: {
          code: 'TRANSCRIPTION_FAILED',
          message: 'Transcription failed',
        },
      });
      expect(eventPublisher.getIntexMessageIngestEvents()).toHaveLength(0);
    });
  });

  describe('maskPhoneNumber edge cases', () => {
    it('logs masked phone number for short numbers (7 chars or less)', async () => {
      // Create a mapping with a very short phone number
      await userMappingRepository.saveMapping('user-short-phone', ['1234567']);

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-short-phone',
        message: 'Hello short number',
        correlationId: 'corr-short',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/send-message',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      // The message should have been sent to the short phone number
      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.phoneNumber).toBe('1234567');
    });
  });
});
