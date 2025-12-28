/**
 * Tests for domain usecases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createConnection,
  processNotification,
  listNotifications,
  deleteNotification,
  hashSignature,
} from '../domain/notifications/index.js';
import { FakeSignatureConnectionRepository, FakeNotificationRepository } from './fakes.js';

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
