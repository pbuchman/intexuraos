import { Timestamp } from '@google-cloud/firestore';
import { getErrorMessage, type Logger, type Result } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { ExecutionMemoryType } from '../models/executionMemory.js';
import type { ExecutionMemoryApplicationCandidate } from '../models/executionMemoryApplication.js';
import { z } from 'zod';
import type { CodeTask } from '../models/codeTask.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { ExecutionMemoryRepository } from '../repositories/executionMemoryRepository.js';
import type { ExecutionMemoryApplicationRepository } from '../repositories/executionMemoryApplicationRepository.js';
import type { ExecutionMemoryPromptContext } from '../services/taskDispatcher.js';

const QUERY_NORMALIZER_VERSION = 'execution-memory-query-normalizer@2.0.0';
const RETRIEVAL_VERSION = 'execution-memory-retrieval@3.0.0';
const MAX_DESCRIPTION_LENGTH = 2500;
const MAX_COMMENT_LENGTH = 800;
const MAX_TOTAL_CONTEXT_LENGTH = 5000;
const MAX_MATCHES = 3;
const BASE_RERANK_THRESHOLD = 0.50;
const REVIEW_RERANK_THRESHOLD = 0.55;
const TOP_LOG_CANDIDATES = 3;
const CANDIDATE_LIMIT = 20;
const TOP_CANDIDATES_LIMIT = 5;

function getMinRerankScore(agentType: string): number {
  return agentType === 'review' ? REVIEW_RERANK_THRESHOLD : BASE_RERANK_THRESHOLD;
}

const QueryNormalizationSchema = z.object({
  semanticQuery: z.string().min(1),
  components: z.array(z.string()).default([]),
  riskFlags: z.array(z.string()).default([]),
  verificationGoals: z.array(z.string()).default([]),
  summary: z.string().min(1),
});

interface QueryNormalization {
  semanticQuery: string;
  components: string[];
  riskFlags: string[];
  verificationGoals: string[];
  summary: string;
}

export interface ExecutionMemoryEmbeddingClient {
  embed(text: string): Promise<Result<number[], { message: string }>>;
}

export interface PrepareExecutionMemoryResources {
  embeddingClient?: ExecutionMemoryEmbeddingClient | undefined;
  executionMemoryRepo?: Pick<ExecutionMemoryRepository, 'findNearest'> | undefined;
  executionMemoryApplicationRepo?: Pick<ExecutionMemoryApplicationRepository, 'create'> | undefined;
}

export interface PrepareExecutionMemoryContextParams extends PrepareExecutionMemoryResources {
  queryClient?: LlmGenerateClient | undefined;
  task: Pick<CodeTask, 'id' | 'prompt' | 'sanitizedPrompt' | 'repository' | 'linearIssueId'>;
  logger: Logger;
  linearAgentClient: Pick<LinearAgentClient, 'getIssueContext'>;
  agentType?: string | undefined;
}

