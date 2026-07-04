/**
 * Tests for Pub/Sub push subscription routes.
 * POST /internal/whatsapp/pubsub/send-message
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeEventPublisher,
  FakePrivateWhatsAppRepository,
  FakeLinkPreviewFetcherPort,
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
  conversationAssistantModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  port: 8080,
  host: '0.0.0.0',
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
        const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
        ctaUrl: { displayText: 'View progress', url: 'https://intexuraos.cloud/#/code-tasks/task-123' },
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
      messageSender.setFail(true, { code: 'INTERNAL_ERROR', message: 'WhatsApp API error for buttons' });

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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(responseBody.error.message).toBe('WhatsApp API error for buttons');
    });

    it('sends CTA URL message when ctaUrl is provided', async () => {
      await userMappingRepository.saveMapping('user-cta', ['+48111222333']);

      const ctaUrl = { displayText: 'View pull request', url: 'https://github.com/owner/repo/pull/42' };

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
      messageSender.setFail(true, { code: 'INTERNAL_ERROR', message: 'WhatsApp API error for CTA URL' });

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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
        const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; data: { deletedCount: number } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; data: { deletedCount: number } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; data: { deletedCount: number } };
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
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
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
