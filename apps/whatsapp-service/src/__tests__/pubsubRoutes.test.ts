/**
 * Tests for Pub/Sub push subscription routes.
 * POST /internal/whatsapp/pubsub/send-message
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeEventPublisher,
  FakeLinkPreviewFetcherPort,
  FakeMediaStorage,
  FakeMessageSender,
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
  gcpProjectId: 'test-project',
  webAgentUrl: 'https://web-agent.example.com',
  internalAuthToken: INTERNAL_AUTH_TOKEN,
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

  beforeEach(async () => {
    messageSender = new FakeMessageSender();
    mediaStorage = new FakeMediaStorage();
    messageRepository = new FakeWhatsAppMessageRepository();
    userMappingRepository = new FakeWhatsAppUserMappingRepository();

    outboundMessageRepository = new FakeOutboundMessageRepository();

    setServices({
      webhookEventRepository: new FakeWhatsAppWebhookEventRepository(),
      userMappingRepository,
      messageRepository,
      mediaStorage,
      eventPublisher: new FakeEventPublisher(),
      messageSender,
      whatsappCloudApi: new FakeWhatsAppCloudApiPort(),
      thumbnailGenerator: new FakeThumbnailGeneratorPort(),
      linkPreviewFetcher: new FakeLinkPreviewFetcherPort(),
      outboundMessageRepository,
      phoneVerificationRepository: new FakePhoneVerificationRepository(),
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
        ctaUrl: { displayText: 'View Progress', url: 'https://intexuraos.cloud/#/code-tasks/task-123' },
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
        displayText: 'View Progress',
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

      const ctaUrl = { displayText: 'View Pull Request', url: 'https://github.com/owner/repo/pull/42' };

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
      // Empty buttons array falls through to plain text (buttons.length > 0 is false)
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

  describe('POST /internal/whatsapp/pubsub/transcription-completed', () => {
    it('returns 401 when auth is missing', async () => {
      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageId: 'msg-123',
        userId: 'user-456',
        jobId: 'job-abc',
        status: 'completed',
        transcript: 'Hello world',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        payload: body,
      });

      expect(response.statusCode).toBe(401);
      const responseBody = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(responseBody.error.message).toContain('auth failed');
    });

    it('returns 200 for completed event and updates message + sends WhatsApp message', async () => {
      messageRepository.setMessage({
        id: 'msg-completed',
        userId: 'user-456',
        waMessageId: 'wamid.completed',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        text: '',
        mediaType: 'audio',
        timestamp: Date.now().toString(),
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-completed',
        metadata: { phoneNumberId: 'phone-789' },
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageId: 'msg-completed',
        userId: 'user-456',
        jobId: 'job-success',
        status: 'completed',
        transcript: 'This is a test transcript',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      const message = messageRepository.getMessageSync('msg-completed');
      expect(message?.transcription?.status).toBe('completed');
      expect(message?.transcription?.text).toBe('This is a test transcript');
    });

    it('returns 200 for failed event and updates message', async () => {
      messageRepository.setMessage({
        id: 'msg-failed',
        userId: 'user-456',
        waMessageId: 'wamid.failed',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        text: '',
        mediaType: 'audio',
        timestamp: Date.now().toString(),
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-failed',
        metadata: { phoneNumberId: 'phone-789' },
      });

      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageId: 'msg-failed',
        userId: 'user-456',
        jobId: 'job-fail',
        status: 'failed',
        error: 'Audio quality too low',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      const message = messageRepository.getMessageSync('msg-failed');
      expect(message?.transcription?.status).toBe('failed');
    });

    it('returns 200 when message not found (graceful handling)', async () => {
      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageId: 'non-existent-msg',
        userId: 'user-456',
        jobId: 'job-orphan',
        status: 'completed',
        transcript: 'Orphan transcript',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('accepts Pub/Sub push with from: noreply@google.com header', async () => {
      const body = createPubSubBody({
        type: 'srt.transcription.completed',
        messageId: 'msg-oidc',
        userId: 'user-456',
        jobId: 'job-oidc',
        status: 'completed',
        transcript: 'OIDC transcript',
        timestamp: new Date().toISOString(),
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
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('returns 200 and logs error when message data is not valid base64', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
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

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('returns 200 and logs error when message data is not valid JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
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

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);
    });

    it('returns 200 when event type is unexpected', async () => {
      const body = createPubSubBody({
        type: 'wrong.event.type',
        messageId: 'msg-123',
        userId: 'user-456',
        jobId: 'job-abc',
        status: 'completed',
        timestamp: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/whatsapp/pubsub/transcription-completed',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const responseBody2 = JSON.parse(response.body) as { success: boolean };
      expect(responseBody2.success).toBe(true);
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