export async function prepareExecutionMemoryContext(
  params: PrepareExecutionMemoryContextParams
): Promise<CodeTask['executionMemoryContext']> {
  const {
    task,
    logger,
    linearAgentClient,
    queryClient,
    embeddingClient,
    executionMemoryRepo,
    executionMemoryApplicationRepo,
  } = params;

  const issueContext = await getLinearContext(task.linearIssueId, linearAgentClient, logger);
  const normalization = await normalizeQuery({
    task,
    issueContext,
    logger,
    queryClient,
  });

  if (executionMemoryApplicationRepo === undefined) {
    return {
      status: 'error',
      retrievalVersion: RETRIEVAL_VERSION,
      querySummary: normalization.summary,
      errorCode: 'application_repo_unavailable',
      errorMessage: 'Execution memory application repository is not configured',
    };
  }

  if (embeddingClient === undefined) {
    const applicationId = await createApplication({
      executionMemoryApplicationRepo,
      task,
      normalization,
      status: 'error',
      matchedMemories: [],
    });

    return {
      status: 'error',
      ...(applicationId !== undefined && { applicationId }),
      retrievalVersion: RETRIEVAL_VERSION,
      querySummary: normalization.summary,
      errorCode: 'embedding_unavailable',
      errorMessage: 'Execution memory embedding client is not configured',
    };
  }

  if (executionMemoryRepo === undefined) {
    const applicationId = await createApplication({
      executionMemoryApplicationRepo,
      task,
      normalization,
      status: 'error',
      matchedMemories: [],
    });

    return {
      status: 'error',
      ...(applicationId !== undefined && { applicationId }),
      retrievalVersion: RETRIEVAL_VERSION,
      querySummary: normalization.summary,
      errorCode: 'memory_repo_unavailable',
      errorMessage: 'Execution memory repository is not configured',
    };
  }

  const embeddingResult = await embeddingClient.embed(normalization.semanticQuery);
  if (!embeddingResult.ok) {
    const applicationId = await createApplication({
      executionMemoryApplicationRepo,
      task,
      normalization,
      status: 'error',
      matchedMemories: [],
    });

    return {
      status: 'error',
      ...(applicationId !== undefined && { applicationId }),
      retrievalVersion: RETRIEVAL_VERSION,
      querySummary: normalization.summary,
      errorCode: 'embedding_failed',
      errorMessage: embeddingResult.error.message,
    };
  }

  const nearestResult = await executionMemoryRepo.findNearest({
    repository: task.repository,
    embedding: embeddingResult.value,
    limit: CANDIDATE_LIMIT,
    status: 'active',
  });

  if (!nearestResult.ok) {
    const applicationId = await createApplication({
      executionMemoryApplicationRepo,
      task,
      normalization,
      status: 'error',
      matchedMemories: [],
    });

    return {
      status: 'error',
      ...(applicationId !== undefined && { applicationId }),
      retrievalVersion: RETRIEVAL_VERSION,
      querySummary: normalization.summary,
      errorCode: 'vector_search_failed',
      errorMessage: nearestResult.error.message,
    };
  }

  const minScore = getMinRerankScore(params.agentType ?? '');
  const reranked = rerankMemories(nearestResult.value, normalization);
  const totalSearchResults = reranked.length;
  const matchedMemories = reranked
    .filter((candidate) => candidate.rerankScore >= minScore)
    .slice(0, MAX_MATCHES);

  const topCandidates: ExecutionMemoryApplicationCandidate[] = reranked.slice(0, TOP_CANDIDATES_LIMIT).map((candidate) => ({
    memoryId: candidate.memory.id,
    title: candidate.memory.title,
    memoryType: candidate.memory.memoryType,
    vectorScore: candidate.memory.vectorScore,
    rerankScore: roundScore(candidate.rerankScore),
    componentOverlap: roundScore(candidate.componentOverlap),
    effectiveness: roundScore(candidate.effectiveness),
    passedThreshold: candidate.rerankScore >= minScore,
  }));

  // Observability: log top candidates with score breakdowns
  const topLogCandidates = topCandidates.slice(0, TOP_LOG_CANDIDATES);

  logger.info(
    {
      taskId: task.id,
      candidateCount: reranked.length,
      matchedCount: matchedMemories.length,
      minRerankScore: minScore,
      topCandidates: topLogCandidates,
    },
    'Execution memory reranking complete'
  );

  const applicationId = await createApplication({
    executionMemoryApplicationRepo,
    task,
    normalization,
    status: matchedMemories.length > 0 ? 'matched' : 'no_match',
    matchedMemories,
    topCandidates,
  });

  if (matchedMemories.length === 0) {
    return {
      status: 'none',
      ...(applicationId !== undefined && { applicationId }),
      retrievalVersion: RETRIEVAL_VERSION,
      querySummary: normalization.summary,
      topCandidates,
      totalSearchResults,
    };
  }

  return {
    status: 'matched',
    ...(applicationId !== undefined && { applicationId }),
    retrievalVersion: RETRIEVAL_VERSION,
    querySummary: normalization.summary,
    topCandidates,
    totalSearchResults,
    matchedAt: Timestamp.now(),
    matchedMemories: matchedMemories.map((match) => ({
      memoryId: match.memory.id,
      title: match.memory.title,
      memoryType: match.memory.memoryType,
      score: roundScore(match.rerankScore),
      appliesWhen: clampField(match.memory.appliesWhen),
      action: clampField(match.memory.action),
      avoid: clampField(match.memory.avoid),
      verification: clampField(match.memory.verification),
    })),
  };
}

