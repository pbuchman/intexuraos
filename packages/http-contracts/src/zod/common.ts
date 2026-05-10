import { z } from 'zod';

export const diagnosticsZodSchema = z
  .object({
    requestId: z.string().optional(),
    durationMs: z.number().optional(),
    downstreamStatus: z.number().int().optional(),
    downstreamRequestId: z.string().optional(),
    endpointCalled: z.string().optional(),
  })
  .strict();

export const errorBodyZodSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const serviceFeedbackZodSchema = z
  .object({
    status: z.enum(['completed', 'failed']),
    message: z.string(),
    resourceUrl: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .strict();

export function createApiSuccessEnvelopeSchema<TSchema extends z.ZodTypeAny>(
  dataSchema: TSchema
): z.ZodObject<
  {
    success: z.ZodLiteral<true>;
    data: TSchema;
    diagnostics: z.ZodOptional<typeof diagnosticsZodSchema>;
  },
  'strict'
> {
  return z
    .object({
      success: z.literal(true),
      data: dataSchema,
      diagnostics: diagnosticsZodSchema.optional(),
    })
    .strict();
}

export const apiErrorEnvelopeZodSchema = z
  .object({
    success: z.literal(false),
    error: errorBodyZodSchema,
    diagnostics: diagnosticsZodSchema.optional(),
  })
  .strict();
