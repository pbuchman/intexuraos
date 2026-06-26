# INT-1703: INTEX Agent Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "INTEX Agent" menu in the web app sidebar with a "Configuration" sub-route that lets users create, edit, and delete per-user natural-language instructions. These instructions are injected as a "User Preferences" block into the Intex Agent system prompt at run time so the agent honors them when acting on WhatsApp Assistant messages.

**Architecture:** `apps/intex-agent` owns a new Firestore collection `intex_agent_user_instructions` (one document per instruction, scoped by `userId`). A new repository port + Firestore adapter back authenticated CRUD endpoints. `handleIncomingMessage` loads the active user's instructions once per inbound message and appends them to the system prompt assembled by `createIntexAgentRunner`. The web app adds a new `INTEX Agent` collapsible sidebar section with a `Configuration` route, a page that lists/adds/edits/deletes instructions through a typed API client, and tests for every layer.

**Tech Stack:** TypeScript (strict), Fastify, React/Vite, TailwindCSS, Vitest, Firestore (`@intexuraos/infra-firestore`), `lucide-react`, `Auth0` JWT.

## Global Constraints

- 100% branch coverage required on new code; use `v8 ignore` only with valid categories from `CLAUDE.md` (`ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`).
- TDD: write failing test → confirm failure → implement minimal code → refactor.
- One Firestore collection owner: `intex-agent` (per `firestore-collections.json` and memory about strict service ownership).
- Every HTTP endpoint MUST use `logIncomingRequest()`.
- All apps use `getServices()`, fastify DI, `validateRequiredEnv()` patterns.
- Domain code in `apps/intex-agent` must not import from `@intexuraos/internal-clients`; ports are explicit.
- Web app is hash-routed (`/#/path`); service URLs come from `apps/web/service-manifest.json` (already includes `INTEXURAOS_INTEX_AGENT_URL`).
- All `PromptBuilder` prompts MUST carry a `version` field; bump on edit (major for behavior, minor for examples, patch for typos).
- Before editing `INTEX_AGENT_SYSTEM_PROMPT`, read the current `version` in `apps/intex-agent/src/domain/agent/systemPrompt.ts` and bump exactly one major version because the prompt content gains a User Preferences block. Current expected path on this PR base: `5.0.0` → `6.0.0`.
- Plans with HTTP endpoints MUST include an "Endpoint Changes" section.
- Reference existing patterns: `apps/web/src/components/WhatsAppPreferencesCard.tsx` (preferences UI) and `apps/intex-agent/src/infra/firestore/sessionRepository.ts` (Firestore repository).

---

## File Structure

### New files (apps/intex-agent)

- `apps/intex-agent/src/domain/preferences/types.ts` — `UserInstruction` type, `InstructionId` branded type.
- `apps/intex-agent/src/domain/preferences/ports/instructionRepository.ts` — port interface.
- `apps/intex-agent/src/domain/preferences/buildInstructionBlock.ts` — pure formatter that converts a list of instructions into the prompt block.
- `apps/intex-agent/src/infra/firestore/instructionRepository.ts` — Firestore adapter; collection `intex_agent_user_instructions`.
- `apps/intex-agent/src/routes/preferenceRoutes.ts` — public/authenticated CRUD endpoints.
- `apps/intex-agent/src/__tests__/domain/preferences/buildInstructionBlock.test.ts`
- `apps/intex-agent/src/__tests__/infra/firestore/instructionRepository.test.ts`
- `apps/intex-agent/src/__tests__/routes/preferenceRoutes.test.ts`

### Modified files (apps/intex-agent)

- `apps/intex-agent/src/domain/agent/systemPrompt.ts` — bump the current version by one major version (expected `5.0.0` → `6.0.0`), export `USER_PREFERENCES_PROMPT_PREAMBLE` constant.
- `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` — accept `instructions: UserInstruction[]` in input, append `buildInstructionBlock` to `systemPrompt`.
- `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts` — load instructions once before `runner.run`, pass through.
- `apps/intex-agent/src/services.ts` — add `instructionRepository` to `ServiceContainer`, wire into `incomingMessageHandler`.
- `apps/intex-agent/src/server.ts` — register `preferenceRoutes`.
- `firestore-collections.json` — register `intex_agent_user_instructions` owner.

