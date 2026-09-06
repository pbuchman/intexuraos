import type { FastifyInstance } from 'fastify';
import type { Logger } from '@intexuraos/common-core';
import { validateInternalAuth, type AuthUser } from '@intexuraos/common-http';
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import type {
  LegacyDigestDefinitionProjection,
  LegacyDigestRunProjection,
  MessageDigestServiceClient,
} from '@intexuraos/internal-clients';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreChunkRepository } from '../infra/firestore/chunkRepository.js';
import { createFirestoreFolderRepository } from '../infra/firestore/folderRepository.js';
import { createFirestorePageRepository } from '../infra/firestore/pageRepository.js';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';

const FISHING_GROUP_KEY = 'grupa-wedkarska-skool';

const authState = vi.hoisted(
  (): {
    user: AuthUser | null;
    logIncomingRequest: ReturnType<typeof vi.fn>;
  } => ({
    user: { userId: 'synthetic-user-001', claims: { email: 'synthetic@example.com' } },
    logIncomingRequest: vi.fn(),
  })
);

vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const original = await importOriginal<typeof import('@intexuraos/common-http')>();
  return {
    ...original,
    requireAuth: vi.fn(
      async (_request: unknown, reply: { fail: (code: string, message: string) => void }) => {
        if (authState.user === null) {
          reply.fail('UNAUTHORIZED', 'Missing auth');
          return null;
        }
        return authState.user;
      }
    ),
    logIncomingRequest: authState.logIncomingRequest,
    validateInternalAuth: vi.fn(() => ({ valid: true })),
  };
});

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

interface RouteTestContext {
  app: FastifyInstance;
  messageDigestClient: {
    queryLegacyDigestDefinitions: ReturnType<typeof vi.fn>;
    queryLegacyDigestRuns: ReturnType<typeof vi.fn>;
  };
}

