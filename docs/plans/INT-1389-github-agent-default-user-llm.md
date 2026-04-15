# GitHub Agent — Use Default User LLM Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the GitHub Agent from using a hardcoded platform Gemini API key to dynamically resolving the user's preferred LLM key per-request.

**Architecture:** Currently, `services.ts` creates a static `ToolCallingClient` at service initialization using `INTEXURAOS_GEMINI_APP_API_KEY` with `system:github-agent` as the userId. The new design introduces a `resolveToolCallingClient(userId: string)` factory function injected via `GitHubAgentDeps`. This factory fetches the user's API keys via `UserServiceClient.getApiKeys()`, extracts the Google key, creates a per-request `ToolCallingClient` with the user's key, and falls back to the platform key if the user has no Google API key. Tool calling remains Gemini-only (the only supported `ToolCallingModel`).

**Tech Stack:** TypeScript, `@intexuraos/llm-factory` (`createToolCallingClient`), `@intexuraos/internal-clients` (`UserServiceClient`), `@intexuraos/llm-contract` (`ToolCallingClient`, `ToolCallingModel`, `LlmModels`), Vitest.

---

## File Structure

| File                                                         | Action   | Responsibility                                                                                                                                                                                           |
| ------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/usecases/githubAgent.ts`         | Modify   | Replace `toolCallingClient: ToolCallingClient` dep with `resolveToolCallingClient` factory. Both `evaluatePREventInternal` and `evaluateCommentEventInternal` call the factory after resolving the user. |
| `apps/code-agent/src/services.ts`                            | Modify   | Remove static `toolCallingClient` creation. Build `resolveToolCallingClient` factory closure. Update `ServiceContainer`, `evaluateEvent` wiring, and `unifiedEvaluator` conditional.                     |
| `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts` | Modify   | Replace `createFakeToolCallingClient()` dep with `resolveToolCallingClient` fake. Add tests for fallback to platform key and user-key-not-found scenarios.                                               |

---

## Task 1: Update `GitHubAgentDeps` and `evaluatePREventInternal`

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/githubAgent.ts`
- Test: `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`

### Context

The `GitHubAgentDeps` interface currently has:

```typescript
export interface GitHubAgentDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
  toolCallingClient: ToolCallingClient;
  userServiceClient: UserServiceClient;
  allowedBots: Set<string>;
}
```

The `evaluatePREventInternal` function already resolves the user (`resolveGitHubUsername` + `getOAuthToken`) before doing LLM work. We replace the static `toolCallingClient` with a factory.

### Steps

- [ ] **Step 1: Write failing test — PR event uses `resolveToolCallingClient` factory**

In `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`, update `createDeps` and add a test that verifies the factory is called with the resolved userId:

```typescript
// Replace the existing createFakeToolCallingClient usage in createDeps with:
function createFakeResolveToolCallingClient(options?: {
  callTools?: boolean;
  error?: boolean;
  toolToCall?: string;
  toolArgs?: Record<string, unknown>;
  resolveError?: boolean;
}): (userId: string) => Promise<Result<ToolCallingClient, GitHubAgentError>> {
  return vi.fn().mockImplementation(async (_userId: string) => {
    if (options?.resolveError === true) {
      return err({ code: 'LLM_FAILED' as const, message: 'No API key available' });
    }
    return ok(createFakeToolCallingClient(options));
  });
}
```

Update `createDeps`:

```typescript
function createDeps(overrides: Partial<GitHubAgentDeps> = {}): GitHubAgentDeps {
  return {
    logger: createFakeLogger(),
    gitHubPRClient: createFakeGitHubPRClient(),
    resolveToolCallingClient: createFakeResolveToolCallingClient(),
    userServiceClient: createFakeUserServiceClient(),
    allowedBots: new Set(['claude[bot]', 'chatgpt-codex-connector[bot]']),
    ...overrides,
  };
}
```

Add a test:

```typescript
it('calls resolveToolCallingClient with resolved userId for PR events', async () => {
  const resolveToolCallingClient = createFakeResolveToolCallingClient();
  const deps = createDeps({ resolveToolCallingClient });
  const event = createFakePREvent();

  await evaluateEvent(deps, event);

  expect(resolveToolCallingClient).toHaveBeenCalledWith('user-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`
Expected: TypeScript compilation error — `GitHubAgentDeps` has no `resolveToolCallingClient` property.

- [ ] **Step 3: Update `GitHubAgentDeps` interface and `evaluatePREventInternal`**

In `apps/code-agent/src/domain/usecases/githubAgent.ts`:

1. Add the import for `Result` (already imported) and `GitHubAgentError` (already defined).

2. Replace the `toolCallingClient` property in `GitHubAgentDeps`:

```typescript
export interface GitHubAgentDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
  resolveToolCallingClient: (userId: string) => Promise<Result<ToolCallingClient, GitHubAgentError>>;
  userServiceClient: UserServiceClient;
  allowedBots: Set<string>;
}
```

3. In `evaluatePREventInternal`, after the OAuth token resolution (after `const accessToken = tokenResult.value.accessToken;` on line 209), add tool calling client resolution:

```typescript
  // Resolve tool calling client for this user
  const toolCallingResult = await deps.resolveToolCallingClient(resolvedUser.userId);
  if (!toolCallingResult.ok) {
    logger.warn({ userId: resolvedUser.userId, error: toolCallingResult.error }, 'GitHub Agent: failed to resolve tool calling client');
    return { ok: false, error: toolCallingResult.error };
  }
  const toolCallingClient = toolCallingResult.value;
```

4. Update the destructuring at line 185 from:
```typescript
const { logger, gitHubPRClient, toolCallingClient, userServiceClient, allowedBots } = deps;
```
to:
```typescript
const { logger, gitHubPRClient, userServiceClient, allowedBots } = deps;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/githubAgent.ts apps/code-agent/src/__tests__/usecases/githubAgent.test.ts
git commit -m "feat(code-agent): replace static toolCallingClient with resolveToolCallingClient factory in PR path"
```

---

