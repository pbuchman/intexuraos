/**
 * Tests for internal routes (service-to-service communication).
 */
import { describe, expect, it, setupTestContext } from './testUtils.js';
import { ok } from '@intexuraos/common-core';
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
import type { NotificationRepository } from '../domain/notifications/index.js';

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

    it('lists only digest subscriptions owned by the requested user', async () => {
      setInternalAuth();
      setMockServices({
        notificationRepository: ctx.notificationRepo,
        digestSubscriptions: [
          { userId: 'u', groupKey: 'g', groupTitlePrefix: 'Group One' },
          { userId: 'other', groupKey: 'hidden', groupTitlePrefix: 'Hidden Group' },
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
      expect(body.data.items[0]?.messageCount).toBe(3);
      expect(body.data.truncated).toBe(false);
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

    it('rejects group-message ranges that are too large', async () => {
      setInternalAuth();

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

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as ErrorResponse;
      expect(body.error.message).toContain('range');
    });

    it('validates group-message subscription ownership', async () => {
      setInternalAuth();
      setMockServices({
        notificationRepository: ctx.notificationRepo,
        digestSubscriptions: [{ userId: 'other', groupKey: 'g', groupTitlePrefix: 'G' }],
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
        digestSubscriptions: [{ userId: 'u', groupKey: 'g', groupTitlePrefix: 'G fishing chat' }],
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
          text: 'Spring ground bait with bread cloud',
          quote: 'Spring ground bait with bread cloud',
        },
      ]);
    });
  });
});
