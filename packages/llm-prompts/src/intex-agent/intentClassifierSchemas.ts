import { z } from 'zod';
import {
  INTEX_AGENT_TOOL_NAMES,
  IntexAgentToolNameSchema,
  type IntexAgentPromptToolName,
} from './toolNames.js';

export const INTEX_AGENT_INTENT_CLASSIFIER_TOOL_NAMES = INTEX_AGENT_TOOL_NAMES;
export const IntexAgentIntentClassifierToolNameSchema = IntexAgentToolNameSchema;

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

export type IntexAgentIntentClassifierToolName = IntexAgentPromptToolName;

export type IntexAgentIntentClassifierOutput = z.infer<
  typeof IntexAgentIntentClassifierOutputSchema
>;
