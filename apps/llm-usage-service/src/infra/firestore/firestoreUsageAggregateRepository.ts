import { err, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { UsageEvent } from '../../domain/models/usageEvent.js';
import type { DailyUsageAggregate } from '../../domain/models/dailyAggregate.js';
import { MISSING_PROMPT_TYPE_SENTINEL } from '../../domain/models/dailyAggregate.js';
import type { UsageAggregateRepository } from '../../domain/repositories/usageAggregateRepository.js';
import { computeAggregateId, toDateString } from './aggregateKeyUtils.js';

const COLLECTION = 'llm_usage_daily_aggregates';

export class FirestoreUsageAggregateRepository implements UsageAggregateRepository {
  async incrementAggregate(event: UsageEvent): Promise<Result<void, { code: string; message: string }>> {
    const db = getFirestore();
    const aggregateId = computeAggregateId(event);
    const now = new Date().toISOString();

    try {
      const docRef = db.collection(COLLECTION).doc(aggregateId);
      const doc = await docRef.get();

      const counterFields = {
        calls: FieldValue.increment(1),
        costUsd: FieldValue.increment(event.cost.billedUsd),
        inputTokens: FieldValue.increment(event.usage.inputTokens),
        outputTokens: FieldValue.increment(event.usage.outputTokens),
        totalTokens: FieldValue.increment(event.usage.totalTokens),
        cacheReadTokens: FieldValue.increment(event.usage.cacheReadTokens),
        cacheWriteTokens: FieldValue.increment(event.usage.cacheWriteTokens),
        cachedTokens: FieldValue.increment(event.usage.cachedTokens),
        reasoningTokens: FieldValue.increment(event.usage.reasoningTokens),
        thinkingTokens: FieldValue.increment(event.usage.thinkingTokens),
        webSearchCalls: FieldValue.increment(event.usage.webSearchCalls),
        imageCount: FieldValue.increment(event.usage.imageCount),
      };

      if (doc.exists) {
        await docRef.update({
          ...counterFields,
          lastOccurredAt: event.occurredAt,
          updatedAt: now,
        });
      } else {
        await docRef.set({
          aggregateId,
          date: toDateString(event.occurredAt),

          // Dimension fields
          ownerType: event.owner.type,
          ownerId: event.owner.id,
          sourceService: event.source.service,
          sourceComponent: event.source.component,
          sourceClient: event.source.client,
          sourceEnvironment: event.source.environment,
          provider: event.request.provider,
          model: event.request.model,
          operation: event.request.operation,
          promptType: event.request.promptType ?? MISSING_PROMPT_TYPE_SENTINEL,
          success: event.request.success,

          // Counter fields
          ...counterFields,

          // Timestamps — firstOccurredAt only set on creation
          firstOccurredAt: event.occurredAt,
          lastOccurredAt: event.occurredAt,
          updatedAt: now,
        });
      }

      return ok(undefined);
    } catch (error: unknown) {
      const firestoreError = error as { code?: number; message?: string };
      return err({
        code: String(firestoreError.code ?? 'UNKNOWN'),
        message: firestoreError.message ?? 'Unknown Firestore error',
      });
    }
  }

  async queryAggregates(from: string, to: string): Promise<Result<DailyUsageAggregate[], { code: string; message: string }>> {
    const db = getFirestore();
    const fromDate = toDateString(from);
    const toDate = toDateString(to);

    try {
      const snapshot = await db
        .collection(COLLECTION)
        .where('date', '>=', fromDate)
        .where('date', '<=', toDate)
        .get();

      const aggregates: DailyUsageAggregate[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          aggregateId: data['aggregateId'] as string,
          date: data['date'] as string,
          ownerType: data['ownerType'] as 'user' | 'system',
          ownerId: data['ownerId'] as string,
          sourceService: data['sourceService'] as string,
          sourceComponent: data['sourceComponent'] as string,
          sourceClient: data['sourceClient'] as string,
          sourceEnvironment: data['sourceEnvironment'] as string,
          provider: data['provider'] as string,
          model: data['model'] as string,
          operation: data['operation'] as string,
          promptType: (data['promptType'] as string | undefined) ?? MISSING_PROMPT_TYPE_SENTINEL,
          success: data['success'] as boolean,
          calls: data['calls'] as number,
          costUsd: data['costUsd'] as number,
          inputTokens: data['inputTokens'] as number,
          outputTokens: data['outputTokens'] as number,
          totalTokens: data['totalTokens'] as number,
          cacheReadTokens: data['cacheReadTokens'] as number,
          cacheWriteTokens: data['cacheWriteTokens'] as number,
          cachedTokens: data['cachedTokens'] as number,
          reasoningTokens: data['reasoningTokens'] as number,
          thinkingTokens: data['thinkingTokens'] as number,
          webSearchCalls: data['webSearchCalls'] as number,
          imageCount: data['imageCount'] as number,
          firstOccurredAt: data['firstOccurredAt'] as string,
          lastOccurredAt: data['lastOccurredAt'] as string,
          updatedAt: data['updatedAt'] as string,
        };
      });

      return ok(aggregates);
    } catch (error: unknown) {
      const firestoreError = error as { code?: number; message?: string };
      return err({
        code: String(firestoreError.code ?? 'UNKNOWN'),
        message: firestoreError.message ?? 'Unknown Firestore error',
      });
    }
  }
}
