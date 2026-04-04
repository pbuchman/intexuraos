import { createHash } from 'node:crypto';
import { ok, err, getErrorMessage, type Logger, type Result } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { z } from 'zod';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { CodeTask } from '../models/codeTask.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { TurnMetricsRepository } from '../repositories/turnMetricsRepository.js';
import type { ExecutionMemoryRepository } from '../repositories/executionMemoryRepository.js';
import type { ExecutionMemoryApplicationRepository } from '../repositories/executionMemoryApplicationRepository.js';
import type { ExecutionMemoryEmbeddingClient } from './prepareExecutionMemoryContext.js';

const DISTILLATION_VERSION = 'execution-memory-distiller@2.0.0';
const PLANNING_DISTILLATION_VERSION = 'planning-memory-distiller@1.0.0';
const REVIEW_DISTILLATION_VERSION = 'review-memory-distiller@1.0.0';
const EVALUATION_VERSION = 'execution-memory-evaluator@1.0.0';
const MAX_LOG_LINES = 350;
const MAX_EVALUATION_LOG_LINES = 200;

const EvaluationSchema = z.object({
  summary: z.string().min(1),
  perMemory: z.array(z.object({
    memoryId: z.string().min(1),
    outcome: z.enum(['positive', 'neutral', 'negative', 'unknown']),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })).default([]),
});

