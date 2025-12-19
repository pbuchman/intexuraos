import { z } from 'zod';

/**
 * POST /v1/integrations/notion/connect
 */
export const connectRequestSchema = z.object({
  notionToken: z.string().min(1, 'notionToken is required'),
  promptVaultPageId: z.string().min(1, 'promptVaultPageId is required'),
});

export type ConnectRequest = z.infer<typeof connectRequestSchema>;

/**
 * POST /v1/tools/notion/promptvault/note
 *
 * Schema constraints:
 * - title: max 200 characters (Notion page title practical limit)
 * - prompt: max 100,000 characters (Notion code block can handle large content;
 *   if chunking is needed in the future, implement deterministic splitting)
 * - strict: rejects any additional fields not in the schema
 */
export const createPromptVaultNoteRequestSchema = z
  .object({
    title: z.string().min(1, 'title is required').max(200, 'title must be at most 200 characters'),
    prompt: z
      .string()
      .min(1, 'prompt is required')
      .max(100000, 'prompt must be at most 100,000 characters'),
  })
  .strict();

export type CreatePromptVaultNoteRequest = z.infer<typeof createPromptVaultNoteRequestSchema>;

/**
 * POST /v1/webhooks/notion
 */
export const webhookRequestSchema = z.record(z.unknown());

export type WebhookRequest = z.infer<typeof webhookRequestSchema>;
