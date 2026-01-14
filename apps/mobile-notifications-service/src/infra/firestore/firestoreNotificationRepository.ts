/**
 * Firestore implementation of NotificationRepository.
 * Stores mobile notifications with cursor-based pagination.
 */
import { err, getErrorMessage, getLogLevel, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import pino from 'pino';
import type {
  CreateNotificationInput,
  Notification,
  NotificationRepository,
  PaginatedNotifications,
  PaginationOptions,
  RepositoryError,
} from '../../domain/notifications/index.js';

const logger = pino({ name: 'FirestoreNotificationRepository', level: getLogLevel() });

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

      logger.info({ notificationId: input.notificationId, docId: docRef.id }, 'Saved notification');

      return ok(notification);
    } catch (error) {
      logger.error({ notificationId: input.notificationId, error }, 'Failed to save notification');
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
      const titleFilter = options.filter?.title?.toLowerCase();
      const hasTitleFilter = titleFilter !== undefined && titleFilter !== '';

      logger.info({ userId, limit: options.limit, hasTitleFilter }, 'Querying notifications');

      // Build base query with DB-level filters
      const buildQuery = (cursor?: string): FirebaseFirestore.Query => {
        let query: FirebaseFirestore.Query = db
          .collection(COLLECTION_NAME)
          .where('userId', '==', userId);

        if (options.filter?.source !== undefined && options.filter.source.length > 0) {
          query = query.where('source', 'in', options.filter.source);
        }
        if (options.filter?.app !== undefined && options.filter.app.length > 0) {
          query = query.where('app', 'in', options.filter.app);
        }

        query = query.orderBy('receivedAt', 'desc');

        const cursorData = decodeCursor(cursor);
        if (cursorData !== undefined) {
          query = query.startAfter(cursorData.receivedAt);
        }

        return query;
      };

      const notifications: Notification[] = [];
      let currentCursor = options.cursor;
      let hasMoreInDb = true;

      // Safety limit to prevent infinite loops (max 5 batches = 5x reads)
      const maxIterations = hasTitleFilter ? 5 : 1;
      let iterations = 0;

      while (notifications.length < options.limit && hasMoreInDb && iterations < maxIterations) {
        iterations++;

        const query = buildQuery(currentCursor);
        const batchSize = hasTitleFilter ? options.limit * 2 : options.limit + 1;
        const snapshot = await query.limit(batchSize).get();

        const docs = snapshot.docs;
        hasMoreInDb = docs.length === batchSize;

        for (const docSnap of docs) {
          if (notifications.length >= options.limit) {
            hasMoreInDb = true;
            break;
          }

          const data = docSnap.data() as NotificationDoc;
          const notification: Notification = { id: docSnap.id, ...data };

          // Apply title filter in memory
          if (hasTitleFilter && !notification.title.toLowerCase().includes(titleFilter)) {
            continue;
          }

          notifications.push(notification);
        }

        // Update cursor for next iteration (tracks DB position, not filtered results)
        if (docs.length > 0) {
          const lastDoc = docs[docs.length - 1];
          if (lastDoc !== undefined) {
            const lastData = lastDoc.data() as NotificationDoc;
            currentCursor = encodeCursor(lastData.receivedAt, lastDoc.id);
          }
        }
      }

      const result: PaginatedNotifications = { notifications };

      logger.info({ userId, resultCount: notifications.length, hasNextPage: result.nextCursor !== undefined }, 'Query completed');

      // Set next cursor if there might be more results
      // Use currentCursor (DB position) so user can continue even if 0 results matched filter
      if (hasMoreInDb && currentCursor !== undefined) {
        result.nextCursor = currentCursor;
      }

      return ok(result);
    } catch (error) {
      logger.error({ userId, error }, 'Failed to list notifications');
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

      const exists = !snapshot.empty;
      logger.info({ notificationId, userId, exists }, 'Checked notification existence (idempotency)');

      return ok(exists);
    } catch (error) {
      logger.error({ notificationId, userId, error }, 'Failed to check notification existence');
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
