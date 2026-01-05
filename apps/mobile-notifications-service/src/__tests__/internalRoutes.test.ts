/**
 * Tests for internal routes (service-to-service communication).
 */
import { describe, expect, it, setupTestContext } from './testUtils.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

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
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
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
          filter: { source: ['ntfy'] },
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
      const body = JSON.parse(response.body) as { error: string };
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

    it('ignores empty filter arrays', async () => {
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
          filter: { app: [], source: [], title: '' },
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
});
