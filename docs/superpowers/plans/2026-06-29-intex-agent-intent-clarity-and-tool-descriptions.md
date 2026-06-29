# Intex Agent Intent Clarity and Tool Descriptions Implementation Plan

## Goal

Implement the reviewed Intex Agent behavior change so ambiguous requests produce targeted clarification, unsupported requests preserve exact blockers, style/language/tone preferences are allowed and controllable, normal intent selection is LLM-first, tool descriptions are clear and shared between classifier and runner, and user-facing `INTEX` copy becomes `Intex`.

Source spec: `docs/superpowers/specs/2026-06-29-intex-agent-intent-clarity-and-tool-descriptions-design.md`

## Constraints

- Use TDD: write failing tests before production code for each behavior group.
- Keep technical identifiers such as `INTEX_AGENT_SYSTEM_PROMPT`, `INTEXURAOS_*`, package names, collection names, and enum names unchanged.
- Do not add new end-user capabilities such as buying tickets, browsing arbitrary websites, sending emails, or updating/deleting calendar events.
- Do not remove deterministic validation, confirmation handling, permission/configuration checks, or schema parsing.
- Do not expose mutating tools when classifier output is unavailable or invalid.
- Final commit gate: `pnpm run ci:tracked`.
- PR target is `development`. PR title/body require a real `INT-XXX` issue ID; do not fabricate one.

## Endpoint Changes

Modified:

- WhatsApp message handling keeps the same external route shape but changes unsupported, clarification, and preference behavior.
- Intex Agent preferences routes keep the same route shape but update user-facing OpenAPI copy from `INTEX` to `Intex`.
- Web Intex Agent pages keep the same route shape but update headings, navigation labels, and confirmation copy from `INTEX` to `Intex`.

Created:

- None.

Removed:

- None.

Unchanged:

- Downstream calendar, note, bookmark, research, code task, and external save API contracts remain unchanged unless adapter-level error normalization is needed.

## Task 1: Prompt And Schema Contracts

Tests first:

- Update `packages/llm-prompts/src/intex-agent/__tests__/systemPrompt.test.ts`.
- Update `packages/llm-prompts/src/intex-agent/__tests__/intentClassifierPrompt.test.ts`.
- Update `packages/llm-prompts/src/intex-agent/__tests__/intentClassifierSchemas.test.ts`.
- Add or update runner output schema and repair prompt tests.
- Cover:
  - system prompt version `10.0.0 -> 11.0.0`
  - system prompt builder version `4.0.0 -> 5.0.0`
  - classifier prompt version `1.1.0 -> 2.0.0`
  - classifier repair prompt version `1.0.0 -> 2.0.0`
  - runner output repair prompt version `1.0.0 -> 2.0.0`
  - harmless preference categories are allowed: language, tone, style, irony, brevity, formality
  - preferences cannot override tool boundaries, auth, data access, safety, or current-turn instructions
  - classifier prompt contains few-shot examples for ambiguous/mixed requests, URL boundaries, calendar create/query, immediate style vs durable preference, unsupported purchase, URL summarization, and missing details
  - `needs_clarification` requires a question/clarification
  - `unsupported` requires `blockerReason` and `suggestedNextStep`
  - invalid cross-products fail schema validation

Implementation:

- Update `packages/llm-prompts/src/intex-agent/systemPrompt.ts`.
- Update `packages/llm-prompts/src/intex-agent/intentClassifierPrompt.ts`.
- Update `packages/llm-prompts/src/intex-agent/intentClassifierSchemas.ts`.
- Update `packages/llm-prompts/src/intex-agent/runnerOutputSchemas.ts`.
- Update `packages/llm-prompts/src/intex-agent/runnerOutputRepairPrompt.ts`.

Verification:

- `pnpm --filter @intexuraos/llm-prompts test -- --run packages/llm-prompts/src/intex-agent/__tests__/systemPrompt.test.ts packages/llm-prompts/src/intex-agent/__tests__/intentClassifierPrompt.test.ts packages/llm-prompts/src/intex-agent/__tests__/intentClassifierSchemas.test.ts`

## Task 2: LLM-First Classification And Metadata Propagation

Tests first:

- Update `apps/intex-agent/src/__tests__/domain/intentClassifier.test.ts`.
- Update `apps/intex-agent/src/__tests__/domain/intentGate.test.ts`.
- Update `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`.
- Update `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`.
- Cover:
  - normal natural-language classification calls the LLM first
  - the regex gate is not used as production routing fallback
  - classifier failure exposes no mutating tools and produces a targeted recovery/clarification response
  - mixed resource intent returns targeted clarification
  - missing required details returns targeted clarification
  - unsupported reply preserves model-specific text and metadata
  - generic capabilities are only used for direct "what can you do?" style questions
  - metadata survives classifier -> runner -> session event payload
  - all previous generic fallback choke points are covered: LLM run failure, invalid runner JSON, parsed unsupported output, completed tool mismatch, unavailable tool calls

Implementation:

- Update `apps/intex-agent/src/domain/agent/intentClassifier.ts`.
- Update `apps/intex-agent/src/domain/agent/intentGate.ts`.
- Update `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`.
- Update `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`.
- Update `apps/intex-agent/src/domain/sessions/types.ts`.
- Update `apps/intex-agent/src/services.ts`.

Verification:

- `pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/intentClassifier.test.ts apps/intex-agent/src/__tests__/domain/intentGate.test.ts apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`

## Task 3: Shared Tool Description Catalog

Tests first:

