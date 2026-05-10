import { z } from 'zod';
import { createApiSuccessEnvelopeSchema } from './common.js';

export const bookmarksBookmarkStatusSchema = z.enum(['draft', 'active']);
export const bookmarksOgFetchStatusSchema = z.enum(['pending', 'processed', 'failed']);

export const bookmarksOpenGraphPreviewSchema = z
  .object({
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    siteName: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    favicon: z.string().nullable().optional(),
  })
  .strict();

export const bookmarksBookmarkSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    status: bookmarksBookmarkStatusSchema,
    url: z.string().url(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
    ogPreview: bookmarksOpenGraphPreviewSchema.nullable(),
    ogFetchedAt: z.string().nullable(),
    ogFetchStatus: bookmarksOgFetchStatusSchema,
    aiSummary: z.string().nullable(),
    aiSummarizedAt: z.string().nullable(),
    source: z.string(),
    sourceId: z.string(),
    archived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const bookmarksCreateBookmarkRequestSchema = z
  .object({
    userId: z.string().min(1),
    url: z.string().url(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: bookmarksBookmarkStatusSchema.optional(),
    source: z.string().min(1),
    sourceId: z.string().min(1),
  })
  .strict();

export const bookmarksCreateBookmarkDataSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    bookmark: bookmarksBookmarkSchema,
  })
  .strict();

export const bookmarksCreateBookmarkResponseSchema = createApiSuccessEnvelopeSchema(
  bookmarksCreateBookmarkDataSchema
);

export const bookmarksBookmarkResponseSchema =
  createApiSuccessEnvelopeSchema(bookmarksBookmarkSchema);

export type BookmarksBookmark = z.infer<typeof bookmarksBookmarkSchema>;
export type BookmarksCreateBookmarkRequest = z.infer<typeof bookmarksCreateBookmarkRequestSchema>;
export type BookmarksCreateBookmarkData = z.infer<typeof bookmarksCreateBookmarkDataSchema>;
