/**
 * Schemas for input validation and improvement endpoints.
 */

export const validateInputBodySchema = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 1,
      maxLength: 20000,
      description: 'The research prompt to validate',
    },
    includeImprovement: {
      type: 'boolean',
      description: 'If true and quality is WEAK_BUT_VALID (1), also return improved version',
    },
  },
} as const;

export const validateInputResponseSchema = {
  type: 'object',
  required: ['quality', 'reason'],
  properties: {
    quality: {
      type: 'number',
      enum: [0, 1, 2],
      description: 'Quality score: 0=INVALID, 1=WEAK_BUT_VALID, 2=GOOD',
    },
    reason: {
      type: 'string',
      description: 'Brief explanation of the quality assessment',
    },
    improvedPrompt: {
      type: ['string', 'null'],
      description: 'Improved version if requested and quality is WEAK_BUT_VALID',
    },
  },
} as const;

export const improveInputBodySchema = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 1,
      maxLength: 20000,
      description: 'The research prompt to improve',
    },
  },
} as const;

export const improveInputResponseSchema = {
  type: 'object',
  required: ['improvedPrompt'],
  properties: {
    improvedPrompt: {
      type: 'string',
      description: 'The improved version of the prompt',
    },
  },
} as const;
