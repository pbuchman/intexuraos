# Conversation Assistant Role Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infer a session-level professional display role from the user's initial Conversation Assistant question and show that role in chat, PDF export, and session metadata, with `Assistant` as the conservative fallback.

**Architecture:** Keep protocol roles unchanged (`user` and `assistant`) and add a separate `assistantRoleLabel` display field on Conversation Assistant sessions. `whatsapp-service` owns inference because it owns session creation, user API-key access, persistence, and PDF mapping. `packages/llm-prompts` owns the role-classifier prompt and Zod schema; `packages/llm-utils.generateStructured()` verifies LLM JSON and runs the repair attempt; `apps/web` only renders the returned label.

**Tech Stack:** TypeScript strict mode, Fastify, Firestore, React/Vite/Tailwind, `@intexuraos/llm-prompts`, `@intexuraos/llm-utils`, `@intexuraos/llm-factory`, `@intexuraos/infra-pdf-export`, Zod, Vitest, `pnpm run ci:tracked`.

**Linear:** [INT-1853](https://linear.app/pbuchman/issue/INT-1853/allow-assistant-to-dynamically-adopt-a-professional-role-based-on-user)
**Plan document:** `docs/plans/INT-1853-conversation-assistant-role-inference.md`

## Global Constraints

- Planning artifact only; implementation must follow test-first development from `.claude/CLAUDE.md`.
- Do not change stored turn roles or LLM chat message roles. `ConversationAssistantTurn.role` remains `'user' | 'assistant'`.
- Add a display-only session field named `assistantRoleLabel`; fallback value is exactly `Assistant`.
- Infer from the user's initial question only, not from the private WhatsApp transcript.
- If the session is created without an initial question, skip the classifier call and store `Assistant`.
- Do not use a hardcoded classifier model. Use the selected Conversation Assistant session model (`input.model ?? deps.defaultModel`) through `ConversationAssistantLlmClientFactory`.
- If the classifier LLM call fails, returns malformed JSON, returns schema-invalid JSON, fails repair, returns a low-confidence role, or returns an unsafe/invalid label, store `Assistant` and continue session creation.
- The classifier must allow arbitrary professions and expert roles, not a fixed enum.
- The classifier must reject personal-title/name outputs, organizations, credential claims, markdown, punctuation-heavy labels, and labels longer than 40 characters.
- The classifier normalizer must deterministically reject numeric-only labels and schema-valid unsafe labels that contain personal-title markers, organization/company names, or credential claims such as licensed/certified/PhD/MD.
- Add or update prompt metadata with semver versions for every prompt touched.
- Existing persisted sessions without `assistantRoleLabel` must hydrate as `Assistant`; no Firestore migration is required.
- Every HTTP endpoint touched must keep `logIncomingRequest()`.
- Before commit in implementation tasks, `pnpm run ci:tracked` must pass.

## Current State

- `apps/whatsapp-service/src/domain/conversation-assistant/types.ts` stores session metadata and public DTO fields, but no display role.
- `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts` creates sessions, optional first turns, follow-up turns, and PDF export input.
- `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts` persists the whole session object and hydrates defensive defaults, including model fallback.
- `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts` maps sessions through `toPublicSession()`, hiding `transcriptText` and adding `modelDisplayName`.
- `packages/llm-utils/src/generateStructured.ts` already strips fenced JSON, parses JSON, validates with Zod, and optionally repairs invalid output.
- `packages/infra-pdf-export/src/conversationPdfExporter.ts` currently labels assistant PDF messages as `LLM response (<modelName>)`.
- `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx` currently renders assistant turns with the hard-coded label `Assistant`.

## Endpoint Changes

| Type | Endpoint | Owner | Details |
| --- | --- | --- | --- |
| Modified | `POST /conversation-assistant/sessions` | `whatsapp-service` | Infer and return `session.assistantRoleLabel` when an initial `question` is supplied; otherwise return `Assistant`. |
| Modified | `GET /conversation-assistant/sessions` | `whatsapp-service` | Include `assistantRoleLabel` on each public session DTO, defaulting old sessions to `Assistant`. |
| Modified | `GET /conversation-assistant/sessions/:sessionId` | `whatsapp-service` | Include `assistantRoleLabel` on the selected public session DTO. |
| Modified | `GET /conversation-assistant/sessions/:sessionId/export.pdf` | `whatsapp-service` | Pass `assistantRoleLabel` to the PDF exporter so assistant messages use the inferred role label. |
| Modified | Web route `/whatsapp/conversation-assistant` | `apps/web` | Render assistant turns and selected-session metadata using `assistantRoleLabel`. |
| Removed | None | - | No endpoint removal. |
| Unchanged | Turn submit/stream endpoints | `whatsapp-service` | Follow-up turns keep using the session's stored display role and do not reclassify. |

## Shared Contracts

### Session DTO

Add `assistantRoleLabel` to the session contract:

```ts
export const DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL = 'Assistant';

export interface ConversationAssistantSession {
  // existing fields unchanged
  assistantRoleLabel: string;
}

export type PublicConversationAssistantSession = Omit<
  ConversationAssistantSession,
  'transcriptText'
> & {
  modelDisplayName: string;
};
```

### Role Classifier Output

The classifier output is schema-verified, not enum-limited:

```ts
export const conversationAssistantRoleClassificationSchema = z.object({
  roleLabel: z.string().trim().min(2).max(40),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().max(240),
}).strict();

export type ConversationAssistantRoleClassification = z.infer<
  typeof conversationAssistantRoleClassificationSchema
>;
```

Accept labels only after normalization:

- Trim whitespace.
- Collapse internal whitespace.
- Convert short labels to title case, preserving common separators like spaces, `/`, `-`, and `&`.
- Require at least one letter.
- Allow letters, numbers, spaces, apostrophes, hyphens, slashes, ampersands, and periods.
- Reject markdown/control characters, numeric-only labels, labels ending with punctuation, labels prefixed with personal titles, organization/company names, and credential claims. Do not reject title-cased multi-word profession labels solely because they look like two capitalized words.
- Use `Assistant` when confidence is below `0.6`.

## Task 1: Add Role Classifier Prompt And Schema

**Files:**
- Create: `packages/llm-prompts/src/whatsapp-conversation-assistant/roleClassifierPrompt.ts`
- Create: `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/roleClassifierPrompt.test.ts`
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/index.ts`

**Interfaces:**
- Consumes: `{ initialQuestion: string }`.
- Produces: `CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT`, `conversationAssistantRoleClassificationSchema`, `buildConversationAssistantRoleClassifierPrompt()`, `buildConversationAssistantRoleClassifierRepairPrompt()`.

- [ ] **Step 1: Write failing prompt/schema tests**

Create `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/roleClassifierPrompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT,
  buildConversationAssistantRoleClassifierPrompt,
  buildConversationAssistantRoleClassifierRepairPrompt,
  conversationAssistantRoleClassificationSchema,
} from '../roleClassifierPrompt.js';

