# WhatsApp Message Digests Test Typecheck Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository-wide test TypeScript project compile without weakening production
types or changing runtime behavior.

**Architecture:** Correct six test-only typing mismatches at their source: expose one repository
method as a Vitest mock at the call site, make one inferred string explicit, read the captured abort
signal from the mock call, resolve two deliberately narrow promises with exact success literals, and
route deliberately malformed runtime inputs through one explicit unknown-boundary test helper.

**Tech Stack:** TypeScript with `exactOptionalPropertyTypes`, Vitest, pnpm workspace test typecheck,
ESLint, Prettier.

## Global Constraints

- Work sequentially in the primary session; subagents are review-only.
- Modify test code and this plan only. Do not change production types, validators, runtime code, or
  public contracts to satisfy tests.
- Preserve the intent of every affected test: fallback behavior, canonical-token rejection,
  provider timeout coverage, concurrent delivery fencing, and fail-closed runtime validation.
- Do not run another full `pnpm run ci:tracked` until `pnpm run typecheck:tests`, all five affected
  test files, lint, formatting, diff checks, and review are green.
- Preserve the five user-owned untracked files under `docs/superpowers/specs/`.

---

### Task 1: Correct the six test-only type boundaries

**Files:**
- Modify: `apps/fishing-assistant-service/src/__tests__/retrieval.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/privateDigestSourceToken.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/sender.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- Modify: `packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts`

**Interfaces:**
- Consumes: existing Vitest mocks, `AbortSignal`, `Result`, and
  `Parameters<typeof buildSendMessageEvent>[0]`.
- Produces: test code accepted by `tsconfig.tests-check.json` with unchanged runtime assertions.

- [x] **Step 1: Capture and classify the RED test typecheck**

  The second full gate ran `pnpm run typecheck:tests` and failed with exactly these source causes:

  - `retrieval.test.ts`: `KnowledgeChunkRepository.findNearestByUserId` is exposed as the production
    function type, so `.mockResolvedValue` is not available without `vi.mocked`.
  - `privateDigestSourceToken.test.ts`: the local canonical-alias candidate needs an explicit string
    annotation under the repository test project.
  - `sender.test.ts`: control-flow analysis cannot observe assignment to the outer signal variable
    inside the fetch mock callback and narrows optional access to `never`.
  - `pubsubRoutes.test.ts`: `ok(...)` returns a `Result` union while the two controlled provider
    promises intentionally accept only the success member.
  - `whatsappSendPublisher.test.ts`: three explicit `undefined` properties and one extra nested field
    are deliberately invalid runtime inputs but cannot be passed as the valid compile-time input
    type under `exactOptionalPropertyTypes` and excess-property checks.

- [x] **Step 2: Preserve the Fishing repository mock type**

  Replace only the failing setup call with:

  ```ts
  vi.mocked(chunkFailure.chunkRepository.findNearestByUserId).mockResolvedValue({
    ok: false,
    error: { code: 'PERSISTENCE_ERROR', message: 'query failed' },
  });
  ```

  Keep `ContextOptions`, `RetrieveEvidenceDeps`, and `KnowledgeChunkRepository` unchanged.

- [x] **Step 3: Make the canonical alias candidate explicit**

  Change the local declaration to a non-circular inference shape that also satisfies the repository's
  `no-inferrable-types` lint rule:

  ```ts
  const candidate = encoded.slice(0, -1).concat(candidateCharacter);
  ```

  Do not change token parsing or canonicality assertions.

- [x] **Step 4: Assert against the fetch mock's captured AbortSignal**

  Keep the signal local to the fetch mock so its response-body closure listens to the exact request
  signal. After the send starts, read `mockFetch.mock.calls[0]?.[1].signal`, require it to be an
  `AbortSignal`, and use that narrowed value for the three `.aborted` assertions. Do not use a cast
  that permits a missing signal and do not change timer values.

- [x] **Step 5: Resolve the two narrow provider promises with exact success literals**

  Replace both `settleProvider(ok({ wamid: ... }))` calls with the corresponding exact object:

  ```ts
  settleProvider({ ok: true, value: { wamid: 'synthetic-value' } });
  ```

  Preserve the controlled in-flight timing and all authorization/release assertions.

- [x] **Step 6: Add one explicit unchecked runtime-input helper**

  Add a test-only helper:

  ```ts
  function buildUncheckedSendMessageEvent(input: unknown) {
    return buildSendMessageEvent(
      input as Parameters<typeof buildSendMessageEvent>[0]
    );
  }
  ```

  Use it only for the three invalid explicit-`undefined` cases and the authorization object with the
  extra field. Keep all valid and type-valid-invalid calls on `buildSendMessageEvent` so compile-time
  coverage remains strong.

- [x] **Step 7: Run the complete focused GREEN gate**

  Run:

  ```bash
  pnpm run typecheck:tests
  pnpm exec vitest run apps/fishing-assistant-service/src/__tests__/retrieval.test.ts apps/whatsapp-service/src/__tests__/infra/privateDigestSourceToken.test.ts apps/whatsapp-service/src/__tests__/infra/sender.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts
  pnpm exec eslint apps/fishing-assistant-service/src/__tests__/retrieval.test.ts apps/whatsapp-service/src/__tests__/infra/privateDigestSourceToken.test.ts apps/whatsapp-service/src/__tests__/infra/sender.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts
  pnpm exec prettier --check apps/fishing-assistant-service/src/__tests__/retrieval.test.ts apps/whatsapp-service/src/__tests__/infra/privateDigestSourceToken.test.ts apps/whatsapp-service/src/__tests__/infra/sender.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts docs/superpowers/plans/2026-07-29-whatsapp-message-digests-test-typecheck-remediation.md
  git diff --check
  ```

  Expected: the test project compiles, every affected runtime test passes, and all static checks are
  clean without a full CI run.

- [ ] **Step 8: Review, resync, and run one final full gate**

  Ask one review-only subagent to verify that all six changes are test-boundary corrections and none
  weakens production contracts or assertions. Fix any accepted Critical or Important finding through
  a focused RED/GREEN cycle. Fetch `origin/development` again, prove HEAD is still based on the exact
  latest remote commit, then run `pnpm run ci:tracked` once more as the final full gate.

## Self-Review

- Spec coverage: every error printed by the second gate maps to exactly one minimal test-only step.
- Placeholder scan: all files, code shapes, commands, and expected results are explicit; no deferred
  implementation marker remains.
- Type consistency: valid inputs retain the production parameter type; only deliberately malformed
  runtime objects cross `unknown`, and exact success promises receive exact success literals.

## Execution Choice

The user selected inline, sequential execution with review-only subagents. Continue in the current
session with `superpowers:executing-plans`; do not ask to switch execution modes.
