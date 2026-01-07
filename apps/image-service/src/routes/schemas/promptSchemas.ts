import { LlmModels } from '@intexuraos/llm-contract';
import type { Gemini25Pro } from '@intexuraos/llm-contract';

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
      enum: ['gpt-4.1', LlmModels.Gemini25Pro],
      description: 'LLM model to use for prompt generation',
    },
    userId: {
      type: 'string',
      description: 'User ID for API key lookup',
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
      required: ['aspectRatio', 'framing', 'textOnImage', 'realism', 'people', 'logosTrademarks'],
      properties: {
        aspectRatio: { type: 'string', enum: ['16:9'] },
        framing: { type: 'string' },
        textOnImage: { type: 'string', enum: ['none'] },
        realism: {
          type: 'string',
          enum: ['photorealistic', 'cinematic illustration', 'clean vector'],
        },
        people: { type: 'string' },
        logosTrademarks: { type: 'string', enum: ['none'] },
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
  model: 'gpt-4.1' | Gemini25Pro;
  userId: string;
}
