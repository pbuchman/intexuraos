import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import { createWhatsappNotificationSender } from '../../../infra/notification/whatsappNotificationSender.js';

describe('createWhatsappNotificationSender', () => {
  const userServiceUrl = 'http://user-service.local';
  const internalAuthToken = 'test-token';
  const silentLogger = pino({ level: 'silent' });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('sendDraftReady', () => {
    it('returns ok on successful notification', async () => {
      nock(userServiceUrl)
        .post('/internal/users/user-123/notify')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200);

      const sender = createWhatsappNotificationSender({ userServiceUrl, internalAuthToken, logger: silentLogger });
      const result = await sender.sendDraftReady(
        'user-123',
        'research-456',
        'AI Research Report',
        'https://app.example.com/research/456'
      );

      expect(result.ok).toBe(true);
    });

    it('sends correct notification payload', async () => {
      const scope = nock(userServiceUrl)
        .post('/internal/users/user-123/notify', (body: Record<string, unknown>) => {
          expect(body['type']).toBe('research_ready');
          expect(body['message']).toContain('AI Research Report');
          expect(body['message']).toContain('https://app.example.com/research/456');
          const metadata = body['metadata'] as Record<string, unknown>;
          expect(metadata['researchId']).toBe('research-789');
          expect(metadata['title']).toBe('AI Research Report');
          expect(metadata['draftUrl']).toBe('https://app.example.com/research/456');
          return true;
        })
        .reply(200);

      const sender = createWhatsappNotificationSender({ userServiceUrl, internalAuthToken, logger: silentLogger });
      await sender.sendDraftReady(
        'user-123',
        'research-789',
        'AI Research Report',
        'https://app.example.com/research/456'
      );

      expect(scope.isDone()).toBe(true);
    });

    it('returns error on non-ok response', async () => {
      nock(userServiceUrl).post('/internal/users/user-123/notify').reply(500);

      const sender = createWhatsappNotificationSender({ userServiceUrl, internalAuthToken, logger: silentLogger });
      const result = await sender.sendDraftReady(
        'user-123',
        'research-456',
        'Test',
        'https://example.com'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('500');
      }
    });

    it('returns error on network failure', async () => {
      nock(userServiceUrl)
        .post('/internal/users/user-123/notify')
        .replyWithError('Connection refused');

      const sender = createWhatsappNotificationSender({ userServiceUrl, internalAuthToken, logger: silentLogger });
      const result = await sender.sendDraftReady(
        'user-123',
        'research-456',
        'Test',
        'https://example.com'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Network error');
      }
    });
  });
});
