import { z } from 'zod';
import { createApiSuccessEnvelopeSchema, serviceFeedbackZodSchema } from './common.js';

export const todosCreateTodoRequestSchema = z
  .object({
    userId: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    tags: z.array(z.string()),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    dueDate: z.string().nullable().optional(),
    source: z.string(),
    sourceId: z.string(),
  })
  .strict();

export const todosCreateTodoResponseSchema =
  createApiSuccessEnvelopeSchema(serviceFeedbackZodSchema);

export type TodosCreateTodoRequest = z.infer<typeof todosCreateTodoRequestSchema>;
