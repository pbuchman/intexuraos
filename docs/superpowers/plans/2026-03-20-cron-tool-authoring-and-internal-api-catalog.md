# Cron Tool Authoring And Internal API Catalog Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cron schedules easier to author by letting users pick concrete tools in the UI, while expanding cron-agent so it can use every internal API documented in api-docs-hub.

**Architecture:** Introduce one shared internal service catalog in `packages/common-core` so both cron-agent and api-docs-hub agree on the same internal API list. Keep the current cron execution model, but add a structured `preferredTools` field that the web UI can edit and cron-agent can use to bias tool selection. Expose tool parameter schemas from `/cron/services` so the UI can inject a readable tool template into the schedule instruction instead of making the user guess argument names.

**Tech Stack:** TypeScript, Fastify, Firestore, React, Vitest, Fastify Swagger/OpenAPI, shared workspace packages.

---

## Problem Summary

Today cron schedules are powerful but awkward to author:

- The user can pick services, but not specific tools.
- The user has to type tool names and argument shapes from memory.
- Cron-agent only had a narrow allowlist instead of the full internal API set.
- api-docs-hub and cron-agent could drift because they did not share the same internal API catalog.

The implementation should stay simple:

- Keep the human-language schedule parsing flow as-is.
- Keep the existing tool-calling runtime as-is.
- Improve authoring and discovery instead of replacing the agent loop.

## Plain Language Definitions

- **Service:** One internal backend, such as `code-agent` or `notes-agent`.
- **Tool:** One callable internal API operation exposed to the LLM from a service OpenAPI document.
- **Preferred tool:** A tool the user explicitly wants the agent to try first.
- **Tool template:** A small JSON-shaped snippet inserted into the instruction box so the user sees the tool name and expected argument structure.

## File Structure

### New files

| File                                                                 | Responsibility |
| -------------------------------------------------------------------- | -------------- |
| `packages/common-core/src/internalServiceCatalog.ts`                 | Shared list of internal services and env vars used by cron-agent and api-docs-hub |
| `packages/common-core/src/__tests__/internalServiceCatalog.test.ts`  | Covers trimming and blank-value filtering for the shared OpenAPI source builder |
| `apps/web/src/pages/cron-agent/PreferredToolChips.tsx`              | Shared chip list UI for selected preferred tools |
| `apps/web/src/pages/cron-agent/toolPromptTemplates.ts`              | Builds inserted tool snippets and manages preferred tool arrays |
| `apps/web/src/__tests__/CronScheduleNewPage.test.tsx`               | Covers clicking a tool, prompt injection, and request payload shape |
| `apps/api-docs-hub/src/__tests__/server.test.ts`                    | Smoke test for health + Swagger JSON/UI endpoints |
| `apps/cron-agent/src/domain/__tests__/types.test.ts`                | Covers schedule-action normalization when `preferredTools` is omitted |

### Modified files

| File                                                            | Change |
| --------------------------------------------------------------- | ------ |
| `apps/cron-agent/src/config.ts`                                 | Build the allowed service list from the shared internal service catalog |
| `apps/cron-agent/src/domain/types.ts`                           | Add `preferredTools` and normalization helpers |
| `apps/cron-agent/src/domain/use-cases/manage-schedule.ts`       | Validate and persist `preferredTools` against selected services |
| `apps/cron-agent/src/domain/use-cases/execute-action.ts`        | Bias tool ordering and prompting toward preferred tools |
| `apps/cron-agent/src/prompts/execute-action-prompt.ts`          | Explain preferred-tool intent in plain language to the model |
| `apps/cron-agent/src/infra/openapi-tool-registry.ts`            | Return tool parameter schemas and build tools from the full shared catalog |
| `apps/cron-agent/src/infra/firestore-schedule-repository.ts`    | Normalize legacy schedules that do not yet store `preferredTools` |
| `apps/cron-agent/src/routes/schedule-routes.ts`                 | Round-trip `preferredTools` and return tool `parameters` in `/cron/services` |
| `apps/api-docs-hub/src/config.ts`                               | Reuse the shared OpenAPI source catalog |
| `apps/api-docs-hub/tsconfig.json`                               | Include the shared catalog source in typecheck input |
| `apps/web/src/types/cronAgent.ts`                               | Add `preferredTools` and tool parameter schema types |
| `apps/web/src/hooks/useScheduleActions.ts`                      | Send and receive `preferredTools` in create/update flows |
| `apps/web/src/pages/cron-agent/CronScheduleNewPage.tsx`         | Add preferred-tool state and tool-template injection |
| `apps/web/src/pages/cron-agent/CronScheduleViewPage.tsx`        | Allow editing preferred tools from the schedule detail page |
| `apps/web/src/pages/cron-agent/ServiceSelector.tsx`             | Make tools clickable and show the preferred tool chips |
| `apps/web/src/pages/cron-agent/AvailableToolsPanel.tsx`         | Show selected preferred tools and insertable tool cards |
| `packages/common-core/src/index.ts`                             | Export the shared internal service catalog |

## Task 1: Shared Internal Service Catalog

**Files:**
- Create: `packages/common-core/src/internalServiceCatalog.ts`
- Create: `packages/common-core/src/__tests__/internalServiceCatalog.test.ts`
- Modify: `packages/common-core/src/index.ts`
- Modify: `apps/cron-agent/src/config.ts`
- Modify: `apps/api-docs-hub/src/config.ts`
- Modify: `apps/api-docs-hub/tsconfig.json`

