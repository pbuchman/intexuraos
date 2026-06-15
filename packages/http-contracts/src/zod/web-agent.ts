import { z } from 'zod';
import { createApiSuccessEnvelopeSchema } from './common.js';

export const webAgentFetchLinkPreviewsRequestSchema = z
  .object({
    urls: z.array(z.string().url()).min(1).max(10),
    timeoutMs: z.number().min(1000).max(30000).optional(),
  })
  .strict();

export const webAgentLinkPreviewSchema = z
  .object({
    url: z.string().url(),
    title: z.string().optional(),
    description: z.string().optional(),
    image: z.string().url().optional(),
    favicon: z.string().url().optional(),
    siteName: z.string().optional(),
  })
  .strict();

export const webAgentLinkPreviewErrorSchema = z
  .object({
    code: z.enum(['FETCH_FAILED', 'TIMEOUT', 'TOO_LARGE', 'INVALID_URL', 'ACCESS_DENIED']),
    message: z.string(),
  })
  .strict();

export const webAgentLinkPreviewResultSchema = z
  .object({
    url: z.string().url(),
    status: z.enum(['success', 'failed']),
    preview: webAgentLinkPreviewSchema.optional(),
    error: webAgentLinkPreviewErrorSchema.optional(),
  })
  .strict();

export const webAgentLinkPreviewMetadataSchema = z
  .object({
    requestedCount: z.number(),
    successCount: z.number(),
    failedCount: z.number(),
    durationMs: z.number(),
  })
  .strict();

export const webAgentFetchLinkPreviewsDataSchema = z
  .object({
    results: z.array(webAgentLinkPreviewResultSchema),
    metadata: webAgentLinkPreviewMetadataSchema,
  })
  .strict();

export const webAgentFetchLinkPreviewsResponseSchema = createApiSuccessEnvelopeSchema(
  webAgentFetchLinkPreviewsDataSchema
);

export const webAgentSummarizePageRequestSchema = z
  .object({
    url: z.string().url(),
    userId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    maxSentences: z.number().min(1).max(50).optional(),
    maxReadingMinutes: z.number().min(1).max(10).optional(),
  })
  .strict();

export const webAgentPageSummarySchema = z
  .object({
    url: z.string().url(),
    summary: z.string(),
    wordCount: z.number(),
    estimatedReadingMinutes: z.number(),
  })
  .strict();

export const webAgentPageSummaryErrorSchema = z
  .object({
    code: z.enum([
      'FETCH_FAILED',
      'TIMEOUT',
      'TOO_LARGE',
      'INVALID_URL',
      'NO_CONTENT',
      'API_ERROR',
    ]),
    message: z.string(),
  })
  .strict();

export const webAgentPageSummaryResultSchema = z
  .object({
    url: z.string().url(),
    status: z.enum(['success', 'failed']),
    summary: webAgentPageSummarySchema.optional(),
    error: webAgentPageSummaryErrorSchema.optional(),
  })
  .strict();

export const webAgentPageSummaryMetadataSchema = z
  .object({
    durationMs: z.number(),
  })
  .strict();

export const webAgentSummarizePageDataSchema = z
  .object({
    result: webAgentPageSummaryResultSchema,
    metadata: webAgentPageSummaryMetadataSchema,
  })
  .strict();

export const webAgentSummarizePageResponseSchema = createApiSuccessEnvelopeSchema(
  webAgentSummarizePageDataSchema
);

export type WebAgentFetchLinkPreviewsRequest = z.infer<
  typeof webAgentFetchLinkPreviewsRequestSchema
>;
export type WebAgentLinkPreview = z.infer<typeof webAgentLinkPreviewSchema>;
export type WebAgentFetchLinkPreviewsData = z.infer<typeof webAgentFetchLinkPreviewsDataSchema>;
export type WebAgentSummarizePageRequest = z.infer<typeof webAgentSummarizePageRequestSchema>;
export type WebAgentPageSummary = z.infer<typeof webAgentPageSummarySchema>;
export type WebAgentSummarizePageData = z.infer<typeof webAgentSummarizePageDataSchema>;