export function toDispatchExecutionMemoryContext(
  context: CodeTask['executionMemoryContext']
): ExecutionMemoryPromptContext | undefined {
  if (
    context?.status !== 'matched'
    || context.applicationId === undefined
    || context.retrievalVersion === undefined
    || context.querySummary === undefined
    || context.matchedMemories === undefined
    || context.matchedMemories.length === 0
  ) {
    return undefined;
  }

  return {
    applicationId: context.applicationId,
    retrievalVersion: context.retrievalVersion,
    querySummary: context.querySummary,
    matchedMemories: context.matchedMemories,
  };
}

async function getLinearContext(
  linearIssueId: string | undefined, // @allow-undefined-type -- function parameter mirrors CodeTask.linearIssueId which is optional
  linearAgentClient: Pick<LinearAgentClient, 'getIssueContext'>,
  logger: Logger
): Promise<{ description: string | null; comments: string[] }> {
  if (linearIssueId === undefined) {
    return { description: null, comments: [] };
  }

  const issueContextResult = await linearAgentClient.getIssueContext({ identifier: linearIssueId });
  if (!issueContextResult.ok) {
    logger.warn(
      { linearIssueId, error: issueContextResult.error },
      'Failed to load Linear issue context for execution memory retrieval'
    );
    return { description: null, comments: [] };
  }

  const description = truncate(issueContextResult.value.description ?? '', MAX_DESCRIPTION_LENGTH);
  const comments: string[] = [];
  let totalContextLength = description.length;

  const newestComments = [...issueContextResult.value.comments]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);

  for (const comment of newestComments) {
    const truncated = truncate(comment.body, MAX_COMMENT_LENGTH);
    if (totalContextLength + truncated.length > MAX_TOTAL_CONTEXT_LENGTH) {
      break;
    }
    comments.push(truncated);
    totalContextLength += truncated.length;
  }

  return {
    description: description === '' ? null : description,
    comments,
  };
}

async function normalizeQuery(params: {
  task: Pick<CodeTask, 'prompt' | 'sanitizedPrompt'>;
  issueContext: { description: string | null; comments: string[] };
  logger: Logger;
  queryClient?: LlmGenerateClient | undefined;
}): Promise<QueryNormalization> {
  const fallback = buildFallbackNormalization(
    params.task,
    params.issueContext
  );

  if (params.queryClient === undefined) {
    return fallback;
  }

  const normalizationPrompt = buildNormalizationPrompt(
    params.task,
    params.issueContext
  );

  const generationResult = await params.queryClient.generate(normalizationPrompt);
  if (!generationResult.ok) {
    params.logger.warn(
      { error: generationResult.error, version: QUERY_NORMALIZER_VERSION },
      'Execution memory query normalization failed, using deterministic fallback'
    );
    return fallback;
  }

  try {
    const parsed = parseJsonObject(generationResult.value.content);
    return QueryNormalizationSchema.parse(parsed);
  } catch (error) {
    params.logger.warn(
      { error: getErrorMessage(error), version: QUERY_NORMALIZER_VERSION },
      'Execution memory query normalization returned invalid JSON, using deterministic fallback'
    );
    return fallback;
  }
}

function buildFallbackNormalization(
  task: Pick<CodeTask, 'prompt' | 'sanitizedPrompt'>,
  issueContext: { description: string | null; comments: string[] }
): QueryNormalization {
  const queryText = [
    task.sanitizedPrompt.trim(),
    issueContext.description ?? '',
    ...issueContext.comments,
  ]
    .filter((part) => part !== '')
    .join('\n\n')
    .trim();

  const tokens = Array.from(new Set(tokenize(queryText))).slice(0, 8);

  return {
    semanticQuery: queryText === '' ? task.prompt.trim() : queryText,
    components: tokens,
    riskFlags: [],
    verificationGoals: [],
    summary: truncate(task.prompt.trim(), 160),
  };
}

