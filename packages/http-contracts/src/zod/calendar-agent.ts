import { z } from 'zod';
import {
  apiErrorEnvelopeZodSchema,
  createApiSuccessEnvelopeSchema,
  serviceFeedbackZodSchema,
} from './common.js';

export const calendarProcessActionRequestSchema = z
  .object({
    action: z
      .object({
        id: z.string(),
        userId: z.string(),
        title: z.string(),
      })
      .strict(),
    text: z.string(),
  })
  .strict();

export const calendarProcessActionResponseSchema =
  createApiSuccessEnvelopeSchema(serviceFeedbackZodSchema);

export const calendarPreviewSchema = z
  .object({
    actionId: z.string(),
    userId: z.string(),
    status: z.enum(['pending', 'ready', 'failed']),
    summary: z.string().optional(),
    start: z.string().optional(),
    end: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    duration: z.string().nullable().optional(),
    isAllDay: z.boolean().optional(),
    error: z.string().optional(),
    reasoning: z.string().optional(),
    generatedAt: z.string(),
  })
  .strict();

export const calendarPreviewDataSchema = z
  .object({
    preview: calendarPreviewSchema.nullable(),
  })
  .strict();

export const calendarPreviewResponseSchema =
  createApiSuccessEnvelopeSchema(calendarPreviewDataSchema);

export const calendarPreviewEnvelopeSchema = z.union([
  calendarPreviewResponseSchema,
  apiErrorEnvelopeZodSchema,
]);

export const calendarGeneratePreviewRequestSchema = z
  .object({
    actionId: z.string(),
    userId: z.string(),
    text: z.string(),
    currentDate: z.string(),
  })
  .strict();

export type CalendarProcessActionRequest = z.infer<typeof calendarProcessActionRequestSchema>;
export type CalendarPreview = z.infer<typeof calendarPreviewSchema>;
export type CalendarPreviewData = z.infer<typeof calendarPreviewDataSchema>;
export type CalendarPreviewResponse = z.infer<typeof calendarPreviewResponseSchema>;
export type CalendarPreviewEnvelope = z.infer<typeof calendarPreviewEnvelopeSchema>;
export type CalendarGeneratePreviewRequest = z.infer<typeof calendarGeneratePreviewRequestSchema>;
