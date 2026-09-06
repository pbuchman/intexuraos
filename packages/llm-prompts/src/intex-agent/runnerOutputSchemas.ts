import { z } from 'zod';
import { IntexAgentToolNameSchema } from './toolNames.js';
import { IntexAgentBlockerReasonSchema } from './intentClassifierSchemas.js';

const replySchema = z.string().min(1);
const optionalSummarySchema = z.string().optional();
const clarificationOnlyBlockerReasons = new Set<z.infer<typeof IntexAgentBlockerReasonSchema>>([
  'missing_required_details',
  'not_enough_context',
  'multiple_possible_intents',
  'ambiguous_preference_target',
]);

const optionalMetadataFields = {
  blockerReason: IntexAgentBlockerReasonSchema.optional(),
  missingFields: z.array(z.string()).optional(),
  suggestedNextStep: z.string().optional(),
  clarification: z.string().optional(),
  candidateIntents: z.array(IntexAgentToolNameSchema).optional(),
  errorCategory: z
    .enum([
      'validation',
      'transient',
      'permission',
      'business',
      'configuration',
      'version_conflict',
      'unknown',
    ])
    .optional(),
  isRetryable: z.boolean().optional(),
  attemptedAction: z.string().optional(),
} as const;

export const IntexAgentRunnerOutputSchema = z.union([
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
      outcome: z.literal('needs_clarification'),
      reply: replySchema,
      summary: optionalSummarySchema,
      ...optionalMetadataFields,
    })
    .strict()
    .superRefine((value, context) => {
      if (!looksLikeQuestion(value.reply) && isBlank(value.clarification)) {
        context.addIssue({
          code: 'custom',
          message: 'needs_clarification requires a question-like reply or clarification',
          path: ['clarification'],
        });
      }
    }),
  z
    .object({
      outcome: z.literal('no_action'),
      reply: replySchema,
      summary: optionalSummarySchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal('unsupported'),
      reply: replySchema,
      summary: optionalSummarySchema,
      ...optionalMetadataFields,
      blockerReason: IntexAgentBlockerReasonSchema,
      suggestedNextStep: z.string().min(1),
    })
    .strict()
    .superRefine((value, context) => {
      if (clarificationOnlyBlockerReasons.has(value.blockerReason)) {
        context.addIssue({
          code: 'custom',
          message: `${value.blockerReason} requires needs_clarification`,
          path: ['blockerReason'],
        });
      }
    }),
]);

export type IntexAgentRunnerOutput = z.infer<typeof IntexAgentRunnerOutputSchema>;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

function looksLikeQuestion(value: string): boolean {
  return /[?？]\s*$/u.test(value.trim());
}
