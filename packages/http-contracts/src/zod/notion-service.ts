import { z } from 'zod';
import { createApiSuccessEnvelopeSchema } from './common.js';

export const notionTokenContextSchema = z
  .object({
    connected: z.boolean(),
    token: z.string().nullable(),
  })
  .strict();

export const notionTokenContextResponseSchema =
  createApiSuccessEnvelopeSchema(notionTokenContextSchema);

export const notionPagePreviewSchema = z
  .object({
    title: z.string(),
    url: z.string().url(),
  })
  .strict();

export const notionPagePreviewResponseSchema =
  createApiSuccessEnvelopeSchema(notionPagePreviewSchema);

export type NotionTokenContext = z.infer<typeof notionTokenContextSchema>;
export type NotionPagePreview = z.infer<typeof notionPagePreviewSchema>;
