/**
 * Tests for authenticated routes with proper JWT handling.
 * Tests statusRoutes, connectRoutes, and notificationRoutes.
 */
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';
import { hashSignature } from '../domain/notifications/index.js';

describe('Authenticated Routes', () => {
  const ctx = setupTestContext();

  describe('GET /mobile-notifications/status', () => {
    it('returns configured: false when no signature exists', async () => {
      const token = await createToken({ sub: 'user-no-config' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { configured: boolean; lastNotificationAt: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.configured).toBe(false);
      expect(body.data.lastNotificationAt).toBeNull();
    });

    it('returns configured: true when signature exists', async () => {
      const userId = 'user-configured';
      const token = await createToken({ sub: userId });

      // Add signature connection
      await ctx.signatureRepo.save({
        userId,
        signatureHash: hashSignature('test-signature'),
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { configured: boolean; lastNotificationAt: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.configured).toBe(true);
    });

    it('returns lastNotificationAt when notifications exist', async () => {
      const userId = 'user-with-notif';
      const token = await createToken({ sub: userId });
      const receivedAt = '2025-01-01T12:00:00.000Z';

      // Add signature connection
      await ctx.signatureRepo.save({
        userId,
        signatureHash: hashSignature('test-signature'),
      });

      // Add notification
      ctx.notificationRepo.addNotification({
        id: 'notif-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: 'Test',
        text: 'Body',
        timestamp: Date.now(),
        postTime: receivedAt,
        receivedAt,
        notificationId: 'notif-ext-1',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { configured: boolean; lastNotificationAt: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.lastNotificationAt).toBe(receivedAt);
    });

    it('returns 500 on repository failure', async () => {
      const token = await createToken({ sub: 'user-fail' });
      ctx.signatureRepo.setFailNextExists(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 on notification repository failure', async () => {
      const userId = 'user-notif-fail';
      const token = await createToken({ sub: userId });

      // Add signature connection so we reach the notification repository call
      await ctx.signatureRepo.save({
        userId,
        signatureHash: hashSignature('test-signature'),
      });

      // Make notification repository fail
      ctx.notificationRepo.setFailNextFind(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Simulated find failure');
    });
  });

  describe('POST /mobile-notifications/connect', () => {
    it('creates connection and returns signature', async () => {
      const token = await createToken({ sub: 'user-connect' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/mobile-notifications/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: { deviceLabel: 'My Phone' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { signature: string; connectionId: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.signature).toBeDefined();
      expect(body.data.connectionId).toBeDefined();
    });

    it('creates connection without device label', async () => {
      const token = await createToken({ sub: 'user-connect-no-label' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/mobile-notifications/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { signature: string; connectionId: string };
      };
      expect(body.success).toBe(true);
    });

    it('returns 500 on repository failure', async () => {
      const token = await createToken({ sub: 'user-connect-fail' });
      ctx.signatureRepo.setFailNextSave(true);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/mobile-notifications/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
    });
  });

  describe('GET /mobile-notifications', () => {
    it('returns empty list when no notifications', async () => {
      const token = await createToken({ sub: 'user-list-empty' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: unknown[]; nextCursor?: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toEqual([]);
      // nextCursor may be undefined or null when no results
      expect(body.data.nextCursor === undefined || body.data.nextCursor === null).toBe(true);
    });

    it('returns notifications for user', async () => {
      const userId = 'user-list-has';
      const token = await createToken({ sub: userId });

      ctx.notificationRepo.addNotification({
        id: 'notif-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: 'Test Title',
        text: 'Test Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-1',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { id: string; title: string }[]; nextCursor: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toHaveLength(1);
      expect(body.data.notifications[0]?.title).toBe('Test Title');
    });

    it('respects limit parameter', async () => {
      const userId = 'user-list-limit';
      const token = await createToken({ sub: userId });

      // Add multiple notifications
      for (let i = 0; i < 5; i++) {
        ctx.notificationRepo.addNotification({
          id: `notif-${String(i)}`,
          userId,
          source: 'tasker',
          device: 'phone',
          app: 'com.example',
          title: `Title ${String(i)}`,
          text: 'Body',
          timestamp: Date.now() + i,
          postTime: '2025-01-01T12:00:00.000Z',
          receivedAt: new Date(Date.now() + i).toISOString(),
          notificationId: `ext-${String(i)}`,
        });
      }

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications?limit=2',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: unknown[]; nextCursor: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toHaveLength(2);
    });

    it('returns 500 on repository failure', async () => {
      const token = await createToken({ sub: 'user-list-fail' });
      ctx.notificationRepo.setFailNextFind(true);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });

    it('uses cursor parameter for pagination', async () => {
      const userId = 'user-list-cursor';
      const token = await createToken({ sub: userId });

      // Add multiple notifications
      for (let i = 0; i < 5; i++) {
        ctx.notificationRepo.addNotification({
          id: `notif-cursor-${String(i)}`,
          userId,
          source: 'tasker',
          device: 'phone',
          app: 'com.example',
          title: `Title ${String(i)}`,
          text: 'Body',
          timestamp: Date.now() + i,
          postTime: '2025-01-01T12:00:00.000Z',
          receivedAt: new Date(Date.now() + i).toISOString(),
          notificationId: `ext-cursor-${String(i)}`,
        });
      }

      // First request with limit to get a cursor
      const firstResponse = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications?limit=2',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body) as {
        success: boolean;
        data: { notifications: unknown[]; nextCursor: string | null };
      };
      expect(firstBody.success).toBe(true);
      expect(firstBody.data.notifications).toHaveLength(2);

      // If there's a cursor, use it for the next request
      if (firstBody.data.nextCursor !== null) {
        const secondResponse = await ctx.app.inject({
          method: 'GET',
          url: `/mobile-notifications?limit=2&cursor=${encodeURIComponent(firstBody.data.nextCursor)}`,
          headers: { authorization: `Bearer ${token}` },
        });

        expect(secondResponse.statusCode).toBe(200);
        const secondBody = JSON.parse(secondResponse.body) as {
          success: boolean;
          data: { notifications: unknown[]; nextCursor: string | null };
        };
        expect(secondBody.success).toBe(true);
        expect(secondBody.data.notifications).toHaveLength(2);
      }
    });

    it('filters by source parameter', async () => {
      const userId = 'user-filter-source';
      const token = await createToken({ sub: userId });

      ctx.notificationRepo.addNotification({
        id: 'notif-tasker-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.whatsapp',
        title: 'Tasker Notification',
        text: 'Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-1',
      });
      ctx.notificationRepo.addNotification({
        id: 'notif-automate-1',
        userId,
        source: 'automate',
        device: 'phone',
        app: 'com.slack',
        title: 'Automate Notification',
        text: 'Body',
        timestamp: Date.now() + 1,
        postTime: '2025-01-01T12:00:01.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        notificationId: 'ext-2',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications?source=tasker',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { source: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toHaveLength(1);
      expect(body.data.notifications[0]?.source).toBe('tasker');
    });

    it('filters by app parameter', async () => {
      const userId = 'user-filter-app';
      const token = await createToken({ sub: userId });

      ctx.notificationRepo.addNotification({
        id: 'notif-whatsapp-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.whatsapp',
        title: 'WhatsApp Notification',
        text: 'Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-1',
      });
      ctx.notificationRepo.addNotification({
        id: 'notif-slack-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.slack',
        title: 'Slack Notification',
        text: 'Body',
        timestamp: Date.now() + 1,
        postTime: '2025-01-01T12:00:01.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        notificationId: 'ext-2',
      });
      ctx.notificationRepo.addNotification({
        id: 'notif-slack-2',
        userId,
        source: 'automate',
        device: 'tablet',
        app: 'com.slack',
        title: 'Slack Notification 2',
        text: 'Body',
        timestamp: Date.now() + 2,
        postTime: '2025-01-01T12:00:02.000Z',
        receivedAt: '2025-01-01T12:00:02.000Z',
        notificationId: 'ext-3',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications?app=com.slack',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { app: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toHaveLength(2);
      expect(body.data.notifications.every((n) => n.app === 'com.slack')).toBe(true);
    });

    it('filters by both source and app parameters (multi-filter)', async () => {
      const userId = 'user-multi-filter';
      const token = await createToken({ sub: userId });

      ctx.notificationRepo.addNotification({
        id: 'notif-match-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.slack',
        title: 'Match',
        text: 'Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-match-1',
      });
      ctx.notificationRepo.addNotification({
        id: 'notif-wrong-source',
        userId,
        source: 'automate',
        device: 'phone',
        app: 'com.slack',
        title: 'Wrong Source',
        text: 'Body',
        timestamp: Date.now() + 1,
        postTime: '2025-01-01T12:00:01.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        notificationId: 'ext-wrong-source',
      });
      ctx.notificationRepo.addNotification({
        id: 'notif-wrong-app',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.whatsapp',
        title: 'Wrong App',
        text: 'Body',
        timestamp: Date.now() + 2,
        postTime: '2025-01-01T12:00:02.000Z',
        receivedAt: '2025-01-01T12:00:02.000Z',
        notificationId: 'ext-wrong-app',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications?source=tasker&app=com.slack',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { source: string; app: string; title: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toHaveLength(1);
      expect(body.data.notifications[0]?.source).toBe('tasker');
      expect(body.data.notifications[0]?.app).toBe('com.slack');
    });

    it('filters by title parameter (case-insensitive partial match)', async () => {
      const userId = 'user-title-filter';
      const token = await createToken({ sub: userId });

      ctx.notificationRepo.addNotification({
        id: 'notif-title-1',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: 'Important Meeting Reminder',
        text: 'Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-title-1',
      });
      ctx.notificationRepo.addNotification({
        id: 'notif-title-2',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: 'Quick Update',
        text: 'Body',
        timestamp: Date.now() + 1,
        postTime: '2025-01-01T12:00:01.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        notificationId: 'ext-title-2',
      });
      ctx.notificationRepo.addNotification({
        id: 'notif-title-3',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: 'Meeting Notes',
        text: 'Body',
        timestamp: Date.now() + 2,
        postTime: '2025-01-01T12:00:02.000Z',
        receivedAt: '2025-01-01T12:00:02.000Z',
        notificationId: 'ext-title-3',
      });

      // Case-insensitive search for "meeting"
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications?title=MEETING',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { title: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toHaveLength(2);
      expect(body.data.notifications.every((n) => n.title.toLowerCase().includes('meeting'))).toBe(
        true
      );
    });

    it('filters by all three parameters (source, app, title)', async () => {
      const userId = 'user-all-filters';
      const token = await createToken({ sub: userId });

      ctx.notificationRepo.addNotification({
        id: 'notif-all-match',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.slack',
        title: 'Urgent Message',
        text: 'Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-all-match',
      });
      ctx.notificationRepo.addNotification({
        id: 'notif-wrong-title',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.slack',
        title: 'Normal Alert',
        text: 'Body',
        timestamp: Date.now() + 1,
        postTime: '2025-01-01T12:00:01.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        notificationId: 'ext-wrong-title',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications?source=tasker&app=com.slack&title=urgent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { notifications: { title: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications).toHaveLength(1);
      expect(body.data.notifications[0]?.title).toBe('Urgent Message');
    });

    it('filter with pagination works correctly', async () => {
      const userId = 'user-filter-pagination';
      const token = await createToken({ sub: userId });

      // Add 4 tasker notifications and 2 automate notifications
      for (let i = 0; i < 4; i++) {
        ctx.notificationRepo.addNotification({
          id: `notif-tasker-pg-${String(i)}`,
          userId,
          source: 'tasker',
          device: 'phone',
          app: 'com.example',
          title: `Tasker ${String(i)}`,
          text: 'Body',
          timestamp: Date.now() + i,
          postTime: '2025-01-01T12:00:00.000Z',
          receivedAt: new Date(Date.now() + i).toISOString(),
          notificationId: `ext-tasker-${String(i)}`,
        });
      }
      for (let i = 0; i < 2; i++) {
        ctx.notificationRepo.addNotification({
          id: `notif-automate-pg-${String(i)}`,
          userId,
          source: 'automate',
          device: 'phone',
          app: 'com.example',
          title: `Automate ${String(i)}`,
          text: 'Body',
          timestamp: Date.now() + 10 + i,
          postTime: '2025-01-01T12:00:00.000Z',
          receivedAt: new Date(Date.now() + 10 + i).toISOString(),
          notificationId: `ext-automate-${String(i)}`,
        });
      }

      // First page with source filter
      const firstResponse = await ctx.app.inject({
        method: 'GET',
        url: '/mobile-notifications?source=tasker&limit=2',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body) as {
        success: boolean;
        data: { notifications: { source: string }[]; nextCursor: string | null };
      };
      expect(firstBody.success).toBe(true);
      expect(firstBody.data.notifications).toHaveLength(2);
      expect(firstBody.data.notifications.every((n) => n.source === 'tasker')).toBe(true);

      // Second page with same filter
      if (firstBody.data.nextCursor !== null) {
        const secondResponse = await ctx.app.inject({
          method: 'GET',
          url: `/mobile-notifications?source=tasker&limit=2&cursor=${encodeURIComponent(firstBody.data.nextCursor)}`,
          headers: { authorization: `Bearer ${token}` },
        });

        expect(secondResponse.statusCode).toBe(200);
        const secondBody = JSON.parse(secondResponse.body) as {
          success: boolean;
          data: { notifications: { source: string }[] };
        };
        expect(secondBody.success).toBe(true);
        expect(secondBody.data.notifications).toHaveLength(2);
        expect(secondBody.data.notifications.every((n) => n.source === 'tasker')).toBe(true);
      }
    });
  });

  describe('DELETE /mobile-notifications/:notification_id', () => {
    it('deletes notification successfully', async () => {
      const userId = 'user-delete';
      const token = await createToken({ sub: userId });

      ctx.notificationRepo.addNotification({
        id: 'notif-to-delete',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: 'Test',
        text: 'Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-1',
      });

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/mobile-notifications/notif-to-delete',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 404 for non-existent notification', async () => {
      const token = await createToken({ sub: 'user-delete-404' });

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/mobile-notifications/non-existent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when deleting another user notification', async () => {
      const token = await createToken({ sub: 'user-delete-forbidden' });

      // Add notification for different user
      ctx.notificationRepo.addNotification({
        id: 'other-user-notif',
        userId: 'other-user',
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: 'Test',
        text: 'Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-1',
      });

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/mobile-notifications/other-user-notif',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 500 on repository find failure', async () => {
      const token = await createToken({ sub: 'user-delete-find-fail' });
      ctx.notificationRepo.setFailNextFind(true);

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/mobile-notifications/any-notif',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 on repository delete failure', async () => {
      const userId = 'user-delete-fail';
      const token = await createToken({ sub: userId });

      // Add a notification for this user
      ctx.notificationRepo.addNotification({
        id: 'notif-delete-fail',
        userId,
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: 'Test',
        text: 'Body',
        timestamp: Date.now(),
        postTime: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:00.000Z',
        notificationId: 'ext-delete-fail',
      });

      // Set the fake repo to fail on delete operation
      ctx.notificationRepo.setFailNextDelete(true);

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/mobile-notifications/notif-delete-fail',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 with fallback status for unknown error code', async () => {
      const token = await createToken({ sub: 'user-unknown-error' });

      // Set custom error with unknown code to trigger ?? 500 fallback
      // This tests defensive programming - the statusMap lookup fallback
      const customError = {
        code: 'VALIDATION_ERROR',
        message: 'Test unknown error',
      };
      ctx.notificationRepo.setCustomFindError(customError);

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/mobile-notifications/any-notif',
        headers: { authorization: `Bearer ${token}` },
      });

      // The route should use the fallback status 500 for unknown error codes
      expect(response.statusCode).toBe(500);
    });
  });
});
