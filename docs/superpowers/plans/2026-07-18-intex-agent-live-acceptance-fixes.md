# Intex Agent Live Acceptance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the infrastructure defects discovered during Home Dev acceptance, redeploy the exact fixes, and complete `preflight` → `endpoint` → `full`.

**Architecture:** The Intex Agent sanitizer omits normalized-empty event values before they reach the strict evaluator wire schema. The shared OpenRouter client rejects malformed or in-band error completions as provider failures before MiniMax output parsing. MiniMax remains the sole judge in JSON-object mode; its dedicated client requires parameter-compatible OpenRouter routing, followed by local `JSON.parse`, strict Zod validation, one same-model repair, and no fallback.

**Tech Stack:** TypeScript 5.7, Node.js 22, pnpm 10, Vitest 4, Zod 3, Home Dev, OpenRouter, MiniMax M3.

## Global Constraints

- The only evaluation judge is `or:minimax/minimax-m3` (`minimax/minimax-m3` at the raw OpenRouter boundary).
- Claude Sonnet is not used as judge, fallback, repair model, or retry model.
- A MiniMax failure, invalid JSON, missing credential, or timeout is an infrastructure failure. It never silently passes or switches models.
- Preserve JSON-object mode, `provider.require_parameters: true`, temperature `0`, strict local Zod validation, and at most one same-model structured repair. Do not parse reasoning as the answer.
- Product tools remain mocked in endpoint scenarios; every synthetic user is cleaned in `finally`.
- Never log response content, provider error text, real user identifiers, Matrix identifiers, paths, tokens, or messages.
- Do not implement strict JSON Schema routing, provider pinning, a second model, or any deferred-perfection item in this fix. `provider.require_parameters: true` is required only on the dedicated MiniMax evaluator client.
- Every production change follows RED → GREEN and receives an independent task review.

## Live Contract Amendment — 2026-07-18

- Two consecutive deployed preflights passed every local/account/Matrix check and failed only the MiniMax provider probe. A privacy-safe A/B request proved that default routing selected a path returning `content: null` for JSON mode.
- Removing `response_format` restored string content and made preflight pass, but scenario 001 then produced invalid judge output both initially and after the one repair. Prompt-only JSON is not accepted as the final contract.
- OpenRouter documents mixed MiniMax M3 endpoint support. Two probes with `response_format` plus `provider.require_parameters: true` returned valid string content and separate reasoning, so the evaluator preserves JSON mode and constrains routing by capability rather than provider name.
- Keep MiniMax M3, temperature `0`, strict prompts, `JSON.parse`, Zod, one repair, closed errors, and no fallback. Do not parse chain-of-thought, add JSON Schema routing, pin a provider, switch models, or weaken the non-string response guard.

---

### Task 1: Omit normalized-empty sanitized event values

**Files:**
- Modify: `apps/intex-agent/src/domain/testConversation/testConversationSanitizer.ts`
- Test: `apps/intex-agent/src/__tests__/domain/testConversationSanitizer.test.ts`

**Interfaces:**
- Consumes: `sanitizeRecord(record)` and the public `sanitizeEventsBySessionId(eventsBySessionId)` path.
- Produces: sanitized generic records and event payloads with string values omitted when normalization yields `''`.

- [ ] **Step 1: Write the failing regression test**

  Add one test using the real `sanitizeRecord()` implementation and one regression through public `sanitizeEventsBySessionId()`:

  ```ts
  expect(sanitizeRecord({ textPreview: ' \n\t ', reason: 'kept' })).toEqual({ reason: 'kept' });
  ```

  The public-path test must prove whitespace-only `text`/`message` does not emit `textPreview` and a whitespace-only copied payload field is also omitted. Retain existing coverage proving non-empty strings are normalized and kept.

- [ ] **Step 2: Verify RED**

  Run:

  ```bash
  pnpm exec vitest run apps/intex-agent/src/__tests__/domain/testConversationSanitizer.test.ts
  ```

  Expected: the tests fail because the generic record and live event path contain normalized-empty values.

- [ ] **Step 3: Implement the minimum fix**

  In the string branch of `sanitizeValue()`, normalize once and omit an empty result. Apply the same rule to the actual event payload copy path and `textPreview` assignment. Do not widen the evaluator wire schema.

- [ ] **Step 4: Verify GREEN and commit**

  Run the focused sanitizer test and `pnpm run ci:tracked`; both must pass with pristine test output. Commit only this task's source and test changes.

**Acceptance:** whitespace-only sanitized payload values are absent; non-empty safe values and all other sanitizer behavior are unchanged.

---

### Task 2: Reject malformed OpenRouter success envelopes

**Files:**
- Modify: `packages/infra-openrouter/src/types.ts`
- Modify: `packages/infra-openrouter/src/client.ts`
- Test: `packages/infra-openrouter/src/__tests__/client.test.ts`

