/**
 * Firestore implementation of UsageStatsRepository.
 * Reads from llm_usage_stats collection using collection group queries.
 *
 * Structure: llm_usage_stats/{model}/by_call_type/{callType}/by_period/{YYYY-MM-DD}/by_user/{userId}
 */
import { getLogLevel } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import pino from 'pino';
import type {
  AggregatedCosts,
  MonthlyCost,
  ModelCost,
  CallTypeCost,
  UsageStatsRepository,
} from '../../domain/ports/index.js';

const logger = pino({ name: 'FirestoreUsageStatsRepository', level: getLogLevel() });

interface UserUsageDoc {
  userId: string;
  totalCalls: number;
  successfulCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
}

interface RawUsageRecord {
  date: string;
  model: string;
  callType: string;
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDatePeriod(period: string): boolean {
  return DATE_PATTERN.test(period);
}

function getMonthFromDate(date: string): string {
  return date.slice(0, 7);
}

function getDateNDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export class FirestoreUsageStatsRepository implements UsageStatsRepository {
  async getUserCosts(userId: string, days = 90): Promise<AggregatedCosts> {
    const db = getFirestore();
    const cutoffDate = getDateNDaysAgo(days);

    logger.info({ userId, days, cutoffDate }, 'Querying user costs');

    const snapshot = await db.collectionGroup('by_user').where('userId', '==', userId).get();

    logger.info({ userId, totalDocs: snapshot.docs.length }, 'Collection group query completed');

    const records: RawUsageRecord[] = [];

    for (const doc of snapshot.docs) {
      const path = doc.ref.path;
      const pathParts = path.split('/');

      // Path structure: llm_usage_stats/{model}/by_call_type/{callType}/by_period/{period}/by_user/{userId}
      // Indices:        0                1      2            3          4         5        6        7
      if (pathParts.length < 8) continue;

      const model = pathParts[1];
      const callType = pathParts[3];
      const period = pathParts[5];

      if (model === undefined || callType === undefined || period === undefined) continue;
      if (!isValidDatePeriod(period)) continue;
      if (period < cutoffDate) continue;

      const data = doc.data() as UserUsageDoc;
      records.push({
        date: period,
        model,
        callType,
        totalCalls: data.totalCalls,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        costUsd: data.costUsd,
      });
    }

    logger.info({ userId, matchingRecords: records.length }, 'Records filtered and aggregated');

    try {
      const result = this.aggregateRecords(records);
      logger.info(
        {
          userId,
          totalCostUsd: result.totalCostUsd,
          totalCalls: result.totalCalls,
          monthlyCount: result.monthlyBreakdown.length,
          modelCount: result.byModel.length,
          callTypeCount: result.byCallType.length,
        },
        'Aggregation completed'
      );
      return result;
    } catch (error) {
      logger.error({ userId, recordsCount: records.length, error }, 'Failed to aggregate records');
      throw error;
    }
  }

  private aggregateRecords(records: RawUsageRecord[]): AggregatedCosts {
    if (records.length === 0) {
      return {
        totalCostUsd: 0,
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        monthlyBreakdown: [],
        byModel: [],
        byCallType: [],
      };
    }

    let totalCostUsd = 0;
    let totalCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const monthlyMap = new Map<
      string,
      { costUsd: number; calls: number; inputTokens: number; outputTokens: number }
    >();
    const modelMap = new Map<string, { costUsd: number; calls: number }>();
    const callTypeMap = new Map<string, { costUsd: number; calls: number }>();

    for (const record of records) {
      totalCostUsd += record.costUsd;
      totalCalls += record.totalCalls;
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;

      const month = getMonthFromDate(record.date);
      const monthData = monthlyMap.get(month) ?? {
        costUsd: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      monthData.costUsd += record.costUsd;
      monthData.calls += record.totalCalls;
      monthData.inputTokens += record.inputTokens;
      monthData.outputTokens += record.outputTokens;
      monthlyMap.set(month, monthData);

      const modelData = modelMap.get(record.model) ?? { costUsd: 0, calls: 0 };
      modelData.costUsd += record.costUsd;
      modelData.calls += record.totalCalls;
      modelMap.set(record.model, modelData);

      const callTypeData = callTypeMap.get(record.callType) ?? { costUsd: 0, calls: 0 };
      callTypeData.costUsd += record.costUsd;
      callTypeData.calls += record.totalCalls;
      callTypeMap.set(record.callType, callTypeData);
    }

    totalCostUsd = roundCost(totalCostUsd);

    const monthlyBreakdown: MonthlyCost[] = Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        costUsd: roundCost(data.costUsd),
        calls: data.calls,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        percentage: totalCostUsd > 0 ? Math.round((data.costUsd / totalCostUsd) * 100) : 0,
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const byModel: ModelCost[] = Array.from(modelMap.entries())
      .map(([model, data]) => ({
        model,
        costUsd: roundCost(data.costUsd),
        calls: data.calls,
        percentage: totalCostUsd > 0 ? Math.round((data.costUsd / totalCostUsd) * 100) : 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const byCallType: CallTypeCost[] = Array.from(callTypeMap.entries())
      .map(([callType, data]) => ({
        callType,
        costUsd: roundCost(data.costUsd),
        calls: data.calls,
        percentage: totalCostUsd > 0 ? Math.round((data.costUsd / totalCostUsd) * 100) : 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    return {
      totalCostUsd,
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      monthlyBreakdown,
      byModel,
      byCallType,
    };
  }
}
