/**
 * LLM Usage Logger.
 *
 * Logs LLM usage to Firestore for cost tracking and analytics.
 * Follows the same pattern as llm-audit - direct Firestore writes, no DI needed.
 *
 * Structure:
 * llm_usage_stats/{model}/                      (model as doc ID)
 *   by_call_type/{callType}/                    (callType subcollection)
 *     by_period/
 *       total/                                  (all-time aggregate)
 *         by_user/{userId}
 *       YYYY-MM/                                (monthly aggregate)
 *         by_user/{userId}
 *       YYYY-MM-DD/                             (daily stats)
 *         by_user/{userId}
 */

import { getFirestore, FieldValue } from '@intexuraos/infra-firestore';
import type { NormalizedUsage } from '@intexuraos/llm-contract';
import type { LlmProvider } from './types.js';

const COLLECTION_NAME = 'llm_usage_stats';

export type CallType = 'research' | 'generate' | 'image_generation';

export interface UsageLogParams {
  userId: string;
  provider: LlmProvider;
  model: string;
  callType: CallType;
  usage: NormalizedUsage;
  success: boolean;
  errorMessage?: string;
}

/**
 * Check if usage logging is enabled.
 * Controlled by INTEXURAOS_LOG_LLM_USAGE env var, defaults to true.
 */
export function isUsageLoggingEnabled(): boolean {
  const envValue = process.env['INTEXURAOS_LOG_LLM_USAGE'];
  if (envValue === undefined || envValue === '') {
    return true;
  }
  return !['false', '0', 'no'].includes(envValue.toLowerCase());
}

/**
 * Log LLM usage to Firestore and Cloud Logging.
 * Fire-and-forget - errors are logged but don't propagate.
 */
export async function logUsage(params: UsageLogParams): Promise<void> {
  if (!isUsageLoggingEnabled()) return;

  // Structured log for Cloud Logging (visible in real-time)
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      severity: 'INFO',
      message: 'LLM usage logged',
      llmUsage: {
        userId: params.userId,
        provider: params.provider,
        model: params.model,
        callType: params.callType,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        totalTokens: params.usage.totalTokens,
        costUsd: params.usage.costUsd,
        success: params.success,
        ...(params.errorMessage !== undefined && { errorMessage: params.errorMessage }),
      },
    })
  );

  try {
    const firestore = getFirestore();
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const monthKey = now.toISOString().slice(0, 7); // YYYY-MM

    // Path: llm_usage_stats/{model}/by_call_type/{callType}/by_period/{period}
    const modelRef = firestore.collection(COLLECTION_NAME).doc(params.model);
    const callTypeRef = modelRef.collection('by_call_type').doc(params.callType);

    const batch = firestore.batch();

    // Ensure model doc exists with metadata (prevents ghost documents)
    batch.set(
      modelRef,
      {
        model: params.model,
        provider: params.provider,
        updatedAt: now.toISOString(),
      },
      { merge: true }
    );

    // Ensure callType doc exists with metadata
    batch.set(
      callTypeRef,
      {
        callType: params.callType,
        updatedAt: now.toISOString(),
      },
      { merge: true }
    );

    // Update periods: total, month, day
    const periods = ['total', monthKey, dateKey];
    for (const period of periods) {
      const periodRef = callTypeRef.collection('by_period').doc(period);
      const updateData = {
        provider: params.provider,
        model: params.model,
        callType: params.callType,
        period,
        totalCalls: FieldValue.increment(1),
        successfulCalls: FieldValue.increment(params.success ? 1 : 0),
        failedCalls: FieldValue.increment(params.success ? 0 : 1),
        inputTokens: FieldValue.increment(params.usage.inputTokens),
        outputTokens: FieldValue.increment(params.usage.outputTokens),
        totalTokens: FieldValue.increment(params.usage.inputTokens + params.usage.outputTokens),
        costUsd: FieldValue.increment(params.usage.costUsd),
        updatedAt: now.toISOString(),
      };
      batch.set(periodRef, updateData, { merge: true });
    }

    await batch.commit();

    // Log per-user stats if userId is provided
    if (params.userId !== '') {
      await logUserUsage(params, now, callTypeRef, dateKey);
    }
  } catch {
    // Fire-and-forget - silently ignore errors to not disrupt LLM operations
  }
}

/**
 * Log per-user usage stats.
 * Path: llm_usage_stats/{model}/by_call_type/{callType}/by_period/{date}/by_user/{userId}
 */
async function logUserUsage(
  params: UsageLogParams,
  now: Date,
  callTypeRef: FirebaseFirestore.DocumentReference,
  dateKey: string
): Promise<void> {
  const firestore = getFirestore();
  const userDocRef = callTypeRef
    .collection('by_period')
    .doc(dateKey)
    .collection('by_user')
    .doc(params.userId);

  const updateData = {
    userId: params.userId,
    totalCalls: FieldValue.increment(1),
    successfulCalls: FieldValue.increment(params.success ? 1 : 0),
    inputTokens: FieldValue.increment(params.usage.inputTokens),
    outputTokens: FieldValue.increment(params.usage.outputTokens),
    costUsd: FieldValue.increment(params.usage.costUsd),
    updatedAt: now.toISOString(),
  };

  await firestore.runTransaction(async (transaction) => {
    const doc = await transaction.get(userDocRef);
    if (doc.exists) {
      transaction.update(userDocRef, updateData);
    } else {
      transaction.set(userDocRef, {
        ...updateData,
        createdAt: now.toISOString(),
      });
    }
  });
}
