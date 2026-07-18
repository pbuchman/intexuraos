# Intex Agent Live Acceptance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two infrastructure defects discovered during the first Home Dev acceptance run, redeploy the exact fixes, and complete `preflight` → `endpoint` → `full`.

**Architecture:** The Intex Agent sanitizer omits normalized-empty event values before they reach the strict evaluator wire schema. The shared OpenRouter client rejects malformed or in-band error completions as provider failures before MiniMax output parsing. MiniMax remains the sole judge with prompt-enforced strict JSON, local `JSON.parse` plus Zod validation, one same-model repair, and no fallback.

**Tech Stack:** TypeScript 5.7, Node.js 22, pnpm 10, Vitest 4, Zod 3, Home Dev, OpenRouter, MiniMax M3.

## Global Constraints

- The only evaluation judge is `or:minimax/minimax-m3` (`minimax/minimax-m3` at the raw OpenRouter boundary).
- Claude Sonnet is not used as judge, fallback, repair model, or retry model.
- A MiniMax failure, invalid JSON, missing credential, or timeout is an infrastructure failure. It never silently passes or switches models.
- Preserve temperature `0`, prompt-enforced strict JSON, strict local Zod validation, and at most one same-model structured repair. Do not parse reasoning as the answer.
- Product tools remain mocked in endpoint scenarios; every synthetic user is cleaned in `finally`.
- Never log response content, provider error text, real user identifiers, Matrix identifiers, paths, tokens, or messages.
- Do not implement strict JSON Schema routing, `provider.require_parameters`, a second model, or any deferred-perfection item in this fix.
- Every production change follows RED → GREEN and receives an independent task review.

## Live Contract Amendment — 2026-07-18

- Two consecutive deployed preflights passed every local/account/Matrix check and failed only the MiniMax provider probe.
- A privacy-safe Home Dev A/B request proved the cause: with `response_format: { type: 'json_object' }`, the selected MiniMax M3 path returned `finish_reason: 'stop'` and `message.content: null`; without that parameter, the otherwise identical request returned the expected final string and a separate reasoning field.
- OpenRouter documents that unsupported parameters may be ignored, and its MiniMax M3 endpoint pool has mixed `response_format` support. The evaluator therefore omits only `responseFormat`; it keeps MiniMax M3, temperature `0`, strict prompts, `JSON.parse`, Zod, one repair, closed errors, and no fallback.
- Do not solve this by parsing chain-of-thought, adding JSON Schema routing, setting `provider.require_parameters`, switching providers/models, or weakening the non-string response guard.

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

**Acceptance:** provider failures cannot be mislabeled downstream as valid chat output; valid string completions, usage accounting, and all existing model behavior remain unchanged.

---

### Task 3: Review, deliver, and repeat live acceptance

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
