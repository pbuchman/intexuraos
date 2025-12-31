/**
 * Tests for domain usecases.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createConnection,
  deleteNotification,
  getDistinctFilterValues,
  hashSignature,
  listNotifications,
  processNotification,
} from '../domain/notifications/index.js';
import { FakeNotificationRepository, FakeSignatureConnectionRepository } from './fakes.js';

describe('createConnection', () => {
  let signatureRepo: FakeSignatureConnectionRepository;

  beforeEach(() => {
    signatureRepo = new FakeSignatureConnectionRepository();
  });

  it('creates a new connection with generated signature', async () => {
    const result = await createConnection(
      { userId: 'user-123', deviceLabel: 'My Phone' },
      signatureRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.connectionId).toBeDefined();
      expect(result.value.signature).toBeDefined();
      expect(result.value.signature).toHaveLength(64); // 32 bytes hex
    }

    // Verify connection was saved
    const connections = signatureRepo.getAll();
    expect(connections).toHaveLength(1);
    expect(connections[0]?.userId).toBe('user-123');
    expect(connections[0]?.deviceLabel).toBe('My Phone');
  });

  it('creates a connection without deviceLabel', async () => {
    const result = await createConnection({ userId: 'user-123' }, signatureRepo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.connectionId).toBeDefined();
    }

    const connections = signatureRepo.getAll();
    expect(connections).toHaveLength(1);
    expect(connections[0]?.deviceLabel).toBeUndefined();
  });

  it('returns error on repository failure', async () => {
    signatureRepo.setFailNextSave(true);

    const result = await createConnection({ userId: 'user-123' }, signatureRepo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('returns error when deleting existing connections fails', async () => {
    signatureRepo.setFailNextDelete(true);

    const result = await createConnection({ userId: 'user-123' }, signatureRepo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});

describe('processNotification', () => {
  let signatureRepo: FakeSignatureConnectionRepository;
  let notificationRepo: FakeNotificationRepository;

  beforeEach(() => {
    signatureRepo = new FakeSignatureConnectionRepository();
    notificationRepo = new FakeNotificationRepository();
  });

  it('accepts notification with valid signature', async () => {
    // Create a connection first
    const signature = 'test-signature-token';
    await signatureRepo.save({
      userId: 'user-123',
      signatureHash: hashSignature(signature),
    });

    const result = await processNotification(
      {
        signature,
        payload: {
          source: 'tasker',
          device: 'test-phone',
          timestamp: Date.now(),
          notification_id: 'notif-123',
          post_time: '2024-01-01T00:00:00Z',
          app: 'com.example.app',
          title: 'Test Title',
          text: 'Test Text',
        },
      },
      signatureRepo,
      notificationRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('accepted');
      expect(result.value.id).toBeDefined();
    }

    // Verify notification was saved
    const notifications = notificationRepo.getAll();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.userId).toBe('user-123');
  });

  it('ignores notification with invalid signature', async () => {
    const result = await processNotification(
      {
        signature: 'invalid-signature',
        payload: {
          source: 'tasker',
          device: 'test-phone',
          timestamp: Date.now(),
          notification_id: 'notif-123',
          post_time: '2024-01-01T00:00:00Z',
          app: 'com.example.app',
          title: 'Test Title',
          text: 'Test Text',
        },
      },
      signatureRepo,
      notificationRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ignored');
      expect(result.value.reason).toBe('invalid_signature');
    }

    // Verify no notification was saved
    expect(notificationRepo.getAll()).toHaveLength(0);
  });

  it('ignores duplicate notification', async () => {
    // Create a connection
    const signature = 'test-signature-token';
    await signatureRepo.save({
      userId: 'user-123',
      signatureHash: hashSignature(signature),
    });

    // Add existing notification
    notificationRepo.addNotification({
      id: 'existing-notif',
      userId: 'user-123',
      source: 'tasker',
      device: 'test-phone',
      app: 'com.example.app',
      title: 'Old Title',
      text: 'Old Text',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'notif-123',
    });

    const result = await processNotification(
      {
        signature,
        payload: {
          source: 'tasker',
          device: 'test-phone',
          timestamp: Date.now(),
          notification_id: 'notif-123', // Same ID
          post_time: '2024-01-01T00:00:00Z',
          app: 'com.example.app',
          title: 'Test Title',
          text: 'Test Text',
        },
      },
      signatureRepo,
      notificationRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ignored');
      expect(result.value.reason).toBe('duplicate');
    }

    // Verify only 1 notification exists
    expect(notificationRepo.getAll()).toHaveLength(1);
  });

  it('returns error on signature lookup failure', async () => {
    signatureRepo.setFailNextFind(true);

    const result = await processNotification(
      {
        signature: 'test-signature',
        payload: {
          source: 'tasker',
          device: 'test-phone',
          timestamp: Date.now(),
          notification_id: 'notif-123',
          post_time: '2024-01-01T00:00:00Z',
          app: 'com.example.app',
          title: 'Test Title',
          text: 'Test Text',
        },
      },
      signatureRepo,
      notificationRepo
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('returns error on duplicate check failure', async () => {
    // Create a connection
    const signature = 'test-signature-token';
    await signatureRepo.save({
      userId: 'user-123',
      signatureHash: hashSignature(signature),
    });

    notificationRepo.setFailNextFind(true);

    const result = await processNotification(
      {
        signature,
        payload: {
          source: 'tasker',
          device: 'test-phone',
          timestamp: Date.now(),
          notification_id: 'notif-123',
          post_time: '2024-01-01T00:00:00Z',
          app: 'com.example.app',
          title: 'Test Title',
          text: 'Test Text',
        },
      },
      signatureRepo,
      notificationRepo
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('returns error on save failure', async () => {
    // Create a connection
    const signature = 'test-signature-token';
    await signatureRepo.save({
      userId: 'user-123',
      signatureHash: hashSignature(signature),
    });

    notificationRepo.setFailNextSave(true);

    const result = await processNotification(
      {
        signature,
        payload: {
          source: 'tasker',
          device: 'test-phone',
          timestamp: Date.now(),
          notification_id: 'notif-123',
          post_time: '2024-01-01T00:00:00Z',
          app: 'com.example.app',
          title: 'Test Title',
          text: 'Test Text',
        },
      },
      signatureRepo,
      notificationRepo
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});

describe('listNotifications', () => {
  let notificationRepo: FakeNotificationRepository;

  beforeEach(() => {
    notificationRepo = new FakeNotificationRepository();
  });

  it('returns empty list when no notifications', async () => {
    const result = await listNotifications({ userId: 'user-123' }, notificationRepo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(0);
      expect(result.value.nextCursor).toBeUndefined();
    }
  });

  it('returns notifications for user', async () => {
    notificationRepo.addNotification({
      id: 'notif-1',
      userId: 'user-123',
      source: 'tasker',
      device: 'test-phone',
      app: 'com.example.app',
      title: 'Title 1',
      text: 'Text 1',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-1',
    });

    const result = await listNotifications({ userId: 'user-123' }, notificationRepo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(1);
      expect(result.value.notifications[0]?.title).toBe('Title 1');
    }
  });

  it('respects limit parameter', async () => {
    // Add 3 notifications
    for (let i = 1; i <= 3; i++) {
      notificationRepo.addNotification({
        id: `notif-${String(i)}`,
        userId: 'user-123',
        source: 'tasker',
        device: 'test-phone',
        app: 'com.example.app',
        title: `Title ${String(i)}`,
        text: `Text ${String(i)}`,
        timestamp: Date.now() + i,
        postTime: '2024-01-01T00:00:00Z',
        receivedAt: new Date(Date.now() + i).toISOString(),
        notificationId: `ext-${String(i)}`,
      });
    }

    const result = await listNotifications({ userId: 'user-123', limit: 2 }, notificationRepo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(2);
      expect(result.value.nextCursor).toBeDefined();
    }
  });

  it('uses cursor for pagination', async () => {
    // Add 3 notifications
    for (let i = 1; i <= 3; i++) {
      notificationRepo.addNotification({
        id: `notif-${String(i)}`,
        userId: 'user-123',
        source: 'tasker',
        device: 'test-phone',
        app: 'com.example.app',
        title: `Title ${String(i)}`,
        text: `Text ${String(i)}`,
        timestamp: Date.now() + i,
        postTime: '2024-01-01T00:00:00Z',
        receivedAt: new Date(Date.now() + i).toISOString(),
        notificationId: `ext-${String(i)}`,
      });
    }

    // Get first page
    const firstPage = await listNotifications({ userId: 'user-123', limit: 2 }, notificationRepo);
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) return;
    expect(firstPage.value.nextCursor).toBeDefined();

    // Get second page using cursor - explicitly check cursor is defined
    const cursor = firstPage.value.nextCursor;
    expect(cursor).toBeDefined();
    if (cursor === undefined) return;

    const secondPage = await listNotifications(
      { userId: 'user-123', limit: 2, cursor },
      notificationRepo
    );

    expect(secondPage.ok).toBe(true);
    if (secondPage.ok) {
      // Second page should have remaining notification(s)
      expect(secondPage.value.notifications.length).toBeGreaterThan(0);
    }
  });

  it('returns error on repository failure', async () => {
    notificationRepo.setFailNextFind(true);

    const result = await listNotifications({ userId: 'user-123' }, notificationRepo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('filters by source', async () => {
    // Add notifications with different sources
    notificationRepo.addNotification({
      id: 'notif-1',
      userId: 'user-123',
      source: 'tasker',
      device: 'phone',
      app: 'com.whatsapp',
      title: 'Title 1',
      text: 'Text 1',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-1',
    });
    notificationRepo.addNotification({
      id: 'notif-2',
      userId: 'user-123',
      source: 'automate',
      device: 'phone',
      app: 'com.slack',
      title: 'Title 2',
      text: 'Text 2',
      timestamp: Date.now() + 1,
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date(Date.now() + 1).toISOString(),
      notificationId: 'ext-2',
    });
    notificationRepo.addNotification({
      id: 'notif-3',
      userId: 'user-123',
      source: 'tasker',
      device: 'tablet',
      app: 'com.slack',
      title: 'Title 3',
      text: 'Text 3',
      timestamp: Date.now() + 2,
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date(Date.now() + 2).toISOString(),
      notificationId: 'ext-3',
    });

    const result = await listNotifications(
      { userId: 'user-123', source: 'tasker' },
      notificationRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(2);
      expect(result.value.notifications.every((n) => n.source === 'tasker')).toBe(true);
    }
  });

  it('filters by app', async () => {
    // Add notifications with different apps
    notificationRepo.addNotification({
      id: 'notif-1',
      userId: 'user-123',
      source: 'tasker',
      device: 'phone',
      app: 'com.whatsapp',
      title: 'Title 1',
      text: 'Text 1',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-1',
    });
    notificationRepo.addNotification({
      id: 'notif-2',
      userId: 'user-123',
      source: 'automate',
      device: 'phone',
      app: 'com.slack',
      title: 'Title 2',
      text: 'Text 2',
      timestamp: Date.now() + 1,
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date(Date.now() + 1).toISOString(),
      notificationId: 'ext-2',
    });
    notificationRepo.addNotification({
      id: 'notif-3',
      userId: 'user-123',
      source: 'tasker',
      device: 'tablet',
      app: 'com.slack',
      title: 'Title 3',
      text: 'Text 3',
      timestamp: Date.now() + 2,
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date(Date.now() + 2).toISOString(),
      notificationId: 'ext-3',
    });

    const result = await listNotifications(
      { userId: 'user-123', app: 'com.slack' },
      notificationRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(2);
      expect(result.value.notifications.every((n) => n.app === 'com.slack')).toBe(true);
    }
  });

  it('returns empty array when filter matches nothing', async () => {
    notificationRepo.addNotification({
      id: 'notif-1',
      userId: 'user-123',
      source: 'tasker',
      device: 'phone',
      app: 'com.whatsapp',
      title: 'Title 1',
      text: 'Text 1',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-1',
    });

    const result = await listNotifications(
      { userId: 'user-123', source: 'nonexistent' },
      notificationRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(0);
    }
  });

  it('pagination works with filter applied', async () => {
    // Add 5 tasker notifications
    for (let i = 1; i <= 5; i++) {
      notificationRepo.addNotification({
        id: `notif-tasker-${String(i)}`,
        userId: 'user-123',
        source: 'tasker',
        device: 'phone',
        app: 'com.example',
        title: `Tasker Title ${String(i)}`,
        text: `Text ${String(i)}`,
        timestamp: Date.now() + i,
        postTime: '2024-01-01T00:00:00Z',
        receivedAt: new Date(Date.now() + i).toISOString(),
        notificationId: `ext-tasker-${String(i)}`,
      });
    }
    // Add 2 automate notifications (should be filtered out)
    for (let i = 1; i <= 2; i++) {
      notificationRepo.addNotification({
        id: `notif-automate-${String(i)}`,
        userId: 'user-123',
        source: 'automate',
        device: 'phone',
        app: 'com.example',
        title: `Automate Title ${String(i)}`,
        text: `Text ${String(i)}`,
        timestamp: Date.now() + 10 + i,
        postTime: '2024-01-01T00:00:00Z',
        receivedAt: new Date(Date.now() + 10 + i).toISOString(),
        notificationId: `ext-automate-${String(i)}`,
      });
    }

    // First page with source filter
    const firstPage = await listNotifications(
      { userId: 'user-123', source: 'tasker', limit: 2 },
      notificationRepo
    );
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) return;
    expect(firstPage.value.notifications).toHaveLength(2);
    expect(firstPage.value.notifications.every((n) => n.source === 'tasker')).toBe(true);
    expect(firstPage.value.nextCursor).toBeDefined();

    // Second page with same filter
    const cursor = firstPage.value.nextCursor;
    if (cursor === undefined) return;

    const secondPage = await listNotifications(
      { userId: 'user-123', source: 'tasker', limit: 2, cursor },
      notificationRepo
    );
    expect(secondPage.ok).toBe(true);
    if (secondPage.ok) {
      expect(secondPage.value.notifications).toHaveLength(2);
      expect(secondPage.value.notifications.every((n) => n.source === 'tasker')).toBe(true);
    }
  });
});

describe('deleteNotification', () => {
  let notificationRepo: FakeNotificationRepository;

  beforeEach(() => {
    notificationRepo = new FakeNotificationRepository();
  });

  it('deletes owned notification', async () => {
    notificationRepo.addNotification({
      id: 'notif-123',
      userId: 'user-123',
      source: 'tasker',
      device: 'test-phone',
      app: 'com.example.app',
      title: 'Title',
      text: 'Text',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-1',
    });

    const result = await deleteNotification(
      { notificationId: 'notif-123', userId: 'user-123' },
      notificationRepo
    );

    expect(result.ok).toBe(true);
    expect(notificationRepo.getAll()).toHaveLength(0);
  });

  it('returns NOT_FOUND for non-existent notification', async () => {
    const result = await deleteNotification(
      { notificationId: 'non-existent', userId: 'user-123' },
      notificationRepo
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns FORBIDDEN when not owner', async () => {
    notificationRepo.addNotification({
      id: 'notif-123',
      userId: 'user-123',
      source: 'tasker',
      device: 'test-phone',
      app: 'com.example.app',
      title: 'Title',
      text: 'Text',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-1',
    });

    const result = await deleteNotification(
      { notificationId: 'notif-123', userId: 'different-user' },
      notificationRepo
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
    }
  });

  it('returns error on find failure', async () => {
    notificationRepo.setFailNextFind(true);

    const result = await deleteNotification(
      { notificationId: 'notif-123', userId: 'user-123' },
      notificationRepo
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('returns error on delete operation failure', async () => {
    notificationRepo.addNotification({
      id: 'notif-123',
      userId: 'user-123',
      source: 'tasker',
      device: 'test-phone',
      app: 'com.example.app',
      title: 'Title',
      text: 'Text',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-1',
    });

    notificationRepo.setFailNextDelete(true);

    const result = await deleteNotification(
      { notificationId: 'notif-123', userId: 'user-123' },
      notificationRepo
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});

describe('hashSignature', () => {
  it('produces consistent SHA-256 hash', () => {
    const signature = 'test-signature';
    const hash1 = hashSignature(signature);
    const hash2 = hashSignature(signature);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = hashSignature('signature-1');
    const hash2 = hashSignature('signature-2');

    expect(hash1).not.toBe(hash2);
  });
});

describe('getDistinctFilterValues', () => {
  let notificationRepo: FakeNotificationRepository;

  beforeEach(() => {
    notificationRepo = new FakeNotificationRepository();
  });

  it('returns distinct values for app field', async () => {
    notificationRepo.addNotification({
      id: 'notif-1',
      userId: 'user-123',
      source: 'tasker',
      device: 'phone',
      app: 'com.whatsapp',
      title: 'Title 1',
      text: 'Text 1',
      timestamp: Date.now(),
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-1',
    });
    notificationRepo.addNotification({
      id: 'notif-2',
      userId: 'user-123',
      source: 'tasker',
      device: 'phone',
      app: 'com.slack',
      title: 'Title 2',
      text: 'Text 2',
      timestamp: Date.now() + 1,
      postTime: '2024-01-01T00:00:00Z',
      receivedAt: new Date().toISOString(),
      notificationId: 'ext-2',
    });

    const result = await getDistinctFilterValues(
      { userId: 'user-123', field: 'app' },
      notificationRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['com.slack', 'com.whatsapp']);
    }
  });

  it('returns empty array when no notifications', async () => {
    const result = await getDistinctFilterValues(
      { userId: 'user-123', field: 'app' },
      notificationRepo
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns error on repository failure', async () => {
    notificationRepo.setFailNextFind(true);

    const result = await getDistinctFilterValues(
      { userId: 'user-123', field: 'source' },
      notificationRepo
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});