describe('conversation assistant role classifier prompt', () => {
  it('exposes semver prompt metadata and a dedicated prompt type', () => {
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.version).toBe('1.0.0');
    expect(CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT.promptType).toBe(
      'whatsapp-conversation-assistant-role-classifier'
    );
  });

  it('asks for an unrestricted professional role label as strict JSON', () => {
    const prompt = buildConversationAssistantRoleClassifierPrompt({
      initialQuestion: 'My employer is threatening me. What are my options?',
    });

    expect(prompt).toContain('Return only JSON');
    expect(prompt).toContain('roleLabel');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('not a fixed enum');
    expect(prompt).toContain('Assistant');
    expect(prompt).toContain('lawyer');
    expect(prompt).not.toContain('Transcript follows');
  });

  it('validates the expected schema and rejects extra fields', () => {
    const valid = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Employment Lawyer',
      confidence: 0.91,
      rationale: 'The user asks about employment legal options.',
    });
    const invalid = conversationAssistantRoleClassificationSchema.safeParse({
      roleLabel: 'Employment Lawyer',
      confidence: 0.91,
      rationale: 'The user asks about employment legal options.',
      extra: true,
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('builds a repair prompt from invalid raw output and schema details', () => {
    const parsed = conversationAssistantRoleClassificationSchema.safeParse({ roleLabel: '' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const repair = buildConversationAssistantRoleClassifierRepairPrompt('not json', parsed.error);

    expect(repair).toContain('not json');
    expect(repair).toContain('Return only valid JSON');
    expect(repair).toContain('roleLabel');
  });
});
```

Run: `pnpm exec vitest run packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/roleClassifierPrompt.test.ts`

Expected: FAIL because `roleClassifierPrompt.ts` does not exist.

- [ ] **Step 2: Implement prompt and schema**

Create `packages/llm-prompts/src/whatsapp-conversation-assistant/roleClassifierPrompt.ts`:

```ts
import { z } from 'zod';
import { formatZodErrors } from '@intexuraos/llm-utils';

export const CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT = {
  version: '1.0.0',
  promptType: 'whatsapp-conversation-assistant-role-classifier',
} as const;

export const conversationAssistantRoleClassificationSchema = z.object({
  roleLabel: z.string().trim().min(2).max(40),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().max(240),
}).strict();

export type ConversationAssistantRoleClassification = z.infer<
  typeof conversationAssistantRoleClassificationSchema
>;

export interface ConversationAssistantRoleClassifierPromptInput {
  initialQuestion: string;
}

export function buildConversationAssistantRoleClassifierPrompt(
  input: ConversationAssistantRoleClassifierPromptInput
): string {
  return [
    'Infer the professional or expert role label that should be displayed for an assistant session.',
    'Use only the initial user question. Do not use or request the private WhatsApp transcript.',
    'The role label is not a fixed enum: allow any real profession or expert role when strongly implied.',
    'Examples include doctor, psychologist, lawyer, software engineer, tax advisor, teacher, mediator, mechanic, career coach, and other professions.',
    'If the question is generic, unclear, casual, or not profession-specific, use roleLabel "Assistant" with confidence below 0.6.',
    'Return one concise display label, maximum three words and 40 characters.',
    'Do not output a person name, company name, credentials, markdown, explanations outside JSON, or claims like licensed/certified.',
    'Return only JSON matching this shape: {"roleLabel":"string","confidence":0.0,"rationale":"string"}.',
    '',
    `Initial question:\n${input.initialQuestion.trim()}`,
  ].join('\n');
}

export function buildConversationAssistantRoleClassifierRepairPrompt(
  raw: string,
  error: z.ZodError
): string {
  return [
    'The previous role-classification response was invalid.',
    `Validation errors: ${formatZodErrors(error)}`,
    'Return only valid JSON with roleLabel, confidence, and rationale.',
    'Use roleLabel "Assistant" with low confidence when the initial question does not clearly imply a profession.',
    '',
    'Invalid response:',
    raw,
  ].join('\n');
}
```

Modify `packages/llm-prompts/src/whatsapp-conversation-assistant/index.ts`:

```ts
export {
  CONVERSATION_ASSISTANT_ROLE_CLASSIFIER_PROMPT,
  buildConversationAssistantRoleClassifierPrompt,
  buildConversationAssistantRoleClassifierRepairPrompt,
  conversationAssistantRoleClassificationSchema,
  type ConversationAssistantRoleClassification,
  type ConversationAssistantRoleClassifierPromptInput,
} from './roleClassifierPrompt.js';
```

- [ ] **Step 3: Verify prompt package**

Run: `pnpm exec vitest run packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/roleClassifierPrompt.test.ts`

Expected: PASS.

## Task 2: Add Backend Role Inference With Conservative Fallback

**Files:**
- Modify: `apps/whatsapp-service/package.json`
- Create: `apps/whatsapp-service/src/domain/conversation-assistant/roleInference.ts`
- Create: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/roleInference.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts`

**Interfaces:**
- Consumes: selected Conversation Assistant model and optional initial question.
- Produces: persisted `ConversationAssistantSession.assistantRoleLabel`.

- [ ] **Step 1: Write failing role inference tests**

Create `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/roleInference.test.ts` with a fake structured client that returns queued `generate()` responses:

```ts
import { err, ok } from '@intexuraos/common-core';
import type { GenerateResult, LlmGenerateClient, LLMError } from '@intexuraos/llm-factory';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
  inferConversationAssistantRoleLabel,
  normalizeConversationAssistantRoleLabel,
} from '../../../domain/conversation-assistant/roleInference.js';

const zeroUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

class FakeGenerateClient implements LlmGenerateClient {
  readonly prompts: string[] = [];
  constructor(private readonly responses: Array<ReturnType<LlmGenerateClient['generate']>>) {}

  async generate(prompt: string, options: { promptType: string }): Promise<ReturnType<LlmGenerateClient['generate']> extends Promise<infer T> ? T : never> {
    this.prompts.push(`${options.promptType}\n${prompt}`);
    return await (this.responses.shift() ?? Promise.resolve(ok({ content: '{"roleLabel":"Assistant","confidence":0.1,"rationale":"fallback"}', usage: zeroUsage })));
  }
}

describe('inferConversationAssistantRoleLabel', () => {
  it('returns Assistant without calling the LLM when the initial question is blank', async () => {
    const client = new FakeGenerateClient([]);

    const label = await inferConversationAssistantRoleLabel({
      initialQuestion: '  ',
      client,
      model: 'or:minimax/minimax-m3',
      sessionId: 'session-1',
    });

    expect(label).toBe(DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL);
    expect(client.prompts).toHaveLength(0);
  });

  it('accepts a high-confidence profession that is not from a fixed enum', async () => {
    const client = new FakeGenerateClient([
      Promise.resolve(ok({
        content: '{"roleLabel":"marine surveyor","confidence":0.93,"rationale":"The user asks about a boat inspection."}',
        usage: zeroUsage,
      })),
    ]);

    const label = await inferConversationAssistantRoleLabel({
      initialQuestion: 'Can you review this boat survey before I buy it?',
      client,
      model: 'or:minimax/minimax-m3',
      sessionId: 'session-1',
    });

    expect(label).toBe('Marine Surveyor');
  });

  it('falls back to Assistant on API failure', async () => {
    const client = new FakeGenerateClient([
      Promise.resolve(err({ code: 'API_ERROR', message: 'down' } as LLMError)),
    ]);

    await expect(inferConversationAssistantRoleLabel({
      initialQuestion: 'Can I sue my employer?',
      client,
      model: 'or:minimax/minimax-m3',
      sessionId: 'session-1',
    })).resolves.toBe(DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL);
  });

  it('falls back to Assistant after malformed JSON and failed repair', async () => {
    const client = new FakeGenerateClient([
      Promise.resolve(ok({ content: 'not json', usage: zeroUsage })),
      Promise.resolve(ok({ content: '{"roleLabel":"","confidence":2,"rationale":""}', usage: zeroUsage })),
    ]);

    await expect(inferConversationAssistantRoleLabel({
      initialQuestion: 'What does this MRI note mean?',
      client,
      model: 'or:minimax/minimax-m3',
      sessionId: 'session-1',
    })).resolves.toBe(DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL);
    expect(client.prompts).toHaveLength(2);
  });

  it('normalizes and rejects unsafe labels', () => {
    expect(normalizeConversationAssistantRoleLabel('  software engineer  ')).toBe('Software Engineer');
    expect(normalizeConversationAssistantRoleLabel('Employment Lawyer')).toBe('Employment Lawyer');
    expect(normalizeConversationAssistantRoleLabel('Marine Surveyor')).toBe('Marine Surveyor');
    expect(normalizeConversationAssistantRoleLabel('Data Scientist')).toBe('Data Scientist');
    expect(normalizeConversationAssistantRoleLabel('Tax Advisor')).toBe('Tax Advisor');
    expect(normalizeConversationAssistantRoleLabel('Dr. Alice Smith')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('123')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Acme Legal Group')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Licensed Psychologist')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Certified Tax Advisor')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Jane Doe, PhD')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('**Lawyer**')).toBe('Assistant');
    expect(normalizeConversationAssistantRoleLabel('Assistant')).toBe('Assistant');
  });
});
```

Run: `pnpm exec vitest run apps/whatsapp-service/src/__tests__/domain/conversation-assistant/roleInference.test.ts`

Expected: FAIL because the role inference module does not exist.

- [ ] **Step 2: Implement role inference helper**

Modify `apps/whatsapp-service/package.json`:

```json
"@intexuraos/llm-utils": "workspace:*"
```

Create `apps/whatsapp-service/src/domain/conversation-assistant/roleInference.ts`:

```ts
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
const ORGANIZATION_PATTERN = /\b(?:inc|llc|ltd|corp(?:oration)?|company|group|clinic|hospital|firm|partners|associates)\b/iu;
const CREDENTIAL_PATTERN = /\b(?:licensed|certified|registered|accredited|phd|m\.?d\.?|esq\.?)\b/iu;

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
    !ROLE_LABEL_PATTERN.test(collapsed)
    || !HAS_LETTER_PATTERN.test(collapsed)
    || PERSONAL_TITLE_PATTERN.test(collapsed)
    || ORGANIZATION_PATTERN.test(collapsed)
    || CREDENTIAL_PATTERN.test(collapsed)
  ) {
    return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
  }
  return collapsed
    .split(' ')
    .map((part) => part.length === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`)
    .join(' ');
}
```

- [ ] **Step 3: Add session field and Firestore fallback**

Modify `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`:

```ts
import { DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL } from './roleInference.js';

export { DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL };

export interface ConversationAssistantSession {
  // existing fields unchanged
  assistantRoleLabel: string;
}
```

Modify `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts` inside `toSession()`:

```ts
assistantRoleLabel:
  typeof session?.assistantRoleLabel === 'string' && session.assistantRoleLabel.trim().length > 0
    ? session.assistantRoleLabel
    : DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
```

Update `makeSession()` in `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts` to include `assistantRoleLabel: 'Doctor'`, and extend the defensive-default test to assert missing session data hydrates `Assistant`.

- [ ] **Step 4: Infer role during session creation**

Modify `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`:

```ts
const sessionId = deps.ids.sessionId();
const assistantRoleLabel = await inferRoleLabelForInitialQuestion({
  userId: input.userId,
  model: selectedModel,
  sessionId,
  question: input.question,
}, deps);

const session: ConversationAssistantSession = {
  id: sessionId,
  // existing fields unchanged
  assistantRoleLabel,
};
```

Add a local helper that never fails session creation:

```ts
async function inferRoleLabelForInitialQuestion(
  input: { userId: string; model: ConversationAssistantModel | string; sessionId: string; question: string | undefined },
  deps: ConversationAssistantDeps
): Promise<string> {
  const question = input.question?.trim();
  if (question === undefined || question.length === 0) {
    return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
  }

  try {
    const clientResult = await deps.llmClientFactory.createLlmClientForUser(input.userId, input.model);
    if (!clientResult.ok) return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
    return await inferConversationAssistantRoleLabel({
      initialQuestion: question,
      client: clientResult.value,
      model: input.model,
      sessionId: input.sessionId,
    });
  } catch {
    return DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL;
  }
}
```

Keep the existing answer-generation call separate. This intentionally means a session with an initial question may call the selected model once for role classification and once for the assistant answer.

- [ ] **Step 5: Extend session use-case tests**

Update `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`:

```ts
it('stores an inferred assistant role label from the initial question', async () => {
  const { deps, llmClient } = makeDeps();
  await seedDirectMessage(deps.privateWhatsAppRepository as FakePrivateWhatsAppRepository);
  llmClient.queueGenerateResponse({
    content: '{"roleLabel":"psychologist","confidence":0.88,"rationale":"The user asks about anxiety."}',
  });
  llmClient.queueChatResponse('The selected context shows...');

  const result = await createConversationAssistantSession({
    userId: USER_ID,
    chatId: CHAT_ID,
    from: '2026-06-30T00:00:00.000Z',
    to: '2026-07-01T00:00:00.000Z',
    question: 'Why do I keep feeling anxious after these messages?',
  }, deps);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.session.assistantRoleLabel).toBe('Psychologist');
});

