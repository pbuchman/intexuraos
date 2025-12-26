/**
 * Tests for WhatsApp message routes:
 * - GET /v1/whatsapp/messages
 * - DELETE /v1/whatsapp/messages/:messageId
 */
import { describe, it, expect, setupTestContext, createToken } from './testUtils.js';

describe('WhatsApp Message Routes', () => {
  const ctx = setupTestContext();

  describe('GET /v1/whatsapp/messages', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/whatsapp/messages',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns empty array when no messages exist', async () => {
      const token = await createToken({ sub: 'user-no-messages' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/whatsapp/messages',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          messages: unknown[];
          fromNumber: string | null;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.messages).toEqual([]);
      expect(body.data.fromNumber).toBeNull();
    });

    it('returns messages for authenticated user', async () => {
      const userId = 'user-with-messages';
      const token = await createToken({ sub: userId });

      // Create a user mapping first
      await ctx.userMappingRepository.saveMapping(userId, ['+15551234567']);

      // Add a test message
      await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.test123',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Test message content',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-123',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/whatsapp/messages',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          messages: { id: string; text: string; fromNumber: string }[];
          fromNumber: string | null;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.messages.length).toBe(1);
      expect(body.data.messages[0]?.text).toBe('Test message content');
      expect(body.data.messages[0]?.fromNumber).toBe('+15551234567');
      // fromNumber from mapping is normalized (without +)
      expect(body.data.fromNumber).toBe('15551234567');
    });

    it('returns messages sorted by newest first', async () => {
      const userId = 'user-sorted-messages';
      const token = await createToken({ sub: userId });

      // Add messages with different timestamps
      await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.older',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Older message',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: '2025-01-01T10:00:00Z',
        webhookEventId: 'event-old',
      });

      await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.newer',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Newer message',
        mediaType: 'text',
        timestamp: '1234567891',
        receivedAt: '2025-01-01T11:00:00Z',
        webhookEventId: 'event-new',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/whatsapp/messages',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          messages: { text: string }[];
        };
      };
      expect(body.data.messages.length).toBe(2);
      expect(body.data.messages[0]?.text).toBe('Newer message');
      expect(body.data.messages[1]?.text).toBe('Older message');
    });
  });

  describe('DELETE /v1/whatsapp/messages/:messageId', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/v1/whatsapp/messages/some-id',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 when message does not exist', async () => {
      const token = await createToken({ sub: 'user-delete-test' });

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/v1/whatsapp/messages/non-existent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when message belongs to another user', async () => {
      const userId1 = 'user-owner';
      const userId2 = 'user-not-owner';
      const token = await createToken({ sub: userId2 });

      // Create message owned by user1
      const saveResult = await ctx.messageRepository.saveMessage({
        userId: userId1,
        waMessageId: 'wamid.test',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Private message',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-private',
      });

      // User2 tries to delete it
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/v1/whatsapp/messages/${saveResult.ok ? saveResult.value.id : 'unknown'}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('deletes message successfully when owned by user', async () => {
      const userId = 'user-delete-own';
      const token = await createToken({ sub: userId });

      // Create message
      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.to-delete',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Message to delete',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-delete',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Delete the message
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/v1/whatsapp/messages/${messageId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { deleted: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      // Verify message is gone
      const getResult = await ctx.messageRepository.getMessage(messageId);
      expect(getResult.ok).toBe(true);
      expect(getResult.ok ? getResult.value : 'error').toBeNull();
    });
  });
});
