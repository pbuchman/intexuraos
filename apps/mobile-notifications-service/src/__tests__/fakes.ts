/**
 * Fake repositories for mobile-notifications-service testing.
 *
 * These fakes implement domain port interfaces with in-memory storage.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CreateNotificationInput,
  CreateSignatureConnectionInput,
  DistinctFilterField,
  Notification,
  NotificationRepository,
  PaginatedNotifications,
  PaginationOptions,
  RepositoryError,
  SignatureConnection,
  SignatureConnectionRepository,
} from '../domain/notifications/index.js';

/**
 * Fake SignatureConnection repository for testing.
 */
export class FakeSignatureConnectionRepository implements SignatureConnectionRepository {
  private connections = new Map<string, SignatureConnection>();
  private idCounter = 1;
  private shouldFailSave = false;
  private shouldFailFind = false;
  private shouldFailExists = false;
  private shouldFailDelete = false;

  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  setFailNextFind(fail: boolean): void {
    this.shouldFailFind = fail;
  }

  setFailNextExists(fail: boolean): void {
    this.shouldFailExists = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  save(
    input: CreateSignatureConnectionInput
  ): Promise<Result<SignatureConnection, RepositoryError>> {
    if (this.shouldFailSave) {
      this.shouldFailSave = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated save failure' }));
    }

    const id = `sig-${String(this.idCounter++)}`;
    const connection: SignatureConnection = {
      id,
      userId: input.userId,
      signatureHash: input.signatureHash,
      createdAt: new Date().toISOString(),
    };

    if (input.deviceLabel !== undefined) {
      connection.deviceLabel = input.deviceLabel;
    }

    this.connections.set(id, connection);
    return Promise.resolve(ok(connection));
  }

  findBySignatureHash(hash: string): Promise<Result<SignatureConnection | null, RepositoryError>> {
    if (this.shouldFailFind) {
      this.shouldFailFind = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated find failure' }));
    }

    for (const conn of Array.from(this.connections.values())) {
      if (conn.signatureHash === hash) {
        return Promise.resolve(ok(conn));
      }
    }
    return Promise.resolve(ok(null));
  }

  findByUserId(userId: string): Promise<Result<SignatureConnection[], RepositoryError>> {
    if (this.shouldFailFind) {
      this.shouldFailFind = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated find failure' }));
    }

    const connections = Array.from(this.connections.values()).filter(
      (conn) => conn.userId === userId
    );
    return Promise.resolve(ok(connections));
  }

  delete(id: string): Promise<Result<void, RepositoryError>> {
    this.connections.delete(id);
    return Promise.resolve(ok(undefined));
  }

  deleteByUserId(userId: string): Promise<Result<number, RepositoryError>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated delete failure' }));
    }

    let count = 0;
    for (const [id, conn] of Array.from(this.connections.entries())) {
      if (conn.userId === userId) {
        this.connections.delete(id);
        count++;
      }
    }
    return Promise.resolve(ok(count));
  }

  existsByUserId(userId: string): Promise<Result<boolean, RepositoryError>> {
    if (this.shouldFailExists) {
      this.shouldFailExists = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated exists failure' }));
    }

    for (const conn of Array.from(this.connections.values())) {
      if (conn.userId === userId) {
        return Promise.resolve(ok(true));
      }
    }
    return Promise.resolve(ok(false));
  }

  clear(): void {
    this.connections.clear();
    this.idCounter = 1;
  }

  getAll(): SignatureConnection[] {
    return Array.from(this.connections.values());
  }
}

/**
 * Fake Notification repository for testing.
 */
