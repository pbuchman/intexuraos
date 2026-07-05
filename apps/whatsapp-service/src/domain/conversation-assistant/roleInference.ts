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
const PERSONAL_TITLE_PATTERN = /\b(?:dr|mr|mrs|ms|prof)\.?\s*\p{L}/iu;
const COMMON_PERSON_NAME_PATTERN =
  /^(?:alex|alice|anna|ben|charles|david|emma|jane|john|julia|maria|michael|natalie|oliver|piotr|priya|robert|sarah|sophia|thomas|william)\s+\p{L}[\p{L}'-]*$/iu;
const ORGANIZATION_PATTERN =
  /(?:\b(?:acme|amazon|apple|contoso|google|intexuraos|meta|microsoft|openai|stripe|tesla)\b|\b(?:inc|llc|ltd|corp(?:oration)?|company|group|clinic|hospital|firm|partners|associates|team)\b$)/iu;
const CREDENTIAL_PATTERN = /\b(?:licensed|certified|registered|accredited|phd|m\.?d\.?|esq\.?)\b/iu;

export interface InferConversationAssistantRoleLabelInput {
  initialQuestion: string | undefined;
  client: StructuredClient;
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
    promptType: CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.promptType,
    repairBuilder: buildConversationAssistantRoleClassifierRepairPrompt,
    maxRepairAttempts: 1,
    options: { correlation: { sessionId: input.sessionId } },
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
    PERSONAL_TITLE_PATTERN.test(collapsed) ||
    COMMON_PERSON_NAME_PATTERN.test(collapsed) ||
    ORGANIZATION_PATTERN.test(collapsed) ||
    CREDENTIAL_PATTERN.test(collapsed)
  ) {
    return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
  }

  return collapsed
    .split(' ')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}
