# Intex Agent Prompt Preference Version Conflict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the WhatsApp Intex Agent save a new instruction-memory preference after all prior preferences have been deleted, without failing with `Expected preference version 0, but current version is 2`.

**Architecture:** Keep prompt preferences as an optimistic-versioned Firestore aggregate. Fix the agent-facing context so an empty-but-versioned aggregate still exposes the current write version, then add a single safe refresh-and-retry path for `add_user_preference`; update/delete remain version-checked because they target specific rows.

**Tech Stack:** TypeScript, Vitest, Firestore repositories, `apps/intex-agent`, `packages/llm-prompts`, WhatsApp Intex Agent session events.

## Global Constraints

- Follow `.claude/CLAUDE.md`; it is the single source of truth for this repo.
- Planning issue: `INT-1847`.
- Test-first: write failing tests before production changes.
- Do not expose private message bodies, phone numbers, OAuth user IDs, tokens, or raw preference text in logs, tests, docs, PR text, or Linear comments.
- Do not remove confirmation gating for prompt-preference mutation tools.
- Preserve optimistic version checks for update/delete operations.
- Prompt edits, if made, must bump semver versions.
- Final implementation commit gate: `pnpm run ci:tracked`.

---

## Investigation Findings

Read-only evidence was gathered from:

- Linear issue `INT-1847`; no comments were present.
- Firestore collections `intex_agent_sessions`, `intex_agent_session_events`, `intex_agent_prompt_preferences`, and `intex_agent_prompt_preference_versions` using `/secrets/gcp-sa.json`.
- Code paths in `apps/intex-agent/src/services.ts`, `apps/intex-agent/src/domain/agent/toolExecutor.ts`, `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`, `apps/intex-agent/src/domain/preferences/promptPreferences.ts`, and `packages/llm-prompts/src/intex-agent/systemPrompt.ts`.

Runtime logging note:

- The worker has a valid service-account credential at `/secrets/gcp-sa.json`.
- `gcloud` is not installed in this worker, so the Cloud Logging command could not be run from here.
- Per `.claude/reference/infrastructure.md`, migrated app services such as `intex-agent` run on Hetzner/PM2, not Cloud Run; persisted Intex Agent session events are the authoritative application trace for this incident.

Production evidence, with private content redacted:

| Time (UTC) | Evidence |
|------------|----------|
| `2026-07-04T20:06:54.377Z` | Latest Intex Agent session `intex_session_58cb588a-9351-451a-a709-70e4cc9586ea` started. |
| `2026-07-04T20:06:59.496Z` | `confirmation_requested` stored `toolName: add_user_preference`, redacted `text` hash `sha256:373be5bbe1d7`, and `expectedVersion: 0`. |
| `2026-07-04T20:07:21.436Z` | User accepted the confirmation. |
| `2026-07-04T20:07:21.812Z` | `tool_call_failed` persisted `error: Expected preference version 0, but current version is 2`, `errorCategory: unknown`, `isRetryable: false`. |
| `2026-06-30T13:46:46.827Z` | Same user's prompt preferences version 1 was created by an agent tool. |
| `2026-06-30T13:47:52.255Z` | Same user's prompt preferences version 2 deleted the only row, leaving `currentVersion: 2`, `itemCount: 0`, and empty `renderedPromptBlock`. |

Root cause:

- Prompt preferences are versioned even when zero active rows remain.
- `renderPromptPreferenceBlock()` returns an empty string when `items.length === 0`.
- `apps/intex-agent/src/services.ts` passes only `promptPreferences.renderedPromptBlock` into `createIntexAgentRunner()` as `userPreferences`.
- `packages/llm-prompts/src/intex-agent/systemPrompt.ts` omits the entire preference section when `userPreferences` is blank.
- The `add_user_preference` tool schema tells the model to use `expectedVersion: 0` when no block exists.
- Therefore an empty-but-versioned state (`currentVersion: 2`, no active rows) is indistinguishable from a never-initialized state (`currentVersion: 0`, no document) to the model, so it generated `expectedVersion: 0` and the repository correctly rejected the write.

Why this was not a confirmation race:

