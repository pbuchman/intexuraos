import { z } from 'zod';

export const INTEX_AGENT_INTENT_CLASSIFIER_TOOL_NAMES = [
  'create_note',
  'create_calendar_event',
  'query_calendar_events',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'get_user_preferences',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
] as const;

export const IntexAgentIntentClassifierToolNameSchema = z.enum(
  INTEX_AGENT_INTENT_CLASSIFIER_TOOL_NAMES
);

const confidenceSchema = z.number().min(0).max(1);
const optionalQuestionSchema = z.string().optional();
const optionalReasonSchema = z.string().optional();

export const IntexAgentIntentClassifierOutputSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('tool'),
      confidence: confidenceSchema,
      allowedToolNames: z.array(IntexAgentIntentClassifierToolNameSchema),
      question: optionalQuestionSchema,
      reason: optionalReasonSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal('needs_clarification'),
      confidence: confidenceSchema,
      question: optionalQuestionSchema,
      reason: optionalReasonSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.enum(['conversation', 'greeting', 'unsupported']),
      confidence: confidenceSchema,
      question: optionalQuestionSchema,
      reason: optionalReasonSchema,
    })
    .strict(),
]);

export type IntexAgentIntentClassifierToolName = z.infer<
  typeof IntexAgentIntentClassifierToolNameSchema
>;

export type IntexAgentIntentClassifierOutput = z.infer<
  typeof IntexAgentIntentClassifierOutputSchema
>;
