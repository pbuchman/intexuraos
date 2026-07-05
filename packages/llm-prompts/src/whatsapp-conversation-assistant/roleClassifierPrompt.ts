import { formatZodErrors } from '@intexuraos/llm-utils';
import { z } from 'zod';
import type { PromptBuilder } from '../shared/types.js';

export const CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT = {
  version: '1.1.1',
  promptType: 'whatsapp-conversation-assistant-role-classifier',
} as const;

const ROLE_LABEL_SAFE_CHARACTERS_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .&'/-]{0,38}[\p{L}\p{N}]$/u;
const ROLE_LABEL_HAS_LETTER_PATTERN = /\p{L}/u;
const ROLE_LABEL_REPEATED_PUNCTUATION_PATTERN = /[.&'/-]{2,}/u;
const ROLE_LABEL_WORD_PATTERN = /\p{L}[\p{L}\p{N}]*/gu;
const ROLE_LABEL_MAX_WORDS = 3;
const ROLE_LABEL_PERSONAL_TITLE_PATTERN = /\b(?:dr|mr|mrs|ms|prof)(?:\.|\s+)\s*\p{L}/iu;
const ROLE_LABEL_COMMON_SINGLE_NAME_PATTERN =
  /^(?:alex|alice|anna|ben|charles|david|emma|jane|john|julia|maria|michael|natalie|oliver|piotr|priya|robert|sarah|sophia|thomas|william)$/iu;
const ROLE_LABEL_ORGANIZATION_PATTERN =
  /(?:\b(?:acme|amazon|apple|contoso|google|intexuraos|meta|microsoft|openai|stripe|tesla)\b|\b(?:inc|llc|ltd|corp(?:oration)?|company|group|clinic|hospital|firm|partners|associates|team)\b$)/iu;
const ROLE_LABEL_CREDENTIAL_PATTERN =
  /\b(?:licensed|certified|registered|accredited|phd|m\.?d\.?|esq\.?)\b/iu;

function countRoleLabelWords(label: string): number {
  return Array.from(label.matchAll(ROLE_LABEL_WORD_PATTERN)).length;
}

export const conversationAssistantRoleClassificationSchema = z
  .object({
    roleLabel: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .refine((label) => ROLE_LABEL_HAS_LETTER_PATTERN.test(label), {
        message: 'roleLabel must contain at least one letter',
      })
      .refine((label) => ROLE_LABEL_SAFE_CHARACTERS_PATTERN.test(label), {
        message:
          'roleLabel may only contain letters, numbers, spaces, apostrophes, hyphens, slashes, ampersands, and periods; it must not end with punctuation',
      })
      .refine((label) => !ROLE_LABEL_REPEATED_PUNCTUATION_PATTERN.test(label), {
        message: 'roleLabel must not be punctuation-heavy',
      })
      .refine((label) => countRoleLabelWords(label) <= ROLE_LABEL_MAX_WORDS, {
        message: 'roleLabel must be at most three words',
      })
      .refine((label) => !ROLE_LABEL_PERSONAL_TITLE_PATTERN.test(label), {
        message: 'roleLabel must not contain a personal title',
      })
      .refine((label) => !ROLE_LABEL_COMMON_SINGLE_NAME_PATTERN.test(label), {
        message: 'roleLabel must not be a person name',
      })
      .refine((label) => !ROLE_LABEL_ORGANIZATION_PATTERN.test(label), {
        message: 'roleLabel must not be an organization name',
      })
      .refine((label) => !ROLE_LABEL_CREDENTIAL_PATTERN.test(label), {
        message: 'roleLabel must not contain credential claims',
      }),
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

export const conversationAssistantRoleClassifierPrompt: PromptBuilder<ConversationAssistantRoleClassifierPromptInput> =
  {
    name: 'whatsapp-conversation-assistant-role-classifier',
    description: 'Infers the expert role label to display for a WhatsApp assistant session',
    version: '1.1.1',
    build(input: ConversationAssistantRoleClassifierPromptInput): string {
      return [
        'Infer the professional or expert role label that should be displayed for an assistant session.',
        'Use only the initial user question. Do not use or request the private WhatsApp transcript.',
        'The role label is not a fixed enum: allow any real profession or expert role when strongly implied.',
        'Examples include doctor, psychologist, lawyer, software engineer, tax advisor, teacher, mediator, mechanic, career coach, and other professions.',
        'If the question is generic, unclear, casual, or not profession-specific, use roleLabel "Assistant" with confidence below 0.6.',
        'Return one concise display label, maximum three words and 40 characters.',
        'Do not output a person name, personal title such as Dr. or Prof., company/organization name, credentials, markdown, punctuation-heavy label, explanations outside JSON, or claims like licensed/certified.',
        'Return only JSON matching this shape: {"roleLabel":"string","confidence":0.0,"rationale":"string"}.',
        '',
        `Initial question:\n${input.initialQuestion.trim()}`,
      ].join('\n');
    },
  };

export interface ConversationAssistantRoleClassifierRepairPromptInput {
  raw: string;
  error: z.ZodError;
}

export const conversationAssistantRoleClassifierRepairPrompt: PromptBuilder<ConversationAssistantRoleClassifierRepairPromptInput> =
  {
    name: 'whatsapp-conversation-assistant-role-classifier-repair',
    description: 'Repairs invalid role-classification JSON for WhatsApp assistant sessions',
    version: '1.1.0',
    build(input: ConversationAssistantRoleClassifierRepairPromptInput): string {
      return [
        'The previous role-classification response was invalid.',
        `Validation errors: ${formatZodErrors(input.error)}`,
        'Return only valid JSON with roleLabel, confidence, and rationale.',
        'Use roleLabel "Assistant" with low confidence when the initial question does not clearly imply a profession.',
        '',
        'Invalid response:',
        input.raw,
      ].join('\n');
    },
  };

export const buildConversationAssistantRoleClassifierPrompt = (
  input: ConversationAssistantRoleClassifierPromptInput
): string => conversationAssistantRoleClassifierPrompt.build(input);

export const buildConversationAssistantRoleClassifierRepairPrompt = (
  raw: string,
  error: z.ZodError
): string => conversationAssistantRoleClassifierRepairPrompt.build({ raw, error });