- Update or add `apps/intex-agent/src/__tests__/domain/toolDefinitions.test.ts`.
- Update prompt tests so the classifier prompt includes generated classifier-facing tool descriptions from the same source.
- Cover:
  - each tool description includes `Purpose`, `Use for`, `Do not use for`, `Required input`, `Boundary`, `Examples`, `Result`, and `Errors`
  - classifier and runner descriptions come from the same checked-in catalog
  - URL precedence is represented
  - preference sequencing is represented
  - positive and negative examples exist for each tool

Implementation:

- Add a checked-in catalog near `apps/intex-agent/src/domain/agent/toolDefinitions.ts` or a shared prompt package location if dependency direction allows it.
- Update `apps/intex-agent/src/domain/agent/toolDefinitions.ts` to use the catalog.
- Update `packages/llm-prompts/src/intex-agent/intentClassifierPrompt.ts` or a supporting prompt helper to include classifier-facing descriptions generated from the catalog.
- If dependency direction prevents direct sharing between app and prompt package, place the source of truth in `packages/llm-prompts` and import it into `apps/intex-agent`.

Verification:

- `pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/toolDefinitions.test.ts`
- `pnpm --filter @intexuraos/llm-prompts test -- --run packages/llm-prompts/src/intex-agent/__tests__/intentClassifierPrompt.test.ts`

## Task 4: Preference Behavior And Display Copy

Tests first:

- Update `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`.
- Update `apps/intex-agent/src/__tests__/domain/capabilities.test.ts`.
- Update `apps/intex-agent/src/__tests__/routes/preferencesRoutes.test.ts` and `promptPreferencesRoutes.test.ts` if present.
- Update web tests:
  - `apps/web/src/pages/__tests__/IntexAgentPreferencesPage.test.tsx`
  - `apps/web/src/pages/__tests__/IntexAgentConfigPage.test.tsx` if present
  - `apps/web/src/components/__tests__/Sidebar.test.tsx`
- Cover:
  - immediate `be shorter` / `answer this one in English` does not mutate preferences
  - durable preference wording exposes exact preference tools
  - ambiguous update/delete preference target does not mutate
  - `INTEX` user-facing copy becomes `Intex`
  - technical identifiers containing `INTEX` remain unchanged

Implementation:

- Update prompt and runner copy.
- Update `apps/intex-agent/src/domain/agent/capabilities.ts`.
- Update `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`.
- Update `apps/intex-agent/src/domain/agent/toolDefinitions.ts`.
- Update `apps/intex-agent/src/routes/preferencesRoutes.ts`.
- Update `apps/intex-agent/src/routes/promptPreferencesRoutes.ts`.
- Update `apps/intex-agent/src/services.ts`.
- Update `apps/web/src/pages/IntexAgentPreferencesPage.tsx`.
- Update `apps/web/src/pages/IntexAgentConfigPage.tsx`.
- Update `apps/web/src/components/Sidebar.tsx`.
- Update `docs/services/intex-agent/features.md`.

Verification:

- `pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts apps/intex-agent/src/__tests__/domain/capabilities.test.ts`
- `pnpm --filter @intexuraos/web test -- --run apps/web/src/pages/__tests__/IntexAgentPreferencesPage.test.tsx apps/web/src/components/__tests__/Sidebar.test.tsx`

## Task 5: Structured Tool Errors And Session Facts

Tests first:

- Update `apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts` if present, or add focused tests around tool executor behavior.
- Update `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`.
- Update `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`.
- Update `apps/intex-agent/src/__tests__/infra/firestore/sessionRepository.test.ts`.
- Cover:
  - external save not configured -> `configuration`, non-retryable
  - downstream transient failure -> `transient`, retryable
  - validation error -> `validation`, user correction message
  - preference stale version -> `version_conflict`
  - empty calendar query result remains completed success
  - tool failures persist safe metadata but not raw secrets or large raw payloads

Implementation:

- Update `apps/intex-agent/src/domain/agent/toolDefinitions.ts` executor interfaces.
- Update `apps/intex-agent/src/domain/agent/toolExecutor.ts`.
- Update `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`.
- Update `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`.
- Update `apps/intex-agent/src/domain/sessions/types.ts`.
- Update `apps/intex-agent/src/infra/firestore/sessionRepository.ts` only if explicit serialization or type handling is required.

Verification:

- `pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`

## Task 6: Integration Verification

Run:

- `pnpm --filter @intexuraos/llm-prompts test`
- `pnpm --filter @intexuraos/intex-agent test`
- `pnpm --filter @intexuraos/web test`
- `pnpm run verify:workspace:tracked -- intex-agent`
- `pnpm run verify:workspace:tracked -- web`
- `pnpm run ci:tracked`

Then request code review before commit.

## Task 7: PR, Merge, Deploy, Notification

Prerequisites:

- A real `INT-XXX` issue ID is required for the PR title/body.
- `pnpm run ci:tracked` must pass completely before commit.

Steps:

- Commit implementation and tests.
- Push branch `codex/intex-agent-clarity-preferences`.
- Open PR against `development`.
- Wait for GitHub Actions.
- Merge only after required checks pass and review requirements are satisfied.
- Watch production deployment GitHub Actions.
- After production deploy succeeds, notify the user via WhatsApp.

## Self-Review Notes

- The highest-risk behavior is over-refusal. The schema compatibility matrix and tests must force clarification for missing details, ambiguous intent, ambiguous preference target, and insufficient context.
- The second highest risk is over-calling tools. Tests must show that immediate style feedback, arbitrary URL summarization, and code-task parameter questions do not call mutation tools.
- Shared tool descriptions are required because prompt-only fixes will drift from runtime tool definitions.
- Structured error persistence must be sanitized. Do not store raw downstream exception strings, auth headers, secrets, or full private payloads.
