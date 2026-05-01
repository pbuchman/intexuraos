import { ok, err, getErrorMessage, type Logger, type Result } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { TurnMetricsRepository } from '../repositories/turnMetricsRepository.js';
import type { ExecutionMemoryRepository } from '../repositories/executionMemoryRepository.js';
import type { ExecutionMemoryApplicationRepository } from '../repositories/executionMemoryApplicationRepository.js';
import type { ExecutionMemoryEmbeddingClient } from './prepareExecutionMemoryContext.js';
import { fetchBacklog } from './executionMemory/fetchBacklog.js';
import {
  processOneTaskCompat,
  evaluateApplicationCompat,
  distillTaskCompat,
  updateExistingMemoryCompat,
} from './executionMemory/testablesCompat.js';
import {
  EVALUATION_SCHEMA_BLOCK,
  distillationPrompt,
  buildEvaluationContext,
  buildFingerprint,
  computeQualityScore,
  isInfraOnlyFailure,
  normalizeFingerprintText,
  parseCsv,
  parseJsonObject,
  shouldSkipDistillation,
  shouldSuppressMemory,
} from './executionMemory/shared.js';
export {
  sweepErroredApplications,
  type SweepErroredApplicationsDeps,
  type SweepErroredApplicationsResult,
} from './executionMemory/sweepErroredApplications.js';
export {
  pruneStaleMemories,
  type PruneStaleMemoriesDeps,
  type PruneStaleMemoriesResult,
} from './executionMemory/pruneStaleMemories.js';

export interface ProcessExecutionMemoryBacklogDeps {
  logger: Logger;
  codeTaskRepo: Pick<CodeTaskRepository, 'listPendingExecutionMemoryPostRun' | 'update'>;
  logLineRepo: Pick<LogLineRepository, 'listRecent'>;
  turnMetricsRepo: Pick<TurnMetricsRepository, 'listByTask'>;
  linearAgentClient: Pick<LinearAgentClient, 'getIssueContext'>;
  executionMemoryRepo: Pick<
    ExecutionMemoryRepository,
    'findById' | 'update' | 'findByFingerprint' | 'findNearest' | 'create'
  >;
  executionMemoryApplicationRepo: Pick<
    ExecutionMemoryApplicationRepository,
    'findById' | 'update'
  >;
  userServiceClient: Pick<UserServiceClient, 'getLlmClient'>;
  /** @internal Resolved per-task by processOneTask from userServiceClient */
  evaluatorClient?: LlmGenerateClient | undefined;
  /** @internal Resolved per-task by processOneTask from userServiceClient */
  distillerClient?: LlmGenerateClient | undefined;
  embeddingClient?: ExecutionMemoryEmbeddingClient | undefined;
  limit: number;
}

export interface ProcessExecutionMemoryBacklogResult {
  claimed: number;
  completed: number;
  skipped: number;
  errored: number;
  taskIds: string[];
}

export interface ProcessExecutionMemoryBacklogError {
  code: 'internal_error';
  message: string;
}

export async function processExecutionMemoryBacklog(
  deps: ProcessExecutionMemoryBacklogDeps
): Promise<Result<ProcessExecutionMemoryBacklogResult, ProcessExecutionMemoryBacklogError>> {
  const backlogResult = await fetchBacklog({
    codeTaskRepo: deps.codeTaskRepo,
    limit: deps.limit,
  });
  if (!backlogResult.ok) {
    return err(backlogResult.error);
  }

  const summary: ProcessExecutionMemoryBacklogResult = {
    claimed: 0,
    completed: 0,
    skipped: 0,
    errored: 0,
    taskIds: [],
  };

  for (const task of backlogResult.value) {
    summary.claimed += 1;
    summary.taskIds.push(task.id);

    const attempts = (task.executionMemoryPostRun?.attempts ?? 0) + 1;
    const lastAttemptAt = Timestamp.now();

    const claimResult = await deps.codeTaskRepo.update(task.id, {
      executionMemoryPostRun: {
        status: 'processing',
        attempts,
        lastAttemptAt,
        generatedMemoryIds: task.executionMemoryPostRun?.generatedMemoryIds ?? [],
      },
    });

    if (!claimResult.ok) {
      deps.logger.warn(
        { taskId: task.id, error: claimResult.error.message },
        'Failed to claim execution memory backlog task, skipping'
      );
      summary.errored += 1;
      continue;
    }

    try {
      const processed = await processOneTaskCompat(task, deps);

      await deps.codeTaskRepo.update(task.id, {
        executionMemoryPostRun: {
          status: processed.status,
          attempts,
          lastAttemptAt,
          generatedMemoryIds: processed.generatedMemoryIds,
          ...(processed.evaluationSummary !== undefined && {
            evaluationSummary: processed.evaluationSummary,
          }),
          ...(processed.skipReason !== undefined && { skipReason: processed.skipReason }),
          completedAt: Timestamp.now(),
        },
      });

      if (processed.status === 'completed') {
        summary.completed += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      deps.logger.warn(
        { taskId: task.id, error: getErrorMessage(error) },
        'Execution memory backlog processing failed'
      );

      await deps.codeTaskRepo.update(task.id, {
        executionMemoryPostRun: {
          status: attempts >= 3 ? 'error' : 'pending',
          attempts,
          lastAttemptAt,
          generatedMemoryIds: task.executionMemoryPostRun?.generatedMemoryIds ?? [],
          errorMessage: getErrorMessage(error),
        },
      });

      summary.errored += 1;
    }
  }

  return ok(summary);
}

export const __testables = {
  processOneTask: processOneTaskCompat,
  evaluateApplication: evaluateApplicationCompat,
  distillTask: distillTaskCompat,
  updateExistingMemory: updateExistingMemoryCompat,
  shouldSuppressMemory,
  computeQualityScore,
  parseCsv,
  parseJsonObject,
  normalizeFingerprintText,
  buildFingerprint,
  isInfraOnlyFailure,
  shouldSkipDistillation,
  distillationPrompt,
  buildEvaluationContext,
  EVALUATION_SCHEMA_BLOCK,
};