describe('Fishing Assistant digest facade routes', () => {
  let ctx: RouteTestContext;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    authState.user = {
      userId: 'synthetic-user-001',
      claims: { email: 'synthetic@example.com' },
    };
    authState.logIncomingRequest.mockClear();
    vi.mocked(validateInternalAuth).mockReturnValue({ valid: true });
    const messageDigestClient = {
      queryLegacyDigestDefinitions: vi.fn(),
      queryLegacyDigestRuns: vi.fn(),
    };
    setServices(createServices(messageDigestClient));
    const app = await buildServer();
    await app.ready();
    ctx = { app, messageDigestClient };
  });

  afterEach(async () => {
    resetServices();
    await ctx.app.close();
  });

  it('requires authentication before querying the Message Digest service', async () => {
    authState.user = null;

    const response = await ctx.app.inject({ method: 'GET', url: '/digest-groups' });

    expect(response.statusCode).toBe(401);
    expect(ctx.messageDigestClient.queryLegacyDigestDefinitions).not.toHaveBeenCalled();
  });

  it('runs a bounded caller-role cutover check through the real Message Digest client', async () => {
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValue({
      ok: true,
      value: { items: [definitionProjection()] },
    });
    ctx.messageDigestClient.queryLegacyDigestRuns
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [
            runProjection({ runId: 'mdr_run_001', date: '2026-07-26' }),
            runProjection({ runId: 'mdr_run_002', date: '2026-07-27' }),
          ],
          truncated: true,
          nextCursor: 'opaque-next',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [runProjection({ runId: 'mdr_run_003', date: '2026-07-28' })],
          truncated: false,
          nextCursor: null,
        },
      });
    const url = '/internal/fishing-assistant/message-digests/cutover/check';
    const payload = {
      userId: 'synthetic-user-001',
      dateFrom: '2026-07-26',
      dateTo: '2026-07-28',
    };
    const headers = { 'x-internal-caller-role': 'message_digest_cutover_verifier' };

    const missingRole = await ctx.app.inject({ method: 'POST', url, payload });
    expect(missingRole.statusCode).toBe(401);

    vi.mocked(validateInternalAuth).mockReturnValueOnce({
      valid: false,
      reason: 'token_mismatch',
    });
    const invalidToken = await ctx.app.inject({ method: 'POST', url, headers, payload });
    expect(invalidToken.statusCode).toBe(401);

    const response = await ctx.app.inject({ method: 'POST', url, headers, payload });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { definitionCount: 1, runCount: 3 },
    });
    expect(ctx.messageDigestClient.queryLegacyDigestDefinitions).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      legacyGroupKey: FISHING_GROUP_KEY,
    });
    expect(ctx.messageDigestClient.queryLegacyDigestRuns.mock.calls).toEqual([
      [
        {
          userId: 'synthetic-user-001',
          legacyGroupKey: FISHING_GROUP_KEY,
          fromDate: '2026-07-26',
          toDate: '2026-07-28',
          limit: 100,
        },
      ],
      [
        {
          userId: 'synthetic-user-001',
          legacyGroupKey: FISHING_GROUP_KEY,
          fromDate: '2026-07-26',
          toDate: '2026-07-28',
          limit: 100,
          cursor: 'opaque-next',
        },
      ],
    ]);
    expect(response.body).not.toContain('synthetic-user-001');
    expect(response.body).not.toContain('Fishing plans');
    expect(authState.logIncomingRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ bodyPreviewLength: 0, includeHeaders: false })
    );
  });

  it('fails the cutover check closed for invalid bounds and inconsistent downstream pages', async () => {
    const url = '/internal/fishing-assistant/message-digests/cutover/check';
    const headers = { 'x-internal-caller-role': 'message_digest_cutover_verifier' };
    const payload = {
      userId: 'synthetic-user-001',
      dateFrom: '2026-07-26',
      dateTo: '2026-07-28',
    };
    const inject = async (
      overrides: Partial<typeof payload> = {}
    ): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> =>
      await ctx.app.inject({ method: 'POST', url, headers, payload: { ...payload, ...overrides } });
    const definitionSuccess = (): void => {
      ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValueOnce({
        ok: true,
        value: { items: [definitionProjection()] },
      });
    };

    expect((await inject({ dateFrom: '2026-02-30' })).statusCode).toBe(400);
    expect(ctx.messageDigestClient.queryLegacyDigestDefinitions).not.toHaveBeenCalled();

    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'synthetic unavailable' },
    });
    expect((await inject()).statusCode).toBe(502);

    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValueOnce({
      ok: true,
      value: {
        items: [{ ...definitionProjection(), legacyGroupKey: 'unexpected-group' }],
      },
    });
    expect((await inject()).statusCode).toBe(502);

    definitionSuccess();
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValueOnce({
      ok: false,
      error: { code: 'MALFORMED_ENVELOPE', message: 'synthetic malformed page' },
    });
    expect((await inject()).statusCode).toBe(502);

    definitionSuccess();
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValueOnce({
      ok: true,
      value: {
        items: [runProjection({ legacyGroupKey: 'unexpected-group' })],
        truncated: false,
        nextCursor: null,
      },
    });
    expect((await inject()).statusCode).toBe(502);

    definitionSuccess();
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValueOnce({
      ok: true,
      value: { items: [], truncated: true, nextCursor: null },
    });
    expect((await inject()).statusCode).toBe(502);

    definitionSuccess();
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValueOnce({
      ok: true,
      value: { items: [], truncated: false, nextCursor: 'unexpected-cursor' },
    });
    expect((await inject()).statusCode).toBe(502);

    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockRejectedValueOnce(
      new Error('synthetic client exception')
    );
    expect((await inject()).statusCode).toBe(502);

    definitionSuccess();
    let page = 0;
    ctx.messageDigestClient.queryLegacyDigestRuns.mockImplementation(async () => {
      page += 1;
      return {
        ok: true,
        value: { items: [], truncated: true, nextCursor: `cursor-${String(page)}` },
      };
    });
    expect((await inject()).statusCode).toBe(502);
    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledTimes(104);
  });

  it('lists only the one canonical migrated fishing alias for the owner', async () => {
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValue({
      ok: true,
      value: { items: [definitionProjection()] },
    });

    const response = await ctx.app.inject({ method: 'GET', url: '/digest-groups' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual([
      { groupKey: FISHING_GROUP_KEY, displayName: 'Grupa Wędkarska Skool' },
    ]);
    expect(ctx.messageDigestClient.queryLegacyDigestDefinitions).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      legacyGroupKey: FISHING_GROUP_KEY,
    });
    expect(response.body).not.toContain('synthetic-account-001');
    expect(response.body).not.toContain('synthetic-chat-001');
  });

  it('returns an empty group list when the migrated alias is absent or still hidden', async () => {
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValue({
      ok: true,
      value: { items: [] },
    });

    const response = await ctx.app.inject({ method: 'GET', url: '/digest-groups' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ items: [] });
  });

  it('lists canonical summaries with date, terms, limit, and signed cursor pagination', async () => {
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValue({
      ok: true,
      value: {
        items: [runProjection()],
        truncated: true,
        nextCursor: 'next-opaque-cursor',
      },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-01&dateTo=2026-07-31&terms=, catch, meeting ,, &limit=50&cursor=opaque-cursor`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      items: [
        {
          groupKey: FISHING_GROUP_KEY,
          date: '2026-07-27',
          title: 'Fishing plans',
          summaryMarkdown: '- The catch was strong.',
          messageCount: 12,
        },
      ],
      truncated: true,
      nextCursor: 'next-opaque-cursor',
    });
    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      legacyGroupKey: FISHING_GROUP_KEY,
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      terms: ['catch', 'meeting'],
      limit: 50,
      cursor: 'opaque-cursor',
    });
    expect(response.body).not.toContain('synthetic-message-ref-001');
    expect(response.body).not.toContain('mdr_run_001');
  });

  it('uses the default page size, omits empty terms, and preserves a terminal page', async () => {
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValue({
      ok: true,
      value: { items: [], truncated: false, nextCursor: null },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-01&dateTo=2026-07-31&terms=, ,`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ items: [], truncated: false });
    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      legacyGroupKey: FISHING_GROUP_KEY,
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      limit: 100,
    });
  });

  it.each([
    `/digests?dateFrom=2026-07-01&dateTo=2026-07-31`,
    `/digests?groupKey=${FISHING_GROUP_KEY}&dateTo=2026-07-31`,
    `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-01`,
    `/digests?groupKey=some-other-group&dateFrom=2026-07-01&dateTo=2026-07-31`,
    `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-02-30&dateTo=2026-07-31`,
    `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-31&dateTo=2026-07-01`,
    `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-01&dateTo=2026-07-31&limit=0`,
    `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-01&dateTo=2026-07-31&limit=101`,
    `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-01&dateTo=2026-07-31&cursor=${'c'.repeat(4_097)}`,
    `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-01&dateTo=2026-07-31&terms=${Array.from({ length: 21 }, (_, index) => `t${String(index)}`).join(',')}`,
  ])('rejects an invalid or non-fishing digest query before downstream access: %s', async (url) => {
    const response = await ctx.app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(400);
    expect(ctx.messageDigestClient.queryLegacyDigestRuns).not.toHaveBeenCalled();
  });

  it('returns one canonical digest detail without legacy state', async () => {
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValue({
      ok: true,
      value: { items: [runProjection()], truncated: false, nextCursor: null },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/digests/${FISHING_GROUP_KEY}/2026-07-27`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      digest: {
        groupKey: FISHING_GROUP_KEY,
        date: '2026-07-27',
        title: 'Fishing plans',
        summaryMarkdown: '- The catch was strong.',
        messageCount: 12,
      },
      state: null,
    });
    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      legacyGroupKey: FISHING_GROUP_KEY,
      fromDate: '2026-07-27',
      toDate: '2026-07-27',
      limit: 1,
    });
  });

  it('returns NOT_FOUND for a missing, hidden, foreign, or non-fishing digest detail', async () => {
    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValue({
      ok: true,
      value: { items: [], truncated: false, nextCursor: null },
    });

    const missing = await ctx.app.inject({
      method: 'GET',
      url: `/digests/${FISHING_GROUP_KEY}/2026-07-27`,
    });
    const otherGroup = await ctx.app.inject({
      method: 'GET',
      url: '/digests/some-other-group/2026-07-27',
    });

    expect(missing.statusCode).toBe(404);
    expect(otherGroup.statusCode).toBe(404);
    expect(ctx.messageDigestClient.queryLegacyDigestRuns).toHaveBeenCalledTimes(1);
  });

  it.each(['not-a-date', '2026-02-30'])(
    'rejects invalid detail date %s before downstream access',
    async (date) => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/digests/${FISHING_GROUP_KEY}/${date}`,
      });

      expect(response.statusCode).toBe(400);
      expect(ctx.messageDigestClient.queryLegacyDigestRuns).not.toHaveBeenCalled();
    }
  );

  it('maps safe Message Digest failures without exposing response bodies', async () => {
    ctx.messageDigestClient.queryLegacyDigestDefinitions.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'HTTP 503', status: 503, statusText: 'Unavailable' },
    });
    const groups = await ctx.app.inject({ method: 'GET', url: '/digest-groups' });

    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValueOnce({
      ok: false,
      error: { code: 'MALFORMED_ENVELOPE', message: 'Invalid response' },
    });
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/digests/${FISHING_GROUP_KEY}/2026-07-27`,
    });

    expect(groups.statusCode).toBe(502);
    expect(detail.statusCode).toBe(502);
    expect(groups.json().error.code).toBe('DOWNSTREAM_ERROR');
    expect(detail.json().error.code).toBe('DOWNSTREAM_ERROR');

    ctx.messageDigestClient.queryLegacyDigestRuns.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'sensitive invalid query detail' },
    });
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/digests?groupKey=${FISHING_GROUP_KEY}&dateFrom=2026-07-01&dateTo=2026-07-31`,
    });
    expect(list.statusCode).toBe(400);
    expect(list.json().error.code).toBe('INVALID_REQUEST');
    expect(list.body).not.toContain('sensitive invalid query detail');
  });
});