const DistillationSchema = z.object({
  decision: z.enum(['create', 'skip']),
  skipReason: z.enum(['infra_only', 'insufficient_signal', 'already_completed', 'no_reusable_lesson', 'planning_unclear']).optional(),
  evidenceSummary: z.string().min(1),
  memories: z.array(z.object({
    memoryType: z.enum([
      'implementation_pattern', 'verification_pattern', 'pitfall_pattern',
      'decomposition_pattern', 'planning_decision', 'review_finding',
    ]),
    title: z.string().min(1),
    appliesWhen: z.string().min(1),
    action: z.string().min(1),
    avoid: z.string().min(1),
    verification: z.string().min(1),
    evidenceSummary: z.string().min(1),
    retrievalText: z.string().min(1),
    keywords: z.array(z.string()).default([]),
    labelHints: z.array(z.string()).default([]),
    componentHints: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
  })).default([]),
});

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
  evaluatorClient?: LlmGenerateClient | undefined;
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
  const pendingResult = await deps.codeTaskRepo.listPendingExecutionMemoryPostRun(deps.limit);
  if (!pendingResult.ok) {
    return err({ code: 'internal_error', message: pendingResult.error.message });
  }

  const summary: ProcessExecutionMemoryBacklogResult = {
    claimed: 0,
    completed: 0,
    skipped: 0,
    errored: 0,
    taskIds: [],
  };

  for (const task of pendingResult.value) {
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
      const processed = await processOneTask(task, deps);

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

function shouldSkipDistillation(task: CodeTask): {
  skip: boolean;
  reason?: 'already_completed' | 'planning_unclear';
} {
  if (task.result?.execution_outcome_label === 'already_completed') {
    return { skip: true, reason: 'already_completed' };
  }
  if (task.agentType === 'planning' && task.result?.planning_outcome_label === 'unclear') {
    return { skip: true, reason: 'planning_unclear' };
  }
  return { skip: false };
}

async function processOneTask(
  task: CodeTask,
  deps: ProcessExecutionMemoryBacklogDeps
): Promise<{
  status: 'completed' | 'skipped';
  generatedMemoryIds: string[];
  evaluationSummary?: string;
  skipReason?: 'infra_only' | 'insufficient_signal' | 'already_completed' | 'no_reusable_lesson' | 'planning_unclear';
}> {
  const logsResult = await deps.logLineRepo.listRecent(task.id, MAX_LOG_LINES);
  if (!logsResult.ok) {
    throw new Error(logsResult.error.message);
  }

  const turnMetricsResult = await deps.turnMetricsRepo.listByTask(task.id);
  if (!turnMetricsResult.ok) {
    throw new Error(turnMetricsResult.error.message);
  }

  const issueContextResult = task.linearIssueId !== undefined
    ? await deps.linearAgentClient.getIssueContext({ identifier: task.linearIssueId })
    : ok({ description: null, comments: [] });

  if (!issueContextResult.ok) {
    throw new Error(issueContextResult.error.message);
  }

  const evaluationSummary = await evaluateApplication(task, logsResult.value, deps);

  const skipCheck = shouldSkipDistillation(task);
  if (skipCheck.skip) {
    return {
      status: 'skipped',
      generatedMemoryIds: [],
      ...(evaluationSummary !== undefined && { evaluationSummary }),
      ...(skipCheck.reason !== undefined && { skipReason: skipCheck.reason }),
    };
  }

  const distillationResult = await distillTask(task, logsResult.value, turnMetricsResult.value, issueContextResult.value, deps);
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
    if (deps.embeddingClient === undefined) {
      throw new Error('Execution memory embedding client is not configured');
    }

    const embeddingResult = await deps.embeddingClient.embed(memory.retrievalText);
    if (!embeddingResult.ok) {
      throw new Error(embeddingResult.error.message);
    }

    const fingerprint = buildFingerprint(task.repository, memory);
    const exactMatchResult = await deps.executionMemoryRepo.findByFingerprint(task.repository, fingerprint);
    if (!exactMatchResult.ok) {
      throw new Error(exactMatchResult.error.message);
    }

    const exactMatch = exactMatchResult.value;
    if (exactMatch !== null) {
      const updatedId = await updateExistingMemory(exactMatch.id, exactMatch.applicationCount, exactMatch.positiveCount, exactMatch.negativeCount, memory.confidence, deps, memory, fingerprint, embeddingResult.value, task.id, task.linearIssueId, sourceAgentType, distillationVersion);
      generatedMemoryIds.push(updatedId);
      continue;
    }

    const nearDuplicateResult = await deps.executionMemoryRepo.findNearest({
      repository: task.repository,
      embedding: embeddingResult.value,
      limit: 5,
      status: 'active',
    });
    if (!nearDuplicateResult.ok) {
      throw new Error(nearDuplicateResult.error.message);
    }

    const mergeCandidate = nearDuplicateResult.value.find((candidate) =>
      candidate.memoryType === memory.memoryType && candidate.vectorScore >= 0.94
    );
    if (mergeCandidate !== undefined) {
      const updatedId = await updateExistingMemory(
        mergeCandidate.id,
        mergeCandidate.applicationCount,
        mergeCandidate.positiveCount,
        mergeCandidate.negativeCount,
        memory.confidence,
        deps,
        memory,
        fingerprint,
        embeddingResult.value,
        task.id,
        task.linearIssueId,
        sourceAgentType,
        distillationVersion
      );
      generatedMemoryIds.push(updatedId);
      continue;
    }

    const createResult = await deps.executionMemoryRepo.create({
      repository: task.repository,
      sourceTaskId: task.id,
      ...(task.linearIssueId !== undefined && { sourceLinearIssueId: task.linearIssueId }),
      sourceAgentType,
      memoryType: memory.memoryType,
      title: memory.title,
      appliesWhen: memory.appliesWhen,
      action: memory.action,
      avoid: memory.avoid,
      verification: memory.verification,
      evidenceSummary: memory.evidenceSummary,
      retrievalText: memory.retrievalText,
      keywords: memory.keywords,
      labelHints: memory.labelHints,
      componentHints: memory.componentHints,
      embedding: embeddingResult.value,
      embeddingModel: 'text-embedding-3-small',
      fingerprint,
      distillationVersion,
      distillationConfidence: memory.confidence,
      qualityScore: computeQualityScore({
        applicationCount: 0,
        positiveCount: 0,
        confidence: memory.confidence,
      }),
      applicationCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      status: 'active',
    });

    if (!createResult.ok) {
      throw new Error(createResult.error.message);
    }

    generatedMemoryIds.push(createResult.value.id);
  }

  return {
    status: 'completed',
    generatedMemoryIds,
    ...(evaluationSummary !== undefined && { evaluationSummary }),
  };
}

