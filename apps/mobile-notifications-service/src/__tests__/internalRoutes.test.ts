/**
 * Tests for internal routes (service-to-service communication).
 */
import { describe, expect, it, setupTestContext } from './testUtils.js';
import { err, ok } from '@intexuraos/common-core';
import { setMockServices } from './helpers/mockServices.js';
import { cetDayBounds } from '../domain/usecases/cetDayBounds.js';
import type {
  DigestRepository,
  GroupStateRepository,
} from '../domain/repositories/digestRepositories.js';
import type {
  DailySummary,
  GroupState,
} from '../domain/schemas/digestSchemas.js';
import type {
  Notification,
  NotificationRepository,
  PaginationOptions,
} from '../domain/notifications/index.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

function setInternalAuth(): void {
  process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
}

function makeSummary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    date: '2026-04-15',
    groupKey: 'g',
    messageCount: 3,
    headline: 'Spring ground bait discussion',
    bullets: ['Ground bait worked in spring', 'Fish responded near reeds', 'Bread added cloud'],
    threads: [
      {
        topic: 'Ground bait',
        participants: ['Jan'],
        resolved: true,
        keyFacts: ['Use light ground bait in spring'],
      },
    ],
    moderatorPosts: [],
    openQuestions: [],
    activityOutliers: [],
    ...overrides,
  };
}

function makeDigestRepository(overrides: Partial<DigestRepository>): DigestRepository {
  return {
    save: (): ReturnType<DigestRepository['save']> => {
      throw new Error('digestRepository.save not configured');
    },
    findByDate: (): ReturnType<DigestRepository['findByDate']> => {
      throw new Error('digestRepository.findByDate not configured');
    },
    findRecentByGroup: (): ReturnType<DigestRepository['findRecentByGroup']> => {
      throw new Error('digestRepository.findRecentByGroup not configured');
    },
    findInRange: (): ReturnType<DigestRepository['findInRange']> => {
      throw new Error('digestRepository.findInRange not configured');
    },
    ...overrides,
  };
}

function makeGroupState(overrides: Partial<GroupState> = {}): GroupState {
  return {
    userId: 'u',
    groupKey: 'g',
    updatedAt: '2026-04-15T20:00:00.000Z',
    identityLedger: [],
    moderatorEvents: [],
    openThreads: [],
    recentSummaryDates: ['2026-04-15'],
    ...overrides,
  };
}

function makeGroupStateRepository(
  overrides: Partial<GroupStateRepository>
): GroupStateRepository {
  return {
    getByDate: (): ReturnType<GroupStateRepository['getByDate']> => {
      throw new Error('groupStateRepository.getByDate not configured');
    },
    getLatest: (): ReturnType<GroupStateRepository['getLatest']> => {
      throw new Error('groupStateRepository.getLatest not configured');
    },
    save: (): ReturnType<GroupStateRepository['save']> => {
      throw new Error('groupStateRepository.save not configured');
    },
    ...overrides,
  };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif',
    userId: 'u',
    source: 'tasker',
    device: 'phone',
    app: 'com.whatsapp',
    title: 'G fishing chat',
    text: 'Spring ground bait',
    timestamp: 1776200400,
    postTime: '1776200400',
    receivedAt: '2026-04-15T10:00:00.000Z',
    notificationId: 'notif',
    ...overrides,
  };
}

