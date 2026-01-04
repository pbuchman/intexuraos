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
      enum: ['gpt-image-1', 'gemini-2.5-flash-image'],
      description: 'Image generation model to use',
    },
    userId: {
      type: 'string',
      description: 'User ID for API key lookup and image ownership',
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

export interface GenerateImageBody {
  prompt: string;
  model: 'gpt-image-1' | 'gemini-2.5-flash-image';
  userId: string;
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