function buildEvaluationContext(task: CodeTask): {
  selfReportUsed: string;
  selfReportRejected: string;
  selfReportSummary: string;
} {
  switch (task.agentType) {
    case 'planning':
      return {
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: task.result?.planning_outcome_label === 'planned'
          ? 'Planning completed successfully'
          : 'Planning outcome was unclear',
      };
    case 'review':
      return {
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: task.result?.needs_remediation === '1'
          ? `Review found issues requiring remediation (${task.result.review_comments_posted ?? '0'} comments)`
          : 'Review completed with no remediation needed',
      };
    default:
      return {
        selfReportUsed: task.result?.execution_memory_ids_used ?? '',
        selfReportRejected: task.result?.execution_memory_ids_rejected ?? '',
        selfReportSummary: task.result?.execution_memory_usage_summary ?? '',
      };
  }
}

async function evaluateApplication(
  task: CodeTask,
  logs: { text: string }[],
  deps: ProcessExecutionMemoryBacklogDeps
): Promise<string | undefined> {
  const evalCtx = buildEvaluationContext(task);
  const applicationId = task.executionMemoryContext?.applicationId;
  if (applicationId === undefined) {
    return evalCtx.selfReportSummary !== '' ? evalCtx.selfReportSummary : undefined;
  }

  const applicationResult = await deps.executionMemoryApplicationRepo.findById(applicationId);
  if (!applicationResult.ok) {
    throw new Error(applicationResult.error.message);
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
    `Matched memories: ${JSON.stringify(application.matchedMemories)}`,
    `Recent logs:\n${logs.slice(0, MAX_EVALUATION_LOG_LINES).map((line) => line.text).join('\n')}`,
    EVALUATION_SCHEMA_BLOCK,
  ].join('\n\n');

  const evaluationResult = await deps.evaluatorClient.generate(evaluationPrompt);
  if (!evaluationResult.ok) {
    throw new Error(evaluationResult.error.message);
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

    const retryResult = await deps.evaluatorClient.generate(refinementPrompt);
    if (!retryResult.ok) {
      throw new Error(retryResult.error.message);
    }

    parsed = EvaluationSchema.parse(parseJsonObject(retryResult.value.content));
  }

  await deps.executionMemoryApplicationRepo.update(applicationId, {
    memoryIdsUsed,
    memoryIdsRejected,
    evaluationSummary: parsed.summary,
    perMemoryOutcome: parsed.perMemory,
    completedAt: new Date(),
  });

  const knownMemoryIds = new Set(application.matchedMemories.map((m: { memoryId: string }) => m.memoryId));

  for (const outcome of parsed.perMemory) {
    if (!knownMemoryIds.has(outcome.memoryId)) {
      deps.logger.warn(
        { taskId: task.id, memoryId: outcome.memoryId },
        'Evaluator returned outcome for unknown memory ID, skipping'
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

const DISTILLATION_SCHEMA_BLOCK = [
  'Return JSON only. Use this exact schema:',
  '{',
  '  "decision": "create" | "skip",',
  '  "skipReason": "infra_only" | "insufficient_signal" | "already_completed" | "no_reusable_lesson" | "planning_unclear",  // required when decision is "skip"',
  '  "evidenceSummary": "string (non-empty, summarize what happened)",',
  '  "memories": [  // empty array when decision is "skip"',
  '    {',
  '      "memoryType": "implementation_pattern" | "verification_pattern" | "pitfall_pattern" | "decomposition_pattern" | "planning_decision" | "review_finding",',
  '      "title": "string (short descriptive title)",',
  '      "appliesWhen": "string (when this memory should be applied)",',
  '      "action": "string (what to do)",',
  '      "avoid": "string (what to avoid)",',
  '      "verification": "string (how to verify correctness)",',
  '      "evidenceSummary": "string (evidence from this task)",',
  '      "retrievalText": "string (text used for semantic search matching)",',
  '      "keywords": ["string"],',
  '      "labelHints": ["string"],',
  '      "componentHints": ["string"],',
  '      "confidence": 0.0 to 1.0',
  '    }',
  '  ]',
  '}',
  '',
  'Example (skip):',
  '{"decision":"skip","skipReason":"no_reusable_lesson","evidenceSummary":"Task was a trivial typo fix with no reusable pattern.","memories":[]}',
  '',
  'Example (create):',
  '{"decision":"create","evidenceSummary":"Discovered that route handlers need serialization tests.","memories":[{"memoryType":"verification_pattern","title":"Verify route serialization","appliesWhen":"Modifying route handlers","action":"Add app.inject tests for response shape","avoid":"Skipping serialization checks","verification":"Run route tests and check response schema","evidenceSummary":"Route handler returned wrong shape without test coverage","retrievalText":"route handler serialization verification test coverage","keywords":["route","serialization"],"labelHints":["testing"],"componentHints":["api"],"confidence":0.85}]}',
].join('\n');

const EVALUATION_SCHEMA_BLOCK = [
  'Return JSON only. Use this exact schema:',
  '{',
  '  "summary": "string (non-empty, overall assessment of how matched memories helped this task)",',
  '  "perMemory": [',
  '    {',
  '      "memoryId": "string (exact ID from matched memories above)",',
  '      "outcome": "positive" | "neutral" | "negative" | "unknown",',
  '      "reason": "string (why this outcome)",',
  '      "confidence": 0.0 to 1.0',
  '    }',
  '  ]',
  '}',
  '',
  'Example (memories helped):',
  '{"summary":"The previous verification memory directly helped the fix.","perMemory":[{"memoryId":"mem-existing","outcome":"positive","reason":"The route coverage lesson was applied.","confidence":0.84}]}',
  '',
  'Example (no matched memories to evaluate):',
  '{"summary":"No matched memories were provided for this task.","perMemory":[]}',
].join('\n');

function buildExecutionDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  return [
    `Version: ${DISTILLATION_VERSION}`,
    `Task status: ${task.status}`,
    `Task summary: ${task.result?.summary ?? ''}`,
    `Task error: ${task.error?.message ?? ''}`,
    `Linear description: ${issueContext.description ?? ''}`,
    `Linear comments: ${issueContext.comments.map((comment) => comment.body).join('\n')}`,
    `Recent logs:\n${logs.map((line) => line.text).join('\n')}`,
    `Turn metrics:\n${JSON.stringify(turnMetrics)}`,
    DISTILLATION_SCHEMA_BLOCK,
  ].join('\n\n');
}

function buildPlanningDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  const subtaskCount = (task.result?.planning_subtask_urls ?? '').split(',').filter((u) => u.trim() !== '').length;
  return [
    `Version: ${PLANNING_DISTILLATION_VERSION}`,
    `Task status: ${task.status}`,
    `Planning outcome: ${task.result?.planning_outcome_label ?? ''}`,
    `Complexity classification: ${task.result?.planning_is_complex === '1' ? 'COMPLEX' : 'SIMPLE_OR_PLAN_DOC'}`,
    `Subtask count: ${String(subtaskCount)}`,
    `Used writing-plans skill: ${task.result?.planning_superpowers_writing_plans_used ?? ''}`,
    `Planning PR URL: ${task.result?.planning_pr_url ?? ''}`,
    `Linear description: ${issueContext.description ?? ''}`,
    `Linear comments: ${issueContext.comments.map((comment) => comment.body).join('\n')}`,
    `Recent logs:\n${logs.slice(0, MAX_LOG_LINES).map((line) => line.text).join('\n')}`,
    `Turn metrics:\n${JSON.stringify(turnMetrics)}`,
    [
      'You are a planning memory distiller. Analyze this completed planning task and extract',
      'reusable patterns about how issues should be planned and decomposed.',
      '',
      'Focus on:',
      '1. DECOMPOSITION PATTERNS: How was the issue broken into subtasks? What service boundaries',
      '   were identified? What parallelization strategy was used? Were subtasks properly scoped',
      '   to single services/workers?',
      '2. PLANNING DECISIONS: What indicators led to the complexity classification? What made this',
      '   issue SIMPLE vs COMPLEX? What signals in the Linear issue description predicted the',
      '   outcome?',
      '3. Any verification or pitfall patterns that emerged during planning (e.g., missing',
      '   composite indexes, cross-service dependencies that blocked parallelization).',
      '',
      'Memory types to use:',
      '- "decomposition_pattern": How complex issues should be broken into subtasks',
      '- "planning_decision": Complexity classification heuristics and indicators',
      '- "implementation_pattern": Reusable if planning uncovered an implementation approach',
      '- "verification_pattern": Reusable if planning identified verification requirements',
      '- "pitfall_pattern": Reusable if planning identified risks or common mistakes',
    ].join('\n'),
    DISTILLATION_SCHEMA_BLOCK,
  ].join('\n\n');
}

function buildReviewDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  return [
    `Version: ${REVIEW_DISTILLATION_VERSION}`,
    `Task status: ${task.status}`,
    `Review types: ${task.result?.review_types ?? ''}`,
    `Comments posted: ${task.result?.review_comments_posted ?? ''}`,
    `Needs remediation: ${task.result?.needs_remediation ?? ''}`,
    `CI status: ${task.result?.gh_actions_status ?? ''}`,
    `Review body:\n${task.result?.review_body ?? ''}`,
    `Inline comments:\n${task.result?.review_inline_comments ?? ''}`,
    `Linear description: ${issueContext.description ?? ''}`,
    `Linear comments: ${issueContext.comments.map((comment) => comment.body).join('\n')}`,
    `Recent logs:\n${logs.slice(0, MAX_LOG_LINES).map((line) => line.text).join('\n')}`,
    [
      'You are a review memory distiller. Analyze this completed code review and extract',
      'reusable patterns that would help FUTURE EXECUTION AGENTS avoid the issues found.',
      '',
      'Focus on:',
      '1. REVIEW FINDINGS: What code quality, security, or architecture issues were flagged?',
      '   Are any of these recurring patterns that other execution tasks should know about?',
      '2. PITFALL PATTERNS: What mistakes did the implementation make that a review caught?',
      '   These are high-value memories — they prevent future agents from making the same errors.',
      '3. VERIFICATION PATTERNS: What checks or tests would have caught these issues before',
      '   review? These help execution agents self-verify before submitting for review.',
      '',
      'Memory types to use:',
      '- "review_finding": Recurring patterns flagged by reviewers that execution agents should be aware of',
      '- "pitfall_pattern": Specific mistakes the review caught that should be avoided',
      '- "verification_pattern": Tests or checks that would have caught the issues pre-review',
      '- "implementation_pattern": Better approaches the review suggested',
    ].join('\n'),
    DISTILLATION_SCHEMA_BLOCK,
  ].join('\n\n');
}

function buildDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  switch (task.agentType) {
    case 'planning':
      return buildPlanningDistillationPrompt(task, logs, turnMetrics, issueContext);
    case 'review':
      return buildReviewDistillationPrompt(task, logs, issueContext);
    default:
      return buildExecutionDistillationPrompt(task, logs, turnMetrics, issueContext);
  }
}

