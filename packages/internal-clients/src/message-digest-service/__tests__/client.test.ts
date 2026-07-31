import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageDigestServiceClient } from '../client.js';
import type { MessageDigestServiceClient, MessageDigestServiceConfig } from '../types.js';

const BASE_URL = 'https://message-digest.test';

const logger: MessageDigestServiceConfig['logger'] = {
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

describe('createMessageDigestServiceClient', () => {
  it('queries the exact active legacy definition with internal auth and request options', async () => {
    const request = {
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
    };
    const response = { items: [definitionProjection()] };
    const scope = nock(BASE_URL)
      .post('/internal/message-digests/definitions/query', request)
      .matchHeader('x-internal-auth', 'secret')
      .matchHeader('x-request-id', 'request-001')
      .reply(200, successEnvelope(response));

    const client = createMessageDigestServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    await expect(
      client.queryLegacyDigestDefinitions(request, {
        requestId: 'request-001',
        timeoutMs: 1_000,
      })
    ).resolves.toEqual({ ok: true, value: response });
    expect(scope.isDone()).toBe(true);
  });

  it('queries a bounded legacy run page without changing the request body', async () => {
    const request = {
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      terms: ['catch', 'meeting'],
      limit: 100,
      cursor: 'opaque-cursor',
    };
    const response = {
      items: [runProjection()],
      truncated: true,
      nextCursor: 'next-opaque-cursor',
    };
    const scope = nock(BASE_URL)
      .post('/internal/message-digests/runs/query', request)
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, successEnvelope(response));

    const client = createClient();
    await expect(client.queryLegacyDigestRuns(request)).resolves.toEqual({
      ok: true,
      value: response,
    });
    expect(scope.isDone()).toBe(true);
  });

  it('accepts projections at the persisted Message Digest document boundaries', async () => {
    const definitionResponse = {
      items: [
        definitionProjection({
          source: {
            sourceAccountId: 'a'.repeat(512),
            generationId: 'b'.repeat(512),
            chatId: 'c'.repeat(512),
            chatType: 'group',
          },
        }),
      ],
    };
    const runResponse = {
      items: [
        runProjection({
          title: 't'.repeat(200),
          summaryMarkdown: 's'.repeat(12_000),
          messageCount: 1_000_001,
          evidenceMessageRefs: Array.from({ length: 1_000 }, () => 'd'.repeat(64)),
        }),
      ],
      truncated: false,
      nextCursor: null,
    };
    nock(BASE_URL)
      .post('/internal/message-digests/definitions/query')
      .reply(200, successEnvelope(definitionResponse));
    nock(BASE_URL)
      .post('/internal/message-digests/runs/query')
      .reply(200, successEnvelope(runResponse));
    const client = createClient();

    await expect(
      client.queryLegacyDigestDefinitions({
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
      })
    ).resolves.toEqual({ ok: true, value: definitionResponse });
    await expect(
      client.queryLegacyDigestRuns({
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        limit: 100,
      })
    ).resolves.toEqual({ ok: true, value: runResponse });
  });

  it.each([
    {
      name: 'source identifier beyond 512 characters',
      endpoint: 'definitions',
      data: {
        items: [
          definitionProjection({
            source: {
              ...(definitionProjection()['source'] as Record<string, unknown>),
              sourceAccountId: 'a'.repeat(513),
            },
          }),
        ],
      },
    },
    {
      name: 'headline beyond 200 characters',
      endpoint: 'runs',
      data: {
        items: [runProjection({ title: 't'.repeat(201) })],
        truncated: false,
        nextCursor: null,
      },
    },
    {
      name: 'summary beyond 12,000 characters',
      endpoint: 'runs',
      data: {
        items: [runProjection({ summaryMarkdown: 's'.repeat(12_001) })],
        truncated: false,
        nextCursor: null,
      },
    },
    {
      name: 'more than 1,000 evidence references',
      endpoint: 'runs',
      data: {
        items: [
          runProjection({
            evidenceMessageRefs: Array.from({ length: 1_001 }, () => 'd'.repeat(64)),
          }),
        ],
        truncated: false,
        nextCursor: null,
      },
    },
    {
      name: 'a non-SHA-256 evidence reference',
      endpoint: 'runs',
      data: {
        items: [runProjection({ evidenceMessageRefs: ['not-a-sha-256-reference'] })],
        truncated: false,
        nextCursor: null,
      },
    },
  ])('rejects $name', async ({ endpoint, data }) => {
    nock(BASE_URL)
      .post(`/internal/message-digests/${endpoint}/query`)
      .reply(200, successEnvelope(data));
    const client = createClient();

    const result =
      endpoint === 'definitions'
        ? await client.queryLegacyDigestDefinitions({
            userId: 'synthetic-user-001',
            legacyGroupKey: 'synthetic-fishing-group',
          })
        : await client.queryLegacyDigestRuns({
            userId: 'synthetic-user-001',
            legacyGroupKey: 'synthetic-fishing-group',
            limit: 100,
          });

    expect(result).toMatchObject({ ok: false, error: { code: 'MALFORMED_ENVELOPE' } });
  });

  it.each([
    { userId: '', legacyGroupKey: 'synthetic-fishing-group' },
    { userId: 'u'.repeat(257), legacyGroupKey: 'synthetic-fishing-group' },
    { userId: 'synthetic-user-001', legacyGroupKey: '' },
    { userId: 'synthetic-user-001', legacyGroupKey: 'Invalid Alias' },
    { userId: 'synthetic-user-001', legacyGroupKey: 'a'.repeat(129) },
    { userId: 'synthetic-user-001', legacyGroupKey: 'synthetic-fishing-group', extra: true },
  ])('rejects an invalid definition query before transport: %o', async (input) => {
    const client = createClient();
    const result = await client.queryLegacyDigestDefinitions(input as never);

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(nock.pendingMocks()).toEqual([]);
  });

  it.each([
    { fromDate: '2026-02-30' },
    { fromDate: '2026-07-02', toDate: '2026-07-01' },
    { terms: [] },
    { terms: [''] },
    { terms: ['a'.repeat(101)] },
    { terms: Array.from({ length: 21 }, (_, index) => `term-${String(index)}`) },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { cursor: '' },
    { cursor: 'c'.repeat(4_097) },
  ])('rejects invalid run query bounds before transport: %o', async (override) => {
    const client = createClient();
    const result = await client.queryLegacyDigestRuns({
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
      limit: 25,
      ...override,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(nock.pendingMocks()).toEqual([]);
  });

  it.each([
    {
      name: 'foreign alias',
      data: {
        items: [definitionProjection({ legacyGroupKey: 'some-other-group' })],
      },
    },
    {
      name: 'missing migration fence',
      data: {
        items: [definitionProjection({ activeMigrationId: null })],
      },
    },
    {
      name: 'direct source',
      data: {
        items: [
          definitionProjection({
            source: {
              ...(definitionProjection()['source'] as Record<string, unknown>),
              chatType: 'direct',
            },
          }),
        ],
      },
    },
    {
      name: 'hidden migration status',
      data: {
        items: [definitionProjection({ status: 'migrating' })],
      },
    },
    {
      name: 'duplicate alias definitions',
      data: {
        items: [definitionProjection(), definitionProjection({ definitionId: 'md_second_001' })],
      },
    },
  ])('rejects a definition response containing $name', async ({ data }) => {
    nock(BASE_URL)
      .post('/internal/message-digests/definitions/query')
      .reply(200, successEnvelope(data));
    const client = createClient();

    const result = await client.queryLegacyDigestDefinitions({
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'MALFORMED_ENVELOPE' } });
  });

  it.each([
    { success: true },
    { success: 'true', data: { items: [] } },
    { success: true, data: { items: [], unexpected: true } },
    successEnvelope({ items: [], truncated: false, nextCursor: null }, { unexpected: true }),
  ])('rejects a malformed or non-strict success envelope', async (body) => {
    nock(BASE_URL).post('/internal/message-digests/runs/query').reply(200, body);
    const client = createClient();

    const result = await client.queryLegacyDigestRuns({
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
      limit: 25,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'MALFORMED_ENVELOPE' } });
  });

  it('rejects a run response whose alias or pagination invariant does not match the request', async () => {
    nock(BASE_URL)
      .post('/internal/message-digests/runs/query')
      .reply(
        200,
        successEnvelope({
          items: [runProjection({ legacyGroupKey: 'some-other-group' })],
          truncated: false,
          nextCursor: 'forbidden-cursor',
        })
      );
    const client = createClient();

    const result = await client.queryLegacyDigestRuns({
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
      limit: 25,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'MALFORMED_ENVELOPE' } });

    nock(BASE_URL)
      .post('/internal/message-digests/runs/query')
      .reply(
        200,
        successEnvelope({
          items: [runProjection({ legacyGroupKey: 'some-other-group' })],
          truncated: false,
          nextCursor: null,
        })
      );
    await expect(
      client.queryLegacyDigestRuns({
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        limit: 25,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'MALFORMED_ENVELOPE' } });
  });

  it('returns API and timeout failures without throwing', async () => {
    nock(BASE_URL)
      .post('/internal/message-digests/definitions/query')
      .reply(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alias not found' },
      });
    nock(BASE_URL)
      .post('/internal/message-digests/runs/query')
      .delayConnection(50)
      .reply(200, successEnvelope({ items: [], truncated: false, nextCursor: null }));
    const client = createClient();

    const missing = await client.queryLegacyDigestDefinitions({
      userId: 'synthetic-user-001',
      legacyGroupKey: 'synthetic-fishing-group',
    });
    const timedOut = await client.queryLegacyDigestRuns(
      {
        userId: 'synthetic-user-001',
        legacyGroupKey: 'synthetic-fishing-group',
        limit: 25,
      },
      { timeoutMs: 5 }
    );

    expect(missing).toMatchObject({ ok: false, error: { code: 'API_ERROR', status: 404 } });
    expect(timedOut).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });
});

function createClient(): MessageDigestServiceClient {
  return createMessageDigestServiceClient({
    baseUrl: BASE_URL,
    internalAuthToken: 'secret',
    logger,
    defaultTimeoutMs: 1_000,
  });
}

function definitionProjection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definitionId: 'md_definition_001',
    legacyGroupKey: 'synthetic-fishing-group',
    source: {
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
    },
    activeMigrationId: 'mdm_migration_001',
    ...overrides,
  };
}

function runProjection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    legacyGroupKey: 'synthetic-fishing-group',
    date: '2026-07-27',
    title: 'Fishing plans',
    summaryMarkdown: '- Meet at dawn.\n- Bring corn bait.',
    messageCount: 12,
    evidenceMessageRefs: ['d'.repeat(64)],
    windowStart: '2026-07-26T07:00:00.000Z',
    windowEnd: '2026-07-27T07:00:00.000Z',
    ...overrides,
  };
}

function successEnvelope(
  data: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    success: true,
    data,
    diagnostics: { requestId: 'synthetic-request-001', durationMs: 1 },
    ...extra,
  };
}
