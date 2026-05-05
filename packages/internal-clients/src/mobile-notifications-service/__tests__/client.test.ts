import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileNotificationsServiceClient } from '../client.js';
import type { MobileNotificationsServiceConfig } from '../types.js';

const BASE_URL = 'https://mobile-notifications.test';

const logger: MobileNotificationsServiceConfig['logger'] = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createMobileNotificationsServiceClient', () => {
  it('listDigestSubscriptions sends auth and uses the exact internal path', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/notifications/digest-subscriptions/list', { userId: 'u' })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: { items: [{ groupKey: 'g', displayName: 'g' }] } });

    const client = createMobileNotificationsServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.listDigestSubscriptions({ userId: 'u' });

    expect(result).toEqual({
      ok: true,
      value: { items: [{ groupKey: 'g', displayName: 'g' }] },
    });
    expect(scope.isDone()).toBe(true);
  });

  it('queryDigests sends auth and uses the exact internal path', async () => {
    const request = {
      userId: 'u',
      groupKey: 'g',
      dateFrom: '2026-04-15',
      dateTo: '2026-04-16',
      limit: 5,
    };
    const response = {
      items: [
        {
          groupKey: 'g',
          date: '2026-04-15',
          title: 'Spring bait',
          summaryMarkdown: '# Spring bait',
          messageCount: 12,
        },
      ],
      truncated: false,
    };
    const scope = nock(BASE_URL)
      .post('/internal/notifications/digests/query', request)
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: response });

    const client = createMobileNotificationsServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.queryDigests(request);

    expect(result).toEqual({ ok: true, value: response });
    expect(scope.isDone()).toBe(true);
  });

  it('getDigest sends auth and uses the exact internal path', async () => {
    const response = {
      groupKey: 'g',
      date: '2026-04-15',
      title: 'Spring bait',
      summaryMarkdown: '# Spring bait',
      messageCount: 12,
    };
    const scope = nock(BASE_URL)
      .post('/internal/notifications/digests/get', {
        userId: 'u',
        groupKey: 'g',
        date: '2026-04-15',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: response });

    const client = createMobileNotificationsServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getDigest({ userId: 'u', groupKey: 'g', date: '2026-04-15' });

    expect(result).toEqual({ ok: true, value: response });
    expect(scope.isDone()).toBe(true);
  });

  it('getDigestState sends auth and uses the exact internal path', async () => {
    const response = {
      userId: 'u',
      groupKey: 'g',
      updatedAt: '2026-04-15T20:00:00.000Z',
      identityLedger: [],
      moderatorEvents: [],
      openThreads: [],
      recentSummaryDates: ['2026-04-15'],
    };
    const scope = nock(BASE_URL)
      .post('/internal/notifications/digest-state/get', { userId: 'u', groupKey: 'g' })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: response });

    const client = createMobileNotificationsServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getDigestState({ userId: 'u', groupKey: 'g' });

    expect(result).toEqual({ ok: true, value: response });
    expect(scope.isDone()).toBe(true);
  });

  it('queryGroupMessages sends auth and preserves optional terms', async () => {
    const request = {
      userId: 'u',
      groupKey: 'g',
      date: '2026-04-15',
      terms: ['spring', 'bait'],
      limit: 10,
    };
    const response = {
      messages: [
        {
          messageRef: 'g:2026-04-15:1:abc',
          groupKey: 'g',
          date: '2026-04-15',
          postTimeSec: 1776200400,
          senderLabel: null,
          text: 'Spring bait worked',
          quote: 'Spring bait worked',
        },
      ],
      totalRaw: 3,
      totalCleaned: 1,
      returned: 1,
      truncated: false,
    };
    const scope = nock(BASE_URL)
      .post('/internal/notifications/group-messages/query', request)
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, { success: true, data: response });

    const client = createMobileNotificationsServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.queryGroupMessages(request);

    expect(result).toEqual({ ok: true, value: response });
    expect(scope.isDone()).toBe(true);
  });

  it('propagates per-request options and default timeout configuration', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/notifications/digest-subscriptions/list', { userId: 'u' })
      .matchHeader('x-internal-auth', 'secret')
      .matchHeader('x-request-id', 'request-123')
      .reply(200, { success: true, data: { items: [] } });

    const client = createMobileNotificationsServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 5000,
    });
    const result = await client.listDigestSubscriptions(
      { userId: 'u' },
      { requestId: 'request-123', timeoutMs: 1000 }
    );

    expect(result).toEqual({ ok: true, value: { items: [] } });
    expect(scope.isDone()).toBe(true);
  });

  it('returns envelope errors without throwing', async () => {
    nock(BASE_URL)
      .post('/internal/notifications/digests/query')
      .reply(200, {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'bad range' },
      });

    const client = createMobileNotificationsServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.queryDigests({
      userId: 'u',
      groupKey: 'g',
      dateFrom: '2026-04-16',
      dateTo: '2026-04-15',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ENVELOPE_ERROR');
      expect(result.error.message).toContain('INVALID_REQUEST');
    }
  });
});