- The version-2 delete happened on `2026-06-30T13:47:52.255Z`.
- The failed add confirmation happened on `2026-07-04T20:06:59.496Z` and was accepted at `2026-07-04T20:07:21.436Z`.
- The stale version was already stale before the session began, not introduced during the confirmation window.

## Endpoint Changes

Modified:

- None.

Created:

- None.

Removed:

- None.

Unchanged:

- `GET /preferences/prompt`
- `POST /preferences/prompt/items`
- `PUT /preferences/prompt/items/:itemId`
- `DELETE /preferences/prompt/items/:itemId`
- Intex Agent WhatsApp Pub/Sub input/output contract
- Stored `intex_agent_prompt_preferences` and `intex_agent_prompt_preference_versions` document shapes

## File Structure

- Modify: `apps/intex-agent/src/domain/preferences/promptPreferences.ts`
  - Add `renderPromptPreferenceAgentContext(preferences)` that exposes the current version to the agent even when no rows are active.
- Modify: `apps/intex-agent/src/__tests__/domain/promptPreferences.test.ts`
  - Cover never-initialized, non-empty, and empty-but-versioned context rendering.
- Modify: `apps/intex-agent/src/services.ts`
  - Pass `renderPromptPreferenceAgentContext(promptPreferences)` into the runner instead of raw `renderedPromptBlock`.
- Modify: `apps/intex-agent/src/__tests__/services.test.ts`
  - Prove service wiring forwards a version-bearing empty context.
- Modify: `apps/intex-agent/src/domain/agent/toolExecutor.ts`
  - Retry `add_user_preference` once after a `PromptPreferencesError` `VERSION_CONFLICT`, refreshing `currentVersion` first.
- Modify: `apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts`
  - Prove add retries with the refreshed version and update/delete still surface stale-version errors.
- Modify: `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
  - Classify preference version conflicts and return a useful localized retry message for conflicts that remain after executor handling.
- Modify: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`
  - Cover the conflict metadata and user-facing reply.

---

### Task 1: Render Agent Preference Context With Version Metadata

**Files:**
- Modify: `apps/intex-agent/src/domain/preferences/promptPreferences.ts`
- Test: `apps/intex-agent/src/__tests__/domain/promptPreferences.test.ts`

**Interfaces:**
- Consumes: `IntexAgentPromptPreferences`
- Produces: `renderPromptPreferenceAgentContext(preferences): string | null`

- [ ] **Step 1: Add failing context-rendering tests**

Add these imports in `apps/intex-agent/src/__tests__/domain/promptPreferences.test.ts`:

```typescript
import {
  renderPromptPreferenceAgentContext,
  // keep existing imports
} from '../../domain/preferences/promptPreferences.js';
```

Add these tests:

```typescript
it('omits agent preference context for a never-initialized empty aggregate', () => {
  const current = emptyPromptPreferences('user-1');

  expect(renderPromptPreferenceAgentContext(current)).toBeNull();
});

it('renders non-empty agent preference context with the current expected version', () => {
  const added = addPromptPreferenceItem(emptyPromptPreferences('user-1'), {
    id: 'pref_focus',
    text: 'Prefer concise replies.',
    now: '2026-07-04T10:00:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-1' },
  });

  expect(renderPromptPreferenceAgentContext(added.current)).toBe(
    [
      'User Preferences v1:',
      '1. (id: pref_focus) \"Prefer concise replies.\"',
      'Use expectedVersion 1 for preference mutation tools.',
    ].join('\n')
  );
});

it('renders empty-but-versioned agent preference context with the current expected version', () => {
  const added = addPromptPreferenceItem(emptyPromptPreferences('user-1'), {
    id: 'pref_focus',
    text: 'Prefer concise replies.',
    now: '2026-07-04T10:00:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-1' },
  });
  const deleted = deletePromptPreferenceItem(added.current, {
    itemId: 'pref_focus',
    now: '2026-07-04T10:01:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-1' },
  });

  expect(deleted.current.renderedPromptBlock).toBe('');
  expect(renderPromptPreferenceAgentContext(deleted.current)).toBe(
    [
      'User Preferences v2:',
      'No active preference rows are currently defined.',
      'Use expectedVersion 2 for add_user_preference.',
    ].join('\n')
  );
});
```