- [ ] **Step 1: Create a shared catalog of internal services**
- [ ] **Step 2: Export helpers for building service definitions from base URLs**
- [ ] **Step 3: Export helpers for building api-docs-hub OpenAPI sources from explicit OpenAPI URLs**
- [ ] **Step 4: Add a focused test that proves blank OpenAPI URLs are skipped and non-blank values are trimmed**
- [ ] **Step 5: Update cron-agent and api-docs-hub to consume the shared catalog instead of keeping separate lists**

## Task 2: Persist Preferred Tools In Cron-Agent

**Files:**
- Modify: `apps/cron-agent/src/domain/types.ts`
- Modify: `apps/cron-agent/src/domain/use-cases/manage-schedule.ts`
- Modify: `apps/cron-agent/src/infra/firestore-schedule-repository.ts`
- Modify: `apps/cron-agent/src/routes/schedule-routes.ts`
- Create: `apps/cron-agent/src/domain/__tests__/types.test.ts`
- Modify: `apps/cron-agent/src/domain/use-cases/__tests__/manage-schedule.test.ts`
- Modify: `apps/cron-agent/src/routes/__tests__/schedule-routes.test.ts`

- [ ] **Step 1: Extend schedule action types with `preferredTools: string[]`**
- [ ] **Step 2: Add one normalizer so missing `preferredTools` becomes `[]` and duplicates are removed**
- [ ] **Step 3: Validate that every preferred tool belongs to one of the selected services**
- [ ] **Step 4: Normalize legacy Firestore records on read so old schedules still load cleanly**
- [ ] **Step 5: Update route tests to prove create/update/list/detail all round-trip `preferredTools`**

## Task 3: Bias Execution Toward Preferred Tools

**Files:**
- Modify: `apps/cron-agent/src/domain/use-cases/execute-action.ts`
- Modify: `apps/cron-agent/src/prompts/execute-action-prompt.ts`
- Modify: `apps/cron-agent/src/domain/use-cases/__tests__/execute-action.test.ts`

- [ ] **Step 1: Reorder the declared tools so preferred tools appear first**
- [ ] **Step 2: Add a plain-language preferred-tools section to the prompt**
- [ ] **Step 3: Keep all selected-service tools available so this remains advisory, not restrictive**
- [ ] **Step 4: Add tests proving preferred tools are listed first and included in the prompt**

## Task 4: Make Tool Selection Clear In The Web UI

**Files:**
- Create: `apps/web/src/pages/cron-agent/PreferredToolChips.tsx`
- Create: `apps/web/src/pages/cron-agent/toolPromptTemplates.ts`
- Modify: `apps/web/src/pages/cron-agent/CronScheduleNewPage.tsx`
- Modify: `apps/web/src/pages/cron-agent/CronScheduleViewPage.tsx`
- Modify: `apps/web/src/pages/cron-agent/ServiceSelector.tsx`
- Modify: `apps/web/src/pages/cron-agent/AvailableToolsPanel.tsx`
- Modify: `apps/web/src/hooks/useScheduleActions.ts`
- Modify: `apps/web/src/types/cronAgent.ts`
- Create: `apps/web/src/__tests__/CronScheduleNewPage.test.tsx`

- [ ] **Step 1: Extend frontend types so tools include `parameters` and actions include `preferredTools`**
- [ ] **Step 2: Build a small utility that turns a JSON Schema into a minimal argument template**
- [ ] **Step 3: Make tool rows clickable and insert a canonical tool block into the instruction textarea**
- [ ] **Step 4: Show removable preferred-tool chips without mutating the user’s free-form prose**
- [ ] **Step 5: Add a test that clicks a tool and proves the request payload contains the matching `preferredTools` entry**

## Task 5: Keep Api-Docs-Hub And Verification Healthy

**Files:**
- Create: `apps/api-docs-hub/src/__tests__/server.test.ts`

- [ ] **Step 1: Add a smoke test for `/health`, `/docs/json`, and `/docs`**
- [ ] **Step 2: Keep the assertions simple and readable so the behavior is obvious**
- [ ] **Step 3: Use the same shared catalog inputs in both cron-agent and api-docs-hub so the docs view and runtime stay aligned**

## Verification

- [ ] Run `pnpm --filter @intexuraos/common-core typecheck`
- [ ] Run `pnpm --filter @intexuraos/cron-agent typecheck`
- [ ] Run `pnpm --filter @intexuraos/api-docs-hub typecheck`
- [ ] Run `pnpm --filter @intexuraos/web typecheck`
- [ ] Run `pnpm --filter @intexuraos/cron-agent test -- src/__tests__/config.test.ts src/infra/__tests__/openapi-tool-registry.test.ts src/domain/use-cases/__tests__/manage-schedule.test.ts src/domain/use-cases/__tests__/execute-action.test.ts src/routes/__tests__/schedule-routes.test.ts`
- [ ] Run `pnpm exec vitest run src/__tests__/CronScheduleNewPage.test.tsx --config vitest.config.ts` from `apps/web`
- [ ] Run `pnpm run verify:workspace:tracked common-core`
- [ ] Run `pnpm run verify:workspace:tracked cron-agent`
- [ ] Run `pnpm run verify:workspace:tracked api-docs-hub`
- [ ] Run `pnpm run verify:workspace:tracked web`
- [ ] Run `pnpm run ci:tracked`

## Acceptance Criteria

- The cron schedule form lets a user click a tool and inject a readable tool template into the instruction.
- The saved schedule stores the selected tool names in `action.preferredTools`.
- Cron-agent still accepts schedules created before this feature.
- `/cron/services` returns enough tool schema data for the frontend to generate a tool template.
- Cron-agent can use all internal APIs that are represented in the shared internal API catalog.
- api-docs-hub and cron-agent read from the same internal API catalog source.

Plan complete and saved to `docs/superpowers/plans/2026-03-20-cron-tool-authoring-and-internal-api-catalog.md`. Ready to execute?