### New files (apps/web)

- `apps/web/src/services/intexAgentPreferencesApi.ts`
- `apps/web/src/services/intexAgentPreferencesApi.types.ts`
- `apps/web/src/hooks/useIntexAgentPreferences.ts`
- `apps/web/src/pages/IntexAgentConfigurationPage.tsx`
- `apps/web/src/pages/__tests__/IntexAgentConfigurationPage.test.tsx`

### Modified files (apps/web)

- `apps/web/src/components/sidebar/navItems.ts` — add `intexAgentItems` array (`/intex-agent/configuration`).
- `apps/web/src/components/sidebar/useSidebarState.ts` — add `isIntexAgentOpen` state, hydrate from URL hash, and auto-expand when the current route starts with `/intex-agent`.
- `apps/web/src/components/Sidebar.tsx` — render new `CollapsibleNavSection`.
- `apps/web/src/components/__tests__/Sidebar.test.tsx` — render test for the new `INTEX Agent` section.
- `apps/web/src/App.tsx` — lazy-load `IntexAgentConfigurationPage` and add `/intex-agent/configuration` route.
- `apps/web/src/services/index.ts` — re-export new API types/functions.

---

## Task 1: Domain types and port for user instructions

**Files:**
- Create: `apps/intex-agent/src/domain/preferences/types.ts`
- Create: `apps/intex-agent/src/domain/preferences/ports/instructionRepository.ts`
- Test: `apps/intex-agent/src/__tests__/domain/preferences/buildInstructionBlock.test.ts` (stub the formatter in step 1, real test in Task 2)

**Interfaces (defined here, consumed later):**

```ts
// apps/intex-agent/src/domain/preferences/types.ts
export type InstructionId = string & { readonly __brand: 'InstructionId' };

export interface UserInstruction {
  id: InstructionId;
  userId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserInstructionDraft {
  text: string;
}

// apps/intex-agent/src/domain/preferences/ports/instructionRepository.ts
import type { UserInstruction, UserInstructionDraft } from '../types.js';
export interface InstructionRepository {
  list(userId: string): Promise<UserInstruction[]>;
  create(userId: string, draft: UserInstructionDraft): Promise<UserInstruction>;
  update(userId: string, id: InstructionId, draft: UserInstructionDraft): Promise<UserInstruction>;
  delete(userId: string, id: InstructionId): Promise<void>;
}
```

- [ ] **Step 1.1:** Write the failing compile-only types + port test by defining a structural fake that implements `InstructionRepository`, calls all four methods, and uses typed inputs/outputs. Do not add a runtime-only `expectInstructionRepositoryContract` helper; TypeScript compatibility is the contract check.
- [ ] **Step 1.2:** Run `pnpm --filter intex-agent exec vitest run src/__tests__/domain/preferences/buildInstructionBlock.test.ts` — expect compile failure.
- [ ] **Step 1.3:** Implement `types.ts` and `ports/instructionRepository.ts` exactly as shown above.
- [ ] **Step 1.4:** Run tests — pass.
- [ ] **Step 1.5:** Commit: `feat(intex-agent): define user instruction domain types and port`.

---

## Task 2: Pure formatter for instruction block

**Files:**
- Create: `apps/intex-agent/src/domain/preferences/buildInstructionBlock.ts`
- Test: `apps/intex-agent/src/__tests__/domain/preferences/buildInstructionBlock.test.ts`

- [ ] **Step 2.1:** Write failing tests covering:
  - empty list returns empty string,
  - one instruction renders numbered `1. <text>` block under header `User Preferences:`,
  - multiple instructions preserve original order,
  - instructions with newlines are emitted verbatim (no escaping),
  - whitespace-only `text` is rejected (treated as empty, function returns `''`).

```ts
import type { UserInstruction } from './types.js';
export function buildInstructionBlock(instructions: UserInstruction[]): string {
  const trimmed = instructions.filter((i) => i.text.trim() !== '');
  if (trimmed.length === 0) return '';
  const lines = trimmed.map((i, idx) => `${idx + 1}. ${i.text.trim()}`);
  return ['User Preferences:', ...lines].join('\n');
}
```