it('falls back to Assistant when role classification returns invalid content', async () => {
  const { deps, llmClient } = makeDeps();
  await seedDirectMessage(deps.privateWhatsAppRepository as FakePrivateWhatsAppRepository);
  llmClient.queueGenerateResponse({ content: 'not json' });
  llmClient.queueGenerateResponse({ content: '{"roleLabel":"","confidence":2,"rationale":""}' });
  llmClient.queueChatResponse('The selected context shows...');

  const result = await createConversationAssistantSession({
    userId: USER_ID,
    chatId: CHAT_ID,
    from: '2026-06-30T00:00:00.000Z',
    to: '2026-07-01T00:00:00.000Z',
    question: 'Do I need a doctor?',
  }, deps);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.session.assistantRoleLabel).toBe('Assistant');
});
```

If `FakeLlmGenerateClient` does not currently support queued `generate()` responses separately from chat responses, add minimal queue helpers in `apps/whatsapp-service/src/__tests__/fakes.ts` before these tests.

- [ ] **Step 6: Verify backend role inference**

Run:

```bash
pnpm exec vitest run \
  apps/whatsapp-service/src/__tests__/domain/conversation-assistant/roleInference.test.ts \
  apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts \
  apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts
```

Expected: PASS.

## Task 3: Propagate Role Label Through API And PDF Export

**Files:**
- Modify: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `packages/infra-pdf-export/src/types.ts`
- Modify: `packages/infra-pdf-export/src/conversationPdfExporter.ts`
- Modify: `packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/testUtils.ts`

**Interfaces:**
- Consumes: `ConversationAssistantSession.assistantRoleLabel`.
- Produces: public session DTOs and PDFs that display the inferred role.

- [ ] **Step 1: Write failing route assertions**

Update `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`:

```ts
expect(body.data.session.assistantRoleLabel).toBe('Assistant');
expect(JSON.stringify(body)).not.toContain('transcriptText');
```

Add a route test with initial question and queued classifier JSON:

```ts
expect(createdBody.data.session.assistantRoleLabel).toBe('Lawyer');
```

Run: `pnpm exec vitest run apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`

Expected: FAIL until DTO mapping and fakes expose `assistantRoleLabel`.

- [ ] **Step 2: Update PDF package contract and tests**

Modify `packages/infra-pdf-export/src/types.ts`:

```ts
export interface PdfConversationExportInput {
  title: string;
  modelName: string;
  assistantRoleLabel: string;
  initialPrompt: string;
  // existing fields unchanged
}
```

Update `packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts` valid input:

```ts
assistantRoleLabel: 'Psychologist',
```

Add assertions:

```ts
expect(readablePdfText).toContain('Assistant role: Psychologist');
expect(readablePdfText).toContain('Psychologist (MiniMax M3)');
```

Add invalid input case:

```ts
{ ...validInput, assistantRoleLabel: '   ' },
```

- [ ] **Step 3: Implement PDF rendering changes**

Modify `packages/infra-pdf-export/src/conversationPdfExporter.ts`:

```ts
if (input.assistantRoleLabel.trim().length === 0) {
  return {
    code: 'INVALID_INPUT',
    message: 'Conversation export assistantRoleLabel cannot be empty',
  };
}
```

In metadata rendering:

```ts
drawMetadataLine(doc, contentWidth, 'Assistant role', input.assistantRoleLabel);
```

In assistant message labels:

```ts
function getMessageRoleLabel(role: 'user' | 'assistant', modelName: string, assistantRoleLabel: string): string {
  return role === 'assistant' ? `${assistantRoleLabel} (${modelName})` : 'User';
}
```

- [ ] **Step 4: Pass role label from WhatsApp PDF export**

Modify `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`:

```ts
export interface ConversationAssistantPdfExportInput {
  title: string;
  modelName: string;
  assistantRoleLabel: string;
  initialPrompt: string;
  // existing fields unchanged
}
```

Modify `exportConversationAssistantSessionPdf()` in `sessionUseCases.ts`:

```ts
assistantRoleLabel: session.assistantRoleLabel,
```

Update fake PDF exporters in `apps/whatsapp-service/src/__tests__/testUtils.ts` and `sessionUseCases.test.ts` by relying on the updated port type. Add one export assertion:

```ts
expect(pdfExporter.calls[0]?.assistantRoleLabel).toBe('Psychologist');
```

- [ ] **Step 5: Verify API/PDF contract**

Run:

```bash
pnpm exec vitest run packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts
pnpm exec vitest run \
  apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts \
  apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
