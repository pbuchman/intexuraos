import { getFirestore, FieldValue } from '@intexuraos/infra-firestore';
import type { UsageStatsRepository } from '../../domain/research/ports/usageStatsRepository.js';
import type {
  LlmUsageStats,
  LlmUsageIncrement,
} from '../../domain/research/models/LlmUsageStats.js';
import type { LlmProvider } from '../../domain/research/models/Research.js';

const COLLECTION_NAME = 'llm_usage_stats';

function getModelKey(provider: string, model: string): string {
  return `${provider}_${model}`;
}

function getTodayPeriod(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getMonthPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export class FirestoreUsageStatsRepository implements UsageStatsRepository {
  async increment(data: LlmUsageIncrement): Promise<void> {
    const db = getFirestore();
    const modelKey = getModelKey(data.provider, data.model);
    const today = getTodayPeriod();
    const month = getMonthPeriod();

    const batch = db.batch();

    const periods = ['total', month, today];

    for (const period of periods) {
      const docRef = db.collection(COLLECTION_NAME).doc(modelKey).collection('periods').doc(period);

      const baseUpdate = {
        provider: data.provider,
        model: data.model,
        period,
        calls: FieldValue.increment(1),
        inputTokens: FieldValue.increment(data.inputTokens),
        outputTokens: FieldValue.increment(data.outputTokens),
        totalTokens: FieldValue.increment(data.inputTokens + data.outputTokens),
        costUsd: FieldValue.increment(data.costUsd),
        lastUpdatedAt: new Date().toISOString(),
      };

      if (data.success) {
        batch.set(
          docRef,
          { ...baseUpdate, successfulCalls: FieldValue.increment(1) },
          { merge: true }
        );
      } else {
        batch.set(docRef, { ...baseUpdate, failedCalls: FieldValue.increment(1) }, { merge: true });
      }
    }

    await batch.commit();
  }

  async getAllTotals(): Promise<LlmUsageStats[]> {
    const db = getFirestore();
    const stats: LlmUsageStats[] = [];

    const modelsSnapshot = await db.collection(COLLECTION_NAME).get();

    for (const modelDoc of modelsSnapshot.docs) {
      const totalDoc = await modelDoc.ref.collection('periods').doc('total').get();

      if (totalDoc.exists) {
        const data = totalDoc.data();
        if (data !== undefined) {
          stats.push({
            provider: data['provider'] as LlmProvider,
            model: data['model'] as string,
            period: 'total',
            calls: (data['calls'] as number | undefined) ?? 0,
            successfulCalls: (data['successfulCalls'] as number | undefined) ?? 0,
            failedCalls: (data['failedCalls'] as number | undefined) ?? 0,
            inputTokens: (data['inputTokens'] as number | undefined) ?? 0,
            outputTokens: (data['outputTokens'] as number | undefined) ?? 0,
            totalTokens: (data['totalTokens'] as number | undefined) ?? 0,
            costUsd: (data['costUsd'] as number | undefined) ?? 0,
            lastUpdatedAt: (data['lastUpdatedAt'] as string | undefined) ?? '',
          });
        }
      }
    }

    return stats;
  }

  async getByPeriod(period: string): Promise<LlmUsageStats[]> {
    const db = getFirestore();
    const stats: LlmUsageStats[] = [];

    const modelsSnapshot = await db.collection(COLLECTION_NAME).get();

    for (const modelDoc of modelsSnapshot.docs) {
      const periodDoc = await modelDoc.ref.collection('periods').doc(period).get();

      if (periodDoc.exists) {
        const data = periodDoc.data();
        if (data !== undefined) {
          stats.push({
            provider: data['provider'] as LlmProvider,
            model: data['model'] as string,
            period,
            calls: (data['calls'] as number | undefined) ?? 0,
            successfulCalls: (data['successfulCalls'] as number | undefined) ?? 0,
            failedCalls: (data['failedCalls'] as number | undefined) ?? 0,
            inputTokens: (data['inputTokens'] as number | undefined) ?? 0,
            outputTokens: (data['outputTokens'] as number | undefined) ?? 0,
            totalTokens: (data['totalTokens'] as number | undefined) ?? 0,
            costUsd: (data['costUsd'] as number | undefined) ?? 0,
            lastUpdatedAt: (data['lastUpdatedAt'] as string | undefined) ?? '',
          });
        }
      }
    }

    return stats;
  }
}