describe('Internal Routes', () => {
  const ctx = setupTestContext();

  describe('POST /internal/mobile-notifications/query', () => {
    it('returns 401 when x-internal-auth header is missing', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        payload: { userId: 'user-1' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.error.message).toContain('auth failed');
    });

    it('returns 401 when x-internal-auth token is invalid', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: { userId: 'user-1' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns empty notifications when user has none', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'user-empty' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: unknown[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toEqual([]);
    });

    it('returns notifications for user', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
      const userId = 'user-with-notifs';

      ctx.notificationRepo.addNotification({
        id: 'notif-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.whatsapp',
        title: 'Message from John',
        text: 'Hello there!',
        timestamp: Date.now(),
        postTime: '2025-01-01T10:00:00.000Z',
        receivedAt: '2025-01-01T10:00:00.000Z',
        notificationId: 'ext-1',
      });

      ctx.notificationRepo.addNotification({
        id: 'notif-2',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.gmail',
        title: 'New email',
        text: 'You have a new email',
        timestamp: Date.now(),
        postTime: '2025-01-01T11:00:00.000Z',
        receivedAt: '2025-01-01T11:00:00.000Z',
        notificationId: 'ext-2',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { id: string; app: string; title: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toHaveLength(2);
      expect(body.data.notifications[0]?.app).toBe('com.gmail');
      expect(body.data.notifications[1]?.app).toBe('com.whatsapp');
    });

    it('filters by app', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
      const userId = 'user-filter-app';

      ctx.notificationRepo.addNotification({
        id: 'notif-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.whatsapp',
        title: 'WhatsApp msg',
        text: 'Text',
        timestamp: Date.now(),
        postTime: '2025-01-01T10:00:00.000Z',
        receivedAt: '2025-01-01T10:00:00.000Z',
        notificationId: 'ext-1',
      });

      ctx.notificationRepo.addNotification({
        id: 'notif-2',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.gmail',
        title: 'Gmail msg',
        text: 'Text',
        timestamp: Date.now(),
        postTime: '2025-01-01T11:00:00.000Z',
        receivedAt: '2025-01-01T11:00:00.000Z',
        notificationId: 'ext-2',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId,
          filter: { app: ['com.whatsapp'] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { app: string }[] };
      };
      expect(body.data.notifications).toHaveLength(1);
      expect(body.data.notifications[0]?.app).toBe('com.whatsapp');
    });

    it('filters by source', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
      const userId = 'user-filter-source';

      ctx.notificationRepo.addNotification({
        id: 'notif-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'app1',
        title: 'Title 1',
        text: 'Text',
        timestamp: Date.now(),
        postTime: '2025-01-01T10:00:00.000Z',
        receivedAt: '2025-01-01T10:00:00.000Z',
        notificationId: 'ext-1',
      });

      ctx.notificationRepo.addNotification({
        id: 'notif-2',
        userId,
        source: 'ntfy',
        device: 'phone',
        app: 'app2',
        title: 'Title 2',
        text: 'Text',
        timestamp: Date.now(),
        postTime: '2025-01-01T11:00:00.000Z',
        receivedAt: '2025-01-01T11:00:00.000Z',
        notificationId: 'ext-2',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId,
          filter: { source: 'ntfy' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { source: string }[] };
      };
      expect(body.data.notifications).toHaveLength(1);
      expect(body.data.notifications[0]?.source).toBe('ntfy');
    });

    it('filters by title', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
      const userId = 'user-filter-title';

      ctx.notificationRepo.addNotification({
        id: 'notif-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'app1',
        title: 'Important meeting',
        text: 'Text',
        timestamp: Date.now(),
        postTime: '2025-01-01T10:00:00.000Z',
        receivedAt: '2025-01-01T10:00:00.000Z',
        notificationId: 'ext-1',
      });

      ctx.notificationRepo.addNotification({
        id: 'notif-2',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'app2',
        title: 'Random notification',
        text: 'Text',
        timestamp: Date.now(),
        postTime: '2025-01-01T11:00:00.000Z',
        receivedAt: '2025-01-01T11:00:00.000Z',
        notificationId: 'ext-2',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId,
          filter: { title: 'meeting' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { title: string }[] };
      };
      expect(body.data.notifications).toHaveLength(1);
      expect(body.data.notifications[0]?.title).toBe('Important meeting');
    });

    it('respects limit parameter', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
      const userId = 'user-limit';

      for (let i = 1; i <= 10; i++) {
        ctx.notificationRepo.addNotification({
          id: `notif-${String(i)}`,
          userId,
          source: 'tasker',
          device: 'phone',
          app: 'app',
          title: `Title ${String(i)}`,
          text: 'Text',
          timestamp: Date.now() + i,
          postTime: `2025-01-01T${String(i).padStart(2, '0')}:00:00.000Z`,
          receivedAt: `2025-01-01T${String(i).padStart(2, '0')}:00:00.000Z`,
          notificationId: `ext-${String(i)}`,
        });
      }

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId,
          limit: 3,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: unknown[] };
      };
      expect(body.data.notifications).toHaveLength(3);
    });

    it('returns 500 on repository failure', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

      ctx.notificationRepo.setFailNextFind(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'user-fail' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.error).toBeDefined();
    });

    it('maps notification fields correctly', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
      const userId = 'user-mapping';

      ctx.notificationRepo.addNotification({
        id: 'notif-map',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.test',
        title: 'Test Title',
        text: 'Test Body Text',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-map',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          notifications: {
            id: string;
            app: string;
            title: string;
            body: string;
            timestamp: string;
            source: string;
          }[];
        };
      };
      const notif = body.data.notifications[0];
      expect(notif?.id).toBe('notif-map');
      expect(notif?.app).toBe('com.test');
      expect(notif?.title).toBe('Test Title');
      expect(notif?.body).toBe('Test Body Text');
      expect(notif?.timestamp).toBe('2025-01-01T12:00:00.000Z');
      expect(notif?.source).toBe('tasker');
    });

    it('ignores empty filter values', async () => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
      const userId = 'user-empty-filter';

      ctx.notificationRepo.addNotification({
        id: 'notif-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'app1',
        title: 'Title',
        text: 'Text',
        timestamp: Date.now(),
        postTime: '2025-01-01T10:00:00.000Z',
        receivedAt: '2025-01-01T10:00:00.000Z',
        notificationId: 'ext-1',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/mobile-notifications/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId,
          filter: { app: [], source: '', title: '' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: unknown[] };
      };
      expect(body.data.notifications).toHaveLength(1);
    });
  });

  describe('Fishing Assistant evidence routes', () => {
    it('returns 401 when x-internal-auth header is missing', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digest-subscriptions/list',
        payload: { userId: 'u' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.message).toContain('auth');
    });

    it('returns 401 when x-internal-auth token is invalid', async () => {
      setInternalAuth();

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digest-subscriptions/list',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: { userId: 'u' },
      });

      expect(response.statusCode).toBe(401);
    });

    for (const route of [
      {
        name: 'digest query',
        url: '/internal/notifications/digests/query',
        payload: { userId: 'u', groupKey: 'g', dateFrom: '2026-04-15', dateTo: '2026-04-15' },
      },
      {
        name: 'digest get',
        url: '/internal/notifications/digests/get',
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      },
      {
        name: 'digest state get',
        url: '/internal/notifications/digest-state/get',
        payload: { userId: 'u', groupKey: 'g' },
      },
      {
        name: 'group messages query',
        url: '/internal/notifications/group-messages/query',
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      },
    ]) {
      it(`returns 401 when x-internal-auth header is missing for ${route.name}`, async () => {
        const response = await ctx.app.inject({
          method: 'POST',
          url: route.url,
          payload: route.payload,
        });

        expect(response.statusCode).toBe(401);
      });
    }

    it('lists only digest subscriptions owned by the requested user', async () => {
      setInternalAuth();
      setMockServices({
        notificationRepository: ctx.notificationRepo,
        digestSubscriptions: [
          { userId: 'u', groupKey: 'g', groupTitlePrefix: 'Group One', outputLanguage: 'Polish' },
          { userId: 'other', groupKey: 'hidden', groupTitlePrefix: 'Hidden Group', outputLanguage: 'English' },
        ],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digest-subscriptions/list',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SuccessResponse<{
        items: { groupKey: string; displayName: string }[];
      }>;
      expect(body.data.items).toEqual([{ groupKey: 'g', displayName: 'g' }]);
    });

    it('validates digest query date order', async () => {
      setInternalAuth();

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', dateFrom: '2026-04-16', dateTo: '2026-04-15' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('validates semantically invalid digest query dates', async () => {
      setInternalAuth();

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', dateFrom: '2026-02-30', dateTo: '2026-02-30' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.message).toContain('YYYY-MM-DD');
    });

    it('validates digest query subscription ownership', async () => {
      setInternalAuth();
      setMockServices({ notificationRepository: ctx.notificationRepo, digestSubscriptions: [] });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', dateFrom: '2026-04-15', dateTo: '2026-04-15' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 500 when digest range lookup fails', async () => {
      setInternalAuth();
      const digestRepository = makeDigestRepository({
        findInRange: async () => err({ code: 'INTERNAL_ERROR', message: 'digest range failed' }),
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, digestRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', dateFrom: '2026-04-15', dateTo: '2026-04-15' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.message).toContain('digest range failed');
    });

    it('queries digests in range and formats markdown evidence', async () => {
      setInternalAuth();
      let capturedInput: Parameters<DigestRepository['findInRange']>[0] | null = null;
      const summary = makeSummary();
      const digestRepository = makeDigestRepository({
        findInRange: async (input) => {
          capturedInput = input;
          return ok({
            items: [{ summary, generation: 1, generatedAt: '2026-04-15T20:00:00.000Z', modelId: 'm' }],
          });
        },
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, digestRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          dateFrom: '2026-04-15',
          dateTo: '2026-04-15',
          terms: ['spring'],
          limit: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedInput).toEqual({
        userId: 'u',
        groupKey: 'g',
        fromDate: '2026-04-15',
        toDate: '2026-04-15',
        limit: 10,
      });
      const body = JSON.parse(response.body) as SuccessResponse<{
        items: { title: string; summaryMarkdown: string; messageCount: number }[];
        truncated: boolean;
      }>;
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.title).toBe('Spring ground bait discussion');
      expect(body.data.items[0]?.summaryMarkdown).toContain('Ground bait worked in spring');
      expect(body.data.items[0]?.summaryMarkdown).toContain('Data: 2026-04-15');
      expect(body.data.items[0]?.summaryMarkdown).toContain('Wiadomości: 3');
      expect(body.data.items[0]?.summaryMarkdown).toContain('## Najważniejsze punkty');
      expect(body.data.items[0]?.summaryMarkdown).not.toContain('## Key points');
      expect(body.data.items[0]?.messageCount).toBe(3);
      expect(body.data.truncated).toBe(false);
    });

    it('propagates digest query cursor and returns nextCursor', async () => {
      setInternalAuth();
      let capturedInput: Parameters<DigestRepository['findInRange']>[0] | null = null;
      const digestRepository = makeDigestRepository({
        findInRange: async (input) => {
          capturedInput = input;
          return ok({
            items: [
              {
                summary: makeSummary(),
                generation: 1,
                generatedAt: '2026-04-15T20:00:00.000Z',
                modelId: 'm',
              },
            ],
            nextCursor: '2026-04-14',
          });
        },
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, digestRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          dateFrom: '2026-01-01',
          dateTo: '2026-04-15',
          limit: 10,
          cursor: '2026-04-15',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedInput).toEqual({
        userId: 'u',
        groupKey: 'g',
        fromDate: '2026-01-01',
        toDate: '2026-04-15',
        limit: 10,
        cursor: '2026-04-15',
      });
      const body = JSON.parse(response.body) as SuccessResponse<{
        items: { title: string }[];
        truncated: boolean;
        nextCursor?: string;
      }>;
      expect(body.data.nextCursor).toBe('2026-04-14');
      expect(body.data.truncated).toBe(true);
    });

    it('uses default digest query limit, skips empty terms, and formats optional markdown sections', async () => {
      setInternalAuth();
      const capturedInputs: Parameters<DigestRepository['findInRange']>[0][] = [];
      const summary = makeSummary({
        bullets: [],
        threads: [
          {
            topic: 'Loose feed',
            participants: ['Jan'],
            resolved: false,
            keyFacts: [],
          },
        ],
        moderatorPosts: [{ time: '18:20', topic: 'Bait', summary: 'Use less aroma in cold water' }],
        openQuestions: ['Which binder works best in March?'],
      });
      const digestRepository = makeDigestRepository({
        findInRange: async (input) => {
          capturedInputs.push(input);
          return ok({
            items: [
              { summary, generation: 1, generatedAt: '2026-04-15T20:00:00.000Z', modelId: 'm' },
              {
                summary: makeSummary({ bullets: [], threads: [] }),
                generation: 1,
                generatedAt: '2026-04-15T20:01:00.000Z',
                modelId: 'm',
              },
            ],
            nextCursor: 'next',
          });
        },
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, digestRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          dateFrom: '2026-04-15',
          dateTo: '2026-04-15',
          terms: ['   '],
        },
      });

      expect(response.statusCode).toBe(200);
      const capturedInput = capturedInputs[0];
      if (capturedInput === undefined) throw new Error('Expected digest query input to be captured');
      expect(capturedInput.limit).toBe(30);
      const body = JSON.parse(response.body) as SuccessResponse<{
        items: { summaryMarkdown: string }[];
        truncated: boolean;
      }>;
      expect(body.data.items[0]?.summaryMarkdown).toContain('## Wpisy moderatorów');
      expect(body.data.items[0]?.summaryMarkdown).toContain('## Otwarte pytania');
      expect(body.data.items[0]?.summaryMarkdown).toContain('- Loose feed');
      expect(body.data.truncated).toBe(true);
    });

    it('returns 404 when a digest is missing', async () => {
      setInternalAuth();
      const digestRepository = makeDigestRepository({
        findByDate: async () => ok(null),
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, digestRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns one digest by date', async () => {
      setInternalAuth();
      const summary = makeSummary();
      const digestRepository = makeDigestRepository({
        findByDate: async (input) => {
          expect(input).toEqual({ userId: 'u', groupKey: 'g', date: '2026-04-15' });
          return ok({ summary, generation: 1, generatedAt: '2026-04-15T20:00:00.000Z', modelId: 'm' });
        },
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, digestRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SuccessResponse<{
        groupKey: string;
        title: string;
        summaryMarkdown: string;
      }>;
      expect(body.data.groupKey).toBe('g');
      expect(body.data.title).toBe('Spring ground bait discussion');
      expect(body.data.summaryMarkdown).toContain('Data: 2026-04-15');
      expect(body.data.summaryMarkdown).toContain('Wiadomości: 3');
      expect(body.data.summaryMarkdown).toContain('## Najważniejsze punkty');
      expect(body.data.summaryMarkdown).not.toContain('## Key points');
    });

    it('validates digest get dates', async () => {
      setInternalAuth();

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-02-30' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('validates digest get subscription ownership', async () => {
      setInternalAuth();
      setMockServices({ notificationRepository: ctx.notificationRepo, digestSubscriptions: [] });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 500 when digest get lookup fails', async () => {
      setInternalAuth();
      const digestRepository = makeDigestRepository({
        findByDate: async () => err({ code: 'INTERNAL_ERROR', message: 'digest get failed' }),
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, digestRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digests/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.message).toContain('digest get failed');
    });

    it('returns 404 when latest group state is missing', async () => {
      setInternalAuth();
      const groupStateRepository = makeGroupStateRepository({
        getLatest: async () => ok(null),
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, groupStateRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digest-state/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns latest group state', async () => {
      setInternalAuth();
      const state = makeGroupState();
      const groupStateRepository = makeGroupStateRepository({
        getLatest: async (input) => {
          expect(input).toEqual({ userId: 'u', groupKey: 'g' });
          return ok(state);
        },
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, groupStateRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digest-state/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SuccessResponse<GroupState>;
      expect(body.data.recentSummaryDates).toEqual(['2026-04-15']);
    });

    it('validates digest state subscription ownership', async () => {
      setInternalAuth();
      setMockServices({ notificationRepository: ctx.notificationRepo, digestSubscriptions: [] });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digest-state/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 500 when digest state lookup fails', async () => {
      setInternalAuth();
      const groupStateRepository = makeGroupStateRepository({
        getLatest: async () => err({ code: 'INTERNAL_ERROR', message: 'state lookup failed' }),
      });
      setMockServices({ notificationRepository: ctx.notificationRepo, groupStateRepository });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/digest-state/get',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.message).toContain('state lookup failed');
    });

    it('requires a date or date range for group-message queries', async () => {
      setInternalAuth();

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects group-message queries that mix single date and range', async () => {
      setInternalAuth();

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          date: '2026-04-15',
          dateFrom: '2026-04-15',
          dateTo: '2026-04-16',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.message).toContain('either date or dateFrom/dateTo');
    });

    it('validates semantically invalid group-message dates', async () => {
      setInternalAuth();

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-02-30' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('accepts long historical group-message ranges', async () => {
      setInternalAuth();
      setMockServices({
        notificationRepository: ctx.notificationRepo,
        digestSubscriptions: [
          {
            userId: 'u',
            groupKey: 'g',
            groupTitlePrefix: 'G fishing chat',
            outputLanguage: 'Polish',
          },
        ],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          dateFrom: '2026-04-01',
          dateTo: '2026-05-15',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SuccessResponse<{ messages: unknown[] }>;
      expect(body.data.messages).toEqual([]);
    });

    it('validates group-message subscription ownership', async () => {
      setInternalAuth();
      setMockServices({
        notificationRepository: ctx.notificationRepo,
        digestSubscriptions: [{ userId: 'other', groupKey: 'g', groupTitlePrefix: 'G', outputLanguage: 'Polish' }],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('filters, cleans, deduplicates, and term-filters group messages', async () => {
      setInternalAuth();
      const bounds = cetDayBounds('2026-04-15');
      const firstMessageSec = bounds.fromSec + 3600;
      const secondMessageSec = bounds.fromSec + 5400;

      const addNotification = (
        id: string,
        overrides: Partial<Parameters<NotificationRepository['save']>[0]> & { receivedAt?: string }
      ): void => {
        ctx.notificationRepo.addNotification({
          id,
          userId: 'u',
          source: 'tasker',
          device: 'phone',
          app: 'com.whatsapp',
          title: 'G fishing chat',
          text: 'Spring ground bait with bread cloud',
          timestamp: firstMessageSec,
          postTime: String(firstMessageSec),
          receivedAt: new Date(firstMessageSec * 1000).toISOString(),
          notificationId: id,
          ...overrides,
        });
      };

      addNotification('meta', { text: '(3 new messages)', timestamp: firstMessageSec, postTime: String(firstMessageSec) });
      addNotification('kept', { text: 'Spring ground bait with bread cloud', timestamp: firstMessageSec, postTime: String(firstMessageSec) });
      addNotification('duplicate', { text: 'Spring ground bait with bread cloud', timestamp: firstMessageSec + 30, postTime: String(firstMessageSec + 30) });
      addNotification('term-drop', { text: 'Winter boilies only', timestamp: secondMessageSec, postTime: String(secondMessageSec) });
      addNotification('wrong-title', { title: 'Other group', text: 'Spring ground bait hidden', timestamp: firstMessageSec, postTime: String(firstMessageSec) });
      addNotification('wrong-app', { app: 'com.gmail', text: 'Spring ground bait hidden', timestamp: firstMessageSec, postTime: String(firstMessageSec) });
      addNotification('wrong-day', { text: 'Spring ground bait outside range', timestamp: bounds.fromSec - 60, postTime: String(bounds.fromSec - 60) });
      setMockServices({
        notificationRepository: ctx.notificationRepo,
        digestSubscriptions: [{ userId: 'u', groupKey: 'g', groupTitlePrefix: 'G fishing chat', outputLanguage: 'Polish' }],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          date: '2026-04-15',
          terms: ['spring'],
          limit: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SuccessResponse<{
        messages: {
          messageRef: string;
          groupKey: string;
          date: string;
          postTimeSec: number;
          text: string;
          quote: string;
          senderLabel?: string | null;
        }[];
        totalRaw: number;
        totalCleaned: number;
        returned: number;
        truncated: boolean;
      }>;
      expect(body.data.totalRaw).toBe(4);
      expect(body.data.totalCleaned).toBe(2);
      expect(body.data.returned).toBe(1);
      expect(body.data.truncated).toBe(false);
      expect(body.data.messages).toEqual([
        {
          messageRef: expect.stringContaining('g:2026-04-15:') as string,
          groupKey: 'g',
          date: '2026-04-15',
          postTimeSec: firstMessageSec,
          senderLabel: null,
          text: 'Spring ground bait with bread cloud',
          quote: 'Spring ground bait with bread cloud',
        },
      ]);
    });

    it('returns 500 when group-message notification lookup fails', async () => {
      setInternalAuth();
      ctx.notificationRepo.setFailNextFind(true);
      setMockServices({
        notificationRepository: ctx.notificationRepo,
        digestSubscriptions: [{ userId: 'u', groupKey: 'g', groupTitlePrefix: 'G fishing chat', outputLanguage: 'Polish' }],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.message).toContain('Simulated find failure');
    });

    it('uses default group-message limit, matches without terms, and truncates long quotes', async () => {
      setInternalAuth();
      const bounds = cetDayBounds('2026-04-15');
      const longText = `${'Spring bait '.repeat(30)}final note`;
      ctx.notificationRepo.addNotification({
        id: 'long',
        userId: 'u',
        source: 'tasker',
        device: 'phone',
        app: 'com.whatsapp',
        title: 'G fishing chat',
        text: longText,
        timestamp: bounds.fromSec + 3600,
        postTime: String(bounds.fromSec + 3600),
        receivedAt: new Date((bounds.fromSec + 3600) * 1000).toISOString(),
        notificationId: 'long',
      });
      setMockServices({
        notificationRepository: ctx.notificationRepo,
        digestSubscriptions: [{ userId: 'u', groupKey: 'g', groupTitlePrefix: 'G fishing chat', outputLanguage: 'Polish' }],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SuccessResponse<{
        messages: { quote: string; senderLabel: string | null }[];
        returned: number;
      }>;
      expect(body.data.returned).toBe(1);
      expect(body.data.messages[0]?.quote).toHaveLength(240);
      expect(body.data.messages[0]?.quote.endsWith('...')).toBe(true);
      expect(body.data.messages[0]?.senderLabel).toBeNull();
    });

    it('stops group-message scanning when a repository cursor repeats', async () => {
      setInternalAuth();
      const bounds = cetDayBounds('2026-04-15');
      const calls: PaginationOptions[] = [];
      const notificationRepository: NotificationRepository = {
        save: ctx.notificationRepo.save.bind(ctx.notificationRepo),
        findById: ctx.notificationRepo.findById.bind(ctx.notificationRepo),
        findByUserIdPaginated: async (_userId, options) => {
          calls.push(options);
          return ok({
            notifications: [makeNotification({ id: 'first', text: 'First spring bait', timestamp: bounds.fromSec + 1, postTime: String(bounds.fromSec + 1) })],
            nextCursor: 'next-page',
          });
        },
        existsByNotificationIdAndUserId: ctx.notificationRepo.existsByNotificationIdAndUserId.bind(ctx.notificationRepo),
        delete: ctx.notificationRepo.delete.bind(ctx.notificationRepo),
      };
      setMockServices({
        notificationRepository,
        digestSubscriptions: [{ userId: 'u', groupKey: 'g', groupTitlePrefix: 'G fishing chat', outputLanguage: 'Polish' }],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
      });

      expect(response.statusCode).toBe(200);
      expect(calls).toHaveLength(2);
      const body = JSON.parse(response.body) as SuccessResponse<{
        nextCursor?: string;
        truncated: boolean;
      }>;
      expect(body.data.nextCursor).toBeUndefined();
      expect(body.data.truncated).toBe(true);
    });

    it('propagates group-message cursor and returns nextCursor', async () => {
      setInternalAuth();
      const bounds = cetDayBounds('2026-04-15');
      const capturedOptions: PaginationOptions[] = [];
      const notificationRepository: NotificationRepository = {
        save: ctx.notificationRepo.save.bind(ctx.notificationRepo),
        findById: ctx.notificationRepo.findById.bind(ctx.notificationRepo),
        findByUserIdPaginated: async (_userId, options) => {
          capturedOptions.push(options);
          return ok({
            notifications: [
              makeNotification({
                id: 'first',
                text: 'Spring bait',
                timestamp: bounds.fromSec + 1,
                postTime: String(bounds.fromSec + 1),
              }),
            ],
            nextCursor: 'raw-cursor-2',
          });
        },
        existsByNotificationIdAndUserId:
          ctx.notificationRepo.existsByNotificationIdAndUserId.bind(ctx.notificationRepo),
        delete: ctx.notificationRepo.delete.bind(ctx.notificationRepo),
      };
      setMockServices({
        notificationRepository,
        digestSubscriptions: [
          {
            userId: 'u',
            groupKey: 'g',
            groupTitlePrefix: 'G fishing chat',
            outputLanguage: 'Polish',
          },
        ],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          date: '2026-04-15',
          limit: 1,
          cursor: 'raw-cursor-1',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedOptions[0]?.cursor).toBe('raw-cursor-1');
      const body = JSON.parse(response.body) as SuccessResponse<{
        messages: { text: string }[];
        truncated: boolean;
        nextCursor?: string;
      }>;
      expect(body.data.messages).toHaveLength(1);
      expect(body.data.nextCursor).toBeDefined();
      expect(body.data.truncated).toBe(true);

      const nextCursor = body.data.nextCursor;
      if (nextCursor === undefined) throw new Error('Expected nextCursor to be defined');
      const secondResponse = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          date: '2026-04-15',
          limit: 1,
          cursor: nextCursor,
        },
      });

      expect(secondResponse.statusCode).toBe(200);
      expect(capturedOptions[1]?.cursor).toBe('raw-cursor-2');
    });

    it('uses buffered route cursors when a raw page has more matches than the response limit', async () => {
      setInternalAuth();
      const bounds = cetDayBounds('2026-04-15');
      const firstMessageSec = bounds.fromSec + 100;
      const secondMessageSec = bounds.fromSec + 200;
      const notificationRepository: NotificationRepository = {
        save: ctx.notificationRepo.save.bind(ctx.notificationRepo),
        findById: ctx.notificationRepo.findById.bind(ctx.notificationRepo),
        findByUserIdPaginated: async () =>
          ok({
            notifications: [
              makeNotification({
                id: 'newer',
                text: 'Newer spring bait',
                timestamp: secondMessageSec,
                postTime: String(secondMessageSec),
              }),
              makeNotification({
                id: 'older',
                text: 'Older spring bait',
                timestamp: firstMessageSec,
                postTime: String(firstMessageSec),
              }),
            ],
          }),
        existsByNotificationIdAndUserId:
          ctx.notificationRepo.existsByNotificationIdAndUserId.bind(ctx.notificationRepo),
        delete: ctx.notificationRepo.delete.bind(ctx.notificationRepo),
      };
      setMockServices({
        notificationRepository,
        digestSubscriptions: [
          {
            userId: 'u',
            groupKey: 'g',
            groupTitlePrefix: 'G fishing chat',
            outputLanguage: 'Polish',
          },
        ],
      });

      const firstResponse = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15', limit: 1 },
      });

      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body) as SuccessResponse<{
        messages: { text: string }[];
        nextCursor?: string;
        truncated: boolean;
      }>;
      expect(firstBody.data.messages).toEqual([expect.objectContaining({ text: 'Older spring bait' })]);
      expect(firstBody.data.nextCursor).toBeDefined();
      expect(firstBody.data.truncated).toBe(true);

      const cursor = firstBody.data.nextCursor;
      if (cursor === undefined) throw new Error('Expected nextCursor to be defined');
      const secondResponse = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { userId: 'u', groupKey: 'g', date: '2026-04-15', limit: 1, cursor },
      });

      expect(secondResponse.statusCode).toBe(200);
      const secondBody = JSON.parse(secondResponse.body) as SuccessResponse<{
        messages: { text: string }[];
        nextCursor?: string;
        truncated: boolean;
      }>;
      expect(secondBody.data.messages).toEqual([expect.objectContaining({ text: 'Newer spring bait' })]);
      expect(secondBody.data.nextCursor).toBeUndefined();
      expect(secondBody.data.truncated).toBe(false);
    });

    it('pages long historical group-message ranges through the route and repository', async () => {
      setInternalAuth();
      const bounds = cetDayBounds('2026-04-15');
      const newestMessageSec = bounds.fromSec + 3600;
      const notifications = Array.from({ length: 501 }, (_, index) =>
        makeNotification({
          id: `history-${String(index)}`,
          notificationId: `history-${String(index)}`,
          text: `Spring bait page ${String(index)}`,
          timestamp: newestMessageSec - index,
          postTime: String(newestMessageSec - index),
          receivedAt: new Date((newestMessageSec - index) * 1000).toISOString(),
        })
      );
      const capturedOptions: PaginationOptions[] = [];
      const notificationRepository: NotificationRepository = {
        save: ctx.notificationRepo.save.bind(ctx.notificationRepo),
        findById: ctx.notificationRepo.findById.bind(ctx.notificationRepo),
        findByUserIdPaginated: async (_userId, options) => {
          capturedOptions.push(options);
          const ordered = notifications
            .filter((notification) => notification.timestamp >= (options.filter?.postTimeSecFrom ?? 0))
            .filter((notification) => notification.timestamp < (options.filter?.postTimeSecTo ?? Number.MAX_SAFE_INTEGER))
            .sort((a, b) => b.timestamp - a.timestamp);
          const cursorIndex =
            options.cursor === undefined
              ? -1
              : ordered.findIndex((notification) => notification.id === options.cursor);
          const page = ordered.slice(cursorIndex + 1, cursorIndex + 1 + options.limit);
          const result: { notifications: Notification[]; nextCursor?: string } = {
            notifications: page,
          };
          const last = page[page.length - 1];
          if (last !== undefined && ordered[cursorIndex + 1 + options.limit] !== undefined) {
            result.nextCursor = last.id;
          }
          return ok(result);
        },
        existsByNotificationIdAndUserId:
          ctx.notificationRepo.existsByNotificationIdAndUserId.bind(ctx.notificationRepo),
        delete: ctx.notificationRepo.delete.bind(ctx.notificationRepo),
      };
      setMockServices({
        notificationRepository,
        digestSubscriptions: [
          {
            userId: 'u',
            groupKey: 'g',
            groupTitlePrefix: 'G fishing chat',
            outputLanguage: 'Polish',
          },
        ],
      });

      const firstResponse = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          dateFrom: '2026-01-01',
          dateTo: '2026-04-30',
          terms: ['spring'],
          limit: 1,
          cursor: 'raw-start',
        },
      });

      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body) as SuccessResponse<{
        messages: { text: string; postTimeSec: number }[];
        nextCursor?: string;
        truncated: boolean;
      }>;
      expect(firstBody.data.messages).toEqual([
        expect.objectContaining({
          text: 'Spring bait page 499',
          postTimeSec: newestMessageSec - 499,
        }),
      ]);
      expect(capturedOptions[0]?.limit).toBe(500);
      expect(capturedOptions[0]?.cursor).toBe('raw-start');
      expect(firstBody.data.nextCursor).toBeDefined();
      expect(firstBody.data.truncated).toBe(true);

      const cursor = firstBody.data.nextCursor;
      if (cursor === undefined) throw new Error('Expected nextCursor to be defined');
      const secondResponse = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          dateFrom: '2026-01-01',
          dateTo: '2026-04-30',
          terms: ['spring'],
          limit: 1,
          cursor,
        },
      });

      expect(secondResponse.statusCode).toBe(200);
      const secondBody = JSON.parse(secondResponse.body) as SuccessResponse<{
        messages: { text: string; postTimeSec: number }[];
        nextCursor?: string;
        truncated: boolean;
      }>;
      expect(secondBody.data.messages).toEqual([
        expect.objectContaining({
          text: 'Spring bait page 498',
          postTimeSec: newestMessageSec - 498,
        }),
      ]);
      expect(capturedOptions[1]?.limit).toBe(500);
      expect(secondBody.data.nextCursor).toBeDefined();
      expect(secondBody.data.truncated).toBe(true);
    });

    it('marks group-message scans truncated when raw notification scan cap is reached', async () => {
      setInternalAuth();
      const bounds = cetDayBounds('2026-04-15');
      const notifications = Array.from({ length: 5000 }, (_, index) =>
        makeNotification({
          id: `scan-${String(index)}`,
          notificationId: `scan-${String(index)}`,
          text: `Spring bait ${String(index)}`,
          timestamp: bounds.fromSec + index,
          postTime: String(bounds.fromSec + index),
          receivedAt: new Date((bounds.fromSec + index) * 1000).toISOString(),
        })
      );
      const capturedOptions: PaginationOptions[] = [];
      const notificationRepository: NotificationRepository = {
        save: ctx.notificationRepo.save.bind(ctx.notificationRepo),
        findById: ctx.notificationRepo.findById.bind(ctx.notificationRepo),
        findByUserIdPaginated: async (_userId, options) => {
          capturedOptions.push(options);
          const start = options.cursor === undefined ? 0 : Number(options.cursor);
          const page = notifications.slice(start, start + options.limit);
          return ok({
            notifications: page,
            nextCursor: String(start + options.limit),
          });
        },
        existsByNotificationIdAndUserId: ctx.notificationRepo.existsByNotificationIdAndUserId.bind(ctx.notificationRepo),
        delete: ctx.notificationRepo.delete.bind(ctx.notificationRepo),
      };
      setMockServices({
        notificationRepository,
        digestSubscriptions: [{ userId: 'u', groupKey: 'g', groupTitlePrefix: 'G fishing chat', outputLanguage: 'Polish' }],
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notifications/group-messages/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'u',
          groupKey: 'g',
          date: '2026-04-15',
          terms: ['no-match'],
          limit: 1,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SuccessResponse<{
        totalRaw: number;
        truncated: boolean;
      }>;
      expect(body.data.totalRaw).toBe(5000);
      expect(body.data.truncated).toBe(true);
      expect(capturedOptions).toHaveLength(10);
      expect(capturedOptions.every((options) => options.limit === 500)).toBe(true);
    });
  });
});