## Task 2: Update `evaluateCommentEventInternal` to use factory

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/githubAgent.ts`
- Test: `apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`

### Context

`evaluateCommentEventInternal` currently destructures `toolCallingClient` from deps (line 366). Unlike the PR path, the comment path does NOT resolve the user. We need to add user resolution here to get the userId for the factory. The event's `senderLogin` is available and can be resolved via `userServiceClient.resolveGitHubUsername()`.

### Steps

- [ ] **Step 1: Write failing test — comment event resolves user and calls factory**

```typescript
it('resolves user and calls resolveToolCallingClient for comment events', async () => {
  const resolveToolCallingClient = createFakeResolveToolCallingClient();
  const deps = createDeps({ resolveToolCallingClient });
  const event = createFakePREvent({
    eventType: 'issue_comment',
    action: 'created',
    body: '@review please check this',
  });

  await evaluateEvent(deps, event);

  expect(deps.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('dev-user');
  expect(resolveToolCallingClient).toHaveBeenCalledWith('user-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`
Expected: FAIL — `resolveToolCallingClient` not called (comment path still uses old destructuring).

- [ ] **Step 3: Update `evaluateCommentEventInternal`**

In `apps/code-agent/src/domain/usecases/githubAgent.ts`, update `evaluateCommentEventInternal`:

1. Change destructuring on line 366 from:
```typescript
const { logger, toolCallingClient, allowedBots } = deps;
```
to:
```typescript
const { logger, userServiceClient, allowedBots } = deps;
```

2. After `const isReviewCommand = isReviewCommandComment(commentBody);` (line 368), add user resolution and tool calling client creation:

```typescript
  // Resolve user for this comment sender
  const resolvedLogin = resolveLoginForTaskCreation(event.senderLogin, event.repository, allowedBots);
  const userResult = await userServiceClient.resolveGitHubUsername(resolvedLogin);
  if (!userResult.ok) {
    logger.warn({ senderLogin: resolvedLogin, error: userResult.error.code }, 'GitHub Agent: user resolution failed for comment');
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `Failed to resolve GitHub user: ${resolvedLogin}` } };
  }

  const resolvedUser = userResult.value;
  if (resolvedUser === null) {
    logger.info({ senderLogin: resolvedLogin }, 'GitHub Agent: comment sender has no linked IntexuraOS account');
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `No IntexuraOS account linked for GitHub user: ${resolvedLogin}` } };
  }

  const toolCallingResult = await deps.resolveToolCallingClient(resolvedUser.userId);
  if (!toolCallingResult.ok) {
    logger.warn({ userId: resolvedUser.userId, error: toolCallingResult.error }, 'GitHub Agent: failed to resolve tool calling client for comment');
    return { ok: false, error: toolCallingResult.error };
  }
  const toolCallingClient = toolCallingResult.value;
```

Note: You need to import `resolveLoginForTaskCreation` — it's already imported at line 19.

- [ ] **Step 4: Write test for comment sender with no linked account**

```typescript
it('returns USER_NOT_FOUND when comment sender has no linked account', async () => {
  const deps = createDeps({
    userServiceClient: {
      ...createFakeUserServiceClient(),
      resolveGitHubUsername: vi.fn().mockResolvedValue(ok(null)),
    },
  });
  const event = createFakePREvent({
    eventType: 'issue_comment',
    action: 'created',
    body: '@review check this',
  });

  const result = await evaluateEvent(deps, event);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('USER_NOT_FOUND');
  }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`
Expected: PASS

- [ ] **Step 6: Write test for factory resolution failure on comment path**

```typescript
it('returns LLM_FAILED when resolveToolCallingClient fails for comment', async () => {
  const deps = createDeps({
    resolveToolCallingClient: createFakeResolveToolCallingClient({ resolveError: true }),
  });
  const event = createFakePREvent({
    eventType: 'issue_comment',
    action: 'created',
    body: '@review check this',
  });

  const result = await evaluateEvent(deps, event);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('LLM_FAILED');
  }
});
```

- [ ] **Step 7: Run tests**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/usecases/githubAgent.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/code-agent/src/domain/usecases/githubAgent.ts apps/code-agent/src/__tests__/usecases/githubAgent.test.ts
git commit -m "feat(code-agent): add user resolution and dynamic tool calling client to comment event path"
```

---

## Task 3: Update `services.ts` wiring — build `resolveToolCallingClient` factory

**Files:**
- Modify: `apps/code-agent/src/services.ts`

### Context

Currently `services.ts` (lines 94, 424-432) creates a static `toolCallingClient`:

```typescript
const GEMINI_TOOL_CALLING_MODEL = LlmModels.Gemini25Flash;
// ...
const toolCallingClient = config.geminiAppApiKey !== ''
  ? createToolCallingClient({
      apiKey: config.geminiAppApiKey,
      model: GEMINI_TOOL_CALLING_MODEL,
      userId: 'system:github-agent',
      logger,
      usageSink: buildUsageSink('github-agent'),
    })
  : undefined;
```

And passes it to `unifiedEvaluator` (line 510):
```typescript
evaluateEvent: toolCallingClient !== undefined
  ? (event, correctionContext) => evaluateEvent(
      { logger, gitHubPRClient, toolCallingClient, userServiceClient, allowedBots: ALLOWED_BOTS },
      event, correctionContext,
    )
  : undefined,
```

We replace the static client with a `resolveToolCallingClient` factory that uses the user's API key with platform key fallback.

### Steps

- [ ] **Step 1: Add `resolveToolCallingClient` factory function in `services.ts`**

Replace lines 94 and 424-432. Remove the `GEMINI_TOOL_CALLING_MODEL` constant (line 94) and the static `toolCallingClient` creation block (lines 424-432).

Add the factory function after the `buildUsageSink` definition (around line 422):

```typescript
  const TOOL_CALLING_MODEL = LlmModels.Gemini25Flash;
  const githubAgentUsageSink = buildUsageSink('github-agent');

  const resolveToolCallingClient = async (userId: string): Promise<Result<ToolCallingClient, GitHubAgentError>> => {
    // Try user's own Google API key first
    const keysResult = await userServiceClient.getApiKeys(userId);
    if (keysResult.ok) {
      const googleKey = keysResult.value.google;
      if (googleKey !== undefined) {
        logger.info({ userId }, 'GitHub Agent: using user Google API key');
        return ok(createToolCallingClient({
          apiKey: googleKey,
          model: TOOL_CALLING_MODEL,
          userId,
          logger,
          usageSink: githubAgentUsageSink,
        }));
      }
    }

    // Fall back to platform key
    if (config.geminiAppApiKey !== '') {
      logger.info({ userId }, 'GitHub Agent: falling back to platform Gemini API key');
      return ok(createToolCallingClient({
        apiKey: config.geminiAppApiKey,
        model: TOOL_CALLING_MODEL,
        userId,
        logger,
        usageSink: githubAgentUsageSink,
      }));
    }

    return err({ code: 'LLM_FAILED' as const, message: 'No Google API key available for tool calling' });
  };
```

You will need to import `ok`, `err` from `@intexuraos/common-core` (check if already imported) and `GitHubAgentError` from the githubAgent use case.

- [ ] **Step 2: Update `ServiceContainer` interface**

In the `ServiceContainer` interface, replace:
```typescript
toolCallingClient: ToolCallingClient | undefined;
```
with:
```typescript
resolveToolCallingClient: (userId: string) => Promise<Result<ToolCallingClient, GitHubAgentError>>;
```

- [ ] **Step 3: Update `unifiedEvaluator` wiring**

Replace the `evaluateEvent` wiring (lines 510-516) from:
```typescript
evaluateEvent: toolCallingClient !== undefined
  ? (event: GitHubPREvent, correctionContext?: string) => evaluateEvent(
      { logger, gitHubPRClient, toolCallingClient, userServiceClient, allowedBots: ALLOWED_BOTS },
      event, correctionContext,
    )
  : undefined,
```
to:
```typescript
evaluateEvent: (event: GitHubPREvent, correctionContext?: string) => evaluateEvent(
  { logger, gitHubPRClient, resolveToolCallingClient, userServiceClient, allowedBots: ALLOWED_BOTS },
  event, correctionContext,
),
```

Note: The `evaluateEvent` callback is no longer conditional on `toolCallingClient !== undefined`. The factory handles unavailability internally by returning an error Result.

- [ ] **Step 4: Update `ServiceContainer` return object**

In the return statement of `buildServices`, replace `toolCallingClient,` with `resolveToolCallingClient,`.

- [ ] **Step 5: Search for other references to `toolCallingClient` in `services.ts`**

Run: `rg 'toolCallingClient' apps/code-agent/src/services.ts`

Ensure all references are updated. If the `ServiceContainer` type is used elsewhere in the codebase, search:

Run: `rg 'ServiceContainer' apps/code-agent/src/ --type ts`

Update any files that reference `container.toolCallingClient`.

- [ ] **Step 6: Build and verify**

Run: `cd /repo && pnpm build`
Expected: Clean build, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/services.ts
git commit -m "feat(code-agent): replace static toolCallingClient with per-user resolveToolCallingClient factory"
```

---

## Task 4: Update all test files referencing `toolCallingClient` in `ServiceContainer`

**Files:**
- Modify: Any test files in `apps/code-agent/src/__tests__/` that reference `toolCallingClient` in service container setup.

### Context

Tests that create fake service containers may reference `toolCallingClient`. These need to be updated to use `resolveToolCallingClient`.

### Steps

- [ ] **Step 1: Find all test files referencing `toolCallingClient`**

Run: `rg 'toolCallingClient' apps/code-agent/src/__tests__/ --type ts -l`

- [ ] **Step 2: Update each test file**

For each file found, replace `toolCallingClient: <value>` with:
```typescript
resolveToolCallingClient: vi.fn().mockResolvedValue(ok(createFakeToolCallingClient())),
```

Or if the test doesn't need tool calling:
```typescript
resolveToolCallingClient: vi.fn().mockResolvedValue(err({ code: 'LLM_FAILED', message: 'Not configured' })),
```

Adapt based on what each test expects. Preserve the existing `createFakeToolCallingClient` helper for use inside the factory mock.

- [ ] **Step 3: Run full test suite for code-agent**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/__tests__/
git commit -m "test(code-agent): update test fakes for resolveToolCallingClient factory pattern"
```

---

## Task 5: Full CI verification

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `cd /repo && pnpm build`
Expected: Clean build.

- [ ] **Step 2: Run tracked CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: PASS with full coverage.

- [ ] **Step 3: Fix any coverage gaps**

If `resolveToolCallingClient` factory branches aren't covered (e.g., the platform key fallback path or the "no key available" path), add integration-style tests in the githubAgent test file or a dedicated `resolveToolCallingClient.test.ts` if the factory is extracted to its own file.

- [ ] **Step 4: Final commit if any fixes**

```bash
git add -A
git commit -m "fix(code-agent): address coverage gaps for resolveToolCallingClient"
```

---

## Endpoint Changes

- **Modified:** None — no HTTP endpoints change. The GitHub Agent is invoked internally by the `UnifiedEvaluator` on webhook receipt.
- **Created:** None
- **Removed:** None
- **Unchanged:** All webhook routes (`POST /api/github/webhooks`, etc.)

## Key Design Decisions

1. **Factory pattern over interface extension:** We add `resolveToolCallingClient` as a factory function in deps rather than adding `getToolCallingClient` to `UserServiceClient`. This keeps the concern local to the GitHub Agent and avoids coupling `internal-clients` to the tool-calling concept.

2. **Platform key as fallback:** When a user has no Google API key, we fall back to the platform `INTEXURAOS_GEMINI_APP_API_KEY`. This ensures the GitHub Agent continues working for all users, not just those with Google keys configured.

3. **User resolution in comment path:** The comment event handler previously didn't resolve the user. We add user resolution (matching the PR event pattern) so the factory can create a per-user client. This also enables proper user attribution of LLM costs.

4. **No changes to `llm-contract` or `llm-factory`:** Tool calling remains Gemini-only. The migration is about whose API key is used, not which model. The `ToolCallingModel` type and `createToolCallingClient` factory remain unchanged.

5. **`evaluateEvent` is no longer conditional:** Previously, the `unifiedEvaluator` received `evaluateEvent: undefined` when no platform Gemini key was configured. Now, `evaluateEvent` is always provided — the factory returns an error Result when no key is available (user or platform), and the caller handles it gracefully.
