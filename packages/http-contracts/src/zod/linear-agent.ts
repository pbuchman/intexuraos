import { z } from 'zod';
import { createApiSuccessEnvelopeSchema, serviceFeedbackZodSchema } from './common.js';

export const linearProcessActionRequestSchema = z
  .object({
    action: z
      .object({
        id: z.string(),
        userId: z.string(),
        text: z.string(),
        summary: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const linearProcessActionResponseSchema =
  createApiSuccessEnvelopeSchema(serviceFeedbackZodSchema);

export type LinearProcessActionRequest = z.infer<typeof linearProcessActionRequestSchema>;