export class FakeNotificationRepository implements NotificationRepository {
  private notifications = new Map<string, Notification>();
  private idCounter = 1;
  private shouldFailSave = false;
  private shouldFailFind = false;
  private shouldFailDelete = false;
  private customFindError: RepositoryError | null = null;

  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  setFailNextFind(fail: boolean): void {
    this.shouldFailFind = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  setCustomFindError(error: unknown): void {
    this.customFindError = error as RepositoryError;
  }

  save(input: CreateNotificationInput): Promise<Result<Notification, RepositoryError>> {
    if (this.shouldFailSave) {
      this.shouldFailSave = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated save failure' }));
    }

    const id = `notif-${String(this.idCounter++)}`;
    const notification: Notification = {
      id,
      userId: input.userId,
      source: input.source,
      device: input.device,
      app: input.app,
      title: input.title,
      text: input.text,
      timestamp: input.timestamp,
      postTime: input.postTime,
      receivedAt: new Date().toISOString(),
      notificationId: input.notificationId,
    };

    this.notifications.set(id, notification);
    return Promise.resolve(ok(notification));
  }

  findById(id: string): Promise<Result<Notification | null, RepositoryError>> {
    if (this.customFindError !== null) {
      const error = this.customFindError;
      this.customFindError = null;
      return Promise.resolve(err(error));
    }

    if (this.shouldFailFind) {
      this.shouldFailFind = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated find failure' }));
    }

    const notification = this.notifications.get(id);
    return Promise.resolve(ok(notification ?? null));
  }

  findByUserIdPaginated(
    userId: string,
    options: PaginationOptions
  ): Promise<Result<PaginatedNotifications, RepositoryError>> {
    if (this.shouldFailFind) {
      this.shouldFailFind = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated find failure' }));
    }

    let notifications = Array.from(this.notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

    // Apply filters
    if (options.filter?.source !== undefined) {
      notifications = notifications.filter((n) => n.source === options.filter?.source);
    }
    if (options.filter?.app !== undefined) {
      notifications = notifications.filter((n) => n.app === options.filter?.app);
    }
    if (options.filter?.title !== undefined) {
      const titleFilter = options.filter.title.toLowerCase();
      notifications = notifications.filter((n) => n.title.toLowerCase().includes(titleFilter));
    }

    // Handle cursor
    if (options.cursor !== undefined) {
      const cursorData = JSON.parse(Buffer.from(options.cursor, 'base64').toString('utf-8')) as {
        receivedAt: string;
        id: string;
      };
      const cursorIndex = notifications.findIndex(
        (n) => n.receivedAt === cursorData.receivedAt && n.id === cursorData.id
      );
      if (cursorIndex >= 0) {
        notifications = notifications.slice(cursorIndex + 1);
      }
    }

    const hasMore = notifications.length > options.limit;
    const resultNotifications = hasMore ? notifications.slice(0, options.limit) : notifications;

    const result: PaginatedNotifications = { notifications: resultNotifications };

    if (hasMore && resultNotifications.length > 0) {
      const lastNotif = resultNotifications[resultNotifications.length - 1];
      if (lastNotif !== undefined) {
        result.nextCursor = Buffer.from(
          JSON.stringify({ receivedAt: lastNotif.receivedAt, id: lastNotif.id })
        ).toString('base64');
      }
    }

    return Promise.resolve(ok(result));
  }

  existsByNotificationIdAndUserId(
    notificationId: string,
    userId: string
  ): Promise<Result<boolean, RepositoryError>> {
    if (this.shouldFailFind) {
      this.shouldFailFind = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated find failure' }));
    }

    for (const notif of Array.from(this.notifications.values())) {
      if (notif.notificationId === notificationId && notif.userId === userId) {
        return Promise.resolve(ok(true));
      }
    }
    return Promise.resolve(ok(false));
  }

  delete(id: string): Promise<Result<void, RepositoryError>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated delete failure' }));
    }

    this.notifications.delete(id);
    return Promise.resolve(ok(undefined));
  }

  clear(): void {
    this.notifications.clear();
    this.idCounter = 1;
  }

  getAll(): Notification[] {
    return Array.from(this.notifications.values());
  }

  /**
   * Add a notification directly (for test setup).
   */
  addNotification(notification: Notification): void {
    this.notifications.set(notification.id, notification);
  }

  getDistinctValues(
    userId: string,
    field: DistinctFilterField
  ): Promise<Result<string[], RepositoryError>> {
    if (this.shouldFailFind) {
      this.shouldFailFind = false;
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated getDistinctValues failure' })
      );
    }

    const values = new Set<string>();
    for (const notif of Array.from(this.notifications.values())) {
      if (notif.userId === userId) {
        const value = notif[field];
        if (typeof value === 'string' && value.length > 0) {
          values.add(value);
        }
      }
    }

    return Promise.resolve(ok(Array.from(values).sort()));
  }
}
