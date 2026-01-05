/**
 * LLM Usage Logger.
 *
 * Logs LLM usage to Firestore for cost tracking and analytics.
 * Follows the same pattern as llm-audit - direct Firestore writes, no DI needed.
 */

import { getFirestore } from '@intexuraos/infra-firestore';
import type { NormalizedUsage } from '@intexuraos/llm-contract';
import type { LlmProvider } from './types.js';

const COLLECTION_NAME = 'llm_usage_stats';

export type CallType =
  | 'research'
  | 'generate'
  | 'synthesis'
  | 'title'
  | 'context_inference'
  | 'context_label'
  | 'classification'
  | 'validation'
  | 'image_generation'
  | 'prompt_generation';

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
 * Log LLM usage to Firestore.
 * Fire-and-forget - errors are logged but don't propagate.
 */
export async function logUsage(params: UsageLogParams): Promise<void> {
  if (!isUsageLoggingEnabled()) return;

  try {
    const firestore = getFirestore();
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // Document ID: provider_model_callType_date (for easy aggregation)
    const docId = `${params.provider}_${params.model}_${params.callType}_${dateKey}`;

    const docRef = firestore.collection(COLLECTION_NAME).doc(docId);

    await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);

      if (doc.exists) {
        const data = doc.data() as UsageStatsDocument;
        transaction.update(docRef, {
          totalCalls: data.totalCalls + 1,
          successfulCalls: data.successfulCalls + (params.success ? 1 : 0),
          failedCalls: data.failedCalls + (params.success ? 0 : 1),
          inputTokens: data.inputTokens + params.usage.inputTokens,
          outputTokens: data.outputTokens + params.usage.outputTokens,
          totalTokens: data.totalTokens + params.usage.totalTokens,
          costUsd: data.costUsd + params.usage.costUsd,
          updatedAt: now.toISOString(),
        });
      } else {
        const newDoc: UsageStatsDocument = {
          provider: params.provider,
          model: params.model,
          callType: params.callType,
          date: dateKey,
          totalCalls: 1,
          successfulCalls: params.success ? 1 : 0,
          failedCalls: params.success ? 0 : 1,
          inputTokens: params.usage.inputTokens,
          outputTokens: params.usage.outputTokens,
          totalTokens: params.usage.totalTokens,
          costUsd: params.usage.costUsd,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        transaction.set(docRef, newDoc);
      }
    });

    // Also log per-user stats if userId is provided
    if (params.userId !== '') {
      await logUserUsage(params, now);
    }
  } catch {
    // Fire-and-forget - silently ignore errors to not disrupt LLM operations
  }
}

interface UsageStatsDocument {
  provider: LlmProvider;
  model: string;
  callType: CallType;
  date: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Log per-user usage stats.
 * Stored in subcollection: llm_usage_stats/{docId}/by_user/{userId}
 */
async function logUserUsage(params: UsageLogParams, now: Date): Promise<void> {
  const firestore = getFirestore();
  const dateKey = now.toISOString().slice(0, 10);
  const parentDocId = `${params.provider}_${params.model}_${params.callType}_${dateKey}`;
  const userDocRef = firestore
    .collection(COLLECTION_NAME)
    .doc(parentDocId)
    .collection('by_user')
    .doc(params.userId);

  await firestore.runTransaction(async (transaction) => {
    const doc = await transaction.get(userDocRef);

    if (doc.exists) {
      const data = doc.data() as UserUsageDocument;
      transaction.update(userDocRef, {
        totalCalls: data.totalCalls + 1,
        successfulCalls: data.successfulCalls + (params.success ? 1 : 0),
        inputTokens: data.inputTokens + params.usage.inputTokens,
        outputTokens: data.outputTokens + params.usage.outputTokens,
        costUsd: data.costUsd + params.usage.costUsd,
        updatedAt: now.toISOString(),
      });
    } else {
      const newDoc: UserUsageDocument = {
        userId: params.userId,
        totalCalls: 1,
        successfulCalls: params.success ? 1 : 0,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        costUsd: params.usage.costUsd,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      transaction.set(userDocRef, newDoc);
    }
  });
}

interface UserUsageDocument {
  userId: string;
  totalCalls: number;
  successfulCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
}