async function distillTask(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] },
  deps: ProcessExecutionMemoryBacklogDeps
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

  const result = await deps.distillerClient.generate(prompt);
  if (!result.ok) {
    throw new Error(result.error.message);
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

    const retryResult = await deps.distillerClient.generate(refinementPrompt);
    if (!retryResult.ok) {
      throw new Error(retryResult.error.message);
    }

    return DistillationSchema.parse(parseJsonObject(retryResult.value.content));
  }
}

async function updateExistingMemory(
  memoryId: string,
  applicationCount: number,
  positiveCount: number,
  negativeCount: number,
  confidence: number,
  deps: ProcessExecutionMemoryBacklogDeps,
  memory: z.infer<typeof DistillationSchema>['memories'][number],
  fingerprint: string,
  embedding: number[],
  sourceTaskId: string,
  sourceLinearIssueId: string | undefined, // @allow-undefined-type -- function param, not optional property
  sourceAgentType: 'execution' | 'planning' | 'review',
  distillationVersion: string
): Promise<string> {
  const qualityScore = computeQualityScore({ applicationCount, positiveCount, confidence });
  const status = shouldSuppressMemory(applicationCount, negativeCount, qualityScore) ? 'suppressed' : 'active';

  const updateResult = await deps.executionMemoryRepo.update(memoryId, {
    sourceTaskId,
    ...(sourceLinearIssueId !== undefined && { sourceLinearIssueId }),
    sourceAgentType,
    memoryType: memory.memoryType,
    title: memory.title,
    appliesWhen: memory.appliesWhen,
    action: memory.action,
    avoid: memory.avoid,
    verification: memory.verification,
    evidenceSummary: memory.evidenceSummary,
    retrievalText: memory.retrievalText,
    keywords: memory.keywords,
    labelHints: memory.labelHints,
    componentHints: memory.componentHints,
    embedding,
    embeddingModel: 'text-embedding-3-small',
    fingerprint,
    distillationVersion,
    distillationConfidence: confidence,
    qualityScore,
    applicationCount,
    positiveCount,
    negativeCount,
    status,
  });

  if (!updateResult.ok) {
    throw new Error(updateResult.error.message);
  }

  return memoryId;
}

