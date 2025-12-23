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
 * POST /v1/tools/notion/promptvault/prompts
 *
 * Schema constraints:
 * - title: max 200 characters (Notion page title practical limit)
 * - prompt: max 100,000 characters (Notion code block can handle large content;
 *   if chunking is needed in the future, implement deterministic splitting)
 * - strict: rejects any additional fields not in the schema
 */
export const createPromptRequestSchema = z
  .object({
    title: z.string().min(1, 'title is required').max(200, 'title must be at most 200 characters'),
    prompt: z
      .string()
      .min(1, 'prompt is required')
      .max(100000, 'prompt must be at most 100,000 characters'),
  })
  .strict();

export type CreatePromptRequest = z.infer<typeof createPromptRequestSchema>;

/**
 * PATCH /v1/tools/notion/promptvault/prompts/{promptId}
 *
 * At least one of title or prompt must be provided.
 */
export const updatePromptRequestSchema = z
  .object({
    title: z
      .string()
      .min(1, 'title cannot be empty')
      .max(200, 'title must be at most 200 characters')
      .optional(),
    prompt: z
      .string()
      .min(1, 'prompt cannot be empty')
      .max(100000, 'prompt must be at most 100,000 characters')
      .optional(),
  })
  .strict()
  .refine((data) => data.title !== undefined || data.prompt !== undefined, {
    message: 'at least one of title or prompt must be provided',
    path: [],
  });

export type UpdatePromptRequest = z.infer<typeof updatePromptRequestSchema>;

export const webhookRequestSchema = z.record(z.unknown());

export type WebhookRequest = z.infer<typeof webhookRequestSchema>;
