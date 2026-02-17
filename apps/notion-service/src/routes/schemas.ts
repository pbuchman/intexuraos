import { z } from 'zod';

/**
 * POST /notion/connect
 */
export const connectRequestSchema = z.object({
  notionToken: z.string().min(1, 'notionToken is required'),
});

export type ConnectRequest = z.infer<typeof connectRequestSchema>;

export const webhookRequestSchema = z.record(z.unknown());

export type WebhookRequest = z.infer<typeof webhookRequestSchema>;
