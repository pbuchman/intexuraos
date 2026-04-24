import { type Logger } from '@intexuraos/common-core';
import type { z } from 'zod';
import type { ExecutionMemoryRepository } from '../../repositories/executionMemoryRepository.js';
import type { ExecutionMemoryEmbeddingClient } from '../prepareExecutionMemoryContext.js';
import {
  DistillationSchema,
  buildFingerprint,
  computeQualityScore,
  shouldSuppressMemory,
} from './shared.js';

export interface PersistMemoryDeps {
  logger: Logger;
  executionMemoryRepo: Pick<
    ExecutionMemoryRepository,
    'findByFingerprint' | 'findNearest' | 'create' | 'update'
  >;
  embeddingClient?: ExecutionMemoryEmbeddingClient | undefined;
}

export type DistilledMemory = z.infer<typeof DistillationSchema>['memories'][number];

export interface PersistMemoryInput {
  repository: string;
  sourceTaskId: string;
  sourceLinearIssueId: string | undefined; // @allow-undefined-type -- function param, not optional property
  sourceAgentType: 'execution' | 'planning' | 'review';
  distillationVersion: string;
  memory: DistilledMemory;
}

export async function persistMemory(
  input: PersistMemoryInput,
  deps: PersistMemoryDeps
): Promise<string> {
  if (deps.embeddingClient === undefined) {
    throw new Error('Execution memory embedding client is not configured');
  }

  const embeddingResult = await deps.embeddingClient.embed(input.memory.retrievalText);
  if (!embeddingResult.ok) {
    throw new Error(embeddingResult.error.message);
  }

  const fingerprint = buildFingerprint(input.repository, input.memory);
  const exactMatchResult = await deps.executionMemoryRepo.findByFingerprint(input.repository, fingerprint);
  if (!exactMatchResult.ok) {
    throw new Error(exactMatchResult.error.message);
  }

  const exactMatch = exactMatchResult.value;
  if (exactMatch !== null) {
    return await updateExistingMemory(
      exactMatch.id,
      exactMatch.applicationCount,
      exactMatch.positiveCount,
      exactMatch.negativeCount,
      input.memory.confidence,
      deps,
      input.memory,
      fingerprint,
      embeddingResult.value,
      input.sourceTaskId,
      input.sourceLinearIssueId,
      input.sourceAgentType,
      input.distillationVersion,
    );
  }

  const nearDuplicateResult = await deps.executionMemoryRepo.findNearest({
    repository: input.repository,
    embedding: embeddingResult.value,
    limit: 5,
    status: 'active',
  });
  if (!nearDuplicateResult.ok) {
    throw new Error(nearDuplicateResult.error.message);
  }

  const mergeCandidate = nearDuplicateResult.value.find((candidate) =>
    candidate.memoryType === input.memory.memoryType && candidate.vectorScore >= 0.88
  );
  if (mergeCandidate !== undefined) {
    return await updateExistingMemory(
      mergeCandidate.id,
      mergeCandidate.applicationCount,
      mergeCandidate.positiveCount,
      mergeCandidate.negativeCount,
      input.memory.confidence,
      deps,
      input.memory,
      fingerprint,
      embeddingResult.value,
      input.sourceTaskId,
      input.sourceLinearIssueId,
      input.sourceAgentType,
      input.distillationVersion,
    );
  }

  const createResult = await deps.executionMemoryRepo.create({
    repository: input.repository,
    sourceTaskId: input.sourceTaskId,
    ...(input.sourceLinearIssueId !== undefined && { sourceLinearIssueId: input.sourceLinearIssueId }),
    sourceAgentType: input.sourceAgentType,
    memoryType: input.memory.memoryType,
    title: input.memory.title,
    appliesWhen: input.memory.appliesWhen,
    action: input.memory.action,
    avoid: input.memory.avoid,
    verification: input.memory.verification,
    evidenceSummary: input.memory.evidenceSummary,
    retrievalText: input.memory.retrievalText,
    keywords: input.memory.keywords,
    componentHints: input.memory.componentHints,
    embedding: embeddingResult.value,
    embeddingModel: 'text-embedding-3-small',
    fingerprint,
    distillationVersion: input.distillationVersion,
    distillationConfidence: input.memory.confidence,
    qualityScore: computeQualityScore({
      applicationCount: 0,
      positiveCount: 0,
      confidence: input.memory.confidence,
    }),
    applicationCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    status: 'active',
  });

  if (!createResult.ok) {
    throw new Error(createResult.error.message);
  }

  return createResult.value.id;
}

export async function updateExistingMemory(
  memoryId: string,
  applicationCount: number,
  positiveCount: number,
  negativeCount: number,
  confidence: number,
  deps: Pick<PersistMemoryDeps, 'executionMemoryRepo'>,
  memory: DistilledMemory,
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