```

Expected: PASS.

## Task 4: Render Role Label In The Web App

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`
- Modify: `apps/web/src/components/whatsapp/ConversationAssistantSessionRail.tsx`
- Modify: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`
- Modify: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`
- Modify: `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`

**Interfaces:**
- Consumes: `ConversationAssistantSession.assistantRoleLabel`.
- Produces: chat turn headers, selected-session metadata, and session rail labels using the stored role label.

- [ ] **Step 1: Write failing web tests**

Update the session fixture in `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`:

```ts
assistantRoleLabel: 'Psychologist',
```

Add assertions in the selected-session test:

```ts
expect(screen.getAllByText('Psychologist').length).toBeGreaterThan(0);
expect(screen.queryByText('Assistant')).not.toBeInTheDocument();
```

Keep one no-selected-session assertion expecting the empty-state label:

```ts
expect(screen.getByText('No role')).toBeInTheDocument();
```

Run: `pnpm exec vitest run apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`

Expected: FAIL until the type and rendering changes are in place.

- [ ] **Step 2: Update web types**

Modify `apps/web/src/types/index.ts`:

```ts
export interface ConversationAssistantSession {
  // existing fields unchanged
  assistantRoleLabel: string;
}
```

No API service code change is required beyond test fixtures unless TypeScript test fixtures need the new field.

