import { LlmModels } from '@intexuraos/llm-contract';

export const generateImageBodySchema = {
  type: 'object',
  required: ['prompt', 'model', 'userId'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 10,
      maxLength: 2000,
      description: 'Image generation prompt (10-2000 characters)',
    },
    model: {
      type: 'string',
      enum: [LlmModels.GPTImage1, LlmModels.Gemini25FlashImage],
      description: 'Image generation model to use',
    },
    userId: {
      type: 'string',
      description: 'User ID for API key lookup and image ownership',
    },
    title: {
      type: 'string',
      maxLength: 100,
      description: 'Optional title for slug-based filename (from prompt generation)',
    },
  },
  additionalProperties: false,
} as const;

const generatedImageDataSchema = {
  type: 'object',
  required: ['id', 'thumbnailUrl', 'fullSizeUrl'],
  properties: {
    id: {
      type: 'string',
      description: 'Unique identifier for the generated image',
    },
    thumbnailUrl: {
      type: 'string',
      format: 'uri',
      description: 'GCS public URL for thumbnail image',
    },
    fullSizeUrl: {
      type: 'string',
      format: 'uri',
      description: 'GCS public URL for full-size image',
    },
  },
} as const;

export const generateImageResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: generatedImageDataSchema,
    diagnostics: { $ref: 'Diagnostics#' },
  },
} as const;

import type { GPTImage1, Gemini25FlashImage } from '@intexuraos/llm-contract';

export interface GenerateImageBody {
  prompt: string;
  model: GPTImage1 | Gemini25FlashImage;
  userId: string;
  title?: string;
}

export const deleteImageParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Image ID to delete' },
  },
} as const;

export const deleteImageResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      required: ['deleted'],
      properties: {
        deleted: { type: 'boolean', enum: [true] },
      },
    },
    diagnostics: { $ref: 'Diagnostics#' },
  },
} as const;

export interface DeleteImageParams {
  id: string;
}
