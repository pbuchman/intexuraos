import { LlmModels } from '@intexuraos/llm-contract';
import { z } from 'zod';
import { createApiSuccessEnvelopeSchema } from './common.js';

const llmCorrelationSchema = z
  .object({
    researchId: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    taskId: z.string().nullable().optional(),
    requestId: z.string().nullable().optional(),
  })
  .strict();

export const imageGeneratePromptRequestSchema = z
  .object({
    text: z.string().min(10).max(60000),
    model: z.literal('gpt-4.1'),
    userId: z.string(),
    promptType: z.string().min(1).optional(),
    correlation: llmCorrelationSchema.optional(),
  })
  .strict();

export const imageThumbnailPromptSchema = z
  .object({
    title: z.string(),
    visualSummary: z.string(),
    prompt: z.string(),
    negativePrompt: z.string(),
    parameters: z
      .object({
        framing: z.string(),
        realism: z.enum(['photorealistic', 'cinematic illustration', 'clean vector']),
        people: z.string(),
      })
      .strict(),
  })
  .strict();

export const imageGeneratePromptResponseSchema = createApiSuccessEnvelopeSchema(
  imageThumbnailPromptSchema
);

export const imageGenerateImageRequestSchema = z
  .object({
    prompt: z.string().min(10).max(2000),
    model: z.literal(LlmModels.GPTImage1),
    userId: z.string(),
    title: z.string().max(100).optional(),
    promptType: z.string().min(1).optional(),
    correlation: llmCorrelationSchema.optional(),
  })
  .strict();

export const imageGeneratedImageDataSchema = z
  .object({
    id: z.string(),
    thumbnailUrl: z.string().url(),
    fullSizeUrl: z.string().url(),
  })
  .strict();

export const imageGenerateImageResponseSchema = createApiSuccessEnvelopeSchema(
  imageGeneratedImageDataSchema
);

export const imageDeleteImageResponseSchema = createApiSuccessEnvelopeSchema(
  z
    .object({
      deleted: z.literal(true),
    })
    .strict()
);

export type ImageGeneratePromptRequest = z.infer<typeof imageGeneratePromptRequestSchema>;
export type ImageThumbnailPrompt = z.infer<typeof imageThumbnailPromptSchema>;
export type ImageGenerateImageRequest = z.infer<typeof imageGenerateImageRequestSchema>;
export type ImageGeneratedImageData = z.infer<typeof imageGeneratedImageDataSchema>;