function buildNormalizationPrompt(
  task: Pick<CodeTask, 'prompt' | 'sanitizedPrompt'>,
  issueContext: { description: string | null; comments: string[] }
): string {
  return [
    `Version: ${QUERY_NORMALIZER_VERSION}`,
    'Return JSON only.',
    'Summarize this execution task into a retrieval query for reusable implementation memories.',
    '',
    `Task prompt:\n${task.prompt}`,
    '',
    `Sanitized prompt:\n${task.sanitizedPrompt}`,
    '',
    `Linear description:\n${issueContext.description ?? ''}`,
    '',
    `Recent Linear comments:\n${issueContext.comments.join('\n---\n')}`,
    '',
    'Schema:',
    '{"semanticQuery":"string","components":["string"],"riskFlags":["string"],"verificationGoals":["string"],"summary":"string"}',
    '',
    'components: Use single-word or hyphenated canonical identifiers matching service/module names.',
    'Examples: "code-agent", "firestore", "routing", "testing", "web-app", "orchestrator",',
    '"common-core", "linear", "pubsub", "migrations", "ci", "planning", "memory".',
    'Do NOT use multi-word descriptive phrases like "code tasks filter" or "issue-groups API endpoint".',
  ].join('\n');
}

function rerankMemories(
  candidates: Awaited<ReturnType<NonNullable<PrepareExecutionMemoryResources['executionMemoryRepo']>['findNearest']>> extends Result<infer TValue, unknown>
    ? TValue
    : never,
  normalization: QueryNormalization
): {
  memory: (typeof candidates)[number];
  rerankScore: number;
  componentOverlap: number;
  effectiveness: number;
}[] {
  return candidates
    .map((memory) => {
      const componentOverlap = overlapRatio(normalization.components, memory.componentHints);
      const effectiveness = (memory.positiveCount + 1) / (memory.applicationCount + 2);
      const rerankScore =
        (0.55 * memory.vectorScore)
        + (0.25 * componentOverlap)
        + (0.20 * effectiveness);

      return { memory, rerankScore, componentOverlap, effectiveness };
    })
    .sort((left, right) => right.rerankScore - left.rerankScore);
}

async function createApplication(params: {
  executionMemoryApplicationRepo: Pick<ExecutionMemoryApplicationRepository, 'create'>;
  task: Pick<CodeTask, 'id' | 'repository' | 'linearIssueId'>;
  normalization: QueryNormalization;
  status: 'matched' | 'no_match' | 'error';
  matchedMemories: {
    memory: {
      id: string;
      title: string;
      memoryType: ExecutionMemoryType;
      vectorScore: number;
    };
    rerankScore: number;
  }[];
  topCandidates?: ExecutionMemoryApplicationCandidate[];
}): Promise<string | undefined> {
  const createResult = await params.executionMemoryApplicationRepo.create({
    taskId: params.task.id,
    repository: params.task.repository,
    ...(params.task.linearIssueId !== undefined && { linearIssueId: params.task.linearIssueId }),
    querySummary: params.normalization.summary,
    queryText: params.normalization.semanticQuery,
    queryComponents: params.normalization.components,
    queryRiskFlags: params.normalization.riskFlags,
    retrievalVersion: RETRIEVAL_VERSION,
    matchedMemories: params.matchedMemories.map((match) => ({
      memoryId: match.memory.id,
      vectorScore: match.memory.vectorScore,
      rerankScore: roundScore(match.rerankScore),
      title: match.memory.title,
      memoryType: match.memory.memoryType,
    })),
    status: params.status,
    memoryIdsUsed: [],
    memoryIdsRejected: [],
    ...(params.topCandidates !== undefined && { topCandidates: params.topCandidates }),
  });

  return createResult.ok ? createResult.value.id : undefined;
}

function overlapRatio(left: string[], right: string[]): number {
  const leftTokens = new Set(left.flatMap((v) => tokenize(v)));
  const rightTokens = new Set(right.flatMap((v) => tokenize(v)));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const value of leftTokens) {
    if (rightTokens.has(value)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, 1);
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 4);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function clampField(value: string): string {
  return truncate(value, 700);
}

function parseJsonObject(response: string): unknown {
  const stripped = response.replace(/```(?:json)?\s*\n?([\s\S]*?)```/g, '$1');
  const match = /\{[\s\S]*\}/.exec(stripped);
  if (match === null) {
    throw new Error('Response did not contain a JSON object');
  }
  return JSON.parse(match[0]);
}

function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

export const __testables = {
  getLinearContext,
  normalizeQuery,
  buildFallbackNormalization,
  buildNormalizationPrompt,
  rerankMemories,
  parseJsonObject,
  truncate,
  overlapRatio,
  getMinRerankScore,
};
