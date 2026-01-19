/**
 * JSON schemas for research endpoints.
 */

import { researchSchema, supportedModelSchema } from './common.js';

export const createResearchBodySchema = {
  type: 'object',
  required: ['prompt', 'selectedModels'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 10,
      maxLength: 20000,
    },
    originalPrompt: {
      type: 'string',
      maxLength: 20000,
      description: 'Original user prompt before improvement. Set when user accepted an improved suggestion.',
    },
    selectedModels: {
      type: 'array',
      items: supportedModelSchema,
      minItems: 1,
      maxItems: 6,
    },
    synthesisModel: supportedModelSchema,
    inputContexts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['content'],
        properties: {
          content: {
            type: 'string',
            maxLength: 60000,
          },
          label: {
            type: 'string',
            maxLength: 100,
          },
        },
      },
      maxItems: 5,
      nullable: true,
    },
    skipSynthesis: {
      type: 'boolean',
      description: 'Skip synthesis step (for single-model research without input context)',
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

export const approveResearchResponseSchema = {
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

export const saveDraftBodySchema = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 1,
      maxLength: 20000,
    },
    selectedModels: {
      type: 'array',
      items: supportedModelSchema,
      maxItems: 6,
    },
    synthesisModel: supportedModelSchema,
    inputContexts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['content'],
        properties: {
          content: {
            type: 'string',
            maxLength: 60000,
          },
          label: {
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

export const updateDraftBodySchema = saveDraftBodySchema;

export const saveDraftResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        id: { type: 'string' },
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

export const confirmPartialFailureBodySchema = {
  type: 'object',
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['proceed', 'retry', 'cancel'],
      description:
        'User decision for partial failure: proceed with successful results, retry failed providers, or cancel',
    },
  },
} as const;

export const confirmPartialFailureResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        message: { type: 'string' },
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

export const retryFromFailedResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['retried_llms', 'retried_synthesis', 'already_completed'],
        },
        message: { type: 'string' },
        retriedModels: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
        },
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

export const enhanceResearchBodySchema = {
  type: 'object',
  properties: {
    additionalModels: {
      type: 'array',
      items: supportedModelSchema,
      maxItems: 6,
      description: 'Additional models to run research with',
    },
    additionalContexts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['content'],
        properties: {
          content: {
            type: 'string',
            maxLength: 60000,
          },
          label: {
            type: 'string',
            maxLength: 100,
          },
        },
      },
      maxItems: 5,
      description: 'Additional custom sources/contexts to include',
    },
    synthesisModel: supportedModelSchema,
    removeContextIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'IDs of existing contexts to remove',
    },
  },
} as const;

export const enhanceResearchResponseSchema = {
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

export const toggleFavouriteBodySchema = {
  type: 'object',
  required: ['favourite'],
  properties: {
    favourite: { type: 'boolean' },
  },
} as const;

export const toggleFavouriteResponseSchema = {
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
