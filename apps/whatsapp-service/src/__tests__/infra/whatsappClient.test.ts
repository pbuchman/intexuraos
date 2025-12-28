/**
 * Tests for WhatsApp Graph API client.
 * Mocks fetch() calls to Graph API endpoints.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import nock from 'nock';
import { sendWhatsAppMessage, getMediaUrl, downloadMedia } from '../../whatsappClient.js';

const GRAPH_API_BASE = 'https://graph.facebook.com';
const PHONE_NUMBER_ID = '123456789';
const ACCESS_TOKEN = 'test-access-token';
const MEDIA_ID = 'media-id-123';

describe('whatsappClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('sendWhatsAppMessage', () => {
    it('sends message successfully and returns messageId', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v21.0/${PHONE_NUMBER_ID}/messages`)
        .reply(200, {
          messaging_product: 'whatsapp',
          contacts: [{ input: '+15551234567', wa_id: '15551234567' }],
          messages: [{ id: 'wamid.HBgNMTU1NTEyMzQ1Njc4FQIAEhg' }],
        });

      const result = await sendWhatsAppMessage(
        PHONE_NUMBER_ID,
        '+15551234567',
        'Hello!',
        ACCESS_TOKEN
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.HBgNMTU1NTEyMzQ1Njc4FQIAEhg');
      expect(result.error).toBeUndefined();
    });

    it('includes context when contextMessageId provided', async () => {
      let capturedBody: string | undefined;
      nock(GRAPH_API_BASE)
        .post(`/v21.0/${PHONE_NUMBER_ID}/messages`, (body) => {
          capturedBody = JSON.stringify(body);
          return true;
        })
        .reply(200, {
          messaging_product: 'whatsapp',
          contacts: [],
          messages: [{ id: 'reply-msg-id' }],
        });

      await sendWhatsAppMessage(
        PHONE_NUMBER_ID,
        '+15551234567',
        'Reply text',
        ACCESS_TOKEN,
        'original-msg-id'
      );

      expect(capturedBody).toContain('context');
      expect(capturedBody).toContain('original-msg-id');
    });

    it('returns error on HTTP 400', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v21.0/${PHONE_NUMBER_ID}/messages`)
        .reply(400, { error: { message: 'Invalid phone number' } });

      const result = await sendWhatsAppMessage(PHONE_NUMBER_ID, 'invalid', 'Hello!', ACCESS_TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('400');
      expect(result.messageId).toBeUndefined();
    });

    it('returns error on HTTP 401 unauthorized', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v21.0/${PHONE_NUMBER_ID}/messages`)
        .reply(401, { error: { message: 'Invalid access token' } });

      const result = await sendWhatsAppMessage(
        PHONE_NUMBER_ID,
        '+15551234567',
        'Hello!',
        'bad-token'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });

    it('returns error on network failure', async () => {
      nock(GRAPH_API_BASE)
        .post(`/v21.0/${PHONE_NUMBER_ID}/messages`)
        .replyWithError('Network error');

      const result = await sendWhatsAppMessage(
        PHONE_NUMBER_ID,
        '+15551234567',
        'Hello!',
        ACCESS_TOKEN
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to send WhatsApp message');
    });

    it('handles response with empty messages array', async () => {
      nock(GRAPH_API_BASE).post(`/v21.0/${PHONE_NUMBER_ID}/messages`).reply(200, {
        messaging_product: 'whatsapp',
        contacts: [],
        messages: [],
      });

      const result = await sendWhatsAppMessage(
        PHONE_NUMBER_ID,
        '+15551234567',
        'Hello!',
        ACCESS_TOKEN
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
    });
  });

  describe('getMediaUrl', () => {
    it('returns media URL and metadata on success', async () => {
      nock(GRAPH_API_BASE).get(`/v21.0/${MEDIA_ID}`).reply(200, {
        url: 'https://lookaside.fbsbx.com/media/123',
        mime_type: 'image/jpeg',
        sha256: 'abc123',
        file_size: 12345,
      });

      const result = await getMediaUrl(MEDIA_ID, ACCESS_TOKEN);

      expect(result.success).toBe(true);
      expect(result.data?.url).toBe('https://lookaside.fbsbx.com/media/123');
      expect(result.data?.mime_type).toBe('image/jpeg');
      expect(result.data?.sha256).toBe('abc123');
      expect(result.data?.file_size).toBe(12345);
    });

    it('returns error on HTTP 404', async () => {
      nock(GRAPH_API_BASE)
        .get(`/v21.0/${MEDIA_ID}`)
        .reply(404, { error: { message: 'Media not found' } });

      const result = await getMediaUrl(MEDIA_ID, ACCESS_TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
      expect(result.data).toBeUndefined();
    });

    it('returns error on network failure', async () => {
      nock(GRAPH_API_BASE).get(`/v21.0/${MEDIA_ID}`).replyWithError('Connection refused');

      const result = await getMediaUrl(MEDIA_ID, ACCESS_TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get media URL');
    });
  });

  describe('downloadMedia', () => {
    const MEDIA_URL = 'https://lookaside.fbsbx.com/media/123';

    it('downloads media and returns buffer', async () => {
      const mediaContent = Buffer.from('fake image content');
      nock('https://lookaside.fbsbx.com').get('/media/123').reply(200, mediaContent);

      const result = await downloadMedia(MEDIA_URL, ACCESS_TOKEN);

      expect(result.success).toBe(true);
      expect(result.buffer).toBeDefined();
      expect(result.buffer?.toString()).toBe('fake image content');
    });

    it('returns error on HTTP 403', async () => {
      nock('https://lookaside.fbsbx.com').get('/media/123').reply(403, 'Forbidden');

      const result = await downloadMedia(MEDIA_URL, ACCESS_TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
    });

    it('returns error on network failure', async () => {
      nock('https://lookaside.fbsbx.com').get('/media/123').replyWithError('Socket hang up');

      const result = await downloadMedia(MEDIA_URL, ACCESS_TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to download media');
    });

    it('returns timeout error when download takes too long', async () => {
      vi.useFakeTimers();

      nock('https://lookaside.fbsbx.com')
        .get('/media/123')
        .delay(35000)
        .reply(200, Buffer.from('content'));

      const resultPromise = downloadMedia(MEDIA_URL, ACCESS_TOKEN);

      await vi.advanceTimersByTimeAsync(31000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');

      vi.useRealTimers();
    });
  });
});
