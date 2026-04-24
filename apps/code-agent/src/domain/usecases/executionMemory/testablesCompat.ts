/**
 * Thin compatibility wrappers used by the exported `__testables` object on
 * `processExecutionMemoryBacklog.ts`. They keep the existing testable call
 * signatures — which accept the full orchestrator `Deps` shape — working
 * while the real implementations live in focused sibling modules.
 */
import type { z } from 'zod';
import type { CodeTask } from '../../models/codeTask.js';
import type { ProcessExecutionMemoryBacklogDeps } from '../processExecutionMemoryBacklog.js';
import {
  processMemoryEntry,
  evaluateApplication,
  distillTask,
  type ProcessMemoryEntryDeps,
} from './processMemoryEntry.js';
import {
  updateExistingMemory,
  type DistilledMemory,
} from './persistMemory.js';
import type { DistillationSchema } from './shared.js';

function toEntryDeps(deps: ProcessExecutionMemoryBacklogDeps): ProcessMemoryEntryDeps {
  return {
    logger: deps.logger,
    logLineRepo: deps.logLineRepo,
    turnMetricsRepo: deps.turnMetricsRepo,
    linearAgentClient: deps.linearAgentClient,
    executionMemoryRepo: deps.executionMemoryRepo,
    executionMemoryApplicationRepo: deps.executionMemoryApplicationRepo,
    userServiceClient: deps.userServiceClient,
    ...(deps.evaluatorClient !== undefined && { evaluatorClient: deps.evaluatorClient }),
    ...(deps.distillerClient !== undefined && { distillerClient: deps.distillerClient }),
    ...(deps.embeddingClient !== undefined && { embeddingClient: deps.embeddingClient }),
  };
}

export async function processOneTaskCompat(
  task: CodeTask,
  deps: ProcessExecutionMemoryBacklogDeps,
): Promise<{
  status: 'completed' | 'skipped';
  generatedMemoryIds: string[];
  evaluationSummary?: string;
  skipReason?: 'infra_only' | 'insufficient_signal' | 'already_completed' | 'no_reusable_lesson' | 'planning_unclear';
}> {
  return await processMemoryEntry(task, toEntryDeps(deps));
}

export async function evaluateApplicationCompat(
  task: CodeTask,
  logs: { text: string }[],
  deps: ProcessExecutionMemoryBacklogDeps,
): Promise<string | undefined> {
  return await evaluateApplication(task, logs, toEntryDeps(deps));
}

export async function distillTaskCompat(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] },
  deps: ProcessExecutionMemoryBacklogDeps,
): Promise<z.infer<typeof DistillationSchema>> {
  return await distillTask(task, logs, turnMetrics, issueContext, toEntryDeps(deps));
}

export async function updateExistingMemoryCompat(
  memoryId: string,
  applicationCount: number,
  positiveCount: number,
  negativeCount: number,
  confidence: number,
  deps: ProcessExecutionMemoryBacklogDeps,
  memory: DistilledMemory,
  fingerprint: string,
  embedding: number[],
  sourceTaskId: string,
  sourceLinearIssueId: string | undefined, // @allow-undefined-type -- function param, not optional property
  sourceAgentType: 'execution' | 'planning' | 'review',
  distillationVersion: string,
): Promise<string> {
  return await updateExistingMemory(
    memoryId,
    applicationCount,
    positiveCount,
    negativeCount,
    confidence,
    { executionMemoryRepo: deps.executionMemoryRepo },
    memory,
    fingerprint,
    embedding,
    sourceTaskId,
    sourceLinearIssueId,
    sourceAgentType,
    distillationVersion,
  );
}
