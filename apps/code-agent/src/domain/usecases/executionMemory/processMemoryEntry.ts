import { ok, getErrorMessage, IntexuraOSError, type Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { z } from 'zod';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { CodeTask } from '../../models/codeTask.js';
import type { LinearAgentClient } from '../../ports/linearAgentClient.js';
import type { LogLineRepository } from '../../repositories/logLineRepository.js';
import type { TurnMetricsRepository } from '../../repositories/turnMetricsRepository.js';
import type { ExecutionMemoryRepository } from '../../repositories/executionMemoryRepository.js';
import type { ExecutionMemoryApplicationRepository } from '../../repositories/executionMemoryApplicationRepository.js';
import type { ExecutionMemoryEmbeddingClient } from '../prepareExecutionMemoryContext.js';
import {
  DISTILLATION_VERSION,
  PLANNING_DISTILLATION_VERSION,
  REVIEW_DISTILLATION_VERSION,
  EVALUATION_VERSION,
  MAX_LOG_LINES,
  MAX_EVALUATION_LOG_LINES,
  EvaluationSchema,
  DistillationSchema,
  EVALUATION_SCHEMA_BLOCK,
  shouldSkipDistillation,
  shouldSuppressMemory,
  computeQualityScore,
  parseCsv,
  parseJsonObject,
  isInfraOnlyFailure,
  buildDistillationPrompt,
  buildEvaluationContext,
} from './shared.js';
import { persistMemory } from './persistMemory.js';

export interface ProcessMemoryEntryDeps {
  logger: Logger;
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
  /** @internal Resolved per-task by processMemoryEntry from userServiceClient */
  evaluatorClient?: LlmGenerateClient | undefined;
  /** @internal Resolved per-task by processMemoryEntry from userServiceClient */
  distillerClient?: LlmGenerateClient | undefined;
  embeddingClient?: ExecutionMemoryEmbeddingClient | undefined;
}

export interface ProcessMemoryEntryResult {
  status: 'completed' | 'skipped';
  generatedMemoryIds: string[];
  evaluationSummary?: string;
  skipReason?: 'infra_only' | 'insufficient_signal' | 'already_completed' | 'no_reusable_lesson' | 'planning_unclear';
}

export async function processMemoryEntry(
  task: CodeTask,
  deps: ProcessMemoryEntryDeps
): Promise<ProcessMemoryEntryResult> {
  // Resolve user's LLM client for this task
  let taskLlmClient: LlmGenerateClient | undefined;
  const llmResult = await deps.userServiceClient.getLlmClient(task.userId);
  if (llmResult.ok) {
    taskLlmClient = llmResult.value;
  } else {
    deps.logger.warn({ userId: task.userId, taskId: task.id, error: llmResult.error }, 'Failed to resolve user LLM client for execution memory backlog');
  }

  const resolvedDeps: ProcessMemoryEntryDeps = {
    ...deps,
    ...(taskLlmClient !== undefined && {
      evaluatorClient: taskLlmClient,
      distillerClient: taskLlmClient,
    }),
  };

  const logsResult = await deps.logLineRepo.listRecent(task.id, MAX_LOG_LINES);
  if (!logsResult.ok) {
    throw new IntexuraOSError('INTERNAL_ERROR', logsResult.error.message);
  }

  const turnMetricsResult = await deps.turnMetricsRepo.listByTask(task.id);
  if (!turnMetricsResult.ok) {
    throw new IntexuraOSError('INTERNAL_ERROR', turnMetricsResult.error.message);
  }

  const issueContextResult = task.linearIssueId !== undefined
    ? await deps.linearAgentClient.getIssueContext({ identifier: task.linearIssueId })
    : ok({ description: null, comments: [] });

  if (!issueContextResult.ok) {
    throw new IntexuraOSError('INTERNAL_ERROR', issueContextResult.error.message);
  }

  const evaluationSummary = await evaluateApplication(task, logsResult.value, resolvedDeps);

  const skipCheck = shouldSkipDistillation(task);
  if (skipCheck.skip) {
    return {
      status: 'skipped',
      generatedMemoryIds: [],
      ...(evaluationSummary !== undefined && { evaluationSummary }),
      ...(skipCheck.reason !== undefined && { skipReason: skipCheck.reason }),
    };
  }

  const distillationResult = await distillTask(task, logsResult.value, turnMetricsResult.value, issueContextResult.value, resolvedDeps);
  if (distillationResult.decision === 'skip') {
    return {
      status: 'skipped',
      generatedMemoryIds: [],
      ...(evaluationSummary !== undefined && { evaluationSummary }),
      ...(distillationResult.skipReason !== undefined && { skipReason: distillationResult.skipReason }),
    };
  }

  const sourceAgentType: 'execution' | 'planning' | 'review' =
    task.agentType === 'planning' ? 'planning'
    : task.agentType === 'review' ? 'review'
    : 'execution';

  const distillationVersion = task.agentType === 'planning' ? PLANNING_DISTILLATION_VERSION
    : task.agentType === 'review' ? REVIEW_DISTILLATION_VERSION
    : DISTILLATION_VERSION;

  const generatedMemoryIds: string[] = [];
  for (const memory of distillationResult.memories.slice(0, 3)) {
    const id = await persistMemory(
      {
        repository: task.repository,
        sourceTaskId: task.id,
        sourceLinearIssueId: task.linearIssueId,
        sourceAgentType,
        distillationVersion,
        memory,
      },
      {
        logger: deps.logger,
        executionMemoryRepo: deps.executionMemoryRepo,
        ...(deps.embeddingClient !== undefined && { embeddingClient: deps.embeddingClient }),
      },
    );
    generatedMemoryIds.push(id);
  }

  return {
    status: 'completed',
    generatedMemoryIds,
    ...(evaluationSummary !== undefined && { evaluationSummary }),
  };
}

export async function evaluateApplication(
  task: CodeTask,
  logs: { text: string }[],
  deps: ProcessMemoryEntryDeps
): Promise<string | undefined> {
  const evalCtx = buildEvaluationContext(task);
  const applicationId = task.executionMemoryContext?.applicationId;
  if (applicationId === undefined) {
    return evalCtx.selfReportSummary !== '' ? evalCtx.selfReportSummary : undefined;
  }

  const applicationResult = await deps.executionMemoryApplicationRepo.findById(applicationId);
  if (!applicationResult.ok) {
    throw new IntexuraOSError('INTERNAL_ERROR', applicationResult.error.message);
  }

  const application = applicationResult.value;
  const memoryIdsUsed = parseCsv(task.result?.execution_memory_ids_used);
  const memoryIdsRejected = parseCsv(task.result?.execution_memory_ids_rejected);

  if (application.matchedMemories.length === 0) {
    await deps.executionMemoryApplicationRepo.update(applicationId, {
      memoryIdsUsed,
      memoryIdsRejected,
      ...(evalCtx.selfReportSummary !== '' && {
        evaluationSummary: evalCtx.selfReportSummary,
      }),
      completedAt: new Date(),
    });
    return evalCtx.selfReportSummary !== '' ? evalCtx.selfReportSummary : undefined;
  }

  if (deps.evaluatorClient === undefined) {
    await deps.executionMemoryApplicationRepo.update(applicationId, {
      memoryIdsUsed,
      memoryIdsRejected,
      ...(evalCtx.selfReportSummary !== '' && {
        evaluationSummary: evalCtx.selfReportSummary,
      }),
      completedAt: new Date(),
    });
    return evalCtx.selfReportSummary !== '' ? evalCtx.selfReportSummary : undefined;
  }

  const evaluationPrompt = [
    `Version: ${EVALUATION_VERSION}`,
    `Task summary: ${task.result?.summary ?? ''}`,
    `Terminal status: ${task.status}`,
    `Worker self report used: ${evalCtx.selfReportUsed}`,
    `Worker self report rejected: ${evalCtx.selfReportRejected}`,
    `Worker self report summary: ${evalCtx.selfReportSummary}`,
    `Matched memories:\n${application.matchedMemories.map(
      (m: { memoryId: string; title: string; memoryType: string }, index: number) =>
        `[${String(index + 1)}] ${m.title} (type: ${m.memoryType})`
    ).join('\n')}`,
    `Recent logs:\n${logs.slice(0, MAX_EVALUATION_LOG_LINES).map((line) => line.text).join('\n')}`,
    EVALUATION_SCHEMA_BLOCK,
  ].join('\n\n');

  const evaluationResult = await deps.evaluatorClient.generate(evaluationPrompt, { promptType: 'execution-memory-evaluation' });
  if (!evaluationResult.ok) {
    throw new IntexuraOSError('INTERNAL_ERROR', evaluationResult.error.message);
  }

  let parsed: z.infer<typeof EvaluationSchema>;
  try {
    parsed = EvaluationSchema.parse(parseJsonObject(evaluationResult.value.content));
  } catch (firstError) {
    deps.logger.warn({ err: firstError }, 'Evaluator response failed Zod parse, retrying with refinement prompt');

    const refinementPrompt = [
      evaluationPrompt,
      '',
      'Your previous response was invalid JSON or did not match the required schema.',
      `Error: ${getErrorMessage(firstError, 'Unknown parse error')}`,
      'Fix the JSON schema violation and return valid JSON matching the exact schema above.',
    ].join('\n');

    const retryResult = await deps.evaluatorClient.generate(refinementPrompt, { promptType: 'execution-memory-evaluation-retry' });
    if (!retryResult.ok) {
      throw new IntexuraOSError('INTERNAL_ERROR', retryResult.error.message);
    }

    parsed = EvaluationSchema.parse(parseJsonObject(retryResult.value.content));
  }

  const indexToId = new Map(
    application.matchedMemories.map(
      (m: { memoryId: string }, index: number) => [index + 1, m.memoryId]
    )
  );

  const resolvedPerMemory = parsed.perMemory.map((outcome) => ({
    memoryId: indexToId.get(outcome.memoryIndex) ?? `unknown-index-${String(outcome.memoryIndex)}`,
    outcome: outcome.outcome,
    reason: outcome.reason,
    confidence: outcome.confidence,
  }));

  await deps.executionMemoryApplicationRepo.update(applicationId, {
    memoryIdsUsed,
    memoryIdsRejected,
    evaluationSummary: parsed.summary,
    perMemoryOutcome: resolvedPerMemory,
    completedAt: new Date(),
  });

  for (const outcome of resolvedPerMemory) {
    if (outcome.memoryId.startsWith('unknown-index-')) {
      deps.logger.warn(
        { taskId: task.id, memoryIndex: outcome.memoryId },
        'Evaluator returned outcome for unknown memory index, skipping'
      );
      continue;
    }

    const memoryResult = await deps.executionMemoryRepo.findById(outcome.memoryId);
    if (!memoryResult.ok) {
      deps.logger.warn(
        { taskId: task.id, memoryId: outcome.memoryId, error: memoryResult.error.message },
        'Failed to load memory for evaluation outcome, skipping'
      );
      continue;
    }

    const memory = memoryResult.value;
    const applicationCount = memory.applicationCount + 1;
    const positiveCount = memory.positiveCount + (outcome.outcome === 'positive' ? 1 : 0);
    const negativeCount = memory.negativeCount + (outcome.outcome === 'negative' ? 1 : 0);
    const qualityScore = computeQualityScore({
      applicationCount,
      positiveCount,
      confidence: memory.distillationConfidence,
      ...(memory.lastAppliedAt !== undefined && { lastAppliedAt: memory.lastAppliedAt }),
    });

    await deps.executionMemoryRepo.update(outcome.memoryId, {
      applicationCount,
      positiveCount,
      negativeCount,
      qualityScore,
      lastAppliedAt: Timestamp.now(),
      status: shouldSuppressMemory(applicationCount, negativeCount, qualityScore) ? 'suppressed' : 'active',
    });
  }

  return parsed.summary;
}

export async function distillTask(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] },
  deps: ProcessMemoryEntryDeps
): Promise<z.infer<typeof DistillationSchema>> {
  if (isInfraOnlyFailure(task)) {
    return {
      decision: 'skip',
      skipReason: 'infra_only',
      evidenceSummary: 'Infrastructure-only failure; not reusable.',
      memories: [],
    };
  }

  if (deps.distillerClient === undefined) {
    return {
      decision: 'skip',
      skipReason: 'insufficient_signal',
      evidenceSummary: 'No distiller configured.',
      memories: [],
    };
  }

  const prompt = buildDistillationPrompt(task, logs, turnMetrics, issueContext);

  const result = await deps.distillerClient.generate(prompt, { promptType: 'execution-memory-distillation' });
  if (!result.ok) {
    throw new IntexuraOSError('INTERNAL_ERROR', result.error.message);
  }

  try {
    return DistillationSchema.parse(parseJsonObject(result.value.content));
  } catch (firstError) {
    deps.logger.warn({ err: firstError }, 'Distiller response failed Zod parse, retrying with refinement prompt');

    const refinementPrompt = [
      prompt,
      '',
      'Your previous response was invalid JSON or did not match the required schema.',
      `Error: ${getErrorMessage(firstError, 'Unknown parse error')}`,
      'Fix the JSON schema violation and return valid JSON matching the exact schema above.',
    ].join('\n');

    const retryResult = await deps.distillerClient.generate(refinementPrompt, { promptType: 'execution-memory-distillation-retry' });
    if (!retryResult.ok) {
      throw new IntexuraOSError('INTERNAL_ERROR', retryResult.error.message);
    }

    return DistillationSchema.parse(parseJsonObject(retryResult.value.content));
  }
}