- [ ] **Step 3: Render session role metadata**

Modify `SessionMetadata()` in `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`:

```tsx
<div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
  <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Role</div>
  <div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
    {session.assistantRoleLabel}
  </div>
</div>
```

Keep the model metadata visible by expanding the grid from four to five cells or combining role/model in one cell if the layout gets too dense.

- [ ] **Step 4: Render assistant turn headers with the inferred label**

Modify the turn mapping in `WhatsAppConversationAssistantPage.tsx`:

```tsx
<span>{isUser ? 'You' : assistant.selectedSession.assistantRoleLabel}</span>
```

Because `assistant.selectedSession` is defined inside this branch, store the label before the map:

```tsx
const assistantRoleLabel = assistant.selectedSession?.assistantRoleLabel ?? 'Assistant';
```

Then use:

```tsx
<span>{isUser ? 'You' : assistantRoleLabel}</span>
```

- [ ] **Step 5: Show role in the session rail**

Modify `apps/web/src/components/whatsapp/ConversationAssistantSessionRail.tsx`:

```tsx
<span className="truncate">{session.assistantRoleLabel}</span>
```

Keep the model display either in the existing bot row as `${session.assistantRoleLabel} · ${session.modelDisplayName}` or add a second row if tests show cramped text. Do not remove `modelDisplayName` from the selected-session metadata.