- [ ] **Step 2.2:** Run `vitest run src/__tests__/domain/preferences/buildInstructionBlock.test.ts` — fail.
- [ ] **Step 2.3:** Implement `buildInstructionBlock.ts`.
- [ ] **Step 2.4:** Tests pass.
- [ ] **Step 2.5:** Commit: `feat(intex-agent): buildInstructionBlock formats user preferences`.

---

## Task 3: Firestore instruction repository

**Files:**
- Create: `apps/intex-agent/src/infra/firestore/instructionRepository.ts`
- Modify: `firestore-collections.json` — add entry under `collections`:
  ```json
  "intex_agent_user_instructions": {
    "owner": "intex-agent",
    "description": "Per-user natural-language instructions appended to the Intex Agent system prompt. Documents keyed by instructionId; ordered by createdAt."
  }
  ```
- Test: `apps/intex-agent/src/__tests__/infra/firestore/instructionRepository.test.ts`

- [ ] **Step 3.1:** Write failing tests using a fake Firestore (mirror `FirestoreSessionRepository` test style — in-memory map keyed by instruction document id, with `userId` stored in each document).
  - `list` returns empty array when collection empty,
  - `list` orders by `createdAt` ascending,
  - `list` filters out documents with mismatched `userId`,
  - `create` assigns UUID via `randomUUID()` and timestamps via injected `clock`,
  - `update` overwrites text and `updatedAt`, throws `INSTRUCTION_NOT_FOUND` if missing/wrong user,
  - `delete` removes an existing instruction,
  - `delete` throws `INSTRUCTION_NOT_FOUND` for missing/wrong user, including a second delete of the same id.
- [ ] **Step 3.2:** Run test — fail.
- [ ] **Step 3.3:** Implement `FirestoreInstructionRepository` with collection constant `INTEX_AGENT_USER_INSTRUCTIONS_COLLECTION = 'intex_agent_user_instructions'`, document id `intex_instruction_${randomUUID()}` (no `userId` in the id). Store `userId` in the document and filter with `where('userId', '==', userId)`, matching `FirestoreSessionRepository`.
- [ ] **Step 3.4:** Tests pass.
- [ ] **Step 3.5:** Update `firestore-collections.json`.
- [ ] **Step 3.6:** Commit: `feat(intex-agent): Firestore instruction repository`.

---

## Task 4: Public CRUD endpoints

**Files:**
- Create: `apps/intex-agent/src/routes/preferenceRoutes.ts`
- Modify: `apps/intex-agent/src/server.ts` — `await app.register(preferenceRoutes);` after `sessionRoutes`.
- Test: `apps/intex-agent/src/__tests__/routes/preferenceRoutes.test.ts`

- [ ] **Step 4.0:** Create the empty route test file so the TDD red step has a concrete target.
- [ ] **Step 4.1:** Write failing tests using `app.inject()` (mirror `sessionRoutes.test.ts`).
  - `GET /user-instructions` → 200 with `UserInstruction[]`,
  - `POST /user-instructions` with `{ text: '...' }` → 201 with created instruction,
  - `POST /user-instructions` with empty text → 400 `INVALID_REQUEST`,
  - `PATCH /user-instructions/:id` updates only the caller's instruction,
  - `PATCH /user-instructions/:id` of another user → 404 `NOT_FOUND`,
  - `PATCH /user-instructions/:id` with an unknown id → 404 `NOT_FOUND`,
  - `DELETE /user-instructions/:id` returns 204 on first delete,
  - `DELETE /user-instructions/:id` returns 404 `NOT_FOUND` on a second delete or unknown id.
- [ ] **Step 4.2:** Run tests — fail.
- [ ] **Step 4.3:** Implement routes using `requireAuth`, `logIncomingRequest`, `getServices().instructionRepository`. Schemas use `security: [{ bearerAuth: [] }]`, tags `['intex-agent']`. Use `reply.ok`, `reply.fail` helpers.
- [ ] **Step 4.4:** Tests pass.
- [ ] **Step 4.5:** Commit: `feat(intex-agent): user-instruction CRUD routes`.

---

## Task 5: System prompt + runner wiring

