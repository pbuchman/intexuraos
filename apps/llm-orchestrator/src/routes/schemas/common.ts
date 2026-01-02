/**
 * Common JSON schema components for research endpoints.
 */

export const llmProviderSchema = {
  type: 'string',
  enum: ['google', 'openai', 'anthropic'],
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
  },
  required: ['provider', 'model', 'status'],
} as const;

export const inputContextSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    content: { type: 'string' },
    addedAt: { type: 'string' },
  },
  required: ['id', 'content', 'addedAt'],
} as const;

export const externalReportSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    content: { type: 'string' },
    model: { type: 'string', nullable: true },
    addedAt: { type: 'string' },
  },
  required: ['id', 'content', 'addedAt'],
} as const;

export const partialFailureSchema = {
  type: 'object',
  properties: {
    failedProviders: {
      type: 'array',
      items: llmProviderSchema,
    },
    userDecision: { type: 'string', enum: ['proceed', 'retry', 'cancel'], nullable: true },
    detectedAt: { type: 'string' },
    retryCount: { type: 'number' },
  },
  required: ['failedProviders', 'detectedAt', 'retryCount'],
} as const;

export const researchSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    selectedLlms: {
      type: 'array',
      items: llmProviderSchema,
    },
    synthesisLlm: llmProviderSchema,
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
    externalReports: {
      type: 'array',
      items: externalReportSchema,
      nullable: true,
    },
    synthesizedResult: { type: 'string', nullable: true },
    synthesisError: { type: 'string', nullable: true },
    partialFailure: { ...partialFailureSchema, nullable: true },
    startedAt: { type: 'string' },
    completedAt: { type: 'string', nullable: true },
    totalDurationMs: { type: 'number', nullable: true },
    sourceActionId: { type: 'string', nullable: true },
  },
  required: [
    'id',
    'userId',
    'title',
    'prompt',
    'selectedLlms',
    'synthesisLlm',
    'status',
    'llmResults',
    'startedAt',
  ],
} as const;
