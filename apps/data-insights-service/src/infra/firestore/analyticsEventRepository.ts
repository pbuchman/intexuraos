/**
 * Firestore implementation of AnalyticsEventRepository.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  AnalyticsEvent,
  AnalyticsEventRepository,
  CreateAnalyticsEventRequest,
} from '../../domain/insights/index.js';

const COLLECTION_NAME = 'analytics_events';

interface AnalyticsEventDoc {
  userId: string;
  sourceService: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
  createdAt: string;
}

export class FirestoreAnalyticsEventRepository implements AnalyticsEventRepository {
  async create(request: CreateAnalyticsEventRequest): Promise<Result<AnalyticsEvent, string>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION_NAME).doc();
      const now = new Date();
      const timestamp = request.timestamp ?? now;

      const doc: AnalyticsEventDoc = {
        userId: request.userId,
        sourceService: request.sourceService,
        eventType: request.eventType,
        payload: request.payload,
        timestamp: timestamp.toISOString(),
        createdAt: now.toISOString(),
      };

      await docRef.set(doc);

      const event: AnalyticsEvent = {
        id: docRef.id,
        userId: doc.userId,
        sourceService: doc.sourceService,
        eventType: doc.eventType,
        payload: doc.payload,
        timestamp,
        createdAt: now,
      };

      return ok(event);
    } catch (error) {
      return err(getErrorMessage(error, 'Failed to create analytics event'));
    }
  }

  async getByUserIdAndTimeRange(
    userId: string,
    startDate: Date,
    endDate: Date,
    limit = 100
  ): Promise<Result<AnalyticsEvent[], string>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION_NAME)
        .where('userId', '==', userId)
        .where('timestamp', '>=', startDate.toISOString())
        .where('timestamp', '<=', endDate.toISOString())
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const events: AnalyticsEvent[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as AnalyticsEventDoc;
        return {
          id: docSnap.id,
          userId: data.userId,
          sourceService: data.sourceService,
          eventType: data.eventType,
          payload: data.payload,
          timestamp: new Date(data.timestamp),
          createdAt: new Date(data.createdAt),
        };
      });

      return ok(events);
    } catch (error) {
      return err(getErrorMessage(error, 'Failed to get analytics events'));
    }
  }

  async countByUserIdAndService(
    userId: string,
    serviceNames: string[]
  ): Promise<Result<Record<string, number>, string>> {
    try {
      const db = getFirestore();
      const counts: Record<string, number> = {};

      for (const serviceName of serviceNames) {
        const snapshot = await db
          .collection(COLLECTION_NAME)
          .where('userId', '==', userId)
          .where('sourceService', '==', serviceName)
          .count()
          .get();

        counts[serviceName] = snapshot.data().count;
      }

      return ok(counts);
    } catch (error) {
      return err(getErrorMessage(error, 'Failed to count analytics events'));
    }
  }
}
