import { z } from 'zod';
import { createApiSuccessEnvelopeSchema, serviceFeedbackZodSchema } from './common.js';

export const researchCreateDraftRequestSchema = z
  .object({
    userId: z.string(),
    title: z.string(),
    prompt: z.string(),
    originalMessage: z.string(),
    sourceActionId: z.string().optional(),
  })
  .strict();

export const researchCreateDraftResponseSchema =
  createApiSuccessEnvelopeSchema(serviceFeedbackZodSchema);

export type ResearchCreateDraftRequest = z.infer<typeof researchCreateDraftRequestSchema>;
