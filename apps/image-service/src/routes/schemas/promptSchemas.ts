import type { LLMCorrelationOptions } from '@intexuraos/llm-contract';

export const generatePromptBodySchema = {
  type: 'object',
  required: ['text', 'model', 'userId'],
  properties: {
    text: {
      type: 'string',
      minLength: 10,
      maxLength: 60000,
      description: 'Content to visualize (10-60000 characters)',
    },
    model: {
      type: 'string',
      enum: ['gpt-4.1'],
      description: 'LLM model to use for prompt generation',
    },
    userId: {
      type: 'string',
      description: 'User ID for API key lookup',
    },
    promptType: {
      type: 'string',
      minLength: 1,
      description: 'Optional usage tracking prompt type',
    },
    correlation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        researchId: { type: ['string', 'null'] },
        sessionId: { type: ['string', 'null'] },
        taskId: { type: ['string', 'null'] },
        requestId: { type: ['string', 'null'] },
      },
      description: 'Optional usage attribution correlation fields',
    },
  },
  additionalProperties: false,
} as const;

const thumbnailPromptDataSchema = {
  type: 'object',
  required: ['title', 'visualSummary', 'prompt', 'negativePrompt', 'parameters'],
  properties: {
    title: {
      type: 'string',
      description: 'Short title for the image concept (max 10 words)',
    },
    visualSummary: {
      type: 'string',
      description: 'One sentence describing the core visual metaphor (max 25 words)',
    },
    prompt: {
      type: 'string',
      description: 'Image generation prompt (80-180 words)',
    },
    negativePrompt: {
      type: 'string',
      description: 'What to avoid (20-80 words)',
    },
    parameters: {
      type: 'object',
      required: ['framing', 'realism', 'people'],
      properties: {
        framing: { type: 'string' },
        realism: {
          type: 'string',
          enum: ['photorealistic', 'cinematic illustration', 'clean vector'],
        },
        people: { type: 'string' },
      },
    },
  },
} as const;

export const generatePromptResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: thumbnailPromptDataSchema,
    diagnostics: { $ref: 'Diagnostics#' },
  },
} as const;

export interface GeneratePromptBody {
  text: string;
  model: 'gpt-4.1';
  userId: string;
  promptType?: string | undefined;
  correlation?: LLMCorrelationOptions | undefined;
}
