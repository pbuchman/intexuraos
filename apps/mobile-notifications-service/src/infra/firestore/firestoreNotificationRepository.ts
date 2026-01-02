/**
 * Firestore implementation of NotificationRepository.
 * Stores mobile notifications with cursor-based pagination.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  CreateNotificationInput,
  Notification,
  NotificationRepository,
  PaginatedNotifications,
  PaginationOptions,
  RepositoryError,
} from '../../domain/notifications/index.js';

const COLLECTION_NAME = 'mobile_notifications';

/**
 * Document structure in Firestore.
 */
interface NotificationDoc {
  userId: string;
  source: string;
  device: string;
  app: string;
  title: string;
  text: string;
  timestamp: number;
  postTime: string;
  receivedAt: string;
  notificationId: string;
}

/**
 * Decode a cursor string to a Firestore doc snapshot.
 */
function decodeCursor(cursor: string | undefined): { receivedAt: string; id: string } | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as { receivedAt?: string; id?: string };
    if (typeof parsed.receivedAt === 'string' && typeof parsed.id === 'string') {
      return { receivedAt: parsed.receivedAt, id: parsed.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Encode a cursor from notification data.
 */
function encodeCursor(receivedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ receivedAt, id })).toString('base64');
}

/**
 * Firestore-backed notification repository.
 */
export class FirestoreNotificationRepository implements NotificationRepository {
  async save(input: CreateNotificationInput): Promise<Result<Notification, RepositoryError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc();
      const now = new Date().toISOString();

      const doc: NotificationDoc = {
        userId: input.userId,
        source: input.source,
        device: input.device,
        app: input.app,
        title: input.title,
        text: input.text,
        timestamp: input.timestamp,
        postTime: input.postTime,
        receivedAt: now,
        notificationId: input.notificationId,
      };

      await docRef.set(doc);

      const notification: Notification = {
        id: docRef.id,
        ...doc,
      };

      return ok(notification);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to save notification'),
      });
    }
  }

  async findById(id: string): Promise<Result<Notification | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const docSnap = await db.collection(COLLECTION_NAME).doc(id).get();

      if (!docSnap.exists) {
        return ok(null);
      }

      const data = docSnap.data() as NotificationDoc;
      const notification: Notification = {
        id: docSnap.id,
        ...data,
      };

      return ok(notification);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to find notification'),
      });
    }
  }

  async findByUserIdPaginated(
    userId: string,
    options: PaginationOptions
  ): Promise<Result<PaginatedNotifications, RepositoryError>> {
    try {
      const db = getFirestore();
      let query = db.collection(COLLECTION_NAME).where('userId', '==', userId);

      // Apply filters if provided
      if (options.filter?.source !== undefined) {
        query = query.where('source', '==', options.filter.source);
      }
      if (options.filter?.app !== undefined) {
        query = query.where('app', '==', options.filter.app);
      }

      query = query.orderBy('receivedAt', 'desc');

      // Apply cursor if provided - uses receivedAt for pagination
      const cursorData = decodeCursor(options.cursor);
      if (cursorData !== undefined) {
        query = query.startAfter(cursorData.receivedAt);
      }

      // Fetch one extra to determine if there are more results
      const snapshot = await query.limit(options.limit + 1).get();

      const docs = snapshot.docs;
      const hasMore = docs.length > options.limit;

      // Take only the requested number of results
      const resultDocs = hasMore ? docs.slice(0, options.limit) : docs;

      let notifications: Notification[] = resultDocs.map((docSnap) => {
        const data = docSnap.data() as NotificationDoc;
        return {
          id: docSnap.id,
          ...data,
        };
      });

      // Apply title filter in memory (case-insensitive partial match)
      if (options.filter?.title !== undefined) {
        const titleFilter = options.filter.title.toLowerCase();
        notifications = notifications.filter((n) => n.title.toLowerCase().includes(titleFilter));
      }

      const result: PaginatedNotifications = { notifications };

      // Set next cursor if there are more results
      if (hasMore && resultDocs.length > 0) {
        const lastDoc = resultDocs[resultDocs.length - 1];
        if (lastDoc !== undefined) {
          const lastData = lastDoc.data() as NotificationDoc;
          result.nextCursor = encodeCursor(lastData.receivedAt, lastDoc.id);
        }
      }

      return ok(result);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to list notifications'),
      });
    }
  }

  async existsByNotificationIdAndUserId(
    notificationId: string,
    userId: string
  ): Promise<Result<boolean, RepositoryError>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('notificationId', '==', notificationId)
        .where('userId', '==', userId)
        .limit(1)
        .get();

      return ok(!snapshot.empty);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to check notification existence'),
      });
    }
  }

  async delete(id: string): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION_NAME).doc(id).delete();
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: getErrorMessage(error, 'Failed to delete notification'),
      });
    }
  }
}
