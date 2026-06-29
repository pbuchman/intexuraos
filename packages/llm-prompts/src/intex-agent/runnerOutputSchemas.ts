import { z } from 'zod';
import { IntexAgentToolNameSchema } from './toolNames.js';

const replySchema = z.string().min(1);
const optionalSummarySchema = z.string().optional();

export const IntexAgentRunnerOutputSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('completed'),
      reply: replySchema,
      summary: optionalSummarySchema,
      toolName: IntexAgentToolNameSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.enum(['needs_clarification', 'no_action', 'unsupported']),
      reply: replySchema,
      summary: optionalSummarySchema,
    })
    .strict(),
]);

export type IntexAgentRunnerOutput = z.infer<typeof IntexAgentRunnerOutputSchema>;
