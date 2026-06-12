import { z } from 'zod';
import { createApiSuccessEnvelopeSchema, serviceFeedbackZodSchema } from './common.js';

export const notesCreateNoteRequestSchema = z
  .object({
    userId: z.string(),
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    source: z.string(),
    sourceId: z.string(),
  })
  .strict();

export const notesCreateNoteResponseSchema =
  createApiSuccessEnvelopeSchema(serviceFeedbackZodSchema);

export type NotesCreateNoteRequest = z.infer<typeof notesCreateNoteRequestSchema>;