- [ ] **Step 2: Run the focused domain test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/promptPreferences.test.ts
```

Expected before implementation: FAIL because `renderPromptPreferenceAgentContext` does not exist.

- [ ] **Step 3: Implement the context renderer**

Add this function in `apps/intex-agent/src/domain/preferences/promptPreferences.ts` after `renderPromptPreferenceBlock()`:

```typescript
export function renderPromptPreferenceAgentContext(
  preferences: IntexAgentPromptPreferences
): string | null {
  const currentVersion = preferences.currentVersion;
  if (preferences.renderedPromptBlock.trim() !== '') {
    return [
      preferences.renderedPromptBlock.trim(),
      `Use expectedVersion ${String(currentVersion)} for preference mutation tools.`,
    ].join('\n');
  }

  if (preferences.createdAt === null && currentVersion === 0) {
    return null;
  }

  return [
    `User Preferences v${String(currentVersion)}:`,
    'No active preference rows are currently defined.',
    `Use expectedVersion ${String(currentVersion)} for add_user_preference.`,
  ].join('\n');
}
```

- [ ] **Step 4: Run the focused domain test and confirm pass**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/promptPreferences.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/intex-agent/src/domain/preferences/promptPreferences.ts apps/intex-agent/src/__tests__/domain/promptPreferences.test.ts
git commit -m "fix: expose prompt preference write version to agent"
```

### Task 2: Wire Version-Bearing Context Into Intex Agent Runner Services

**Files:**
- Modify: `apps/intex-agent/src/services.ts`
- Test: `apps/intex-agent/src/__tests__/services.test.ts`

**Interfaces:**
- Consumes: `renderPromptPreferenceAgentContext(promptPreferences)`
- Produces: `createIntexAgentRunner({ userPreferences })` receives `null`, a non-empty preference block, or an empty-state block with current version.

- [ ] **Step 1: Add a failing services wiring test**

Add this import in `apps/intex-agent/src/__tests__/services.test.ts`:

```typescript
import {
  deletePromptPreferenceItem,
  addPromptPreferenceItem,
  emptyPromptPreferences,
} from '../domain/preferences/promptPreferences.js';
```

If `emptyPromptPreferences` is already imported, extend that import rather than adding a duplicate.

Add this test inside `describe('createTestConversationRunnerService', () => { ... })`:

```typescript
it('passes an empty-but-versioned preference context to the runner', async () => {
  const repository = new MemorySessionRepository();
  const added = addPromptPreferenceItem(emptyPromptPreferences('user-versioned-empty'), {
    id: 'pref_focus',
    text: 'Prefer concise replies.',
    now: '2026-07-04T10:00:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-versioned-empty' },
  });
  const deleted = deletePromptPreferenceItem(added.current, {
    itemId: 'pref_focus',
    now: '2026-07-04T10:01:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-versioned-empty' },
  });
  const createAgentRunnerFn: AgentRunnerFactory = vi.fn((): IntexAgentRunner => ({
    async run(): Promise<IntexAgentRunnerResult> {
      return { outcome: 'no_action', reply: 'Ready.' };
    },
    async executeConfirmed(): Promise<IntexAgentRunnerResult> {
      throw new Error('not used');
    },
  }));

  const runner = createTestConversationRunnerService({
    config: testConfig(),
    sessionRepository: repository,
    promptPreferencesRepository: promptPreferencesRepositoryWithCurrent(deleted.current),
    logger: silentLogger(),
    usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
    createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
    createLlmClientFn: vi.fn(() => fakeStructuredClient()),
    createAgentRunnerFn,
    ids: fixedTestIds(),
  });

  await runner.run({
    ...testRequest('versioned-empty'),
    userId: 'user-versioned-empty',
  });

  expect(createAgentRunnerFn).toHaveBeenCalledWith(
    expect.objectContaining({
      userPreferences: [
        'User Preferences v2:',
        'No active preference rows are currently defined.',
        'Use expectedVersion 2 for add_user_preference.',
      ].join('\n'),
    })
  );
});
```

Add this helper near the existing `promptPreferencesRepository()` test helper:

```typescript
function promptPreferencesRepositoryWithCurrent(
  current: ReturnType<typeof emptyPromptPreferences>
): CreateTestConversationRunnerServiceInput['promptPreferencesRepository'] {
  return {
    async getCurrent(): Promise<ReturnType<typeof emptyPromptPreferences>> {
      return current;
    },
    async listVersions(): Promise<[]> {
      return [];
    },
    async getVersion(): Promise<null> {
      return null;
    },
    async addItem(): Promise<never> {
      throw new Error('not used');
    },
    async updateItem(): Promise<never> {
      throw new Error('not used');
    },
    async deleteItem(): Promise<never> {
      throw new Error('not used');
    },
  };
}
```

- [ ] **Step 2: Run services test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/services.test.ts
```

Expected before implementation: FAIL because services still pass `promptPreferences.renderedPromptBlock`.

- [ ] **Step 3: Wire the context renderer**

In `apps/intex-agent/src/services.ts`, add the import:

```typescript
import { renderPromptPreferenceAgentContext } from './domain/preferences/promptPreferences.js';
```

Replace every runner config occurrence of:

```typescript
userPreferences: promptPreferences.renderedPromptBlock,
```

with:

```typescript
userPreferences: renderPromptPreferenceAgentContext(promptPreferences),
```

There are four occurrences in this file: confirmed production runner, normal production runner, and the two test-conversation runner paths.

- [ ] **Step 4: Run services test and confirm pass**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/services.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add apps/intex-agent/src/services.ts apps/intex-agent/src/__tests__/services.test.ts
git commit -m "fix: pass prompt preference version context to runner"
```

### Task 3: Refresh And Retry Safe Add Preference Version Conflicts

**Files:**
- Modify: `apps/intex-agent/src/domain/agent/toolExecutor.ts`
- Test: `apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts`

**Interfaces:**
- Consumes: `PromptPreferencesRepository.addItem(input)` and `PromptPreferencesRepository.getCurrent(userId)`
- Produces: `addUserPreference(args)` retries once with refreshed `current.currentVersion` only for `PromptPreferencesError` `VERSION_CONFLICT`

- [ ] **Step 1: Make the fake repository enforce expected versions**

In `apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts`, add `assertExpectedPromptPreferenceVersion` to the existing prompt-preference import.

Update `FakePromptPreferencesRepository.addItem()` to check the input version before mutating:

```typescript
  async addItem(
    input: Parameters<PromptPreferencesRepository['addItem']>[0]
  ): Promise<IntexAgentPromptPreferences> {
    this.calls.push({ method: 'addItem', input });
    assertExpectedPromptPreferenceVersion(this.current, input.expectedVersion);
    const result = addPromptPreferenceItem(this.current, {
      id: `pref_${String(++this.idCounter)}`,
      text: input.text,
      now: this.nextTime(),
      updatedBy: input.updatedBy,
    });
    this.current = result.current;
    this.versions.push(result.version);
    return result.current;
  }
```

Apply the same `assertExpectedPromptPreferenceVersion(this.current, input.expectedVersion);` line at the start of `updateItem()` and `deleteItem()` so stale update/delete test coverage is meaningful.

Add this helper method to `FakePromptPreferencesRepository`:

```typescript
  replaceCurrent(current: IntexAgentPromptPreferences): void {
    this.current = current;
  }
```

- [ ] **Step 2: Add failing retry and non-retry tests**

Add these tests after `mutates prompt preferences with authenticated session metadata`:

```typescript
it('refreshes current version once when adding a preference hits a version conflict', async () => {
  const promptPreferencesRepository = new FakePromptPreferencesRepository();
  const added = addPromptPreferenceItem(emptyPromptPreferences('user-1'), {
    id: 'pref_focus',
    text: 'Prefer concise replies.',
    now: '2026-07-04T10:00:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-1' },
  });
  const deleted = deletePromptPreferenceItem(added.current, {
    itemId: 'pref_focus',
    now: '2026-07-04T10:01:00.000Z',
    updatedBy: { actor: 'web_ui', userId: 'user-1' },
  });
  promptPreferencesRepository.replaceCurrent(deleted.current);
  const executor = createIntexAgentToolExecutor(
    createExecutorDeps({ promptPreferencesRepository, sessionId: 'session-1' })
  );

  const result = await executor.addUserPreference({
    text: 'Prefer direct answers.',
    expectedVersion: 0,
  });

  expect(promptPreferencesRepository.calls).toMatchObject([
    { method: 'addItem', input: { expectedVersion: 0 } },
    { method: 'getCurrent', userId: 'user-1' },
    { method: 'addItem', input: { expectedVersion: 2 } },
  ]);
  expect(JSON.parse(result)).toMatchObject({
    status: 'completed',
    currentVersion: 3,
    changedItemId: 'pref_1',
  });
});

it('does not retry stale update or delete preference operations', async () => {
  const updateRepository = new FakePromptPreferencesRepository();
  updateRepository.seed('user-1', { id: 'pref_focus', text: 'Prefer concise replies.' });
  const updateExecutor = createIntexAgentToolExecutor(
    createExecutorDeps({ promptPreferencesRepository: updateRepository })
  );

  await expect(
    updateExecutor.updateUserPreference({
      itemId: 'pref_focus',
      text: 'Prefer direct answers.',
      expectedVersion: 0,
    })
  ).rejects.toThrow('Expected preference version 0, but current version is 1');
  expect(updateRepository.calls).toMatchObject([
    { method: 'updateItem', input: { expectedVersion: 0 } },
  ]);

  const deleteRepository = new FakePromptPreferencesRepository();
  deleteRepository.seed('user-1', { id: 'pref_focus', text: 'Prefer concise replies.' });
  const deleteExecutor = createIntexAgentToolExecutor(
    createExecutorDeps({ promptPreferencesRepository: deleteRepository })
  );

  await expect(
    deleteExecutor.deleteUserPreference({
      itemId: 'pref_focus',
      expectedVersion: 0,
    })
  ).rejects.toThrow('Expected preference version 0, but current version is 1');
  expect(deleteRepository.calls).toMatchObject([
    { method: 'deleteItem', input: { expectedVersion: 0 } },
  ]);
});
```

- [ ] **Step 3: Run tool executor test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/toolExecutor.test.ts
```

Expected before implementation: FAIL because `addUserPreference()` does not retry.

- [ ] **Step 4: Implement add-only retry**

In `apps/intex-agent/src/domain/agent/toolExecutor.ts`, change the import:

```typescript
import {
  PromptPreferencesError,
  type IntexAgentPromptPreferences,
} from '../preferences/promptPreferences.js';
```

Replace `addUserPreference()` with:

```typescript
    async addUserPreference(args: AddUserPreferenceToolArgs): Promise<string> {
      const actor = preferenceToolActor(deps);
      try {
        const preferences = await deps.promptPreferencesRepository.addItem({
          userId: deps.userId,
          text: args.text,
          expectedVersion: args.expectedVersion,
          updatedBy: actor,
        });
        return JSON.stringify(
          toPromptPreferenceToolResult(preferences, preferences.items.at(-1)?.id)
        );
      } catch (error) {
        if (!isPromptPreferenceVersionConflict(error)) {
          throw error;
        }
        const current = await deps.promptPreferencesRepository.getCurrent(deps.userId);
        const preferences = await deps.promptPreferencesRepository.addItem({
          userId: deps.userId,
          text: args.text,
          expectedVersion: current.currentVersion,
          updatedBy: actor,
        });
        return JSON.stringify(
          toPromptPreferenceToolResult(preferences, preferences.items.at(-1)?.id)
        );
      }
    },
```

Add this helper near `preferenceToolActor()`:

```typescript
function isPromptPreferenceVersionConflict(error: unknown): boolean {
  return error instanceof PromptPreferencesError && error.code === 'VERSION_CONFLICT';
}
```

- [ ] **Step 5: Run tool executor test and confirm pass**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/toolExecutor.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add apps/intex-agent/src/domain/agent/toolExecutor.ts apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts
git commit -m "fix: retry add preference after stale version"
```

### Task 4: Improve Remaining Preference Version Conflict Reply And Metadata

**Files:**
- Modify: `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
- Test: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`

