# INTEX Agent Versioned Preferences Implementation Plan

## Goal

Implement itemized, versioned INTEX Agent prompt preferences that can be managed from both the agent and the web UI. The newest rendered preference block must be injected before every INTEX Agent LLM run. Existing External Save preferences remain separate and must not be overwritten by prompt-preference mutations.

Source spec: `docs/superpowers/specs/2026-06-28-intex-agent-versioned-preferences-design.md`

## Constraints

- Use TDD: add failing tests before production code for each behavior group.
- Do not migrate legacy `instructions` data.
- Keep `/preferences` only for current External Save configuration compatibility.
- Prompt preferences use new Firestore collections:
  - `intex_agent_prompt_preferences`
  - `intex_agent_prompt_preference_versions`
- Every route must call `logIncomingRequest()` and `requireAuth()`.
- Final gate before commit: `pnpm run ci:tracked`.

## Endpoint Changes

Create:

- `GET /preferences/prompt`
- `POST /preferences/prompt/items`
- `PATCH /preferences/prompt/items/:itemId`
- `DELETE /preferences/prompt/items/:itemId`
- `GET /preferences/prompt/versions`
- `GET /preferences/prompt/versions/:version`

Modify:

- `POST /internal/intex-agent/messages` fetches current prompt preferences immediately before each LLM run and injects only `renderedPromptBlock`.
- `GET /preferences`, `PUT /preferences`, and `DELETE /preferences` keep External Save behavior but no longer provide prompt runtime state.

## Data Model

Add domain types under `apps/intex-agent/src/domain/preferences/`:

- `IntexAgentPromptPreferences`
- `IntexAgentPromptPreferenceItem`
- `IntexAgentPromptPreferenceVersion`
- `IntexAgentPromptPreferenceVersionSummary`
- `PreferenceUpdatedBy`
- repository mutation input types

Add domain helpers:

- `emptyPromptPreferences(userId)`
- `normalizePreferenceText(text)`
- `renderPromptPreferenceBlock(version, items)`
- `createPreferenceId()`
- typed domain errors for invalid input, not found, and version conflict

## Task 1: Domain Model And Rendering

Tests first:

- Add `apps/intex-agent/src/__tests__/domain/promptPreferences.test.ts`.
- Cover empty state, single row render, multi-row render, update-position render, text normalization, empty rejection, length rejection, newline/control rejection, row-limit rejection, and rendered prompt block limit.

Implementation:

- Add `apps/intex-agent/src/domain/preferences/promptPreferences.ts`.
- Add constants:
  - `MAX_PROMPT_PREFERENCE_ITEMS = 50`
  - `MAX_PROMPT_PREFERENCE_ITEM_LENGTH = 500`
  - `MAX_RENDERED_PROMPT_PREFERENCES_LENGTH = 10_000`
- Render exactly:

```text
User Preferences v3:
1. (id: pref_abc123) "When I ask to invite Jakub to an event, invite jakub@gmail.com."
```

Verification:

- `pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/promptPreferences.test.ts`

## Task 2: Repository Port And Firestore Adapter

Tests first:

- Add `apps/intex-agent/src/__tests__/infra/firestore/promptPreferencesRepository.test.ts`.
- Cover missing current doc empty state, add/update/delete version increments, immutable version snapshots, stale `expectedVersion`, unknown item, row limit, prompt block limit, and External Save isolation.

Implementation:

- Add `apps/intex-agent/src/domain/ports/promptPreferencesRepository.ts`.
- Add `apps/intex-agent/src/infra/firestore/promptPreferencesRepository.ts`.
- Use one Firestore transaction per mutation:
  - read current doc,
  - validate `expectedVersion`,
  - derive next state and next version,
  - `transaction.set()` current doc,
  - `transaction.create()` immutable version doc.
- List versions by user ID and sort in memory by descending version if the Firestore test utility does not support a composite ordered query. Add an index migration only if the chosen query requires it.
- Register both new collections in `firestore-collections.json`.

Verification:

- `pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/infra/firestore/promptPreferencesRepository.test.ts`

## Task 3: HTTP Routes

Tests first:

- Add `apps/intex-agent/src/__tests__/routes/promptPreferencesRoutes.test.ts`.
- Cover auth, empty current response, add/update/delete success, version listing, version read, malformed version, item not found, version not found, validation errors, and `409 VERSION_CONFLICT` with `data.current`.
- Update `apps/intex-agent/src/__tests__/routes/preferencesRoutes.test.ts` so legacy `/preferences` no longer validates prompt instructions as runtime prompt state and continues to preserve External Save.

Implementation:

