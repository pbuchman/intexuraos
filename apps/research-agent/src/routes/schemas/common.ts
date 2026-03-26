/**
 * Common JSON schema components for research endpoints.
 */

import { ALL_LLM_MODELS } from '@intexuraos/llm-contract';

export const supportedModelSchema = {
  anyOf: [
    { type: 'string', enum: ALL_LLM_MODELS },
    { type: 'string', pattern: '^or:[a-z0-9-]+/[a-z0-9._:-]+$' },
  ],
} as const;

/**
 * Intentionally relaxed to a plain string (no enum constraint).
 * Historical research documents may contain model IDs that have since been removed
 * from ALL_LLM_MODELS or the OpenRouter allowlist. Using the stricter
 * supportedModelSchema here would cause Fastify to strip those values from read
 * responses, breaking the UI's ability to display and guard against retired models.
 */
export const storedModelSchema = {
  type: 'string',
} as const;

export const llmProviderSchema = {
  type: 'string',
  enum: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'],
} as const;

export const storedLlmProviderSchema = {
  type: 'string',
} as const;

export const researchStatusSchema = {
  type: 'string',
  enum: [
    'draft',
    'pending',
    'processing',
    'awaiting_confirmation',
    'retrying',
    'synthesizing',
    'completed',
    'failed',
  ],
} as const;

export const llmResultSchema = {
  type: 'object',
  properties: {
    provider: storedLlmProviderSchema,
    model: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
    result: { type: 'string', nullable: true },
    error: { type: 'string', nullable: true },
    sources: { type: 'array', items: { type: 'string' }, nullable: true },
    startedAt: { type: 'string', nullable: true },
    completedAt: { type: 'string', nullable: true },
    durationMs: { type: 'number', nullable: true },
    inputTokens: { type: 'number', nullable: true },
    outputTokens: { type: 'number', nullable: true },
    costUsd: { type: 'number', nullable: true },
  },
  required: ['provider', 'model', 'status'],
} as const;

export const inputContextSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    content: { type: 'string' },
    label: { type: 'string', nullable: true },
    addedAt: { type: 'string' },
  },
  required: ['id', 'content', 'addedAt'],
} as const;

export const partialFailureSchema = {
  type: 'object',
  properties: {
    failedModels: {
      type: 'array',
      items: storedModelSchema,
    },
    userDecision: { type: 'string', enum: ['proceed', 'retry', 'cancel'], nullable: true },
    detectedAt: { type: 'string' },
    retryCount: { type: 'number' },
  },
  required: ['failedModels', 'detectedAt', 'retryCount'],
} as const;

export const shareInfoSchema = {
  type: 'object',
  properties: {
    shareToken: { type: 'string' },
    slug: { type: 'string' },
    shareUrl: { type: 'string' },
    sharedAt: { type: 'string' },
    gcsPath: { type: 'string' },
  },
  required: ['shareToken', 'slug', 'shareUrl', 'sharedAt', 'gcsPath'],
} as const;

export const notionExportInfoSchema = {
  type: 'object',
  properties: {
    mainPageId: { type: 'string' },
    mainPageUrl: { type: 'string' },
    llmReportPageIds: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          pageId: { type: 'string' },
        },
        required: ['model', 'pageId'],
      },
    },
    exportedAt: { type: 'string' },
  },
  required: ['mainPageId', 'mainPageUrl', 'llmReportPageIds', 'exportedAt'],
} as const;

export const researchSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    originalPrompt: { type: 'string', nullable: true },
    selectedModels: {
      type: 'array',
      items: storedModelSchema,
    },
    synthesisModel: storedModelSchema,
    status: researchStatusSchema,
    llmResults: {
      type: 'array',
      items: llmResultSchema,
    },
    inputContexts: {
      type: 'array',
      items: inputContextSchema,
      nullable: true,
    },
    synthesizedResult: { type: 'string', nullable: true },
    synthesisError: { type: 'string', nullable: true },
    partialFailure: { ...partialFailureSchema, nullable: true },
    shareInfo: { ...shareInfoSchema, nullable: true },
    notionExportInfo: { ...notionExportInfoSchema, nullable: true },
    startedAt: { type: 'string' },
    completedAt: { type: 'string', nullable: true },
    totalDurationMs: { type: 'number', nullable: true },
    totalInputTokens: { type: 'number', nullable: true },
    totalOutputTokens: { type: 'number', nullable: true },
    totalCostUsd: { type: 'number', nullable: true },
    sourceActionId: { type: 'string', nullable: true },
    sourceResearchId: { type: 'string', nullable: true },
    favourite: { type: 'boolean', nullable: true },
    userName: { type: 'string', nullable: true },
    userEmail: { type: 'string', nullable: true },
  },
  required: [
    'id',
    'userId',
    'title',
    'prompt',
    'selectedModels',
    'synthesisModel',
    'status',
    'llmResults',
    'startedAt',
  ],
} as const;
