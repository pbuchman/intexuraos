# WhatsApp Conversation Assistant Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose the LLM used by a WhatsApp Conversation Assistant session at session creation time, keep MiniMax as the default, expose the selected model in the UI and PDF export, and define a dedicated typed catalog for Conversation Assistant models.

**Architecture:** `@intexuraos/llm-contract` owns the curated Conversation Assistant model type, constants, display names, default model, and runtime validation. `whatsapp-service` accepts the selected model when creating a frozen assistant session, persists it on the session, uses that stored model for every follow-up turn, and maps it to a user-facing display name for public session DTOs and PDF export. `apps/web` renders a model selector in the session creation controls and displays the selected model in session metadata.

**Tech Stack:** TypeScript strict mode, Fastify, Firestore, React/Vite/Tailwind, `@intexuraos/llm-contract`, `@intexuraos/llm-factory`, `@intexuraos/infra-openrouter`, `@intexuraos/infra-pdf-export`, Vitest, `pnpm run ci:tracked`.

**Linear:** [INT-1844](https://linear.app/pbuchman/issue/INT-1844/allow-users-to-select-the-llm-for-whatsapp-conversation-assistance)
**Plan document:** `docs/plans/INT-1844-conversation-assistant-model-selection.md`
**External references checked on 2026-07-04:** [OpenRouter Models API](https://openrouter.ai/docs/guides/overview/models), [MiniMax M3 on OpenRouter](https://openrouter.ai/minimax/minimax-m3), [MiniMax API Overview](https://platform.minimax.io/docs/api-reference/api-overview), [Claude Sonnet 5 on OpenRouter](https://openrouter.ai/anthropic/claude-sonnet-5), [Gemini 3.5 Flash on OpenRouter](https://openrouter.ai/google/gemini-3.5-flash)

## Global Constraints

- Planning artifact only; implementation must follow test-first development from `.claude/CLAUDE.md`.
- The model choice is made from the user's perspective at the beginning of a new Conversation Assistant session.
- The selected model is immutable for that session; follow-up turns and PDF export use the model stored on the session.
- Default model is MiniMax M3: `or:minimax/minimax-m3`.
- Any MiniMax M2.7 references in this plan are migration targets, historical-document cleanup items, or legacy-session compatibility notes; M2.7 is not a current default or selectable recommendation.
- MiniMax M2.7 must not remain as an active default, allowlist recommendation, or user-facing current-model label anywhere in the repository. The implementation must migrate active M2.7 references to M3 across runtime config, tests, shared model catalogs, OpenRouter allowlists, web display names, and active documentation.
- The initial curated selector must include at least:
  - `or:minimax/minimax-m3` with label `MiniMax M3`
  - `or:anthropic/claude-sonnet-5` with label `Claude Sonnet 5`
  - `or:google/gemini-3.5-flash` with label `Gemini 3.5 Flash Thinking`
- The execution agent must re-check `https://openrouter.ai/api/v1/models` immediately before coding. On 2026-07-04 it returned `minimax/minimax-m3`, `anthropic/claude-sonnet-5`, and `google/gemini-3.5-flash`; it did not expose a separate Gemini 3.5 Thinking/Pro slug. If a separate current Gemini 3.5 Thinking slug exists at implementation time, add it to the same typed catalog instead of inventing an ID.
- Conversation Assistant continues to require the user's OpenRouter API key and must not add a platform-key fallback.
- Conversation Assistant LLM calls continue to pass reasoning options. If model metadata requires per-model reasoning configuration, encode that in the dedicated model catalog.
- PDF export must show the user-facing model name, not only a raw provider slug.
- Existing sessions with older or missing model values must remain readable and exportable; fallback display text is the raw stored model or the default MiniMax M3 label.
- Every HTTP endpoint touched must keep `logIncomingRequest()`.
- No new Linear subtasks are required for this plan-doc task.
- Before commit in implementation tasks, `pnpm run ci:tracked` must pass.

## Current State

- `apps/whatsapp-service/src/domain/conversation-assistant/types.ts` already stores `ConversationAssistantSession.model` as `string`.
- `apps/whatsapp-service/src/services.ts` currently wires one `conversationAssistantModel` from `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL` and uses that single value for all sessions.
- `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts` persists `session.model = deps.model` at creation and uses `deps.llmClientFactory.createLlmClientForUser(session.userId)` for every turn, so model selection needs to be threaded into the client factory.
- `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts` already passes `session.model` to PDF export as `modelName`.
- `packages/infra-pdf-export/src/conversationPdfExporter.ts` already prints `LLM model: <modelName>` and labels assistant turns as `LLM response (<modelName>)`.
- `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx` has a create panel with direct chat, range, and first-question controls, but no model selector.
- `apps/web/src/types/index.ts` and `apps/web/src/services/conversationAssistantApi.ts` currently type `model` as `string` and do not expose model display names.
- Repository audit on 2026-07-04 found active MiniMax M2.7 references in Conversation Assistant runtime defaults, OpenRouter allowlists, shared model display-name catalogs, tests, active service documentation, and historical implementation plans/specs.
- `workers/orchestrator/src/services/isolation/types.ts` already uses direct MiniMax `MiniMax-M3` for the `minimax` worker type; the repository-wide upgrade task must preserve that and bring the remaining active OpenRouter/runtime references up to M3.

## Endpoint Changes

| Type | Endpoint | Owner | Details |
| --- | --- | --- | --- |
| Modified | `POST /conversation-assistant/sessions` | `whatsapp-service` | Accept optional `model`, validate it against `ConversationAssistantModel`, default to MiniMax when omitted, persist it on the new session, and return display metadata. |
| Modified | `GET /conversation-assistant/sessions` | `whatsapp-service` | Return public sessions with `model` and `modelDisplayName`. |
| Modified | `GET /conversation-assistant/sessions/:sessionId` | `whatsapp-service` | Return `modelDisplayName` for the selected session. |
| Modified | `POST /conversation-assistant/sessions/:sessionId/turns` | `whatsapp-service` | Use the session's stored model when creating the LLM client. |
| Modified | `POST /conversation-assistant/sessions/:sessionId/turns/stream` | `whatsapp-service` | Use the session's stored model when creating the streaming LLM client. |
| Modified | `GET /conversation-assistant/sessions/:sessionId/export.pdf` | `whatsapp-service` | Map the stored model to a display name before calling the PDF exporter. |
| Modified | Web route `/whatsapp/conversation-assistant` | `apps/web` | Add a model selector to the new-session controls and show selected-session model metadata. |
| Removed | None | - | No endpoint removal. |
| Unchanged | `POST /conversation-assistant/context/check` | `whatsapp-service` | Context size checking is independent of model selection. |

## Shared Model Contract

Add a dedicated Conversation Assistant model catalog to `packages/llm-contract/src/supportedModels.ts` and export it from `packages/llm-contract/src/index.ts`.

The implementation should follow this shape:

```ts
export type OpenRouterMiniMaxM3 = 'or:minimax/minimax-m3' & OpenRouterModelId;
export type OpenRouterClaudeSonnet5 = 'or:anthropic/claude-sonnet-5' & OpenRouterModelId;
export type OpenRouterGemini35Flash = 'or:google/gemini-3.5-flash' & OpenRouterModelId;

export type ConversationAssistantModel =
  | OpenRouterMiniMaxM3
  | OpenRouterClaudeSonnet5
  | OpenRouterGemini35Flash;

export interface ConversationAssistantModelOption {
  id: ConversationAssistantModel;
  label: string;
  provider: string;
  supportsReasoning: boolean;
}

export const ConversationAssistantModels = {
  MiniMaxM3: createOpenRouterModelId('minimax/minimax-m3') as OpenRouterMiniMaxM3,
  ClaudeSonnet5: createOpenRouterModelId('anthropic/claude-sonnet-5') as OpenRouterClaudeSonnet5,
  Gemini35FlashThinking: createOpenRouterModelId('google/gemini-3.5-flash') as OpenRouterGemini35Flash,
} as const;

export const DEFAULT_CONVERSATION_ASSISTANT_MODEL =
  ConversationAssistantModels.MiniMaxM3;

export const CONVERSATION_ASSISTANT_MODEL_OPTIONS: readonly ConversationAssistantModelOption[] = [
  {
    id: ConversationAssistantModels.MiniMaxM3,
    label: 'MiniMax M3',
    provider: 'MiniMax',
    supportsReasoning: true,
  },
  {
    id: ConversationAssistantModels.ClaudeSonnet5,
    label: 'Claude Sonnet 5',
    provider: 'Anthropic',
    supportsReasoning: true,
  },
  {
    id: ConversationAssistantModels.Gemini35FlashThinking,
    label: 'Gemini 3.5 Flash Thinking',
    provider: 'Google',
    supportsReasoning: true,
  },
] as const;

export const CONVERSATION_ASSISTANT_MODEL_DISPLAY_NAMES: Readonly<Record<ConversationAssistantModel, string>> =
  Object.fromEntries(CONVERSATION_ASSISTANT_MODEL_OPTIONS.map((model) => [model.id, model.label])) as Readonly<Record<ConversationAssistantModel, string>>;

export function isConversationAssistantModel(model: string): model is ConversationAssistantModel {
  return CONVERSATION_ASSISTANT_MODEL_OPTIONS.some((option) => option.id === model);
}

export function getConversationAssistantModelDisplayName(model: string): string {
  return isConversationAssistantModel(model)
    ? CONVERSATION_ASSISTANT_MODEL_DISPLAY_NAMES[model]
    : model;
}
```

If the execution-time OpenRouter catalog has a separate current Gemini 3.5 Thinking model, add it as another `ConversationAssistantModel` member, keep the same display-name/validation pattern, and include it in the web selector. Do not use an unverified OpenRouter slug.

## Task 1: Upgrade Repository-Wide MiniMax Defaults To M3

**Files:**
- Modify: `ecosystem.config.cjs`
- Modify: `ecosystem.config.prod.cjs`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: `apps/whatsapp-service/src/__tests__/config.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/openapi-contract.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/services.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/testUtils.ts`
- Modify: `apps/web/src/utils/openRouterModelNames.ts`
- Modify: `packages/llm-contract/src/supportedModels.ts`
- Modify: `packages/llm-contract/src/__tests__/supportedModels.test.ts`
- Modify: `packages/infra-openrouter/src/allowlist.ts`
- Modify: `packages/infra-openrouter/src/defaultAllowlist.ts`
- Modify: `packages/infra-openrouter/src/__tests__/allowlist.test.ts`
- Modify: `packages/infra-openrouter/src/__tests__/client.test.ts`
- Modify: `packages/infra-openrouter/src/__tests__/defaultAllowlist.test.ts`
- Modify: `scripts/__tests__/ecosystem.prod.config.test.ts`
- Modify active docs that describe current models, including `docs/services/code-worker/technical.md`, `docs/services/research-agent/technical.md`, and `docs/services/index.md`.
- Review historical plan/spec hits under `docs/plans/` and `docs/superpowers/`; update reusable/current guidance to M3 and mark intentionally historical M2.7 references as superseded so no active guidance recommends M2.7.

**Interfaces:**
- Consumes: verified OpenRouter model slug `minimax/minimax-m3` and direct MiniMax model name `MiniMax-M3`.
- Produces: repository-wide active defaults and allowlists that use MiniMax M3 instead of MiniMax M2.7.

- [ ] **Step 1: Re-run the MiniMax model audit**

Run:

```bash
rg -n -S "minimax/minimax-m2\.7|MiniMax M2\.7|MiniMax-M2\.7" \
  --glob '!node_modules' \
  --glob '!dist' \
  --glob '!coverage' \
  --glob '!pnpm-lock.yaml' \
  --glob '!terraform/certs/**'
```

Expected: all active M2.7 hits are classified before editing. Historical docs may keep M2.7 only when they explicitly describe past work and include a supersession note pointing to MiniMax M3.

- [ ] **Step 2: Verify current MiniMax M3 model IDs**

Run:

```bash
node - <<'NODE'
const https = require('https');
https.get('https://openrouter.ai/api/v1/models', (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    const payload = JSON.parse(body);
    const ids = new Set(payload.data.map((model) => model.id));
    for (const id of ['minimax/minimax-m3', 'minimax/minimax-m2.7']) {
      console.log(`${id}: ${ids.has(id) ? 'present' : 'missing'}`);
    }
  });
}).on('error', (error) => {
  console.error(error);
  process.exit(1);
});
NODE
```

Expected: `minimax/minimax-m3` is present. If OpenRouter changes the slug, stop and update the plan with the verified current slug before coding.

- [ ] **Step 3: Write failing M3 migration tests**

Update tests first so they expect MiniMax M3:

```ts
expect(config.conversationAssistantModel).toBe('or:minimax/minimax-m3');
expect(ids).toContain('minimax/minimax-m3');
expect(isDefaultEligibleModel('or:minimax/minimax-m3')).toBe(true);
expect(DEFAULT_MODEL_DISPLAY_NAMES['or:minimax/minimax-m3']).toBe('MiniMax M3');
```

Also update production ecosystem tests to expect `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL` fallback `or:minimax/minimax-m3`.

- [ ] **Step 4: Migrate active runtime and config defaults**

Update all active Conversation Assistant defaults from `or:minimax/minimax-m2.7` to `or:minimax/minimax-m3` in:

- `apps/whatsapp-service/src/config.ts`
- `ecosystem.config.cjs`
- `ecosystem.config.prod.cjs`
- `terraform/environments/dev/main.tf`
- WhatsApp service test utilities and tests that assert the default model.

- [ ] **Step 5: Migrate shared OpenRouter allowlists and display names**

Update active OpenRouter model catalogs from `minimax/minimax-m2.7` / `MiniMax M2.7` to `minimax/minimax-m3` / `MiniMax M3` in:

- `packages/llm-contract/src/supportedModels.ts`
- `packages/infra-openrouter/src/allowlist.ts`
- `packages/infra-openrouter/src/defaultAllowlist.ts`
- `apps/web/src/utils/openRouterModelNames.ts`

Adjust context-length and pricing expectations only from verified catalog data. Do not invent price or context metadata.

- [ ] **Step 6: Update active documentation**

Update current service documentation so it describes MiniMax M3, not M2.7. Include at least:

- `docs/services/code-worker/technical.md`
- `docs/services/research-agent/technical.md`
- `docs/services/index.md`

For historical implementation plans/specs that mention M2.7, either update reusable snippets to M3 or add a one-line supersession note saying active implementations now use MiniMax M3.

- [ ] **Step 7: Verify no active M2.7 guidance remains**

Re-run the audit command from Step 1. Expected result: no active code/config/test/current-doc references still present M2.7 as the current MiniMax model. Any remaining M2.7 references must be explicitly historical or legacy-session compatibility notes.

- [ ] **Step 8: Verify affected workspaces**

Run:

```bash
pnpm run verify:workspace:tracked -- llm-contract
pnpm run verify:workspace:tracked -- infra-openrouter
pnpm run verify:workspace:tracked -- whatsapp-service
```

Expected: shared catalogs, OpenRouter allowlists, and WhatsApp service defaults all pass with MiniMax M3.

## Task 2: Add The Conversation Assistant Model Type

**Files:**
- Modify: `packages/llm-contract/src/supportedModels.ts`
- Modify: `packages/llm-contract/src/index.ts`
- Modify: `packages/llm-contract/src/__tests__/supportedModels.test.ts`

**Interfaces:**
- Produces: `ConversationAssistantModel`, `ConversationAssistantModels`, `DEFAULT_CONVERSATION_ASSISTANT_MODEL`, `CONVERSATION_ASSISTANT_MODEL_OPTIONS`, `isConversationAssistantModel()`, and `getConversationAssistantModelDisplayName()`.
- Consumes: existing `OpenRouterModelId` and `createOpenRouterModelId()`.

- [ ] **Step 1: Verify OpenRouter model IDs before coding**

Run:

```bash
node - <<'NODE'
const https = require('https');
https.get('https://openrouter.ai/api/v1/models', (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    const payload = JSON.parse(body);
    const ids = new Set(payload.data.map((model) => model.id));
    for (const id of [
      'minimax/minimax-m3',
      'anthropic/claude-sonnet-5',
      'google/gemini-3.5-flash',
    ]) {
      console.log(`${id}: ${ids.has(id) ? 'present' : 'missing'}`);
    }
  });
}).on('error', (error) => {
  console.error(error);
  process.exit(1);
});
NODE
```

Expected: all required IDs print `present`, or the implementer updates the MiniMax/Gemini entries only when OpenRouter exposes verified current replacement slugs.

- [ ] **Step 2: Write failing contract tests**

Add tests that assert:

```ts
expect(DEFAULT_CONVERSATION_ASSISTANT_MODEL).toBe('or:minimax/minimax-m3');
expect(isConversationAssistantModel('or:minimax/minimax-m3')).toBe(true);
expect(isConversationAssistantModel('or:anthropic/claude-sonnet-5')).toBe(true);
expect(isConversationAssistantModel('or:google/gemini-3.5-flash')).toBe(true);
expect(isConversationAssistantModel('or:unknown/model')).toBe(false);
expect(getConversationAssistantModelDisplayName('or:anthropic/claude-sonnet-5')).toBe('Claude Sonnet 5');
```

- [ ] **Step 3: Implement the model catalog**

Add the model types, constants, runtime guard, and display-name helper shown in the Shared Model Contract.

- [ ] **Step 4: Export the model catalog**

Update `packages/llm-contract/src/index.ts` to export the new constants and types.

- [ ] **Step 5: Verify package behavior**

Run:

```bash
pnpm --filter @intexuraos/llm-contract test
pnpm run verify:package-exports
```

Expected: tests pass and package exports remain source-export compliant.

## Task 3: Thread The Selected Model Through WhatsApp Service

**Files:**
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: `apps/whatsapp-service/src/index.ts`
- Modify: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Modify: `apps/whatsapp-service/src/services.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Modify: `apps/whatsapp-service/src/__tests__/config.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/services.test.ts`

**Interfaces:**
- Consumes: `ConversationAssistantModel`, `DEFAULT_CONVERSATION_ASSISTANT_MODEL`, `isConversationAssistantModel()`, and `getConversationAssistantModelDisplayName()` from `@intexuraos/llm-contract`.
- Produces: public session DTOs with `model: ConversationAssistantModel | string` and `modelDisplayName: string`.

- [ ] **Step 1: Write failing domain tests**

Add tests covering:

```ts
it('persists the selected Conversation Assistant model on session creation', async () => {
  const result = await createConversationAssistantSession(
    {
      userId: 'user-1',
      chatId: 'chat-1',
      from: '2026-07-04T10:00:00.000Z',
      to: '2026-07-04T11:00:00.000Z',
      model: 'or:anthropic/claude-sonnet-5' as ConversationAssistantModel,
    },
    deps
  );

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.session.model).toBe('or:anthropic/claude-sonnet-5');
});
```

Add a follow-up test that creates a session with Claude Sonnet 5, sends a turn, and asserts the fake `llmClientFactory.createLlmClientForUser()` receives that stored model rather than the default.

Add a validation test that an unsupported model returns:

```ts
{ code: 'INVALID_REQUEST', message: 'Unsupported Conversation Assistant model' }
```

- [ ] **Step 2: Update domain input and dependency types**

Change `CreateConversationAssistantSessionInput` to include:

```ts
model?: ConversationAssistantModel;
```

Change `ConversationAssistantLlmClientFactory` to:

```ts
createLlmClientForUser(
  userId: string,
  model: ConversationAssistantModel | string
): Promise<ConversationAssistantResult<LlmGenerateClient>>;
```

Keep `ConversationAssistantDeps.model` only as a default model value, or rename it to `defaultModel` if that keeps call sites clearer.

- [ ] **Step 3: Validate and persist the selected model**

In `createConversationAssistantSession()`:

```ts
const selectedModel = input.model ?? deps.defaultModel;
if (!isConversationAssistantModel(selectedModel)) {
  return err({ code: 'INVALID_REQUEST', message: 'Unsupported Conversation Assistant model' });
}
```

Persist `model: selectedModel` on the session.

- [ ] **Step 4: Use the session model for LLM calls**

In both `callConversationAssistantModel()` and `callConversationAssistantModelStream()`, call:

```ts
const llmClientResult = await deps.llmClientFactory.createLlmClientForUser(
  session.userId,
  session.model
);
```

Then use the returned client exactly as today.

- [ ] **Step 5: Update config defaulting and startup validation**

In `apps/whatsapp-service/src/config.ts`, make `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL` optional for normal startup and default `loadConfig().conversationAssistantModel` to `DEFAULT_CONVERSATION_ASSISTANT_MODEL` when it is omitted or blank.

Keep early validation for configured values:

```ts
const conversationAssistantModel =
  env.INTEXURAOS_CONVERSATION_ASSISTANT_MODEL?.trim() ||
  DEFAULT_CONVERSATION_ASSISTANT_MODEL;
if (!isConversationAssistantModel(conversationAssistantModel)) {
  throw new Error('Unsupported Conversation Assistant model configured');
}
```

Update `apps/whatsapp-service/src/index.ts` so `validateRequiredEnv()` no longer requires `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL` before `loadConfig()` can apply the default.

Add `apps/whatsapp-service/src/__tests__/config.test.ts` coverage for omitted env defaulting to MiniMax M3, blank env defaulting to MiniMax M3, and invalid configured defaults being rejected.

- [ ] **Step 6: Update service wiring**

In `createConversationAssistantLlmClientFactory()`:

```ts
async createLlmClientForUser(userId, model) {
  const keysResult = await userServiceClient.getApiKeys(userId);
  // keep existing error handling
  return ok(createLlmClient({
    apiKey: openRouterKey,
    model: model as never,
    userId,
    logger: createAppLogger({ name: 'whatsapp-conversation-assistant-llm' }),
    usageSink,
    ownerType: 'user',
  }));
}
```

The default env var can remain for deployment override, but load/validation should default to `DEFAULT_CONVERSATION_ASSISTANT_MODEL` and reject invalid configured defaults early.

- [ ] **Step 7: Update routes and public session projection**

Add `model` to `CreateSessionBody` schema as an optional string.

When building the domain input:

```ts
if (request.body.model !== undefined) input.model = request.body.model as ConversationAssistantModel;
```

Update `toPublicSession()` to add:

```ts
modelDisplayName: getConversationAssistantModelDisplayName(session.model)
```

Add route tests for missing model defaulting to MiniMax M3, selected model persistence, invalid model rejection, and public response `modelDisplayName`.

- [ ] **Step 8: Preserve older persisted sessions**

In `toSession()`, keep the existing fallback behavior but prefer:

```ts
model: typeof session?.model === 'string' && session.model.length > 0
  ? session.model
  : DEFAULT_CONVERSATION_ASSISTANT_MODEL,
```

Add repository hydration tests for missing `model` and unknown legacy `model` values.

- [ ] **Step 9: Verify WhatsApp service**

Run:

```bash
pnpm run verify:workspace:tracked -- whatsapp-service
```

Expected: all WhatsApp service tests, typecheck, lint, and coverage gates pass.

## Task 4: Show The Selected Model In PDF Export

**Files:**
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts`

**Interfaces:**
- Consumes: `getConversationAssistantModelDisplayName(session.model)`.
- Produces: PDF export input with `modelName` set to the user-facing display name.

- [ ] **Step 1: Write failing export mapping test**

Add a test that creates a session snapshot with:

```ts
model: 'or:google/gemini-3.5-flash'
```

and asserts the fake PDF exporter receives:

```ts
modelName: 'Gemini 3.5 Flash Thinking'
```

- [ ] **Step 2: Map the display name before export**

In `exportConversationAssistantSessionPdf()`, replace raw `session.model` with:

```ts
modelName: getConversationAssistantModelDisplayName(session.model),
```

- [ ] **Step 3: Keep PDF renderer tests explicit**

Add or update the PDF package test to assert that a provided model name appears in the PDF metadata text by checking the uncompressed PDF bytes contain a short ASCII model label such as `Claude Sonnet 5`.

- [ ] **Step 4: Verify PDF and WhatsApp workspaces**

Run:

```bash
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- infra-pdf-export
```

Expected: all tests pass.

## Task 5: Add The Web Model Selector And Metadata Display

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/conversationAssistantApi.ts`
- Modify: `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`
- Modify: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`
- Modify: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`
- Modify: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`
- Modify: `apps/web/src/components/whatsapp/ConversationAssistantSessionRail.tsx`

**Interfaces:**
- Consumes: `CONVERSATION_ASSISTANT_MODEL_OPTIONS`, `DEFAULT_CONVERSATION_ASSISTANT_MODEL`, and `ConversationAssistantModel` from `@intexuraos/llm-contract`.
- Produces: `CreateConversationAssistantSessionRequest.model?: ConversationAssistantModel` and UI selection state.

- [ ] **Step 1: Write failing API and hook tests**

Assert that `createConversationAssistantSession()` serializes:

```json
{
  "chatId": "chat-1",
  "from": "2026-07-04T10:00:00.000Z",
  "to": "2026-07-04T11:00:00.000Z",
  "model": "or:anthropic/claude-sonnet-5"
}
```

Add hook tests that the initial selected model is `DEFAULT_CONVERSATION_ASSISTANT_MODEL`, changing the selector updates pending session state, and creating a session sends the selected model.

- [ ] **Step 2: Update web types**

Import or re-export:

```ts
import type { ConversationAssistantModel } from '@intexuraos/llm-contract';
```

Add:

```ts
model: ConversationAssistantModel | string;
modelDisplayName: string;
```

to `ConversationAssistantSession`, and add:

```ts
model?: ConversationAssistantModel;
```

to `CreateConversationAssistantSessionRequest`.

- [ ] **Step 3: Add hook state**

Add:

```ts
selectedModel: ConversationAssistantModel;
selectModel: (model: ConversationAssistantModel) => void;
```

to `UseWhatsAppConversationAssistantResult`.

Default to `DEFAULT_CONVERSATION_ASSISTANT_MODEL`, reset large-context warnings when the model changes, and include `model: selectedModel` in both normal create and confirmed large-context create requests.

- [ ] **Step 4: Render the model selector at the beginning controls**

Place a selector in the same top creation panel as direct chat and range, before the optional first question. Use `CONVERSATION_ASSISTANT_MODEL_OPTIONS` for options.

Suggested label:

```tsx
<span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
  Model
</span>
```

Display option labels as `Provider - Label` or just `Label` if the layout is tight. Keep the control as a real `<select>` for accessibility and predictable keyboard behavior.

- [ ] **Step 5: Display the selected session model**

Update `SessionMetadata` to include a model cell. If keeping the current three-column grid, change it to a responsive four-column grid and add:

```tsx
<div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Model</div>
<div className="mt-1 text-sm text-slate-950 dark:text-slate-50">
  {session.modelDisplayName}
</div>
```

Update `ConversationAssistantSessionRail` to show a short model label below the chat or range so users can distinguish sessions created with different models.

- [ ] **Step 6: Verify web behavior**

Run:

```bash
pnpm run verify:workspace:tracked -- web
```

Expected: web tests, typecheck, and lint pass.

## Task 6: Final Verification

**Files:**
- No new source files beyond the files listed above.

**Interfaces:**
- Consumes: completed tasks 1-5.
- Produces: a verified implementation branch.

- [ ] **Step 1: Run targeted verification**

Run:

```bash
pnpm run verify:workspace:tracked -- llm-contract
pnpm run verify:workspace:tracked -- infra-openrouter
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- infra-pdf-export
pnpm run verify:workspace:tracked -- web
pnpm run verify:package-exports
```

Expected: all targeted commands pass.

- [ ] **Step 2: Run full commit-gate CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: full tracked CI passes before commit.

## Acceptance Criteria

- A user sees a model selector before creating a WhatsApp Conversation Assistant session.
- MiniMax M3 is selected by default.
- Active repository defaults, OpenRouter allowlists, shared display names, tests, and current documentation use MiniMax M3 instead of MiniMax M2.7.
- Claude Sonnet 5 and Gemini 3.5 Flash Thinking are selectable by name.
- The backend rejects unsupported model IDs.
- The selected model is stored on the session and used for all future turns in that session.
- Existing sessions remain readable and exportable.
- Session list, session metadata, and PDF export show the user-facing model name.
- PDF export includes the model name in the document metadata section and assistant response labels.
- `ConversationAssistantModel` and related constants are defined in a dedicated shared type surface.
- `pnpm run ci:tracked` passes before implementation is committed.

## Self-Review

- Spec coverage: The plan covers repository-wide MiniMax M3 migration, initial user selection, default MiniMax M3, Sonnet 5, Gemini 3.5 Flash Thinking, dedicated model type, backend model use, PDF export, and UI display.
- Placeholder scan: No implementation task relies on TBD behavior; the only conditional is explicit OpenRouter catalog verification for a separate Gemini thinking slug.
- Type consistency: The same `ConversationAssistantModel` type is consumed by shared contract, backend request/session logic, and web request/session types.
