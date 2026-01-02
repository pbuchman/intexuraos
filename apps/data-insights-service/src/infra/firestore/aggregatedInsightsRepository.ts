/**
 * Firestore implementation of AggregatedInsightsRepository.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  AggregatedInsights,
  AggregatedInsightsRepository,
  ServiceUsage,
} from '../../domain/insights/index.js';

const COLLECTION_NAME = 'aggregated_insights';

interface ServiceUsageDoc {
  serviceName: string;
  totalEvents: number;
  eventsLast7Days: number;
  lastEventAt: string | null;
}

interface AggregatedInsightsDoc {
  summary: {
    totalEvents: number;
    eventsLast7Days: number;
    eventsLast30Days: number;
    mostActiveService: string | null;
  };
  usageByService: Record<string, ServiceUsageDoc>;
  updatedAt: string;
}

export class FirestoreAggregatedInsightsRepository implements AggregatedInsightsRepository {
  async getByUserId(userId: string): Promise<Result<AggregatedInsights | null, string>> {
    try {
      const db = getFirestore();
      const docSnap = await db.collection(COLLECTION_NAME).doc(userId).get();

      if (!docSnap.exists) {
        return ok(null);
      }

      const data = docSnap.data() as AggregatedInsightsDoc;
      const usageByService: Record<string, ServiceUsage> = {};

      for (const [key, usage] of Object.entries(data.usageByService)) {
        usageByService[key] = {
          serviceName: usage.serviceName,
          totalEvents: usage.totalEvents,
          eventsLast7Days: usage.eventsLast7Days,
          lastEventAt: usage.lastEventAt !== null ? new Date(usage.lastEventAt) : null,
        };
      }

      const insights: AggregatedInsights = {
        userId,
        summary: data.summary,
        usageByService,
        updatedAt: new Date(data.updatedAt),
      };

      return ok(insights);
    } catch (error) {
      return err(getErrorMessage(error, 'Failed to get aggregated insights'));
    }
  }

  async upsert(insights: AggregatedInsights): Promise<Result<void, string>> {
    try {
      const db = getFirestore();
      const usageByService: Record<string, ServiceUsageDoc> = {};

      for (const [key, usage] of Object.entries(insights.usageByService)) {
        usageByService[key] = {
          serviceName: usage.serviceName,
          totalEvents: usage.totalEvents,
          eventsLast7Days: usage.eventsLast7Days,
          lastEventAt: usage.lastEventAt !== null ? usage.lastEventAt.toISOString() : null,
        };
      }

      const doc: AggregatedInsightsDoc = {
        summary: insights.summary,
        usageByService,
        updatedAt: insights.updatedAt.toISOString(),
      };

      await db.collection(COLLECTION_NAME).doc(insights.userId).set(doc, { merge: true });
      return ok(undefined);
    } catch (error) {
      return err(getErrorMessage(error, 'Failed to upsert aggregated insights'));
    }
  }
}
