/**
 * Tests for WhatsApp Cloud API client.
 * Mocks fetch() calls to Graph API endpoints.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { createWhatsAppClient } from '../client.js';
import type { WhatsAppConfig } from '../types.js';

const GRAPH_API_BASE = 'https://graph.facebook.com';
const PHONE_NUMBER_ID = '123456789';
const ACCESS_TOKEN = 'test-access-token';
const MEDIA_ID = 'media-id-123';

const config: WhatsAppConfig = {
  phoneNumberId: PHONE_NUMBER_ID,
  accessToken: ACCESS_TOKEN,
};

describe('WhatsAppClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('sendTextMessage', () => {
    it('sends message successfully and returns messageId', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v22.0/${PHONE_NUMBER_ID}/messages`)
        .reply(200, {
          messaging_product: 'whatsapp',
          contacts: [{ input: '+15551234567', wa_id: '15551234567' }],
          messages: [{ id: 'wamid.HBgNMTU1NTEyMzQ1Njc4FQIAEhg' }],
        });

      const client = createWhatsAppClient(config);
      const result = await client.sendTextMessage({
        to: '+15551234567',
        message: 'Hello!',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messageId).toBe('wamid.HBgNMTU1NTEyMzQ1Njc4FQIAEhg');
      }
    });

    it('includes context when replyToMessageId provided', async () => {
      let capturedBody: string | undefined;
      nock(GRAPH_API_BASE)
        .post(`/v22.0/${PHONE_NUMBER_ID}/messages`, (body) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, {
          messaging_product: 'whatsapp',
          contacts: [],
          messages: [{ id: 'reply-msg-id' }],
        });

      const client = createWhatsAppClient(config);
      await client.sendTextMessage({
        to: '+15551234567',
        message: 'Reply text',
        replyToMessageId: 'original-msg-id',
      });

      expect(capturedBody).toContain('context');
      expect(capturedBody).toContain('original-msg-id');
    });

    it('returns error on HTTP 400', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v22.0/${PHONE_NUMBER_ID}/messages`)
        .reply(400, { error: { message: 'Invalid phone number' } });

      const client = createWhatsAppClient(config);
      const result = await client.sendTextMessage({
        to: 'invalid',
        message: 'Hello!',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('400');
        expect(result.error.statusCode).toBe(400);
      }
    });

    it('returns error on HTTP 401 unauthorized', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v22.0/${PHONE_NUMBER_ID}/messages`)
        .reply(401, { error: { message: 'Invalid access token' } });

      const client = createWhatsAppClient(config);
      const result = await client.sendTextMessage({
        to: '+15551234567',
        message: 'Hello!',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('401');
      }
    });

    it('returns error on network failure', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v22.0/${PHONE_NUMBER_ID}/messages`)
        .replyWithError('Network error');

      const client = createWhatsAppClient(config);
      const result = await client.sendTextMessage({
        to: '+15551234567',
        message: 'Hello!',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Failed to send WhatsApp message');
      }
    });

    it('returns error when response has empty messages array', async () => {
      nock(GRAPH_API_BASE).post(`/v22.0/${PHONE_NUMBER_ID}/messages`).reply(200, {
        messaging_product: 'whatsapp',
        contacts: [],
        messages: [],
      });

      const client = createWhatsAppClient(config);
      const result = await client.sendTextMessage({
        to: '+15551234567',
        message: 'Hello!',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('No message ID');
      }
    });
  });

  describe('getMediaUrl', () => {
    it('returns media URL and metadata on success', async () => {
      nock(GRAPH_API_BASE).get(`/v22.0/${MEDIA_ID}`).reply(200, {
        url: 'https://lookaside.fbsbx.com/media/123',
        mime_type: 'image/jpeg',
        sha256: 'abc123',
        file_size: 12345,
      });

      const client = createWhatsAppClient(config);
      const result = await client.getMediaUrl(MEDIA_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://lookaside.fbsbx.com/media/123');
        expect(result.value.mimeType).toBe('image/jpeg');
        expect(result.value.sha256).toBe('abc123');
        expect(result.value.fileSize).toBe(12345);
      }
    });

    it('returns error on HTTP 404', async () => {
      nock(GRAPH_API_BASE)
        .get(`/v22.0/${MEDIA_ID}`)
        .reply(404, { error: { message: 'Media not found' } });

      const client = createWhatsAppClient(config);
      const result = await client.getMediaUrl(MEDIA_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('404');
      }
    });

    it('returns error on network failure', async () => {
      nock(GRAPH_API_BASE).get(`/v22.0/${MEDIA_ID}`).replyWithError('Connection refused');

      const client = createWhatsAppClient(config);
      const result = await client.getMediaUrl(MEDIA_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Failed to get media URL');
      }
    });
  });

  describe('downloadMedia', () => {
    const MEDIA_URL = 'https://lookaside.fbsbx.com/media/123';

    it('downloads media and returns buffer', async () => {
      const mediaContent = Buffer.from('fake image content');
      nock('https://lookaside.fbsbx.com').get('/media/123').reply(200, mediaContent);

      const client = createWhatsAppClient(config);
      const result = await client.downloadMedia(MEDIA_URL);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.toString()).toBe('fake image content');
      }
    });

    it('returns error on HTTP 403', async () => {
      nock('https://lookaside.fbsbx.com').get('/media/123').reply(403, 'Forbidden');

      const client = createWhatsAppClient(config);
      const result = await client.downloadMedia(MEDIA_URL);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('403');
      }
    });

    it('returns error on network failure', async () => {
      nock('https://lookaside.fbsbx.com').get('/media/123').replyWithError('Socket hang up');

      const client = createWhatsAppClient(config);
      const result = await client.downloadMedia(MEDIA_URL);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Failed to download media');
      }
    });

    it('returns timeout error when download takes too long', async () => {
      vi.useFakeTimers();

      nock('https://lookaside.fbsbx.com')
        .get('/media/123')
        .delay(35000)
        .reply(200, Buffer.from('content'));

      const client = createWhatsAppClient(config);
      const resultPromise = client.downloadMedia(MEDIA_URL);

      await vi.advanceTimersByTimeAsync(31000);

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
        expect(result.error.message).toContain('timed out');
      }

      vi.useRealTimers();
    });
  });

  describe('markAsRead', () => {
    const MESSAGE_ID = 'wamid.HBgNMTU1NTEyMzQ1Njc4FQIAEhg';

    it('marks message as read successfully', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v22.0/${PHONE_NUMBER_ID}/messages`, (body: object) => {
          const b = body as { messaging_product: string; status: string; message_id: string };
          return (
            b.messaging_product === 'whatsapp' && b.status === 'read' && b.message_id === MESSAGE_ID
          );
        })
        .reply(200, { success: true });

      const client = createWhatsAppClient(config);
      const result = await client.markAsRead(MESSAGE_ID);

      expect(result.ok).toBe(true);
    });

    it('returns error on HTTP 400', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v22.0/${PHONE_NUMBER_ID}/messages`)
        .reply(400, { error: { message: 'Invalid message ID' } });

      const client = createWhatsAppClient(config);
      const result = await client.markAsRead(MESSAGE_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('400');
      }
    });

    it('returns error on network failure', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v22.0/${PHONE_NUMBER_ID}/messages`)
        .replyWithError('Network error');

      const client = createWhatsAppClient(config);
      const result = await client.markAsRead(MESSAGE_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Failed to mark message as read');
      }
    });
  });
});
