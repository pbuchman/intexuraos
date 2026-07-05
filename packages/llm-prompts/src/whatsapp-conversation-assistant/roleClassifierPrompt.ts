import { formatZodErrors } from '@intexuraos/llm-utils';
import { z } from 'zod';

import type { PromptBuilder } from '../types.js';

export const CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT: PromptBuilder<ConversationAssistantRoleClassifierPromptInput> =
  {
    name: 'whatsapp-conversation-assistant-role-classifier',
    description: 'Infers a safe professional assistant role label from the initial user question',
    version: '1.0.0',
    build(input: ConversationAssistantRoleClassifierPromptInput): string {
      return [
        'Infer the professional or expert role label that should be displayed for an assistant session.',
        'Use only the initial user question. Do not use or request the private WhatsApp transcript.',
        'The role label is not a fixed enum: allow any real profession or expert role when strongly implied.',
        'Examples include doctor, psychologist, lawyer, software engineer, tax advisor, teacher, mediator, mechanic, career coach, and other professions.',
        'If the question is generic, unclear, casual, or not profession-specific, use roleLabel "Assistant" with confidence below 0.6.',
        'Return one concise display label, maximum three words and 40 characters.',
        'Do not output personal names or titles, company or organization names, credentials, markdown, punctuation-heavy labels, explanations outside JSON, or claims like licensed/certified.',
        'Return only JSON matching this shape: {"roleLabel":"string","confidence":0.0,"rationale":"string"}.',
        '',
        `Initial question:\n${input.initialQuestion.trim()}`,
      ].join('\n');
    },
  };

export interface ConversationAssistantRoleClassifierRepairPromptInput extends ConversationAssistantRoleClassifierPromptInput {
  raw: string;
  validationErrors: string;
}

export const CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_REPAIR_PROMPT: PromptBuilder<ConversationAssistantRoleClassifierRepairPromptInput> =
  {
    name: 'whatsapp-conversation-assistant-role-classifier-repair',
    description:
      'Repairs invalid role classifier JSON while preserving initial-question-only scope',
    version: '1.0.0',
    build(input: ConversationAssistantRoleClassifierRepairPromptInput): string {
      return [
        'The previous role-classification response was invalid.',
        `Validation errors: ${input.validationErrors}`,
        'Return only valid JSON with roleLabel, confidence, and rationale.',
        'Use only the initial user question. Do not use or request the private WhatsApp transcript.',
        'Use roleLabel "Assistant" with low confidence when the initial question does not clearly imply a profession.',
        '',
        `Initial question:\n${input.initialQuestion.trim()}`,
        '',
        'Invalid response:',
        input.raw,
      ].join('\n');
    },
  };

const ROLE_LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .&'/-]{0,38}[\p{L}\p{N}]$/u;
const HAS_LETTER_PATTERN = /\p{L}/u;
const PERSONAL_TITLE_PATTERN = /^(?:dr|mr|mrs|ms|prof)\.?\s+\p{L}/iu;
const COMMON_PERSON_NAME_PATTERN =
  /^(?:alice|anna|david|emily|jane|john|maria|michael|piotr|priya|robert|sarah)\s+(?:brown|chen|doe|garcia|johnson|kowalski|lee|martinez|miller|patel|smith|williams|\p{L}[\p{L}'-]*)$/iu;
const ORGANIZATION_PATTERN =
  /\b(?:inc|llc|ltd|corp(?:oration)?|company|group|clinic|hospital|firm|partners|associates)\b/iu;
const CREDENTIAL_PATTERN = /\b(?:licensed|certified|registered|accredited|phd|m\.?d\.?|esq\.?)\b/iu;
const PUNCTUATION_PATTERN = /[.&'/-]/g;
const MAX_ROLE_LABEL_PUNCTUATION = 1;

export const conversationAssistantRoleClassificationSchema = z
  .object({
    roleLabel: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .refine((label) => {
        if (label === 'Assistant') {
          return true;
        }
        return (
          ROLE_LABEL_PATTERN.test(label) &&
          HAS_LETTER_PATTERN.test(label) &&
          (label.match(PUNCTUATION_PATTERN)?.length ?? 0) <= MAX_ROLE_LABEL_PUNCTUATION &&
          !PERSONAL_TITLE_PATTERN.test(label) &&
          !COMMON_PERSON_NAME_PATTERN.test(label) &&
          !ORGANIZATION_PATTERN.test(label) &&
          !CREDENTIAL_PATTERN.test(label)
        );
      }, 'roleLabel must be a safe professional display label'),
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().max(240),
  })
  .strict();

export type ConversationAssistantRoleClassification = z.infer<
  typeof conversationAssistantRoleClassificationSchema
>;

export interface ConversationAssistantRoleClassifierPromptInput {
  initialQuestion: string;
}

export const buildConversationAssistantRoleClassifierPrompt = (
  input: ConversationAssistantRoleClassifierPromptInput
): string => CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.build(input);

export const buildConversationAssistantRoleClassifierRepairPrompt = (
  raw: string,
  error: z.ZodError,
  input: ConversationAssistantRoleClassifierPromptInput
): string =>
  CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_REPAIR_PROMPT.build({
    initialQuestion: input.initialQuestion,
    raw,
    validationErrors: formatZodErrors(error),
  });