**Files:**
- Modify: `apps/intex-agent/src/domain/agent/systemPrompt.ts`
- Modify: `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
- Test: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts` (extend existing test file)

- [ ] **Step 5.1:** Add new failing assertion in the existing `intexAgentRunner.test.ts`:
  - When `instructions: [{ id, userId, text: 'When I add an event with Monika, also invite monikamaupa@gmail.com', createdAt, updatedAt }]` is supplied, the prompt contains `User Preferences:` and the numbered instruction.
  - When instructions are empty, prompt must not contain `User Preferences:`.
  - `INTEX_AGENT_SYSTEM_PROMPT.version` equals the current prompt version bumped by one major version (expected `'6.0.0'` on this PR base).
- [ ] **Step 5.2:** Run test — fail.
- [ ] **Step 5.3:** Bump `INTEX_AGENT_SYSTEM_PROMPT.version` by one major version from its current value (expected `'5.0.0'` → `'6.0.0'` on this PR base) and append a single line: `'Always honor the User Preferences block when it is present in this prompt.'`.
- [ ] **Step 5.4:** Update `IntexAgentRunner.run` signature to accept `instructions: UserInstruction[]`, compute `instructionBlock = buildInstructionBlock(instructions)`, and assemble `systemPrompt = instructionBlock === '' ? INTEX_AGENT_SYSTEM_PROMPT.text : `${INTEX_AGENT_SYSTEM_PROMPT.text}\n\n${instructionBlock}\nCurrent date-time: ${currentDateTime}``.
- [ ] **Step 5.5:** Tests pass.
- [ ] **Step 5.6:** Commit: `feat(intex-agent): inject user preferences into system prompt`.

---

## Task 6: Wire repository through services and message handler

**Files:**
- Modify: `apps/intex-agent/src/services.ts`
- Modify: `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`
- Test: extend `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`

- [ ] **Step 6.1:** Write failing test asserting `handleIncomingMessage` calls `instructionRepository.list(userId)` exactly once per message and passes the result into `runner.run`.
- [ ] **Step 6.2:** Run test — fail.
- [ ] **Step 6.3:** Add `InstructionRepository` to `ServiceContainer`. In `initServices`, instantiate `FirestoreInstructionRepository({ firestore })`. In `HandleIncomingMessageDeps`, add `instructionRepository`. In `handleIncomingMessage`, before `runner.run`, call `deps.instructionRepository.list(input.userId)` and pass result as `instructions` to the runner.
- [ ] **Step 6.4:** Update `incomingMessageHandler` constructor in `services.ts` to pass `instructionRepository`.
- [ ] **Step 6.5:** Tests pass.
- [ ] **Step 6.6:** Commit: `feat(intex-agent): load user preferences during message handling`.

---

## Task 7: Web API client + types

**Files:**
- Create: `apps/web/src/services/intexAgentPreferencesApi.types.ts`
- Create: `apps/web/src/services/intexAgentPreferencesApi.ts`
- Modify: `apps/web/src/services/index.ts`

- [ ] **Step 7.1:** Define types:
  ```ts
  export interface UserInstruction {
    id: string;
    userId: string;
    text: string;
    createdAt: string;
    updatedAt: string;
  }
  export interface CreateUserInstructionRequest { text: string; }
  export interface UpdateUserInstructionRequest { text: string; }
  ```
- [ ] **Step 7.2:** Implement `listUserInstructions`, `createUserInstruction`, `updateUserInstruction`, `deleteUserInstruction` using `apiRequest` and `config.intexAgentUrl`. Path: `/user-instructions` and `/user-instructions/:id`.
- [ ] **Step 7.3:** Re-export from `services/index.ts` with:
  ```ts
  export * from './intexAgentPreferencesApi.js';
  export type {
    CreateUserInstructionRequest,
    UpdateUserInstructionRequest,
    UserInstruction,
  } from './intexAgentPreferencesApi.types.js';
  ```
- [ ] **Step 7.4:** Commit: `feat(web): intex-agent preferences API client`.

---

## Task 8: React hook `useIntexAgentPreferences`

