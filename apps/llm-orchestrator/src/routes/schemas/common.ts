/**
 * Common JSON schema components for research endpoints.
 */

import { SUPPORTED_MODELS } from '@intexuraos/llm-contract';

export const supportedModelSchema = {
  type: 'string',
  enum: Object.keys(SUPPORTED_MODELS),
} as const;

export const llmProviderSchema = {
  type: 'string',
  enum: ['google', 'openai', 'anthropic', 'perplexity'],
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
    provider: llmProviderSchema,
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
      items: supportedModelSchema,
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

export const researchSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    selectedModels: {
      type: 'array',
      items: supportedModelSchema,
    },
    synthesisModel: supportedModelSchema,
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
    startedAt: { type: 'string' },
    completedAt: { type: 'string', nullable: true },
    totalDurationMs: { type: 'number', nullable: true },
    totalInputTokens: { type: 'number', nullable: true },
    totalOutputTokens: { type: 'number', nullable: true },
    totalCostUsd: { type: 'number', nullable: true },
    sourceActionId: { type: 'string', nullable: true },
    sourceResearchId: { type: 'string', nullable: true },
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