function shouldSuppressMemory(
  applicationCount: number,
  negativeCount: number,
  qualityScore: number
): boolean {
  return (applicationCount >= 3 && negativeCount / applicationCount >= 0.5)
    || qualityScore < 0.25;
}

function computeQualityScore(params: {
  applicationCount: number;
  positiveCount: number;
  confidence: number;
  lastAppliedAt?: Timestamp;
}): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const RECENCY_DECAY_DAYS = 180;
  const effectiveness = (params.positiveCount + 1) / (params.applicationCount + 2);
  const recency = params.lastAppliedAt !== undefined
    ? Math.max(0, Math.min(1, 1 - (Date.now() - params.lastAppliedAt.toDate().getTime()) / (RECENCY_DECAY_DAYS * MS_PER_DAY)))
    : 1;
  return (0.5 * effectiveness) + (0.3 * params.confidence) + (0.2 * recency);
}

function parseCsv(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function parseJsonObject(response: string): unknown {
  const stripped = response.replace(/```(?:json)?\s*\n?([\s\S]*?)```/g, '$1');
  const match = /\{[\s\S]*\}/.exec(stripped);
  if (match === null) {
    throw new Error('Response did not contain JSON');
  }
  return JSON.parse(match[0]);
}

function normalizeFingerprintText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildFingerprint(
  repository: string,
  memory: z.infer<typeof DistillationSchema>['memories'][number]
): string {
  return createHash('sha256')
    .update([
      repository,
      memory.memoryType,
      normalizeFingerprintText(memory.title),
      normalizeFingerprintText(memory.appliesWhen),
      normalizeFingerprintText(memory.action),
      normalizeFingerprintText(memory.avoid),
    ].join('::'))
    .digest('hex')
    .slice(0, 24);
}

function isInfraOnlyFailure(task: CodeTask): boolean {
  const code = task.error?.code ?? '';
  return [
    'dispatch_failed',
    'worker_unavailable',
    'queue_timeout',
    'retry_exhausted',
    'retry_expired',
    'network_error',
  ].includes(code);
}

export const __testables = {
  processOneTask,
  evaluateApplication,
  distillTask,
  updateExistingMemory,
  shouldSuppressMemory,
  computeQualityScore,
  parseCsv,
  parseJsonObject,
  normalizeFingerprintText,
  buildFingerprint,
  isInfraOnlyFailure,
  shouldSkipDistillation,
  buildDistillationPrompt,
  buildEvaluationContext,
  EVALUATION_SCHEMA_BLOCK,
};
