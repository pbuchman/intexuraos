/**
 * Tests for Pub/Sub push subscription routes.
 * POST /internal/whatsapp/pubsub/send-message
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeEventPublisher,
  FakeLinkPreviewFetcherPort,
  FakeMediaStorage,
  FakeMessageSender,
  FakeSpeechTranscriptionPort,
  FakeThumbnailGeneratorPort,
  FakeWhatsAppCloudApiPort,
  FakeWhatsAppMessageRepository,
  FakeWhatsAppUserMappingRepository,
  FakeWhatsAppWebhookEventRepository,
} from './fakes.js';
import type { Config } from '../config.js';

const testConfig: Config = {
  verifyToken: 'test-verify-token',
  appSecret: 'test-app-secret',
  accessToken: 'test-access-token',
  allowedWabaIds: ['102290129340398'],
  allowedPhoneNumberIds: ['123456789012345'],
  mediaBucket: 'test-media-bucket',
  mediaCleanupTopic: 'test-media-cleanup',
  mediaCleanupSubscription: 'test-media-cleanup-sub',
  speechmaticsApiKey: 'test-speechmatics-api-key',
  gcpProjectId: 'test-project',
  port: 8080,
  host: '0.0.0.0',
};

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token-12345';

function encodeEvent(event: unknown): string {
  return Buffer.from(JSON.stringify(event)).toString('base64');
}

function createPubSubBody(eventData: unknown): unknown {
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

  beforeEach(async () => {
    messageSender = new FakeMessageSender();
    mediaStorage = new FakeMediaStorage();

    setServices({
      webhookEventRepository: new FakeWhatsAppWebhookEventRepository(),
      userMappingRepository: new FakeWhatsAppUserMappingRepository(),
      messageRepository: new FakeWhatsAppMessageRepository(),
      mediaStorage,
      eventPublisher: new FakeEventPublisher(),
      messageSender,
      transcriptionService: new FakeSpeechTranscriptionPort(),
      whatsappCloudApi: new FakeWhatsAppCloudApiPort(),
      thumbnailGenerator: new FakeThumbnailGeneratorPort(),
      linkPreviewFetcher: new FakeLinkPreviewFetcherPort(),
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
        phoneNumber: '+48123456789',
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Internal-Auth header is invalid', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-123',
        phoneNumber: '+48123456789',
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Unauthorized');
    });

    describe('Pub/Sub OIDC authentication', () => {
      it('accepts Pub/Sub push with from: noreply@google.com header (no x-internal-auth)', async () => {
        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-123',
          phoneNumber: '+48123456789',
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
            // NOTE: NO x-internal-auth header - should still work via OIDC
          },
          payload: body,
        });

        expect(response.statusCode).toBe(200);
        const responseBody = JSON.parse(response.body) as { success: boolean };
        expect(responseBody.success).toBe(true);

        // Verify message was sent
        expect(messageSender.getSentMessages()).toHaveLength(1);
        expect(messageSender.getSentMessages()[0]?.phoneNumber).toBe('+48123456789');
      });

      it('rejects direct calls without x-internal-auth or Pub/Sub from header', async () => {
        const body = createPubSubBody({
          type: 'whatsapp.message.send',
          userId: 'user-123',
          phoneNumber: '+48123456789',
          message: 'Hello',
          correlationId: 'corr-123',
          timestamp: new Date().toISOString(),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/internal/whatsapp/pubsub/send-message',
          headers: {
            'content-type': 'application/json',
            // NO from: noreply@google.com
            // NO x-internal-auth
          },
          payload: body,
        });

        expect(response.statusCode).toBe(401);
        const responseBody = JSON.parse(response.body) as { error: string };
        expect(responseBody.error).toBe('Unauthorized');
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Invalid message format');
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Invalid message format');
    });

    it('returns 400 when event type is not whatsapp.message.send', async () => {
      const body = createPubSubBody({
        type: 'unknown.event.type',
        userId: 'user-123',
        phoneNumber: '+48123456789',
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Invalid event type');
    });

    it('sends message and returns 200 on success', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-123',
        phoneNumber: '+48123456789',
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

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body) as { success: boolean };
      expect(responseBody.success).toBe(true);

      const sentMessages = messageSender.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toEqual({
        phoneNumber: '+48123456789',
        message: 'Hello from test',
      });
    });

    it('returns 500 when message sending fails', async () => {
      messageSender.setFail(true, { code: 'INTERNAL_ERROR', message: 'WhatsApp API error' });

      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-123',
        phoneNumber: '+48123456789',
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('WhatsApp API error');
    });

    it('handles message without optional fields', async () => {
      const body = createPubSubBody({
        type: 'whatsapp.message.send',
        userId: 'user-456',
        phoneNumber: '+15551234567',
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
      expect(sentMessages[0]?.phoneNumber).toBe('+15551234567');
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Unauthorized');
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Unauthorized');
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
          deletedCount: number;
        };
        expect(responseBody.success).toBe(true);
        expect(responseBody.deletedCount).toBe(2);
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
        const responseBody = JSON.parse(response.body) as { error: string };
        expect(responseBody.error).toBe('Unauthorized');
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Invalid message format');
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Invalid message format');
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
      const responseBody = JSON.parse(response.body) as { error: string };
      expect(responseBody.error).toBe('Invalid event type');
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
      const responseBody = JSON.parse(response.body) as { success: boolean; deletedCount: number };
      expect(responseBody.success).toBe(true);
      expect(responseBody.deletedCount).toBe(2);

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
      const responseBody = JSON.parse(response.body) as { success: boolean; deletedCount: number };
      expect(responseBody.success).toBe(true);
      expect(responseBody.deletedCount).toBe(0);
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
      const responseBody = JSON.parse(response.body) as { success: boolean; deletedCount: number };
      expect(responseBody.success).toBe(true);
      expect(responseBody.deletedCount).toBe(0);
    });
  });
});
