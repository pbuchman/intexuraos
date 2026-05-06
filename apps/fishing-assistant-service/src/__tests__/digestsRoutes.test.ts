import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Logger } from '@intexuraos/common-core';
import type { AuthUser } from '@intexuraos/common-http';
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import type {
  DigestEvidenceItem,
  GetDigestStateResponse,
  MobileNotificationsServiceClient,
} from '@intexuraos/internal-clients';
import OpenAI from 'openai';
import { buildServer } from '../server.js';
import { resetServices, setServices, type ServiceContainer } from '../services.js';
import { createFirestoreChunkRepository } from '../infra/firestore/chunkRepository.js';
import { createFirestoreFolderRepository } from '../infra/firestore/folderRepository.js';
import { createFirestorePageRepository } from '../infra/firestore/pageRepository.js';

const authState = vi.hoisted(
  (): {
    user: AuthUser | null;
    logIncomingRequest: ReturnType<typeof vi.fn>;
  } => ({
    user: { userId: 'user-1', claims: { email: 'user@example.com' } },
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
  mobileNotificationsClient: {
    listDigestSubscriptions: ReturnType<typeof vi.fn>;
    queryDigests: ReturnType<typeof vi.fn>;
    getDigest: ReturnType<typeof vi.fn>;
    getDigestState: ReturnType<typeof vi.fn>;
    queryGroupMessages: ReturnType<typeof vi.fn>;
  };
}

function createServices(): Omit<RouteTestContext, 'app'> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  const mobileNotificationsClient = {
    listDigestSubscriptions: vi.fn(),
    queryDigests: vi.fn(),
    getDigest: vi.fn(),
    getDigestState: vi.fn(),
    queryGroupMessages: vi.fn(),
  };

  setServices({
    generateId: vi.fn().mockReturnValue('id-1'),
    logger,
    repositories: {
      firestore,
      folderRepository: createFirestoreFolderRepository({ firestore, logger }),
      pageRepository: createFirestorePageRepository({ firestore, logger }),
      chunkRepository: createFirestoreChunkRepository({ firestore, logger }),
    },
    chatRepository: {} as ServiceContainer['chatRepository'],
    embeddingClient: { embedTexts: vi.fn() } as ServiceContainer['embeddingClient'],
    openAiClient: {} as OpenAI,
    userServiceClient: {} as ServiceContainer['userServiceClient'],
    mobileNotificationsClient: mobileNotificationsClient as unknown as MobileNotificationsServiceClient,
    usageSink: {} as ServiceContainer['usageSink'],
    chatAdapter: {} as ServiceContainer['chatAdapter'],
  });

  return {
    mobileNotificationsClient,
  };
}

describe('Fishing Assistant digest facade routes', () => {
  let ctx: RouteTestContext;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    authState.user = { userId: 'user-1', claims: { email: 'user@example.com' } };
    authState.logIncomingRequest.mockClear();
    const services = createServices();
    const app = await buildServer();
    await app.ready();
    ctx = { app, ...services };
  });

  afterEach(async () => {
    resetServices();
    await ctx.app.close();
  });

  it('requires authentication', async () => {
    authState.user = null;

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digest-groups',
    });

    expect(response.statusCode).toBe(401);
  });

  it('lists digest groups for the authenticated user', async () => {
    ctx.mobileNotificationsClient.listDigestSubscriptions.mockResolvedValue({
      ok: true,
      value: {
        items: [{ groupKey: 'feeder', displayName: 'Feeder Team' }],
      },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digest-groups',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual([
      { groupKey: 'feeder', displayName: 'Feeder Team' },
    ]);
    expect(ctx.mobileNotificationsClient.listDigestSubscriptions).toHaveBeenCalledWith({
      userId: 'user-1',
    });
  });

  it('lists digests for the selected group and range', async () => {
    const digest: DigestEvidenceItem = {
      groupKey: 'feeder',
      date: '2026-05-01',
      title: 'Majówka',
      summaryMarkdown: '- leszcze\n- pinka',
      messageCount: 12,
    };
    ctx.mobileNotificationsClient.queryDigests.mockResolvedValue({
      ok: true,
      value: { items: [digest], truncated: false },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests?groupKey=feeder&dateFrom=2026-05-01&dateTo=2026-05-03',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      items: [digest],
      truncated: false,
    });
    expect(ctx.mobileNotificationsClient.queryDigests).toHaveBeenCalledWith({
      userId: 'user-1',
      groupKey: 'feeder',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-03',
    });
  });

  it('validates required query params and forwards parsed terms and limits', async () => {
    const missingGroup = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests?dateFrom=2026-05-01&dateTo=2026-05-03',
    });
    const missingFrom = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests?groupKey=feeder&dateTo=2026-05-03',
    });
    const missingTo = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests?groupKey=feeder&dateFrom=2026-05-01',
    });

    ctx.mobileNotificationsClient.queryDigests.mockResolvedValueOnce({
      ok: true,
      value: { items: [], truncated: false },
    });
    const parsed = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests?groupKey=feeder&dateFrom=2026-05-01&dateTo=2026-05-03&terms=, pinka, mix ,, &limit=5',
    });

    expect(missingGroup.statusCode).toBe(400);
    expect(missingFrom.statusCode).toBe(400);
    expect(missingTo.statusCode).toBe(400);
    expect(parsed.statusCode).toBe(200);
    expect(ctx.mobileNotificationsClient.queryDigests).toHaveBeenCalledWith({
      userId: 'user-1',
      groupKey: 'feeder',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-03',
      terms: ['pinka', 'mix'],
      limit: 5,
    });
  });

  it('omits empty parsed terms and surfaces digest-list downstream failures', async () => {
    ctx.mobileNotificationsClient.queryDigests.mockResolvedValueOnce({
      ok: true,
      value: { items: [], truncated: false },
    });
    const emptyTerms = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests?groupKey=feeder&dateFrom=2026-05-01&dateTo=2026-05-03&terms=, ,',
    });

    ctx.mobileNotificationsClient.queryDigests.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'HTTP 503', status: 503 },
    });
    const downstream = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests?groupKey=feeder&dateFrom=2026-05-01&dateTo=2026-05-03',
    });

    expect(emptyTerms.statusCode).toBe(200);
    expect(ctx.mobileNotificationsClient.queryDigests).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      groupKey: 'feeder',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-03',
    });
    expect(downstream.statusCode).toBe(502);
  });

  it('returns digest detail together with optional state', async () => {
    const digest: DigestEvidenceItem = {
      groupKey: 'feeder',
      date: '2026-05-01',
      title: 'Majówka',
      summaryMarkdown: '- leszcze\n- pinka',
      messageCount: 12,
    };
    const state: GetDigestStateResponse = {
      userId: 'user-1',
      groupKey: 'feeder',
      updatedAt: '2026-05-01T08:00:00Z',
      identityLedger: [],
      moderatorEvents: [],
      openThreads: [],
      recentSummaryDates: ['2026-05-01'],
    };
    ctx.mobileNotificationsClient.getDigest.mockResolvedValue({ ok: true, value: digest });
    ctx.mobileNotificationsClient.getDigestState.mockResolvedValue({
      ok: true,
      value: state,
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests/feeder/2026-05-01',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      digest,
      state,
    });
    expect(ctx.mobileNotificationsClient.getDigest).toHaveBeenCalledWith({
      userId: 'user-1',
      groupKey: 'feeder',
      date: '2026-05-01',
    });
    expect(ctx.mobileNotificationsClient.getDigestState).toHaveBeenCalledWith({
      userId: 'user-1',
      groupKey: 'feeder',
    });
  });

  it('returns NOT_FOUND for missing digests and tolerates missing state', async () => {
    ctx.mobileNotificationsClient.getDigest.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'HTTP 404', status: 404 },
    });
    const notFound = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests/feeder/2026-05-09',
    });

    const digest: DigestEvidenceItem = {
      groupKey: 'feeder',
      date: '2026-05-01',
      title: 'Majówka',
      summaryMarkdown: '- leszcze\n- pinka',
      messageCount: 12,
    };
    ctx.mobileNotificationsClient.getDigest.mockResolvedValueOnce({ ok: true, value: digest });
    ctx.mobileNotificationsClient.getDigestState.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'HTTP 404', status: 404 },
    });
    const missingState = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests/feeder/2026-05-01',
    });

    expect(notFound.statusCode).toBe(404);
    expect(missingState.statusCode).toBe(200);
    expect(missingState.json().data.state).toBeNull();
  });

  it('returns DOWNSTREAM_ERROR when the mobile notifications service fails', async () => {
    ctx.mobileNotificationsClient.listDigestSubscriptions.mockResolvedValue({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 503',
        status: 503,
      },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digest-groups',
    });
    ctx.mobileNotificationsClient.getDigest.mockResolvedValueOnce({
      ok: true,
      value: {
        groupKey: 'feeder',
        date: '2026-05-01',
        title: 'Majówka',
        summaryMarkdown: '- leszcze\n- pinka',
        messageCount: 12,
      },
    });
    ctx.mobileNotificationsClient.getDigestState.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 503',
        status: 503,
      },
    });
    const detailResponse = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests/feeder/2026-05-01',
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('DOWNSTREAM_ERROR');
    expect(detailResponse.statusCode).toBe(502);
  });

  it('returns DOWNSTREAM_ERROR when digest detail lookup fails for reasons other than 404', async () => {
    ctx.mobileNotificationsClient.getDigest.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 503',
        status: 503,
      },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/fishing/digests/feeder/2026-05-01',
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('DOWNSTREAM_ERROR');
  });
});
