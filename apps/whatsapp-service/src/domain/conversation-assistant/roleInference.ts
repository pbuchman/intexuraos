import { generateStructured, type StructuredClient } from '@intexuraos/llm-utils';
import {
  CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT,
  buildConversationAssistantRoleClassifierPrompt,
  buildConversationAssistantRoleClassifierRepairPrompt,
  conversationAssistantRoleClassificationSchema,
} from '@intexuraos/llm-prompts';

export const DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL = 'Assistant';

const MIN_ROLE_CONFIDENCE = 0.6;
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
const ROLE_LABEL_WORD_PATTERN = /\p{L}[\p{L}\p{N}]*/gu;

export interface InferConversationAssistantRoleLabelInput {
  initialQuestion: string | undefined;
  client: StructuredClient;
  model: string;
  sessionId: string;
}

export async function inferConversationAssistantRoleLabel(
  input: InferConversationAssistantRoleLabelInput
): Promise<string> {
  const question = input.initialQuestion?.trim();
  if (question === undefined || question.length === 0) {
    return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
  }

  const result = await generateStructured({
    client: input.client,
    prompt: buildConversationAssistantRoleClassifierPrompt({ initialQuestion: question }),
    schema: conversationAssistantRoleClassificationSchema,
    promptType: CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.name,
    repairBuilder: (raw, error) =>
      buildConversationAssistantRoleClassifierRepairPrompt(raw, error, {
        initialQuestion: question,
      }),
    maxRepairAttempts: 1,
    options: {
      model: input.model,
      correlation: { sessionId: input.sessionId },
    },
  });

  if (!result.ok || result.value.data.confidence < MIN_ROLE_CONFIDENCE) {
    return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
  }

  return normalizeConversationAssistantRoleLabel(result.value.data.roleLabel);
}

export function normalizeConversationAssistantRoleLabel(label: string): string {
  const collapsed = label.trim().replace(/\s+/g, ' ');
  if (collapsed === DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL) {
    return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
  }

  if (
    !ROLE_LABEL_PATTERN.test(collapsed) ||
    !HAS_LETTER_PATTERN.test(collapsed) ||
    (collapsed.match(PUNCTUATION_PATTERN)?.length ?? 0) > MAX_ROLE_LABEL_PUNCTUATION ||
    PERSONAL_TITLE_PATTERN.test(collapsed) ||
    COMMON_PERSON_NAME_PATTERN.test(collapsed) ||
    ORGANIZATION_PATTERN.test(collapsed) ||
    CREDENTIAL_PATTERN.test(collapsed)
  ) {
    return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
  }

  return collapsed.replace(
    ROLE_LABEL_WORD_PATTERN,
    (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
  );
}
