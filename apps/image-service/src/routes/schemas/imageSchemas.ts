export const generateImageBodySchema = {
  type: 'object',
  required: ['prompt', 'model'],
  properties: {
    prompt: {
      type: 'string',
      minLength: 10,
      maxLength: 2000,
      description: 'Image generation prompt (10-2000 characters)',
    },
    model: {
      type: 'string',
      enum: ['gpt-image-1', 'nano-banana-pro'],
      description: 'Image generation model to use',
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
  model: 'gpt-image-1' | 'nano-banana-pro';
}
