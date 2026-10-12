import { z } from 'zod';

/** Notification identity is additive to ordinary session correlation. Never encode payloads here. */
export const notificationContextSchema = z
  .object({
    source: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
    runId: z.string().min(1).max(256),
    phase: z.enum(['ack', 'final']),
    outcome: z.enum(['succeeded', 'failed']).optional(),
    partIndex: z.number().int().min(0).max(999).optional(),
    partCount: z.number().int().min(1).max(1000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.phase !== 'final' ||
      (value.outcome !== undefined &&
        value.partIndex !== undefined &&
        value.partCount !== undefined &&
        value.partIndex < value.partCount),
    'Final notification context requires outcome and complete part numbering'
  );
export type NotificationContext = z.infer<typeof notificationContextSchema>;
export const transportConfirmationSchema = z
  .object({
    status: z.enum(['pending', 'delivered', 'read', 'failed']),
    deliveredAt: z.string().datetime().optional(),
    readAt: z.string().datetime().optional(),
    failedAt: z.string().datetime().optional(),
    failureCode: z.string().max(128).optional(),
  })
  .strict();
export type TransportConfirmation = z.infer<typeof transportConfirmationSchema>;
export const notificationRunStateSchema = z
  .object({
    status: z.enum(['pending', 'delivered', 'failed']),
    deliveredAt: z.string().datetime().optional(),
    failureCode: z.string().max(128).optional(),
    stage: z
      .enum(['awaiting_ingress', 'processing', 'awaiting_delivery', 'delivered', 'failed'])
      .optional(),
  })
  .strict();
export type NotificationRunState = z.infer<typeof notificationRunStateSchema>;