**Files:**
- Create: `apps/web/src/hooks/useIntexAgentPreferences.ts`
- Test: `apps/web/src/hooks/__tests__/useIntexAgentPreferences.test.tsx` (create if missing — follow `useWorkerSettings.test.tsx` pattern)

- [ ] **Step 8.1:** Failing tests:
  - load on mount calls `listUserInstructions`,
  - `add(text)` calls API and prepends/keeps order,
  - `update(id, text)` patches and replaces in state,
  - `remove(id)` calls delete and removes from state,
  - error surfaces in `error` field,
  - empty `text` is rejected by hook (does not call API).
- [ ] **Step 8.2:** Implement hook using the existing dominant web hook auth pattern: call `getAccessToken` from `useAuth()` directly, as in `useWorkerSettings.ts`, `useNotes.ts`, and `IntexAgentSessionsPage.tsx`. Use optimistic updates with revert on failure (mirror `WhatsAppPreferencesCard`).
- [ ] **Step 8.3:** Tests pass.
- [ ] **Step 8.4:** Commit: `feat(web): useIntexAgentPreferences hook`.

---

## Task 9: Sidebar nav item

**Files:**
- Modify: `apps/web/src/components/sidebar/navItems.ts`
- Modify: `apps/web/src/components/sidebar/useSidebarState.ts`
- Modify: `apps/web/src/components/Sidebar.tsx`

- [ ] **Step 9.1:** In `navItems.ts` add:
  ```ts
  export const intexAgentItems: NavItem[] = [
    { to: '/intex-agent/configuration', label: 'Configuration', icon: SlidersHorizontal },
  ];
  ```
  Import `SlidersHorizontal` from `lucide-react`.
- [ ] **Step 9.2:** In `useSidebarState.ts` add `isIntexAgentOpen` state seeded from `window.location.hash.includes('/intex-agent')`.
- [ ] **Step 9.2a:** Add the matching auto-expand effect used by the other sidebar sections:
  ```ts
  useEffect(() => {
    if (location.pathname.startsWith('/intex-agent')) {
      setIsIntexAgentOpen(true);
    }
  }, [location.pathname]);
  ```
- [ ] **Step 9.3:** In `Sidebar.tsx`, render a `CollapsibleNavSection` after `Research Studio` and before `Linear`:
  ```tsx
  <CollapsibleNavSection
    label="INTEX Agent"
    icon={Sparkles}
    items={intexAgentItems}
    rootPath="/intex-agent"
    isOpen={s.isIntexAgentOpen}
    onToggle={s.setIsIntexAgentOpen}
    isCollapsed={s.isCollapsed}
    isActive={location.pathname.startsWith('/intex-agent')}
    navigateFallback="/intex-agent/configuration"
  />
  ```
  (`Sparkles` is already imported. Alternatively `Bot` if preferred for semantic clarity.)
- [ ] **Step 9.4:** Add `apps/web/src/components/__tests__/Sidebar.test.tsx` that mounts `Sidebar` with `MemoryRouter` and asserts the `INTEX Agent` section and `Configuration` entry render.
- [ ] **Step 9.5:** Run `pnpm --filter web exec vitest run src/components/sidebar src/components/__tests__/Sidebar.test.tsx` — pass.
- [ ] **Step 9.6:** Commit: `feat(web): INTEX Agent sidebar section`.

---

## Task 10: Configuration page

**Files:**
- Create: `apps/web/src/pages/IntexAgentConfigurationPage.tsx`
- Test: `apps/web/src/pages/__tests__/IntexAgentConfigurationPage.test.tsx`

- [ ] **Step 10.1:** Write failing page tests:
  - shows loading spinner on mount,
  - renders error banner on load failure,
  - renders list of instructions from hook,
  - clicking `Add instruction` opens the editor in create mode,
  - editing existing item opens editor pre-filled,
  - deleting calls `remove` and removes row.
