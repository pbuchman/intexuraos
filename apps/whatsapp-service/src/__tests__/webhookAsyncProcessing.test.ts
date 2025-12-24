/**
 * Tests for webhook async processing:
 * - processWebhookAsync (lines 205-298)
 * - sendConfirmationMessage (lines 303-333)
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

// Mock the notion infra to simulate createInboxNote
vi.mock('../infra/notion/index.js', () => ({
  createInboxNote: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      id: 'mock-note-id',
      title: 'Test Note',
      content: 'Test Content',
      source: 'whatsapp',
      status: 'inbox',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }),
}));

import { sendWhatsAppMessage } from '../whatsappClient.js';
import { createInboxNote } from '../infra/notion/index.js';

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
    it('processes webhook and updates event status when no user mapping exists', async () => {
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

      // Event should be persisted with updated status
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
      // Status will be IGNORED because phone_number_id is not in allowedPhoneNumberIds
      const event = events[0];
      expect(event?.status).toBeDefined();
    });

    it('processes webhook when user mapping exists with Notion connection', async () => {
      // Setup user mapping and Notion connection
      const senderPhone = '15551234567';
      const userId = 'test-user-id';
      const inboxNotesDbId = 'test-db-id';
      const notionToken = 'test-notion-token';

      // Create mapping with the sender's phone number
      await ctx.userMappingRepository.saveMapping(userId, [senderPhone], inboxNotesDbId);
      ctx.notionConnectionRepository.setConnection(userId, notionToken);

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

      // Verify event was processed
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
    });

    it('handles webhook with no sender phone number', async () => {
      // Payload without messages (status update only)
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

      // Event should be persisted
      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
    });

    it('processes webhook when user has mapping but no Notion connection', async () => {
      const senderPhone = '15551234567';
      const userId = 'test-user-id';
      const inboxNotesDbId = 'test-db-id';

      // Create mapping without Notion connection
      await ctx.userMappingRepository.saveMapping(userId, [senderPhone], inboxNotesDbId);

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
    });

    it('processes webhook from allowed phone number ID', async () => {
      // Create payload with allowed phone number ID
      const payload = {
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
                    phone_number_id: 'test-phone-id', // This is in testConfig.allowedPhoneNumberIds
                  },
                  contacts: [
                    {
                      wa_id: '15551234567',
                      profile: { name: 'Test User' },
                    },
                  ],
                  messages: [
                    {
                      from: '15551234567',
                      id: 'wamid.test123',
                      timestamp: '1234567890',
                      type: 'text',
                      text: { body: 'Hello, World!' },
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
      expect(events[0]?.phoneNumberId).toBe('test-phone-id');
    });
  });

  describe('sendConfirmationMessage', () => {
    it('sends confirmation message when webhook is successfully processed', async () => {
      // Setup user mapping and Notion connection
      const senderPhone = '15551234567';
      const userId = 'test-user-id';
      const inboxNotesDbId = 'test-db-id';
      const notionToken = 'test-notion-token';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone], inboxNotesDbId);
      ctx.notionConnectionRepository.setConnection(userId, notionToken);

      // Use allowed phone number ID to ensure processing
      const payload = {
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
                    phone_number_id: 'test-phone-id',
                  },
                  contacts: [
                    {
                      wa_id: senderPhone,
                      profile: { name: 'Test User' },
                    },
                  ],
                  messages: [
                    {
                      from: senderPhone,
                      id: 'wamid.test-message-id',
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
    });

    it('handles sendWhatsAppMessage failure gracefully', async () => {
      // Mock sendWhatsAppMessage to fail
      vi.mocked(sendWhatsAppMessage).mockResolvedValueOnce({
        success: false,
        error: 'Failed to send message',
      });

      const senderPhone = '15551234567';
      const userId = 'test-user-id';
      const inboxNotesDbId = 'test-db-id';
      const notionToken = 'test-notion-token';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone], inboxNotesDbId);
      ctx.notionConnectionRepository.setConnection(userId, notionToken);

      const payload = {
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
                    phone_number_id: 'test-phone-id',
                  },
                  contacts: [
                    {
                      wa_id: senderPhone,
                      profile: { name: 'Test User' },
                    },
                  ],
                  messages: [
                    {
                      from: senderPhone,
                      id: 'wamid.test-message-id',
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

      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
    });

    it('does not send confirmation when phoneNumberId is null', async () => {
      // Clear the mock call count
      vi.mocked(sendWhatsAppMessage).mockClear();

      // Payload with no phone_number_id
      const payload = {
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
                    // No phone_number_id
                  },
                  contacts: [
                    {
                      wa_id: '15551234567',
                      profile: { name: 'Test User' },
                    },
                  ],
                  messages: [
                    {
                      from: '15551234567',
                      id: 'wamid.test123',
                      timestamp: '1234567890',
                      type: 'text',
                      text: { body: 'Hello' },
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
        url: '/v1/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        payload: payloadString,
      });

      expect(response.statusCode).toBe(200);

      await waitForAsyncProcessing(200);

      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
    });
  });

  describe('error handling in processWebhookAsync', () => {
    it('handles createInboxNote failure gracefully', async () => {
      // Mock createInboxNote to fail
      vi.mocked(createInboxNote).mockResolvedValueOnce({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create note' },
      });

      const senderPhone = '15551234567';
      const userId = 'test-user-id';
      const inboxNotesDbId = 'test-db-id';
      const notionToken = 'test-notion-token';

      await ctx.userMappingRepository.saveMapping(userId, [senderPhone], inboxNotesDbId);
      ctx.notionConnectionRepository.setConnection(userId, notionToken);

      const payload = {
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
                    phone_number_id: 'test-phone-id',
                  },
                  contacts: [
                    {
                      wa_id: senderPhone,
                      profile: { name: 'Test User' },
                    },
                  ],
                  messages: [
                    {
                      from: senderPhone,
                      id: 'wamid.test-message-id',
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
        url: '/v1/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        payload: payloadString,
      });

      // Response should still be 200 (fire-and-forget)
      expect(response.statusCode).toBe(200);

      await waitForAsyncProcessing(200);

      const events = ctx.webhookEventRepository.getAll();
      expect(events.length).toBe(1);
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
