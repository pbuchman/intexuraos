/**
 * Tests for WhatsApp message routes:
 * - GET /whatsapp/messages
 * - GET /whatsapp/messages/:message_id/media
 * - GET /whatsapp/messages/:message_id/thumbnail
 * - DELETE /whatsapp/messages/:message_id
 */
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('WhatsApp Message Routes', () => {
  const ctx = setupTestContext();

  describe('GET /whatsapp/messages', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/messages',
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
        url: '/whatsapp/messages',
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
        url: '/whatsapp/messages',
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
        url: '/whatsapp/messages',
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

    it('returns transcription fields for audio messages', async () => {
      const userId = 'user-with-transcription';
      const token = await createToken({ sub: userId });

      // Add an audio message
      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.audio-transcribed',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'audio',
        gcsPath: 'whatsapp/user/msg/audio.ogg',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-transcription',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Update the message with transcription
      await ctx.messageRepository.updateTranscription(userId, messageId, {
        status: 'completed',
        text: 'This is the transcribed text',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/messages',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          messages: {
            id: string;
            transcriptionStatus?: string;
            transcription?: string;
            transcriptionError?: string;
          }[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.messages.length).toBe(1);
      expect(body.data.messages[0]?.transcriptionStatus).toBe('completed');
      expect(body.data.messages[0]?.transcription).toBe('This is the transcribed text');
      expect(body.data.messages[0]?.transcriptionError).toBeUndefined();
    });

    it('returns linkPreview for text messages with URLs', async () => {
      const userId = 'user-with-linkpreview';
      const token = await createToken({ sub: userId });

      // Add a text message
      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.text-with-link',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Check out https://example.com',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-linkpreview',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Update the message with link preview (LinkPreviewState has previews as array)
      const updateResult = await ctx.messageRepository.updateLinkPreview(userId, messageId, {
        status: 'completed',
        previews: [
          {
            url: 'https://example.com',
            title: 'Example Domain',
            description: 'This is an example website',
            siteName: 'example.com',
          },
        ],
      });
      expect(updateResult.ok).toBe(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/messages',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          messages: {
            id: string;
            linkPreview?: {
              status: string;
              previews?: { url: string; title?: string }[];
            };
          }[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.messages.length).toBe(1);
      expect(body.data.messages[0]?.linkPreview).toBeDefined();
      expect(body.data.messages[0]?.linkPreview?.status).toBe('completed');
      expect(body.data.messages[0]?.linkPreview?.previews?.[0]?.title).toBe('Example Domain');
      expect(body.data.messages[0]?.linkPreview?.previews?.[0]?.url).toBe('https://example.com');
    });

    it('includes nextCursor when pagination has more results', async () => {
      const userId = 'user-with-pagination';
      const token = await createToken({ sub: userId });

      // Add a test message
      await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.paged',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Paged message',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-paged',
      });

      // Configure fake to return a nextCursor
      ctx.messageRepository.setNextCursor('cursor-for-next-page');

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/messages',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          messages: { text: string }[];
          nextCursor?: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.messages.length).toBe(1);
      expect(body.data.nextCursor).toBe('cursor-for-next-page');
    });
  });

  describe('GET /whatsapp/messages/:message_id/media', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/messages/some-id/media',
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
      const token = await createToken({ sub: 'user-media-test' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/messages/non-existent-id/media',
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
      const userId1 = 'user-media-owner';
      const userId2 = 'user-media-not-owner';
      const token = await createToken({ sub: userId2 });

      const saveResult = await ctx.messageRepository.saveMessage({
        userId: userId1,
        waMessageId: 'wamid.media-test',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath: 'whatsapp/user1/msg/media.jpg',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-media',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${saveResult.ok ? saveResult.value.id : 'unknown'}/media`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when message has no media', async () => {
      const userId = 'user-no-media';
      const token = await createToken({ sub: userId });

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.text-only',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Text message without media',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-text',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${saveResult.ok ? saveResult.value.id : 'unknown'}/media`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.message).toBe('Message has no media');
    });

    it('returns signed URL for media when message has gcsPath', async () => {
      const userId = 'user-with-media';
      const token = await createToken({ sub: userId });
      const gcsPath = 'whatsapp/user-with-media/msg123/media-id.jpg';

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.with-media',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath,
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-with-media',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${saveResult.ok ? saveResult.value.id : 'unknown'}/media`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { url: string; expiresAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.url).toContain('storage.example.com/signed/');
      expect(body.data.url).toContain(gcsPath);
      expect(body.data.expiresAt).toBeDefined();
      // Verify expiresAt is a valid ISO date roughly 15 minutes in the future
      const expiresAt = new Date(body.data.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(14 * 60 * 1000); // > 14 minutes
      expect(diffMs).toBeLessThan(16 * 60 * 1000); // < 16 minutes
    });

    it('returns 502 when getSignedUrl fails', async () => {
      const userId = 'user-signed-url-fail';
      const token = await createToken({ sub: userId });
      const gcsPath = 'whatsapp/user-signed-url-fail/msg/media.jpg';

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.signed-url-fail',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath,
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-signed-url-fail',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Configure fake to fail getSignedUrl
      ctx.mediaStorage.setFailGetSignedUrl(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${messageId}/media`,
        headers: { authorization: `Bearer ${token}` },
      });

      // Reset failure flag
      ctx.mediaStorage.setFailGetSignedUrl(false);

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Simulated getSignedUrl failure');
    });

    it('returns 502 when getMessage fails for media', async () => {
      const userId = 'user-media-get-fail';
      const token = await createToken({ sub: userId });

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.media-get-fail',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath: 'whatsapp/user-media-get-fail/msg/media.jpg',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-media-get-fail',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Configure fake to fail getMessage
      ctx.messageRepository.setFailGetMessage(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${messageId}/media`,
        headers: { authorization: `Bearer ${token}` },
      });

      // Reset failure flag
      ctx.messageRepository.setFailGetMessage(false);

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Simulated getMessage failure');
    });
  });

  describe('GET /whatsapp/messages/:message_id/thumbnail', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/messages/some-id/thumbnail',
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
      const token = await createToken({ sub: 'user-thumb-test' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/whatsapp/messages/non-existent-id/thumbnail',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when message belongs to another user', async () => {
      const userId1 = 'user-thumb-owner';
      const userId2 = 'user-thumb-not-owner';
      const token = await createToken({ sub: userId2 });

      const saveResult = await ctx.messageRepository.saveMessage({
        userId: userId1,
        waMessageId: 'wamid.thumb-test',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath: 'whatsapp/user1/msg/media.jpg',
        thumbnailGcsPath: 'whatsapp/user1/msg/media_thumb.jpg',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-thumb',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${saveResult.ok ? saveResult.value.id : 'unknown'}/thumbnail`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when message has no thumbnail', async () => {
      const userId = 'user-no-thumb';
      const token = await createToken({ sub: userId });

      // Audio messages have media but no thumbnail
      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.audio-no-thumb',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'audio',
        gcsPath: 'whatsapp/user/msg/audio.ogg',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-audio',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${saveResult.ok ? saveResult.value.id : 'unknown'}/thumbnail`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.message).toBe('Message has no thumbnail');
    });

    it('returns signed URL for thumbnail when message has thumbnailGcsPath', async () => {
      const userId = 'user-with-thumb';
      const token = await createToken({ sub: userId });
      const thumbnailGcsPath = 'whatsapp/user-with-thumb/msg456/media-id_thumb.jpg';

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.with-thumb',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath: 'whatsapp/user-with-thumb/msg456/media-id.jpg',
        thumbnailGcsPath,
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-with-thumb',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${saveResult.ok ? saveResult.value.id : 'unknown'}/thumbnail`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { url: string; expiresAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.url).toContain('storage.example.com/signed/');
      expect(body.data.url).toContain(thumbnailGcsPath);
      expect(body.data.expiresAt).toBeDefined();
    });

    it('returns 502 when getSignedUrl fails for thumbnail', async () => {
      const userId = 'user-thumb-signed-url-fail';
      const token = await createToken({ sub: userId });
      const thumbnailGcsPath = 'whatsapp/user-thumb-signed-url-fail/msg/media_thumb.jpg';

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.thumb-signed-url-fail',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath: 'whatsapp/user-thumb-signed-url-fail/msg/media.jpg',
        thumbnailGcsPath,
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-thumb-signed-url-fail',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Configure fake to fail getSignedUrl
      ctx.mediaStorage.setFailGetSignedUrl(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${messageId}/thumbnail`,
        headers: { authorization: `Bearer ${token}` },
      });

      // Reset failure flag
      ctx.mediaStorage.setFailGetSignedUrl(false);

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Simulated getSignedUrl failure');
    });

    it('returns 502 when getMessage fails for thumbnail', async () => {
      const userId = 'user-thumb-get-fail';
      const token = await createToken({ sub: userId });

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.thumb-get-fail',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath: 'whatsapp/user-thumb-get-fail/msg/media.jpg',
        thumbnailGcsPath: 'whatsapp/user-thumb-get-fail/msg/media_thumb.jpg',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-thumb-get-fail',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Configure fake to fail getMessage
      ctx.messageRepository.setFailGetMessage(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/whatsapp/messages/${messageId}/thumbnail`,
        headers: { authorization: `Bearer ${token}` },
      });

      // Reset failure flag
      ctx.messageRepository.setFailGetMessage(false);

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Simulated getMessage failure');
    });
  });

  describe('DELETE /whatsapp/messages/:message_id', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/whatsapp/messages/some-id',
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
        url: '/whatsapp/messages/non-existent-id',
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
        url: `/whatsapp/messages/${saveResult.ok ? saveResult.value.id : 'unknown'}`,
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
        url: `/whatsapp/messages/${messageId}`,
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

      // No cleanup event for text-only messages
      const cleanupEvents = ctx.eventPublisher.getMediaCleanupEvents();
      expect(cleanupEvents).toEqual([]);
    });

    it('publishes cleanup event when deleting message with media', async () => {
      const userId = 'user-delete-media';
      const token = await createToken({ sub: userId });
      const gcsPath = 'whatsapp/user-delete-media/msg/image.jpg';
      const thumbnailGcsPath = 'whatsapp/user-delete-media/msg/image_thumb.jpg';

      // Create image message with media paths
      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.media-delete',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'image',
        gcsPath,
        thumbnailGcsPath,
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-media-delete',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Delete the message
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/whatsapp/messages/${messageId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { deleted: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      // Verify cleanup event was published
      const cleanupEvents = ctx.eventPublisher.getMediaCleanupEvents();
      expect(cleanupEvents.length).toBe(1);
      expect(cleanupEvents[0]?.type).toBe('whatsapp.media.cleanup');
      expect(cleanupEvents[0]?.userId).toBe(userId);
      expect(cleanupEvents[0]?.messageId).toBe(messageId);
      expect(cleanupEvents[0]?.gcsPaths).toEqual([gcsPath, thumbnailGcsPath]);
    });

    it('publishes cleanup event with only gcsPath when no thumbnail exists', async () => {
      const userId = 'user-delete-audio';
      const token = await createToken({ sub: userId });
      const gcsPath = 'whatsapp/user-delete-audio/msg/audio.ogg';

      // Create audio message (no thumbnail)
      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.audio-delete',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: '',
        mediaType: 'audio',
        gcsPath,
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-audio-delete',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Delete the message
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/whatsapp/messages/${messageId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);

      // Verify cleanup event with only one path
      const cleanupEvents = ctx.eventPublisher.getMediaCleanupEvents();
      expect(cleanupEvents.length).toBe(1);
      expect(cleanupEvents[0]?.gcsPaths).toEqual([gcsPath]);
    });

    it('returns 502 when getMessage fails during delete', async () => {
      const userId = 'user-delete-get-fail';
      const token = await createToken({ sub: userId });

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.delete-get-fail',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Message for delete test',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-delete-get-fail',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Configure fake to fail getMessage
      ctx.messageRepository.setFailGetMessage(true);

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/whatsapp/messages/${messageId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      // Reset failure flag
      ctx.messageRepository.setFailGetMessage(false);

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Simulated getMessage failure');
    });

    it('returns 502 when deleteMessage fails', async () => {
      const userId = 'user-delete-fail';
      const token = await createToken({ sub: userId });

      const saveResult = await ctx.messageRepository.saveMessage({
        userId,
        waMessageId: 'wamid.delete-fail',
        fromNumber: '+15551234567',
        toNumber: '+15559876543',
        text: 'Message for delete test',
        mediaType: 'text',
        timestamp: '1234567890',
        receivedAt: new Date().toISOString(),
        webhookEventId: 'event-delete-fail',
      });

      expect(saveResult.ok).toBe(true);
      const messageId = saveResult.ok ? saveResult.value.id : '';

      // Configure fake to fail deleteMessage
      ctx.messageRepository.setFailDeleteMessage(true);

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/whatsapp/messages/${messageId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      // Reset failure flag
      ctx.messageRepository.setFailDeleteMessage(false);

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Simulated deleteMessage failure');
    });
  });
});