**Interfaces:**
- Consumes: OpenRouter's non-streaming chat-completion envelope.
- Produces: `generate()` and `generateChat()` return an error `Result` for an absent first choice, `finish_reason: 'error'`, an in-band `choice.error`, or non-string assistant content.

- [ ] **Step 1: Write failing HTTP-boundary regression tests**

  Add complete Nock fixtures for:

  1. HTTP 200 with `finish_reason: 'error'`, `choices[0].error`, and partial content;
  2. HTTP 200 with `choices: []`;
  3. HTTP 200 with `message.content: null`.

  Assert that the public client returns an error `Result` and never exposes partial/empty content as success. Do not assert provider message text and do not add test-only production APIs. Update the two existing empty-choice success tests to the new failure contract.

- [ ] **Step 2: Verify RED**

  Run:

  ```bash
  pnpm exec vitest run packages/infra-openrouter/src/__tests__/client.test.ts
  ```

  Expected: the new assertions fail because the current client returns successful content for these envelopes.

- [ ] **Step 3: Implement runtime validation**

  Widen only the raw provider response type to reflect optional error metadata and unknown/null content. Before usage extraction and `ok(...)`, reject an absent choice, an in-band choice error, `finish_reason === 'error'`, and content whose runtime type is not `string`. Use a closed local error message; never forward the provider's error text. Preserve existing HTTP error mapping and retry behavior.

- [ ] **Step 4: Verify GREEN and commit**

  Run the focused OpenRouter test, evaluator MiniMax tests, and `pnpm run ci:tracked`; all must pass. Commit only this task's source and test changes.

**Acceptance:** provider failures cannot be mislabeled downstream as valid chat output; valid string completions, usage accounting, JSON-object requests, and all existing model behavior remain unchanged.

---

### Task 3: Route MiniMax JSON requests only to parameter-compatible endpoints

**Files:**
- Modify: `packages/infra-openrouter/src/types.ts`
- Modify: `packages/infra-openrouter/src/client.ts`
- Test: `packages/infra-openrouter/src/__tests__/client.test.ts`
- Modify: `tools/intex-agent-evals/src/minimaxJudge.ts`
- Test: `tools/intex-agent-evals/src/__tests__/minimaxJudge.test.ts`

**Interfaces:**
- Consumes: optional `OpenRouterConfig.providerRouting.requireParameters` on the shared client and the dedicated MiniMax evaluator client configuration.
- Produces: OpenRouter request field `provider: { require_parameters: true }` only when explicitly enabled; the MiniMax judge and probe combine it with `response_format: { type: 'json_object' }`.

- [x] **Step 1: Write failing routing-contract tests**

  Prove that the shared client omits `provider` by default and serializes the exact snake-case request for `generate()`, `generateChat()`, and `generateChatStream()`. Prove that the MiniMax evaluator enables the option and uses JSON-object mode for initial judge, same-model repair, Matrix judge, and production probe.

- [x] **Step 2: Verify RED**

  Run the focused OpenRouter and MiniMax evaluator suites. Expected and observed: eight new assertions fail while all pre-existing assertions pass.

- [x] **Step 3: Implement the minimum routing constraint**

  Add the optional typed client configuration and conditionally serialize `provider.require_parameters`. Enable it only in the dedicated MiniMax evaluator client and restore JSON-object mode through the common judge invocation and probe. Do not pin a provider, parse reasoning, change models, add fallback, or weaken strict parsing.

- [x] **Step 4: Verify GREEN and review**

  Run both focused suites and `pnpm run ci:tracked` on the combined code diff. Require an independent review of the implementation and plan before delivery.

**Acceptance:** MiniMax JSON requests are routed by declared parameter capability, every default OpenRouter caller is unchanged, all four evaluator paths retain JSON-object mode, and invalid provider output still fails closed.

---

### Task 4: Review, deliver, and repeat live acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-intex-agent-live-acceptance-fixes.md` only to record final evidence.

- [ ] Independently review each task and the combined diff; close every Critical or Important finding.
- [ ] Run focused suites and `pnpm run ci:tracked` on the exact final revision.
- [ ] Push the branch, open and merge a PR into `development`, and wait until Home Dev contains the exact fix revision through the existing deployment path.
- [ ] Verify Home Dev health and deployed-revision ancestry.
- [ ] Run `scripts/run-intex-agent-evals-home-dev.sh preflight`.
- [ ] Run `scripts/run-intex-agent-evals-home-dev.sh endpoint`; stop before Matrix on nonzero exit.
- [ ] Only after endpoint exit `0`, run `scripts/run-intex-agent-evals-home-dev.sh full` exactly once.
- [ ] Report the two artifact paths, MiniMax provider-reported USD, failed scenario IDs, and cleanup evidence without private content.

**Final acceptance:** Home Dev `full` exits `0`; all 20 scenarios pass deterministic and MiniMax checks; one safe Matrix smoke passes; all reports are private and complete.