function createServices(
  messageDigestClient: RouteTestContext['messageDigestClient']
): ServiceContainer {
  const firestore = createFakeFirestore() as unknown as Firestore;
  return {
    generateId: vi.fn().mockReturnValue('synthetic-id-001'),
    logger,
    repositories: {
      firestore,
      folderRepository: createFirestoreFolderRepository({ firestore, logger }),
      pageRepository: createFirestorePageRepository({ firestore, logger }),
      chunkRepository: createFirestoreChunkRepository({ firestore, logger }),
    },
    chatRepository: {} as ServiceContainer['chatRepository'],
    embeddingClient: { embedTexts: vi.fn() } as ServiceContainer['embeddingClient'],
    userServiceClient: {} as ServiceContainer['userServiceClient'],
    messageDigestClient: messageDigestClient as unknown as MessageDigestServiceClient,
    whatsappClient: {} as ServiceContainer['whatsappClient'],
    usageSink: {} as ServiceContainer['usageSink'],
    chatAdapter: {} as ServiceContainer['chatAdapter'],
  };
}

function definitionProjection(): LegacyDigestDefinitionProjection {
  return {
    definitionId: 'md_definition_001',
    legacyGroupKey: FISHING_GROUP_KEY,
    source: {
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
    },
    activeMigrationId: 'mdm_migration_001',
  };
}

function runProjection(
  overrides: Partial<LegacyDigestRunProjection> = {}
): LegacyDigestRunProjection {
  return {
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    legacyGroupKey: FISHING_GROUP_KEY,
    date: '2026-07-27',
    title: 'Fishing plans',
    summaryMarkdown: '- The catch was strong.',
    messageCount: 12,
    evidenceMessageRefs: ['synthetic-message-ref-001'],
    windowStart: '2026-07-26T07:00:00.000Z',
    windowEnd: '2026-07-27T07:00:00.000Z',
    ...overrides,
  };
}
