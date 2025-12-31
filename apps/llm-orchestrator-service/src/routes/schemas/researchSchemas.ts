/**
 * JSON schemas for research endpoints.
 */

import { llmProviderSchema, researchSchema } from './common.js';

export const createResearchBodySchema = {
  type: 'object',
  required: ['prompt', 'selectedLlms'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 10,
      maxLength: 20000,
    },
    selectedLlms: {
      type: 'array',
      items: llmProviderSchema,
      minItems: 1,
      maxItems: 3,
    },
    synthesisLlm: llmProviderSchema,
    externalReports: {
      type: 'array',
      items: {
        type: 'object',
        required: ['content'],
        properties: {
          content: {
            type: 'string',
            maxLength: 60000,
          },
          model: {
            type: 'string',
            maxLength: 100,
          },
        },
      },
      maxItems: 5,
      nullable: true,
    },
  },
} as const;

export const createResearchResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: researchSchema,
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const listResearchesQuerySchema = {
  type: 'object',
  properties: {
    limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
    cursor: { type: 'string' },
  },
} as const;

export const listResearchesResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: researchSchema,
        },
        nextCursor: { type: 'string', nullable: true },
      },
    },
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const getResearchResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: researchSchema,
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const deleteResearchResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const researchIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;
