/**
 * Tests for webhook async processing:
 * - processWebhookAsync
 * - sendConfirmationMessage
 *
 * These tests wait for the async processing to complete and verify the state changes.
 */
import { vi } from 'vitest';
import {
  describe,
  it,
  expect,
  setupTestContext,
  testConfig,
  createSignature,
  createWebhookPayload,
} from './testUtils.js';

// Mock the whatsappClient module to capture sendWhatsAppMessage calls
vi.mock('../whatsappClient.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-message-id' }),
}));

import { sendWhatsAppMessage } from '../whatsappClient.js';

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
        url: '/v1/webhooks/whatsapp',
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
        url: '/v1/webhooks/whatsapp',
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
        url: '/v1/webhooks/whatsapp',
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
        url: '/v1/webhooks/whatsapp',
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
        url: '/v1/webhooks/whatsapp',
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

      // Verify sendWhatsAppMessage was called
      expect(sendWhatsAppMessage).toHaveBeenCalled();
    });

    it('handles sendWhatsAppMessage failure gracefully', async () => {
      // Mock sendWhatsAppMessage to fail
      vi.mocked(sendWhatsAppMessage).mockResolvedValueOnce({
        success: false,
        error: 'Failed to send message',
      });

      const senderPhone = '15551234567';
      const userId = 'test-user-id';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone]);

      const payload = createWebhookPayload();
      const payloadString = JSON.stringify(payload);
      const signature = createSignature(payloadString, testConfig.appSecret);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/webhooks/whatsapp',
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
        url: '/v1/webhooks/whatsapp',
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
});