**Interfaces:**
- Consumes: confirmed execution errors from preference tools
- Produces: `errorCategory: 'version_conflict'`, `isRetryable: true`, and a direct retry instruction when a preference version conflict still reaches the runner

- [ ] **Step 1: Add failing runner test**

Add this test near the existing confirmed execution failure metadata tests in `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`:

```typescript
it('returns a targeted retry reply for stale preference update confirmations', async () => {
  const runner = createIntexAgentRunner({
    client: new FakeToolCallingClient([]),
    toolExecutor: fakeToolExecutor({
      updateUserPreference: async (): Promise<string> => {
        throw new Error('Expected preference version 0, but current version is 2');
      },
    }),
  });

  await expect(
    runner.executeConfirmed({
      session: session(),
      events: [event('user_message', { text: 'Update that instruction memory entry.' })],
      toolName: 'update_user_preference',
      toolArgs: {
        itemId: 'pref_focus',
        text: 'Prefer concise replies.',
        expectedVersion: 0,
      },
      currentDateTime: CURRENT_DATE_TIME,
    })
  ).resolves.toEqual({
    outcome: 'tool_failed',
    reply:
      'Your instruction memory changed before I could save that. Send the request again so I can use the latest version.',
    toolName: 'update_user_preference',
    error: 'Expected preference version 0, but current version is 2',
    errorCategory: 'version_conflict',
    isRetryable: true,
    attemptedAction: 'update_user_preference',
  });
});
```

- [ ] **Step 2: Run runner test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/intexAgentRunner.test.ts
```

Expected before implementation: FAIL because the current category is `unknown` and the reply includes the raw error.

- [ ] **Step 3: Add localized conflict copy and metadata**

In `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`, add this constant near the other localized reply constants:

```typescript
const PREFERENCE_VERSION_CONFLICT_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en:
    'Your instruction memory changed before I could save that. Send the request again so I can use the latest version.',
  pl:
    'Pamięć instrukcji zmieniła się przed zapisem. Wyślij prośbę ponownie, żebym użył najnowszej wersji.',
};
```

Update `buildConfirmedExecutionFailureReply()` before the `save_external` branch:

```typescript
  if (isPreferenceToolName(toolName) && isPreferenceVersionConflictMessage(errorMessage)) {
    return PREFERENCE_VERSION_CONFLICT_REPLIES[replyLanguage];
  }
```

Update `toolFailureMetadata()` before the validation branch:

```typescript
  if (isPreferenceToolName(toolName) && isPreferenceVersionConflictMessage(errorMessage)) {
    return {
      errorCategory: 'version_conflict',
      isRetryable: true,
      attemptedAction: toolName,
    };
  }
```

Add this helper near `isPreferenceToolName()`:

```typescript
function isPreferenceVersionConflictMessage(errorMessage: string): boolean {
  return /^Expected preference version \d+, but current version is \d+$/u.test(errorMessage);
}
```

- [ ] **Step 4: Run runner test and confirm pass**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/intexAgentRunner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add apps/intex-agent/src/domain/agent/intexAgentRunner.ts apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts
git commit -m "fix: clarify prompt preference version conflicts"
```

### Task 5: Final Verification

**Files:**
- No new code files.
- Validate all modified workspaces.

**Interfaces:**
- Consumes: completed Tasks 1-4
- Produces: verified implementation branch ready for PR

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/promptPreferences.test.ts src/__tests__/services.test.ts src/__tests__/domain/toolExecutor.test.ts src/__tests__/domain/intexAgentRunner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run tracked workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- intex-agent
```

Expected: PASS.

- [ ] **Step 3: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 4: Confirm no private evidence leaked**

Run:

```bash
rg -n "google-oauth2\\||wamid\\." apps/intex-agent/src
```

Expected:

- No matches. Do not add raw OAuth provider IDs or raw WhatsApp message IDs to tests.

- [ ] **Step 5: Commit final verification notes if any files changed**

If verification required any code changes, commit them:

```bash
git add apps/intex-agent/src packages/llm-prompts/src
git commit -m "test: cover prompt preference version conflicts"
```

If no files changed after Task 4, do not create an empty commit.