- Add `apps/intex-agent/src/routes/promptPreferencesRoutes.ts`.
- Register it from `apps/intex-agent/src/server.ts`.
- Map errors:
  - `INVALID_REQUEST` to 400
  - `NOT_FOUND` to 404
  - `VERSION_CONFLICT` to 409 with `{ current }`
  - unknown failures to `INTERNAL_ERROR`
- Keep existing `preferencesRoutes.ts` for External Save compatibility, but stop treating `instructions` as meaningful prompt data.

Verification:

- `pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/routes/promptPreferencesRoutes.test.ts apps/intex-agent/src/__tests__/routes/preferencesRoutes.test.ts`

## Task 4: Agent Tools, Intent Gate, And Prompt Injection

Tests first:

- Update `apps/intex-agent/src/__tests__/domain/toolDefinitions.test.ts`.
- Update `apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts`.
- Update `apps/intex-agent/src/__tests__/domain/intentGate.test.ts`.
- Update runner/session tests that assert prompt construction and tool filtering.
- Cover:
  - tools defined: `get_user_preferences`, `add_user_preference`, `update_user_preference`, `delete_user_preference`
  - tools use authenticated/session user ID only
  - mutation tool replies include exact new prompt block and version
  - intent gate exposes preference tools only for preference-management messages
  - newest rendered prompt block is fetched before every LLM run
  - no preference block is injected when there are no items

Implementation:

- Extend `apps/intex-agent/src/domain/sessions/types.ts`.
- Extend `apps/intex-agent/src/domain/agent/toolDefinitions.ts`.
- Extend `apps/intex-agent/src/domain/agent/toolExecutor.ts`.
- Extend `apps/intex-agent/src/domain/agent/intentGate.ts`.
- Update `apps/intex-agent/src/domain/agent/systemPrompt.ts`:
  - bump `INTEX_AGENT_SYSTEM_PROMPT.version`
  - make preference priority explicit
- Update `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`:
  - special-case completed replies for preference tools so the agent returns exact prompt blocks for list/mutation requests.
- Update `apps/intex-agent/src/services.ts`:
  - instantiate and inject the prompt-preferences repository separately from legacy External Save preferences.

Verification:

- `pnpm --filter @intexuraos/intex-agent test -- --run apps/intex-agent/src/__tests__/domain/toolDefinitions.test.ts apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts apps/intex-agent/src/__tests__/domain/intentGate.test.ts`
- `pnpm run verify:workspace:tracked -- intex-agent`

## Task 5: Web API And Preferences Page

Tests first:

- Update `apps/web/src/services/__tests__/intexAgentApi.test.ts`.
- Add `apps/web/src/pages/__tests__/IntexAgentPreferencesPage.test.tsx`.
- Cover load, empty state, add, edit, delete confirmation, conflict refresh, prompt preview, version history list, version selection, changed-row metadata, validation, pending state, and retry after failure.

Implementation:

- Extend `apps/web/src/services/intexAgentApi.ts` with prompt-preference types and API methods.
- Add `apps/web/src/pages/IntexAgentPreferencesPage.tsx`.
- Update `apps/web/src/App.tsx` with `/#/intex-agent/preferences`.
- Update `apps/web/src/components/sidebar/navItems.ts` so INTEX Agent links to `Preferences`.
- Keep or redirect existing `/intex-agent/config` only for External Save compatibility if existing routes/tests require it.
- Use a full-size, dense management page:
  - current version and last updated near title,
  - editable row list,
  - top and bottom add controls,
  - read-only current prompt preview,
  - version history panel,
  - historical prompt preview,
  - delete confirmation copy that says history retains removed text.

Verification:

- `pnpm --filter @intexuraos/web test -- --run apps/web/src/services/__tests__/intexAgentApi.test.ts apps/web/src/pages/__tests__/IntexAgentPreferencesPage.test.tsx`

## Task 6: Final Verification And Delivery

Run:

- `pnpm run verify:workspace:tracked -- intex-agent`
- `pnpm run verify:workspace:tracked -- web`
- `pnpm run ci:tracked`

Then:

- Commit all implementation and tests.
- Push the feature branch.
- Open a PR against `development` with a valid `INT-XXX` issue ID in the title.
- Wait for GitHub Actions to pass.
- Notify the user via WhatsApp when actions are green and the PR is ready to merge.

## Self-Review

- The plan separates prompt preferences from legacy External Save state, avoiding the main data-loss risk identified in architecture review.
- Versioning is implemented in the repository, not only in UI or routes, so every mutation path shares the same invariants.
- Prompt injection stays close to the existing service flow, minimizing session-runner churn.
- UI work is scoped to a real management page and avoids a marketing/configuration landing experience.
- The only remaining external dependency is the required PR issue ID; request it before PR creation if it is not discoverable in branch context.