- [ ] **Step 6: Verify web tests**

Run:

```bash
pnpm exec vitest run \
  apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx \
  apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx \
  apps/web/src/services/__tests__/conversationAssistantApi.test.ts
```

Expected: PASS.

## Task 5: Final Verification

**Files:**
- No new files.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: tracked workspace verification evidence.

- [ ] **Step 1: Run targeted workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- llm-prompts
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- infra-pdf-export
pnpm run verify:workspace:tracked -- web
```

Expected: PASS for every command.

- [ ] **Step 2: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 3: Manual smoke check**

In the local web app, create Conversation Assistant sessions with these initial questions:

| Initial question | Expected role label |
| --- | --- |
| `Can I sue my employer for withholding pay?` | `Lawyer` or a more specific legal profession |
| `Why do I panic after these messages?` | `Psychologist` or a more specific mental-health profession |
| `Can you summarize what was agreed?` | `Assistant` |
| `Can you inspect this boat survey before purchase?` | `Marine Surveyor` or another non-enum professional label |

Expected: chat turn headers, selected-session metadata, session rail, and PDF export all use the same stored role label. Existing sessions created before this change display `Assistant`.

## Self-Review Notes

- Spec coverage: The plan covers LLM role inference, schema verification, repair attempt, conservative fallback, no fixed profession enum, API propagation, web chat display, PDF export, and existing-session fallback.
- Memory coverage: malformed JSON, schema-invalid JSON, and API errors are explicitly tested as classifier fallbacks; model selection uses the existing selected Conversation Assistant model instead of a hardcoded classifier model.
- Endpoint coverage: All changed HTTP surfaces are listed; no endpoints are created or removed.