- [ ] **Step 10.2:** Implement the CRUD UI in `IntexAgentConfigurationPage.tsx` directly unless it exceeds the CLAUDE.md SRP target of roughly 150 lines. Keep row/editor rendering as local JSX helpers if needed rather than separate components. Use `Pencil` / `Trash2` icons, dark-mode aware Tailwind classes consistent with `WhatsAppPreferencesCard`, and `Button` / `Input` / `Card` from `@/components`.
- [ ] **Step 10.3:** Include header `INTEX Agent Configuration` and helper text with the English example: "These instructions are injected as a User Preferences block whenever the agent executes a prompt. Example: 'When I add a calendar event with Monika, also invite monikamaupa@gmail.com'." This intentionally displays the English version of the Polish example from the issue.
- [ ] **Step 10.4:** Tests pass.
- [ ] **Step 10.5:** Commit: `feat(web): INTEX Agent configuration page`.

---

## Task 11: Route registration

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 11.1:** Add lazy import:
  ```ts
  const IntexAgentConfigurationPage = React.lazy(() =>
    import('@/pages/IntexAgentConfigurationPage').then((m) => ({ default: m.IntexAgentConfigurationPage })),
  );
  ```
- [ ] **Step 11.2:** Inside `<ProtectedLayout>`, add route after the WhatsApp routes:
  ```tsx
  <Route path="/intex-agent/configuration" element={<IntexAgentConfigurationPage />} />
  ```
- [ ] **Step 11.3:** Run `pnpm --filter web exec vitest run src/App` — pass.
- [ ] **Step 11.4:** Commit: `feat(web): register /intex-agent/configuration route`.

---

## Task 12: Workspace verification + docs

- [ ] **Step 12.1:** Run `pnpm run verify:workspace:tracked -- intex-agent` and `pnpm run verify:workspace:tracked -- web` — both green.
- [ ] **Step 12.2:** Run `pnpm run ci:tracked` — green.
- [ ] **Step 12.3:** Confirm coverage ≥ 95% on both workspaces; address any `v8 ignore` with valid category and `-- reason @preserve`.
- [ ] **Step 12.4:** Update `docs/services/intex-agent.md` (create if absent) with a new section "User Preferences" describing the endpoints and prompt-block semantics. Update `docs/services/web.md` listing the new page.
- [ ] **Step 12.5:** Commit: `docs: INTEX Agent configuration documentation`.

---

## Endpoint Changes

### Modified

- `apps/intex-agent` system prompt: appended instruction line. No public schema change.

### Created

| Method | Path                                 | Description                                                                 |
| ------ | ------------------------------------ | --------------------------------------------------------------------------- |
| GET    | `/user-instructions`                 | List caller's active instructions.                                          |
| POST   | `/user-instructions`                 | Create a new instruction (`{ text }`). 400 on empty text.                   |
| PATCH  | `/user-instructions/:id`             | Update text. 404 if missing or not owned by caller.                         |
| DELETE | `/user-instructions/:id`             | Delete. 204 on first delete; 404 if missing or not owned.                   |

### Removed

- None.

### Unchanged

- `/sessions`, `/sessions/:sessionId`, `/sessions/:sessionId/events`, `/internal/intex-agent/messages` — untouched.

---

## Self-Review

**Spec coverage:**
1. ✅ New sidebar menu "INTEX Agent" — Task 9.
2. ✅ Submenu "Configuration" — Tasks 9, 11.
3. ✅ UI for adding/saving instructions to Firestore — Tasks 8, 10.
4. ✅ Instructions injected as prompt block during execution — Tasks 5, 6.
5. ✅ Example instruction covered by tests and helper copy — Tasks 5, 10.

**Placeholders:** No "TBD" / "TODO" / "similar to" / vague validation steps.

**Type consistency:**
- `UserInstruction` defined in Task 1, used verbatim in Tasks 3, 4, 5, 7, 8, 10.
- `InstructionRepository` port defined in Task 1, implemented in Task 3, wired in Task 6.
- `buildInstructionBlock` signature fixed in Task 2 and reused in Task 5.
- `systemPrompt` version bumped exactly one major version from the implementation branch's current value (Task 5).

**No dead code / no orphaned imports** — every new symbol has at least one consumer.

**Memory usage:**
- Memory [2] applied: collection owned by `intex-agent` (not bloated into `user-service`).
- Memory [3] applied: layered approach (domain → infra → routes → runner wiring → UI → docs).

Engineered with love by 🤖 <a href="mailto:intex@intexuraos.cloud">Intex</a>
