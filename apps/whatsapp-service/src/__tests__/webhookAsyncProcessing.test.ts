/**
 * Tests for webhook async processing:
 * - processWebhookAsync
 * - sendConfirmationMessage
 *
 * These tests wait for the async processing to complete and verify the state changes.
 */
import {
  describe,
  it,
  expect,
  setupTestContext,
  testConfig,
  createSignature,
  createWebhookPayload,
  createImageWebhookPayload,
  createAudioWebhookPayload,
} from './testUtils.js';

// Sample JPEG image buffer (1x1 pixel)
const SAMPLE_IMAGE_BUFFER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
  0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
  0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
  0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
  0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
  0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
  0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd5, 0xfb, 0xd5, 0xff, 0xd9,
]);

describe('Webhook async processing', () => {
  const ctx = setupTestContext();

  /**
   * Helper to wait for async processing to complete.
   * The processWebhookAsync function is fire-and-forget, so we need to wait.
   */
  async function waitForAsyncProcessing(ms = 100): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  describe('processWebhookAsync', () => {
    it('processes webhook and updates event status to USER_UNMAPPED when no user mapping exists', async () => {
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

      // Wait for async processing
      await waitForAsyncProcessing();

      // Event should be persisted with USER_UNMAPPED status (no mapping for sender)
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('USER_UNMAPPED');
    });

    it('processes webhook and stores message when user mapping exists', async () => {
      // Setup user mapping
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      // Create mapping with the sender's phone number
      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

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

      // Wait for async processing
      await waitForAsyncProcessing();

      // Event should be processed
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('PROCESSED');

      // Message should be stored
      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(1);
      expect(messages[0]?.text).toBe('Hello, World!');
      expect(messages[0]?.userId).toBe(userId);
    });

    it('handles webhook with no sender phone number', async () => {
      // Payload without messages (status update only)
      const statusPayload = {
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

      // Wait for async processing
      await waitForAsyncProcessing();

      // Event should be persisted with IGNORED status (no sender)
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('IGNORED');
    });

    it('processes webhook when user mapping is disconnected', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      // Create mapping and then disconnect it
      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);
      await ctx.userMappingRepository.disconnectMapping(userId);

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

      await waitForAsyncProcessing();

      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      // User is found but mapping is disconnected, so USER_UNMAPPED
      expect(events[0]?.status).toBe('USER_UNMAPPED');
    });
  });

  describe('sendConfirmationMessage', () => {
    it('sends confirmation message when webhook is successfully processed', async () => {
      // Setup user mapping
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

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

      // Wait for async processing including confirmation message
      await waitForAsyncProcessing(200);

      // Verify event was processed
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('PROCESSED');

      // Verify confirmation message was sent via whatsappCloudApi
      const sentMessages = ctx.whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
    });

    it('handles sendWhatsAppMessage failure gracefully', async () => {
      // Configure the fake to fail sendMessage
      ctx.whatsappCloudApi.setFailSendMessage(true);

      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

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

      // Should still return 200 even if confirmation message fails
      expect(response.statusCode).toBe(200);

      await waitForAsyncProcessing(200);

      // Event should still be processed
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('PROCESSED');
    });
  });

  describe('repository error handling', () => {
    it('returns 200 when saveEvent fails', async () => {
      // Configure the fake repository to fail
      ctx.webhookEventRepository.setFailNextSave(true);

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

      // Should still return 200 even when save fails
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { received: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.received).toBe(true);

      // No events should be persisted since save failed
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(0);
    });
  });

  describe('image message processing', () => {
    it('processes image message and stores with GCS paths', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Set up the fake whatsappCloudApi with media URLs
      ctx.whatsappCloudApi.setMediaUrl('test-media-id-12345', {
        url: 'https://example.com/media/test-media-id-12345',
        mimeType: 'image/jpeg',
        fileSize: 12345,
      });
      ctx.whatsappCloudApi.setMediaContent(
        'https://example.com/media/test-media-id-12345',
        SAMPLE_IMAGE_BUFFER
      );

      const payload = createImageWebhookPayload({ caption: 'Test image caption' });
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

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be processed
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('PROCESSED');

      // Message should be stored with media info
      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(1);

      const savedMessage = messages[0];
      expect(savedMessage?.mediaType).toBe('image');
      expect(savedMessage?.media?.id).toBe('test-media-id-12345');
      expect(savedMessage?.media?.mimeType).toBe('image/jpeg');
      expect(savedMessage?.caption).toBe('Test image caption');
      expect(savedMessage?.gcsPath).toContain('whatsapp/');
      expect(savedMessage?.gcsPath).toContain('/test-media-id-12345.jpg');
      expect(savedMessage?.thumbnailGcsPath).toContain('_thumb.jpg');

      // Files should be stored in GCS
      const files = ctx.mediaStorage.getAllFiles();
      expect(files.size).toBe(2); // Original + thumbnail
    });

    it('handles image message without caption', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Set up the fake whatsappCloudApi with media URLs
      ctx.whatsappCloudApi.setMediaUrl('test-media-id-12345', {
        url: 'https://example.com/media/test-media-id-12345',
        mimeType: 'image/jpeg',
        fileSize: 12345,
      });
      ctx.whatsappCloudApi.setMediaContent(
        'https://example.com/media/test-media-id-12345',
        SAMPLE_IMAGE_BUFFER
      );

      const payload = createImageWebhookPayload();
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

      await waitForAsyncProcessing(200);

      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(1);
      expect(messages[0]?.text).toBe('');
      expect(messages[0]?.caption).toBeUndefined();
    });

    it('handles getMediaUrl failure gracefully', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Configure the fake to fail getMediaUrl
      ctx.whatsappCloudApi.setFailGetMediaUrl(true);

      const payload = createImageWebhookPayload();
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

      await waitForAsyncProcessing(200);

      // Event should be marked as FAILED
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('FAILED');

      // No message should be stored
      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(0);
    });

    it('handles downloadMedia failure gracefully', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Set up media URL but configure download to fail
      ctx.whatsappCloudApi.setMediaUrl('test-media-id-12345', {
        url: 'https://example.com/media/test-media-id-12345',
        mimeType: 'image/jpeg',
        fileSize: 12345,
      });
      ctx.whatsappCloudApi.setFailDownload(true);

      const payload = createImageWebhookPayload();
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

      await waitForAsyncProcessing(200);

      // Event should be marked as FAILED
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('FAILED');
    });

    it('sends confirmation message after successful image processing', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Set up the fake whatsappCloudApi with media URLs
      ctx.whatsappCloudApi.setMediaUrl('test-media-id-12345', {
        url: 'https://example.com/media/test-media-id-12345',
        mimeType: 'image/jpeg',
        fileSize: 12345,
      });
      ctx.whatsappCloudApi.setMediaContent(
        'https://example.com/media/test-media-id-12345',
        SAMPLE_IMAGE_BUFFER
      );

      const payload = createImageWebhookPayload();
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

      await waitForAsyncProcessing(200);

      // Verify confirmation message was sent via whatsappCloudApi
      const sentMessages = ctx.whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
    });
  });

  describe('audio message processing', () => {
    it('processes audio message, stores to GCS, and publishes event', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Set up the fake whatsappCloudApi with audio media
      ctx.whatsappCloudApi.setMediaUrl('test-audio-id-12345', {
        url: 'https://example.com/media/test-audio-id-12345',
        mimeType: 'audio/ogg',
        fileSize: 5000,
      });
      ctx.whatsappCloudApi.setMediaContent(
        'https://example.com/media/test-audio-id-12345',
        Buffer.from('fake-audio-content')
      );

      const payload = createAudioWebhookPayload();
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

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be processed
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('PROCESSED');

      // Message should be stored with audio media info
      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(1);

      const savedMessage = messages[0];
      expect(savedMessage?.mediaType).toBe('audio');
      expect(savedMessage?.media?.id).toBe('test-audio-id-12345');
      expect(savedMessage?.media?.mimeType).toBe('audio/ogg');
      expect(savedMessage?.gcsPath).toContain('whatsapp/');
      expect(savedMessage?.gcsPath).toContain('/test-audio-id-12345.ogg');
      expect(savedMessage?.thumbnailGcsPath).toBeUndefined();

      // Audio file should be stored in GCS
      const files = ctx.mediaStorage.getAllFiles();
      expect(files.size).toBe(1);
    });

    it('handles getMediaUrl failure gracefully for audio', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Configure the fake to fail getMediaUrl
      ctx.whatsappCloudApi.setFailGetMediaUrl(true);

      const payload = createAudioWebhookPayload();
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

      await waitForAsyncProcessing(200);

      // Event should be marked as FAILED
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('FAILED');

      // No message should be stored
      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(0);
    });

    it('handles downloadMedia failure gracefully for audio', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Set up media URL but configure download to fail
      ctx.whatsappCloudApi.setMediaUrl('test-audio-id-12345', {
        url: 'https://example.com/media/test-audio-id-12345',
        mimeType: 'audio/ogg',
        fileSize: 5000,
      });
      ctx.whatsappCloudApi.setFailDownload(true);

      const payload = createAudioWebhookPayload();
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

      await waitForAsyncProcessing(200);

      // Event should be marked as FAILED
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('FAILED');
    });

    it('sends confirmation message after successful audio processing', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Set up the fake whatsappCloudApi with audio media
      ctx.whatsappCloudApi.setMediaUrl('test-audio-id-12345', {
        url: 'https://example.com/media/test-audio-id-12345',
        mimeType: 'audio/ogg',
        fileSize: 5000,
      });
      ctx.whatsappCloudApi.setMediaContent(
        'https://example.com/media/test-audio-id-12345',
        Buffer.from('fake-audio-content')
      );

      const payload = createAudioWebhookPayload();
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

      await waitForAsyncProcessing(200);

      // Verify confirmation message was sent via whatsappCloudApi
      const sentMessages = ctx.whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
    });
  });

  describe('text message error handling', () => {
    it('marks event as FAILED when message save fails', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Configure message repository to fail save
      ctx.messageRepository.setFailSave(true);

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

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be marked as FAILED
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('FAILED');
      expect(events[0]?.failureDetails).toContain('Failed to save message');

      // No message should be stored
      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(0);
    });
  });

  describe('unexpected error handling', () => {
    it('handles unexpected exceptions in processWebhookAsync gracefully', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Configure user mapping repository to throw an unexpected exception
      ctx.userMappingRepository.setThrowOnGetMapping(true);

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

      // Should still return 200 (webhook acknowledged) even if async processing throws
      expect(response.statusCode).toBe(200);

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be persisted (save happens before the error)
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      // Status remains PENDING because the error occurs before status update
      // The catch block just logs the error
      expect(events[0]?.status).toBe('PENDING');
    });
  });

  describe('user lookup error handling', () => {
    it('marks event as FAILED when findUserByPhoneNumber fails', async () => {
      // Configure user mapping repository to fail findUserByPhoneNumber
      ctx.userMappingRepository.setFailFindUserByPhoneNumber(true);

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

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be marked as FAILED
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('FAILED');
      expect(events[0]?.failureDetails).toContain('Simulated user lookup failure');
    });
  });

  describe('audio message without media info', () => {
    it('ignores audio message without media info', async () => {
      // Create an audio payload with missing media info by constructing manually
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
                      id: 'wamid.audio.noinfo',
                      timestamp: '1234567890',
                      type: 'audio',
                      // Intentionally missing 'audio' field to simulate no media info
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

      expect(response.statusCode).toBe(200);

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be IGNORED because audio message has no media info
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('IGNORED');
    });
  });

  describe('text message without body', () => {
    it('ignores text message without body', async () => {
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
                      id: 'wamid.text.nobody',
                      timestamp: '1234567890',
                      type: 'text',
                      // Missing 'text' field to simulate no body
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

      expect(response.statusCode).toBe(200);

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be IGNORED because text message has no body
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('IGNORED');
    });
  });

  describe('image message without media info', () => {
    it('ignores image message without media info', async () => {
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
                      id: 'wamid.image.noinfo',
                      timestamp: '1234567890',
                      type: 'image',
                      // Missing 'image' field to simulate no media info
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

      expect(response.statusCode).toBe(200);

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be IGNORED because image message has no media info
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('IGNORED');
    });
  });

  describe('unsupported message type', () => {
    it('ignores unsupported message type', async () => {
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
                      id: 'wamid.sticker.unsupported',
                      timestamp: '1234567890',
                      type: 'sticker',
                      sticker: {
                        id: 'sticker-media-id',
                        mime_type: 'image/webp',
                      },
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

      expect(response.statusCode).toBe(200);

      // Wait for async processing
      await waitForAsyncProcessing(200);

      // Event should be IGNORED because sticker is not a supported message type
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('IGNORED');
    });
  });

  describe('branch coverage edge cases', () => {
    it('handles payload without rawBody property (fallback to JSON.stringify)', async () => {
      // This test covers the rawBody ?? JSON.stringify(request.body) branch
      const payload = createWebhookPayload();
      const payloadString = JSON.stringify(payload);
      const signature = createSignature(payloadString, testConfig.appSecret);

      // Inject without rawBody set - Fastify should still handle it
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
    });

    it('handles text message without sender name (only phoneNumberId in metadata)', async () => {
      // This test covers the case where senderName is null but phoneNumberId exists
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Create payload without contacts (no senderName) but with phoneNumberId
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
                    display_phone_number: '15551234567',
                    phone_number_id: '123456789012345',
                  },
                  // No contacts array, so senderName will be null
                  messages: [
                    {
                      from: '15551234567',
                      // No id field - will use fallback
                      timestamp: '1234567890',
                      type: 'text',
                      text: { body: 'Test message' },
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

      expect(response.statusCode).toBe(200);

      await waitForAsyncProcessing(200);

      // Message should be saved with metadata containing only phoneNumberId
      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(1);
      expect(messages[0]?.text).toBe('Test message');
      expect(messages[0]?.metadata?.phoneNumberId).toBe('123456789012345');
      expect(messages[0]?.metadata?.senderName).toBeUndefined();
    });

    it('handles message with missing waMessageId (uses fallback)', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Create payload without message id
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
                      // Missing 'id' field - will trigger fallback
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

      expect(response.statusCode).toBe(200);

      await waitForAsyncProcessing(200);

      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(1);
      // waMessageId should use fallback pattern 'unknown-{eventId}'
      expect(messages[0]?.waMessageId).toMatch(/^unknown-/);
    });

    it('handles message with missing timestamp and toNumber (uses fallbacks)', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Create payload without timestamp
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
                    // Missing display_phone_number - will use fallback
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
                      id: 'wamid.test',
                      // Missing 'timestamp' field - will use fallback
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

      expect(response.statusCode).toBe(200);

      await waitForAsyncProcessing(200);

      const messages = ctx.messageRepository.getAll();
      expect(messages.length).toBe(1);
      expect(messages[0]?.timestamp).toBe(''); // Empty string fallback
      expect(messages[0]?.toNumber).toBe(''); // Empty string fallback
    });

    it('handles null wabaId in error message (uses "null" fallback)', async () => {
      // Create payload with null WABA ID (missing entry)
      const payload = {
        object: 'whatsapp_business_account',
        entry: [],
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

      // Should reject with 403
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { error: { message: string } };
      expect(body.error.message).toContain('waba_id');
      expect(body.error.message).toContain('null');
    });

    it('handles null phoneNumberId in error message (uses "null" fallback)', async () => {
      // Create payload with valid WABA but missing phone_number_id
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
                    // Missing phone_number_id
                    display_phone_number: '15551234567',
                  },
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

      // Should reject with 403
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { error: { message: string } };
      expect(body.error.message).toContain('phone_number_id');
      expect(body.error.message).toContain('null');
    });

    it('handles null messageType in error message (uses "unknown" fallback)', async () => {
      // Create payload with missing message type
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
                      id: 'wamid.test',
                      timestamp: '1234567890',
                      // Missing 'type' field
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

      expect(response.statusCode).toBe(200);

      await waitForAsyncProcessing(200);

      // Event should be IGNORED with 'unknown' in message
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      expect(events[0]?.status).toBe('IGNORED');
      expect(events[0]?.ignoredReason?.message).toContain('unknown');
    });

    it('handles confirmation message with null originalMessageId (uses undefined fallback)', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      // Create payload without message id (originalMessageId will be null)
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
                      // Missing 'id' field - originalMessageId will be null
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

      expect(response.statusCode).toBe(200);

      await waitForAsyncProcessing(200);

      // Confirmation message should be sent even without originalMessageId
      const sentMessages = ctx.whatsappCloudApi.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
    });
  });
});
