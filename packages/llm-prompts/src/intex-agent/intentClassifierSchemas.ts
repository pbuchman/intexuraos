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
const nonEmptyStringSchema = z.string().min(1);

export const IntexAgentBlockerReasonSchema = z.enum([
  'unsupported_capability',
  'missing_required_details',
  'multiple_possible_intents',
  'tool_boundary',
  'permission_or_configuration',
  'not_enough_context',
  'ambiguous_preference_target',
]);

export const IntexAgentStylePreferenceActionSchema = z.enum([
  'none',
  'apply_this_turn_only',
  'save_new',
  'update_existing',
  'delete_existing',
  'needs_clarification',
]);

const clarificationOnlyBlockerReasons = new Set<z.infer<typeof IntexAgentBlockerReasonSchema>>([
  'missing_required_details',
  'not_enough_context',
  'multiple_possible_intents',
  'ambiguous_preference_target',
]);

const preferenceActionToolRequirements: Partial<
  Record<z.infer<typeof IntexAgentStylePreferenceActionSchema>, readonly IntexAgentPromptToolName[]>
> = {
  save_new: ['add_user_preference'],
  update_existing: ['update_user_preference'],
  delete_existing: ['delete_user_preference'],
};

const commonClassifierFields = {
  confidence: confidenceSchema,
  question: optionalQuestionSchema,
  clarification: z.string().optional(),
  reason: optionalReasonSchema,
  blockerReason: IntexAgentBlockerReasonSchema.optional(),
  missingFields: z.array(nonEmptyStringSchema).optional(),
  candidateIntents: z.array(IntexAgentIntentClassifierToolNameSchema).optional(),
  suggestedNextStep: z.string().optional(),
  stylePreferenceAction: IntexAgentStylePreferenceActionSchema,
  languageOverride: z.string().optional(),
  decisionEvidence: z.string().optional(),
} as const;

export const IntexAgentIntentClassifierOutputSchema = z.union([
  z
    .object({
      outcome: z.literal('tool'),
      ...commonClassifierFields,
      allowedToolNames: z.array(IntexAgentIntentClassifierToolNameSchema).min(1),
    })
    .strict()
    .superRefine((value, context) => {
      const requiredTools = preferenceActionToolRequirements[value.stylePreferenceAction];
      if (
        requiredTools !== undefined &&
        !requiredTools.some((toolName) => value.allowedToolNames.includes(toolName))
      ) {
        context.addIssue({
          code: 'custom',
          message: `${value.stylePreferenceAction} requires a matching preference tool`,
          path: ['allowedToolNames'],
        });
      }
      if (
        value.stylePreferenceAction === 'apply_this_turn_only' ||
        value.stylePreferenceAction === 'needs_clarification'
      ) {
        context.addIssue({
          code: 'custom',
          message: `${value.stylePreferenceAction} is not a tool outcome`,
          path: ['stylePreferenceAction'],
        });
      }
    }),
  z
    .object({
      outcome: z.literal('needs_clarification'),
      ...commonClassifierFields,
      blockerReason: IntexAgentBlockerReasonSchema,
    })
    .strict()
    .superRefine((value, context) => {
      if (isBlank(value.question) && isBlank(value.clarification)) {
        context.addIssue({
          code: 'custom',
          message: 'needs_clarification requires question or clarification',
          path: ['question'],
        });
      }
      if (value.blockerReason === 'missing_required_details') {
        if (value.missingFields === undefined || value.missingFields.length === 0) {
          context.addIssue({
            code: 'custom',
            message: 'missing_required_details requires at least one missing field',
            path: ['missingFields'],
          });
        }
        if (value.candidateIntents === undefined || value.candidateIntents.length === 0) {
          context.addIssue({
            code: 'custom',
            message: 'missing_required_details requires at least one candidate tool intent',
            path: ['candidateIntents'],
          });
        }
      }
    }),
  z
    .object({
      outcome: z.enum(['conversation', 'greeting', 'retain_context']),
      ...commonClassifierFields,
    })
    .strict(),
  z
    .object({
      outcome: z.literal('unsupported'),
      ...commonClassifierFields,
      blockerReason: IntexAgentBlockerReasonSchema,
      suggestedNextStep: nonEmptyStringSchema,
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

export type IntexAgentIntentClassifierToolName = IntexAgentPromptToolName;
export type IntexAgentBlockerReason = z.infer<typeof IntexAgentBlockerReasonSchema>;
export type IntexAgentStylePreferenceAction = z.infer<typeof IntexAgentStylePreferenceActionSchema>;

export type IntexAgentIntentClassifierOutput = z.infer<
  typeof IntexAgentIntentClassifierOutputSchema
>;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}
