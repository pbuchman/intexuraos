# Intex Agent Live Acceptance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the infrastructure defects discovered during Home Dev acceptance, redeploy the exact fixes, and complete `preflight` → `endpoint` → `full`.

**Architecture:** The Intex Agent sanitizer omits normalized-empty event values before they reach the strict evaluator wire schema. The endpoint returns a correlated executed prefix when a later turn depends on a confirmation button the model did not produce, allowing deterministic evaluation to classify the stop behaviorally. The combined runner admits Matrix only after its own endpoint corpus passes. The shared OpenRouter client and self-contained MiniMax prompt keep provider and judge failures closed.

**Tech Stack:** TypeScript 5.7, Node.js 22, pnpm 10, Vitest 4, Zod 3, Home Dev, OpenRouter, MiniMax M3.

## Global Constraints

- The only evaluation judge is `or:minimax/minimax-m3` (`minimax/minimax-m3` at the raw OpenRouter boundary).
- Claude Sonnet is not used as judge, fallback, repair model, or retry model.
- A MiniMax failure, invalid JSON, missing credential, or timeout is an infrastructure failure. It never silently passes or switches models.
- Preserve JSON-object mode, `provider.require_parameters: true`, temperature `0`, strict local Zod validation, and at most one same-model structured repair. Use only `gmicloud` → `minimax` → `morph`, with fallback outside the list disabled. Do not parse reasoning as the answer.
- Product tools remain mocked in endpoint scenarios; every synthetic user is cleaned in `finally`.
- Never log response content, provider error text, real user identifiers, Matrix identifiers, paths, tokens, or messages.
- Do not implement strict JSON Schema routing, a second model, or any deferred-perfection item in this fix. The required-parameter flag and ordered provider restriction are required only on the dedicated MiniMax evaluator client.
- Every production change follows RED → GREEN and receives an independent task review.

## Endpoint Changes

### Modified

- `POST /internal/intex-agent/test/conversation`: when a requested dependent confirmation button is unavailable, return the strictly correlated executed prefix plus optional `stoppedBeforeTurn: { turnIndex, reason: 'confirmation_button_unavailable' }` instead of HTTP 500.

### Created

- None.

### Removed

- None.

### Unchanged

- Endpoint path, request contract, internal authentication, local/dev-only availability, production `404`, every existing response field, and full-response behavior when no stop marker is present.

## Live Contract Amendment — 2026-07-18

- Two consecutive deployed preflights passed every local/account/Matrix check and failed only the MiniMax provider probe. A privacy-safe A/B request proved that default routing selected a path returning `content: null` for JSON mode.
- Removing `response_format` restored string content and made preflight pass, but scenario 001 then produced invalid judge output both initially and after the one repair. Prompt-only JSON is not accepted as the final contract.
- OpenRouter documents mixed MiniMax M3 endpoint support. Two probes with `response_format` plus `provider.require_parameters: true` returned valid string content and separate reasoning, so the evaluator preserves JSON mode and constrains routing by capability rather than provider name.
- The next real endpoint run still failed scenario 001 after one repair. Privacy-safe structural diagnostics proved the exact schema issue: GMICloud, direct MiniMax, and Morph returned valid JSON with only `failures[]:invalid_enum_value`; the prompt never listed the allowed enum values, so repair repeated the same error. Parasail returned `content: null`, and Together returned `429` in the same matrix.
- Before delivery, the replacement self-contained prompt was exercised against the same synthetic scenario: GMICloud, direct MiniMax, and Morph each returned schema-valid verdict JSON on the initial call, while endpoint determinism and cleanup again passed. No response content was printed or persisted.
- Keep MiniMax M3, temperature `0`, strict `JSON.parse` plus Zod, one repair, and closed errors. Make the prompt contract self-contained and route in the verified order GMICloud, direct MiniMax, then Morph, with no fallback outside that list. Do not parse chain-of-thought, add JSON Schema routing, switch models, or weaken the non-string response guard.
- After that fix was deployed, scenarios 001–006 completed with 15 schema-valid MiniMax verdicts and complete cleanup. Scenario 007 twice returned endpoint HTTP 500, while a first-turn probe, a direct full runner call, and a later full endpoint call all completed. The stochastic difference is whether the model emits the expected confirmation button; the current runner throws when it cannot materialize the dependent input turn.
- Treat that absence as product behavior. Return the exact executed prefix plus `stoppedBeforeTurn: { turnIndex, reason: 'confirmation_button_unavailable' }`, require strict correlation, and record one deterministic behavioral failure. Never fabricate or retry the missing user confirmation.
- The audit also found that `full` currently runs Matrix after an endpoint `behavioral_failure`. Tighten this to `effectiveKind === 'passed'`; a separate preceding endpoint pass is not sufficient because `full` executes a fresh corpus whose stochastic result must gate its own real message.

---

### Task 1: Omit normalized-empty sanitized event values

**Files:**
- Modify: `apps/intex-agent/src/domain/testConversation/testConversationSanitizer.ts`
- Test: `apps/intex-agent/src/__tests__/domain/testConversationSanitizer.test.ts`

**Interfaces:**
- Consumes: `sanitizeRecord(record)` and the public `sanitizeEventsBySessionId(eventsBySessionId)` path.
- Produces: sanitized generic records and event payloads with string values omitted when normalization yields `''`.

- [x] **Step 1: Write the failing regression test**

  Add one test using the real `sanitizeRecord()` implementation and one regression through public `sanitizeEventsBySessionId()`:

  ```ts
  expect(sanitizeRecord({ textPreview: ' \n\t ', reason: 'kept' })).toEqual({ reason: 'kept' });
  ```

  The public-path test must prove whitespace-only `text`/`message` does not emit `textPreview` and a whitespace-only copied payload field is also omitted. Retain existing coverage proving non-empty strings are normalized and kept.

- [x] **Step 2: Verify RED**

  Run:

  ```bash
  pnpm exec vitest run apps/intex-agent/src/__tests__/domain/testConversationSanitizer.test.ts
  ```

  Expected: the tests fail because the generic record and live event path contain normalized-empty values.

- [x] **Step 3: Implement the minimum fix**

  In the string branch of `sanitizeValue()`, normalize once and omit an empty result. Apply the same rule to the actual event payload copy path and `textPreview` assignment. Do not widen the evaluator wire schema.

- [x] **Step 4: Verify GREEN and commit**

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

- [x] **Step 1: Write failing HTTP-boundary regression tests**

  Add complete Nock fixtures for:

  1. HTTP 200 with `finish_reason: 'error'`, `choices[0].error`, and partial content;
  2. HTTP 200 with `choices: []`;
  3. HTTP 200 with `message.content: null`.

  Assert that the public client returns an error `Result` and never exposes partial/empty content as success. Do not assert provider message text and do not add test-only production APIs. Update the two existing empty-choice success tests to the new failure contract.

- [x] **Step 2: Verify RED**

  Run:

  ```bash
  pnpm exec vitest run packages/infra-openrouter/src/__tests__/client.test.ts
  ```

  Expected: the new assertions fail because the current client returns successful content for these envelopes.

- [x] **Step 3: Implement runtime validation**

  Widen only the raw provider response type to reflect optional error metadata and unknown/null content. Before usage extraction and `ok(...)`, reject an absent choice, an in-band choice error, `finish_reason === 'error'`, and content whose runtime type is not `string`. Use a closed local error message; never forward the provider's error text. Preserve existing HTTP error mapping and retry behavior.

- [x] **Step 4: Verify GREEN and commit**

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

### Task 4: Make the MiniMax verdict contract self-contained and routing deterministic

**Files:**
- Modify: `packages/infra-openrouter/src/types.ts`
- Modify: `packages/infra-openrouter/src/client.ts`
- Test: `packages/infra-openrouter/src/__tests__/client.test.ts`
- Modify: `tools/intex-agent-evals/src/minimaxJudge.ts`
- Test: `tools/intex-agent-evals/src/__tests__/minimaxJudge.test.ts`

**Interfaces:**
- Consumes: the six allowed judge failure codes and OpenRouter provider-order options.
- Produces: one canonical enum shared by Zod and every full-verdict prompt; requests ordered through `gmicloud`, `minimax`, and `morph` with `allow_fallbacks: false`.

- [x] **Step 1: Write failing contract and routing tests**

  Require every canonical failure code, the exact JSON skeleton, and the pass-coherence rule in endpoint, Matrix, and repair prompts. Require repair to correct an invalid enum when given one chance. Require the shared OpenRouter client to serialize `order` and `allow_fallbacks` while still omitting `provider` for default callers, and require the dedicated evaluator's exact three-host order.

- [x] **Step 2: Verify RED**

  Run the focused OpenRouter and MiniMax evaluator suites. The new prompt and provider assertions must fail against the deployed implementation while all pre-existing assertions continue to pass.

- [x] **Step 3: Implement the canonical prompt and provider contract**

  Define the failure tuple once and reuse it in Zod and prompt construction. Include the complete compact skeleton, enum list, and pass rule in initial, Matrix, and repair instructions; bump the changed prompt versions. Add optional shared-client `order` and `allowFallbacks` serialization, then enable the verified order only in the MiniMax evaluator. Preserve one repair and every fail-closed guard.

- [x] **Step 4: Verify GREEN and review**

  Run both focused suites and `pnpm run ci:tracked` on the exact combined diff. Require independent code and specification review before delivery.

**Acceptance:** valid MiniMax JSON can satisfy the complete schema without guessing hidden enums, repair has all information needed to correct a verdict, known null-content/rate-limited hosts cannot be selected, and every non-evaluator OpenRouter caller is unchanged.

---

### Task 5: Convert an unavailable dependent confirmation into a behavioral stop

**Files:**
- Modify: `apps/intex-agent/src/domain/testConversation/testConversationTypes.ts`
- Modify: `apps/intex-agent/src/domain/testConversation/runTestConversation.ts`
- Test: `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts`
- Modify: `tools/intex-agent-evals/src/endpointClient.ts`
- Test: `tools/intex-agent-evals/src/__tests__/endpointClient.test.ts`
- Modify: `tools/intex-agent-evals/src/deterministicEvaluator.ts`
- Test: `tools/intex-agent-evals/src/__tests__/deterministicEvaluator.test.ts`
- Modify: `tools/intex-agent-evals/src/reportWriter.ts`
- Test: `tools/intex-agent-evals/src/__tests__/reportWriter.test.ts`
- Modify: `docs/testing/intex-agent-evals.md`
- Test: `tools/intex-agent-evals/src/__tests__/documentation.test.ts`

**Interfaces:**
- Consumes: a scenario `confirmation_button` turn whose requested button is absent from the executed prior turn.
- Produces: a strict correlated prefix with `stoppedBeforeTurn.reason = 'confirmation_button_unavailable'` and one closed deterministic failure of the same meaning.

- [x] **Step 1: Write failing prefix, correlation, evaluator, and report tests**

  Prove the domain runner stops before the unavailable turn without mutation, the client accepts only an exact bounded confirmation-turn prefix, the deterministic evaluator judges executed replies and emits one stop failure without cascaded evidence for unexecuted turns, and the report schema accepts the closed code. Prove malformed or forged partial responses remain infrastructure failures.

- [x] **Step 2: Verify RED**

  Run the four focused suites. The new assertions must fail against the deployed throwing/full-length-only behavior while all existing tests remain green.

- [x] **Step 3: Implement the additive partial-stop contract**

  Return the executed prefix and marker only for an absent requested confirmation button. Keep invalid request references as errors. Tighten endpoint correlation around the stop index and request turn kind; never fabricate a button or retry the LLM. Skip deterministic expectations at and after the stop while preserving all real prefix failures and judge inputs.

- [x] **Step 4: Verify GREEN and review**

  Run all focused suites, package typecheck/lint, and `pnpm run ci:tracked` on the exact diff. Require independent review before delivery.

**Acceptance:** an agent decision not to request confirmation is reported as a behavioral regression with intact prefix evidence and cleanup; it can no longer abort the corpus as endpoint infrastructure failure.

---

### Task 6: Enforce the Matrix gate inside `full`

**Files:**
- Modify: `tools/intex-agent-evals/src/cli.ts`
- Test: `tools/intex-agent-evals/src/__tests__/cli.test.ts`
- Modify: `tools/intex-agent-evals/src/reportWriter.ts`
- Test: `tools/intex-agent-evals/src/__tests__/reportWriter.test.ts`

**Interfaces:**
- Consumes: the `effectiveKind` of the endpoint corpus executed by the same `full` invocation.
- Produces: exactly one Matrix smoke only for `passed`; no Matrix call for `behavioral_failure`, `infrastructure_failure`, or missing endpoint evidence.

- [x] **Step 1: Write and verify the failing behavioral-gate test**

  Replace the old expectation that `full` continues after endpoint behavior with a proof that Matrix is not called and the private partial report records only the endpoint behavioral result.

- [x] **Step 2: Implement the strict gate and verify GREEN**

  Require `endpoint.result.effectiveKind === 'passed'` before `runMatrixSmoke()`. Preserve explicit `matrix-smoke` behavior and the one-call guarantee for a passing `full` run.

**Acceptance:** no real Matrix prompt can be sent by `full` unless all endpoint scenarios in that same invocation pass.

---

### Task 7: Review, deliver, and repeat live acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-intex-agent-live-acceptance-fixes.md` only to record final evidence.

- [x] Independently review each task and the combined diff; close every Critical or Important finding.
- [x] Run focused suites and `pnpm run ci:tracked` on the exact final revision.
- [x] Push the branch, open and merge PR [#2328](https://github.com/pbuchman/intexuraos/pull/2328) into `development`, and wait until Home Dev contains the exact fix revision through the existing deployment path.
- [x] Verify Home Dev health and deployed-revision ancestry.
- [x] Run `scripts/run-intex-agent-evals-home-dev.sh preflight`.
- [x] Run `scripts/run-intex-agent-evals-home-dev.sh endpoint`; stop before Matrix on nonzero exit.
- [ ] Only after endpoint exit `0`, run `scripts/run-intex-agent-evals-home-dev.sh full` exactly once. The current endpoint result is `1`, so this step is intentionally blocked by the safety gate.
- [x] Record the available endpoint artifact path, MiniMax provider-reported USD, failed scenario IDs, and cleanup evidence without private content. A second/full artifact does not exist because Matrix/full was not attempted after the non-passing endpoint corpus.

### Live evidence — 2026-07-18

- Home Dev contains the merged fix revision; Intex Agent was restarted and Intex Agent, WhatsApp Service, and Matrix adapter health checks pass.
- Preflight passed all 12 checks and reported the expected 20-scenario catalog and MiniMax M3 judge.
- Endpoint run `eval-8c81de82-b675-42a6-a23b-6ed7e9cfbd2f` wrote `.artifacts/intex-agent-evals/eval-8c81de82-b675-42a6-a23b-6ed7e9cfbd2f/report.json` on Home Dev.
- The complete corpus finished with exit `1`: 6 passed, 14 behavioral failures, zero infrastructure failures, 58 turns/replies, 18 tool calls, and full 20-turn execution in scenario `020`.
- MiniMax made 70 calls including 12 repairs, reported 95,069 total tokens and USD `0.0280443`. Cleanup passed `214/214`.
- Passed scenarios: `011`, `012`, `013`, `014`, `015`, `019`. Behavioral failures: `001`–`010`, `016`, `017`, `018`, `020`.
- Scenario `016` is a repeatable product event/result-coherence regression. Scenario `017` is model/flow variance: one run stopped behaviorally before unavailable confirmation, while a repeated run completed both turns. The remaining failures are judge semantics, including several verdict-contract ambiguities already covered by the frozen deferred-perfection annotation.
- No Matrix prompt was sent because the operator procedure stopped before `full` after endpoint exit `1`. The internal `full` hard gate is contract-tested but remains to be exercised live after a preceding green endpoint run.

**Final acceptance:** Home Dev `full` exits `0`; all 20 scenarios pass deterministic and MiniMax checks; one safe Matrix smoke passes; all reports are private and complete.

---

## Post-acceptance quality-loop amendment — 2026-07-18

The first authorized Matrix message and Chrome audit exposed additional defects after the endpoint corpus above. Work continues in small RED → GREEN increments; a live `full` run remains forbidden until the endpoint corpus itself exits `0`.

### Task 8: Accept a limited initial Matrix timeline as a forward checkpoint

**Files:**
- Modify: `tools/intex-agent-evals/src/live/runMatrixSmoke.ts`
- Test: `tools/intex-agent-evals/src/__tests__/runMatrixSmoke.test.ts`

**Contract:** A since-less initial `/sync` may return `timeline.limited: true` because older room history was truncated. Its top-level `next_batch` is still the required forward cursor. The runner discards that history and sends only after capturing the cursor, so it must continue from `next_batch`. A limited timeline on any incremental post-send poll remains fail-closed as `MATRIX_TIMELINE_LIMITED`.

- [x] Replace the incorrect initial-limited failure test with a RED regression proving historical events are ignored and the next poll uses the exact captured `next_batch`.
- [x] Verify RED: the current runner stops before send with `MATRIX_TIMELINE_LIMITED`.
- [x] Remove only the initial-capture limited rejection; keep incremental rejection and the failure-code/report schemas unchanged.
- [x] Verify the focused runner/client/report suites, package checks, independent task review, and `pnpm run ci:tracked` before commit.

**Acceptance:** a busy room can establish a safe baseline and observe only a later reply; no historical text or identifiers reach selection, judging, logs, or reports.

### Task 9: Make Home Dev web deploys restart PM2 from the repository root

**External repository:** `/Users/p.buchman/personal/pbuchman-dev/machine-setup`

**Contract:** The webhook handler is started by systemd with `cwd=/`. Both the PM2 restart path and its start fallback must execute with the deployed IntexuraOS repository as `cwd`; a successful pull must not leave a pre-existing Vite process serving an obsolete workspace module graph.

- [x] Add a RED regression that executes the handler from `/` with fake `direnv`/`pm2` and covers restart plus fallback start.
- [x] Set `cwd: REPO_PATH` and use `direnv exec .` for both PM2 calls without changing service allowlisting or webhook authentication.
- [x] Run the external repository's focused and full checks and review independently.
- [x] Merge the external change, deploy the handler without touching the dirty Home Dev personal checkout, and prove a controlled no-op deployment restarts only web successfully.

**Acceptance:** Home Dev deployment logs no longer contain `File ecosystem.config.cjs not found`; web serves the deployed package exports without a manual restart.

### Task 10: Preserve successful read-only tool executions

- [x] Add RED runner tests in `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts` where `get_user_preferences` and `query_calendar_events` execute successfully but the model's final envelope says `no_action`.
- [x] Normalize a successful read-only tool execution to the canonical `completed` result before returning the parsed outcome; preserve mutation confirmation and downstream event persistence.
- [x] Keep tool mocks, correlation, cleanup, and privacy invariants unchanged.

**Acceptance:** scenario `016` exposes the real tool result and `tool_call_completed` evidence even when the final model label is `no_action`; read-only tools never enter the mutation-confirmation path.

### Task 11: Characterize the scenario 017 confirmation boundary

**Evidence:** correlated, privacy-safe Home Dev logs show the failed live turn completed intent classification, executed exactly one schema-valid `add_user_preference` preview, and then failed both the runner-envelope validation and its single repair. The observed boundary is therefore neither classifier variance nor a provider ignoring `toolChoice: required`.

- [x] Add deterministic tests for explicit-add misclassification, a required-tool turn returning final text without a tool call, and malformed runner output.
- [x] Assert the current safe behavior and absence of mutation for every path before choosing a product change.
- [ ] Keep scenario `017` unchanged. Treat exactly one tracked, schema-valid mutating preview as authoritative confirmation evidence even when the final envelope remains malformed; retain fallback for no preview, read-only execution, invalid arguments, and multiple previews, and keep the real mutator at zero before confirmation.

### Task 12: Make the touched UI production-ready

- [x] Add a presentation projection that hides an `assistant_message` only when it immediately follows `clarification_requested` with the same normalized reply text. Keep both persisted source events and preserve distinct adjacent messages.
- [x] Render an absent end reason as `Open` and absent active tool as `None`; reserve `Unknown` for malformed required data.
- [x] Order the selected timeline before the session rail below `xl`, while preserving rail-first desktop layout and search behavior.
- [ ] Preserve desktop search, status, timeline, preferences history, accessibility, and responsive no-overflow behavior; cover each change with component tests and verify it live in Chrome.

### Task 13: Keep nested local checkouts out of Vitest discovery

**Files:**
- Modify: `scripts/verify-vitest-config.mjs`
- Modify: `vitest.config.ts`

- [x] Extend the config verifier first so it fails when the root test exclusion does not contain the exact `.worktrees/**` pattern.
- [x] Observe RED with `pnpm run verify:vitest-config`, then add `.worktrees/**` only to `test.exclude` and observe GREEN.
- [x] Do not increase or weaken the protected `coverage.exclude` budget or thresholds.
- [x] Run `pnpm run ci:tracked` with the preserved nested checkout still present, proving its tests are not discovered.

**Acceptance:** local ignored worktree contents cannot be executed or counted by the root unit/coverage gate; the existing checkout and its files remain untouched.

### Task 14: Align semantic judging with the sanitized reply contract

**Evidence:** privacy-safe endpoint-only reruns of scenarios `001`–`010` completed every expected flow with mocked tools and cleanup. Their replies intentionally omitted lifecycle narration and redacted raw confirmation arguments, matching the product system prompt and sanitizer. The prior MiniMax failures were driven by semantic criteria that required those unavailable strings, including synthetic evidence markers and exact calendar details already covered deterministically.

- [x] Replace the catalog assertions that require lifecycle narration with a RED invariant that semantic criteria must not ask the judge to infer session transitions, synthetic markers, or redacted raw arguments; keep those facts in deterministic transition, timeline, and argument assertions.
- [x] Remove positive and negative session-announcement requirements from scenarios `001`–`010`, remove synthetic marker tokens from every semantic criterion, and make scenario `002` judge user-facing confirmation/success without duplicating exact date/time assertions.
- [x] Preserve all scenario messages, turn counts (including the 20-turn scenario), expected tools, confirmation boundaries, deterministic payload evidence, cleanup, privacy, and the MiniMax M3 judge.
- [x] Regenerate the locked catalog digest and verify catalog tests before the next live corpus run.

**Acceptance:** MiniMax evaluates only observable sanitized reply quality; deterministic checks remain solely authoritative for session lifecycle, exact tool arguments, and synthetic correlation evidence.

### Task 15: Enforce coherent MiniMax verdict semantics

**Evidence:** the live report contains verdicts with every generic criterion set to `true` while `failures` still contains `missing_information`, `unclear`, or `unsupported_claim`. The current schema treats those contradictory verdicts as valid, so otherwise correct replies fail without invoking the existing repair path.

- [x] Add RED schema and evaluator tests for each closed failure-code mapping: `misunderstood_intent` requires `understoodIntent=false`; `missing_information`, `unhelpful`, and `unsupported_claim` require `helpful=false`; `unclear` requires `conciseAndClear=false`; `bad_tone` requires `professionalTone=false` or `noPassiveAggression=false`.
- [x] Encode the same mapping in both judge and repair prompts, and reject incoherent verdicts so the existing single MiniMax repair produces one internally consistent decision.
- [x] Keep the failure enum, five public criteria, model/provider order, one-repair limit, usage accounting, reports, privacy, endpoint ordering, and Matrix gate unchanged.

**Acceptance:** no passing generic criterion can coexist with a failure code that contradicts it; incoherent MiniMax output is repaired once or fails as evaluator infrastructure instead of becoming a false behavioral regression.

### Task 16: Redact multiline confirmation values completely

**Evidence:** an endpoint-only run of the 20-turn synthetic scenario showed that `Content:` itself became `[redacted]`, but subsequent lines belonging to the same multiline note value remained in `assistantReplies`. This violates the endpoint privacy contract and also gives MiniMax inconsistent partial content.

- [x] Add RED sanitizer tests with unique sentinels on continuation lines after `Content:`, `Prompt:`, and another structured confirmation field across CRLF plus the complete common vertical-boundary set (LF, CR, VT, FF, NEL, U+2028, U+2029); assert no sentinel survives in assistant replies or behavioral previews.
- [x] Make structured confirmation redaction stateful across every accepted line terminator so once a sensitive field begins, all of its multiline continuation content remains redacted without weakening URL, preference-block, marker, truncation, or event-payload protections.
- [x] Keep raw product replies and persisted session events unchanged; modify only the internal test endpoint projection and its tests.

**Acceptance:** no line belonging to a redacted structured confirmation value can reach endpoint output, judge input, reports, or diagnostics, including scenario `020`'s accumulated multiline note.

### Task 17: Calibrate privacy-safe isolated judging and long-session acknowledgements

**Evidence:** the deployed post-fix corpus improved from `6/20` to `15/20`, with scenarios `016` and `017` now passing and zero deterministic failures. The remaining five failures were MiniMax-only. Safe endpoint-only reruns proved the confirmation replies contained their expected structured labels followed by `[redacted]`, while the 20-turn run exposed one incorrect paraphrase of a retained fragment even though the final deterministic note arguments still contained all 18 markers. Passing `submittedTextPreview` to the external judge was rejected because it would unnecessarily widen the user-text privacy boundary.

- [x] Add RED catalog invariants that treat literal structured `…: [redacted]` fields as complete confirmation evidence and prohibit isolated criteria from requiring unavailable raw values or earlier conversation state.
- [x] Calibrate scenarios `002`, `006`, `012`, `018`, and `020` without changing messages, turn counts, transitions, tools, payload assertions, cleanup, or the MiniMax M3 judge.
- [x] Instruct Intex Agent to answer explicit retain-only, do-not-save turns with a short neutral current-session acknowledgement that does not paraphrase, enumerate, count, infer, or claim durable storage; lock the behavior with a RED prompt test and required version bump.
- [ ] Rerun the deployed 20-scenario endpoint gate; only after exit `0`, run the full endpoint-plus-Matrix gate once.

**Acceptance:** MiniMax evaluates only observable privacy-safe evidence, long context-retention turns cannot invent or repeat fragment details, all deterministic assertions remain authoritative, and Matrix remains gated behind a green endpoint corpus.

### Task 18: Close the deployed 18/20 regressions without weakening the gate

**Evidence:** deployed endpoint run `eval-b1dbdd16-f556-4d8b-b34b-c87e15f999da` completed all 20 scenarios with 59 turns, 59 judged replies, 19 tool calls, and zero infrastructure failures; cleanup for the two failed scenarios was `50/50`. Scenarios `001`–`010` and `012`–`019` passed. Scenario `011` had one stochastic calendar-argument assertion plus an `unsupported_claim` verdict because the isolated judge was not told that the closed mock returned zero events. Scenario `020` retained all markers in the final note arguments, but turns `0`–`17` visibly paraphrased or enumerated the fragments and turn `18` rendered repeated `[redacted]` continuations. The endpoint gate exited `1`, so Matrix/full was correctly not run.

- [x] Add an explicit classifier outcome `retain_context` and use it as the positive gate for a localized current-session acknowledgement without invoking the runner LLM. Keep ordinary conversation, mixed intents, image handling, and every tool/unsupported/clarification intent on their existing routes; retain the deterministic no-save/context-shape guard as defense in depth.
- [x] Collapse every continuation of a sensitive confirmation field into its existing `[redacted]` placeholder while preserving later structured field labels, all vertical separators, ordinary multiline replies, and raw persisted product events.
- [x] Remove the contradictory MiniMax instruction boundary: `semanticCriteria` plus closed facts are authoritative evaluation requirements, while only `assistantReply` is untrusted content. Keep the payload, MiniMax M3, provider order, one-repair cap, and `submittedTextPreview` exclusion unchanged.
- [x] Make scenario `011` state the closed zero-event mock result as complete judge evidence without changing tool, range, transition, or cleanup assertions.
- [x] Propagate the user's IANA time zone into the runner and define exact `mode=list` whole-day bounds for `today`/`tomorrow`, including DST-skipped midnights and fully skipped civil dates; make scenario `011` assert the exact Warsaw `+02:00` bounds and bump every affected prompt version.
- [x] Bound the production time-zone lookup to 1000 ms with transport abort, safe UTC fallback, and reason-only logs; preserve the `2026-07-01` endpoint contract by defaulting omitted `timeZone` to UTC while rejecting a supplied invalid IANA zone.
- [x] Close every Critical/Important combined-review finding, then run `pnpm run ci:tracked` on the exact final diff (`5518/5518` tests, coverage, build, format, and bundle budget passed).
- [x] Commit, push, merge PR `#2332`, wait for Home Dev to contain exact merge `ebf1f133df901bf93bf4b7bd20038081391da2c2`, and rerun the green preflight plus 20-scenario endpoint gate.
- [ ] Only after endpoint exit `0`, run `full` once and require its fresh endpoint corpus plus authorized Matrix smoke to exit `0`.
- [ ] Complete the logged-in desktop/mobile Chrome audit and record final privacy-safe evidence.

**Acceptance:** the real 20-scenario endpoint corpus exits `0`, the independently executed full gate exits `0` with MiniMax M3 and one Matrix smoke, no product tool writes escape the mock boundary, and the browser audit confirms the deployed session UI.

**Review status:** independent combined and time-zone/operations re-reviews approved the final implementation diff after verifying mixed-intent routing, exact scenario `011` bounds, skipped-midnight/date behavior, cancellable privacy-safe lookup, and legacy endpoint compatibility. Full tracked CI passed on the exact final diff with `5518/5518` tests, PR `#2332` merged with every GitHub check green, and Home Dev ran the exact merge. The fresh endpoint corpus fixed `011` and `020` but exposed the separate Task 19 regressions below, so Matrix/full correctly remained closed.

### Task 19: Close missing-date and code-task judge regressions from the exact deployed corpus

**Evidence:** deployed endpoint run `eval-c89c1373-af10-4e19-96a3-417c261a44b6` completed all 20 scenarios; scenarios `001`–`002`, `004`–`013`, and `015`–`020` passed, including the two Task 18 targets. Scenario `003` inferred the missing event date from `Current date-time`, requested confirmation before clarification, superseded that invalid confirmation after the user supplied Tuesday, and lost one exact synthetic identifier before the completed mocked tool call. Scenario `014` had zero deterministic failures, one correct completed `create_code_task`, and cleanup `9/9`, but one MiniMax verdict treated the intentionally redacted planning/worker confirmation as unclear; independent repeats passed the identical shape `3/4` times. Cleanup for both failures was `22/22`; the endpoint exited `1`, so Matrix/full was not run.

- [x] Add a RED runner test proving that a false-positive `create_calendar_event` classification cannot reach the runner LLM or tool preview when no date signal exists in the current request or relevant session history.
- [x] Add a deterministic pre-LLM missing-date gate with localized EN/PL clarification, explicit date-signal coverage, and paired pass-through tests for weekdays, ISO dates, Polish month dates, and prior-turn dates.
- [x] Strengthen the versioned runner prompt so a bare time never defaults to today and every exact identifier/code/reference survives clarification into final tool arguments.
- [x] Make scenario `014` treat its literal redacted confirmation labels as complete judge evidence and deterministically assert `workerType=minimax` plus `taskMode=planning` in both confirmation and execution evidence.
- [x] Close every Critical/Important independent-review finding and run `pnpm run ci:tracked` on the exact final source/test/evaluation diff (`5542/5542` tests, coverage, build, format, and bundle budget passed).
- [x] Commit, push, merge, wait for exact Home Dev deployment, rerun preflight, and require focused live scenarios `003` and `014` to pass before the complete endpoint corpus.
- [ ] Require the 20-scenario endpoint gate to exit `0`; only then run `full` once and require its fresh endpoint corpus plus authorized Matrix smoke to exit `0`.
- [ ] Complete the logged-in desktop/mobile Chrome audit and record final privacy-safe evidence.

**Acceptance:** the deterministic date gate prevents invented event dates without reducing valid calendar routing, exact identifiers survive clarification, scenario `014` is judged only from observable privacy-safe evidence, the real endpoint and full gates exit `0`, and Matrix remains strictly downstream of endpoint success.

**Review status:** independent calendar-chain and scenario-`014` re-reviews approved the final implementation after verifying topic boundaries, multi-clarification continuity, inbound quoted context, ordinal/month false positives, omitted Linear identifiers, closed sanitization paths, and 100% branch coverage of the new runner gate. No Critical or Important findings remain.

### Task 20: Close the three residual failures from the exact deployed corpus

**Evidence:** deployed endpoint run `eval-3c30827d-fdbe-4772-949b-4a9a18cbf8ae` completed all 20 scenarios with 58 turns, 58 judged replies, 18 tool calls, zero infrastructure failures, complete MiniMax M3 usage/cost accounting, and cleanup for all synthetic users. Seventeen scenarios passed. Focused repeats made scenarios `006` and `010` pass without a product change, identifying stochastic model/judge sensitivity; scenario `008` failed again and a privacy-safe direct diagnostic proved that the first missing-time clarification did not persist its classified calendar intent, so the next time-only answer was incorrectly treated as a new missing-date request. The endpoint exited `1`, therefore Matrix/full was correctly not run.

- [x] Add a RED → GREEN runner regression proving that a tool intent selected by the classifier remains in `candidateIntents` when the runner LLM asks for missing fields, preserving the active multi-turn clarification chain.
- [x] Strengthen the versioned product prompt so a new save/create action cannot inherit content or identifiers from an earlier completed action unless the user explicitly requests reuse; for note previews, deterministically restore every exact current-turn opaque letter-digit reference that a stochastic model omitted, without rewriting other tool arguments.
- [x] Calibrate scenario `010` to the observable sanitized contract: `Content: [redacted]` is required, `Title: [redacted]` is optional, redacted values are complete evidence, and the isolated reply need not name its audio/transcript source.
- [x] Make completed closed tool evidence authoritative to MiniMax M3 for a concise completion claim while preserving every failure enum, privacy boundary, deterministic assertion, model, provider order, repair limit, and fail-closed behavior.
- [x] Close every Critical/Important independent-review finding and run `pnpm run ci:tracked` on the exact final source/test/evaluation diff (`5553/5553` tests, coverage, build, format, and bundle budget passed).
- [ ] Commit, push, merge, wait for the exact Home Dev deployment, rerun preflight, and require focused live scenarios `006`, `008`, and `010` to pass before the complete endpoint corpus.
- [ ] Require the 20-scenario endpoint gate to exit `0`; only then run `full` once and require its fresh endpoint corpus plus the authorized Matrix smoke to exit `0`.
- [ ] Complete the logged-in desktop/mobile Chrome audit and record final privacy-safe evidence.

**Acceptance:** clarification metadata survives every runner-generated follow-up, new mutating requests are isolated from completed actions, MiniMax judges only observable closed facts, the real endpoint and full gates exit `0`, Matrix remains strictly downstream of endpoint success, and the deployed sessions UI passes the logged-in desktop/mobile audit.

**Review status:** two independent reviews approved the Task 20 implementation after checking classifier-authoritative runner metadata, exact-reference restoration and exclusion boundaries, the scenario `010` sanitized contract, and the MiniMax closed-evidence rule. PR `#2334` merged with every GitHub check green and Home Dev ran the exact merge `0514971e74367b53b88145ba40e94125da753176`. Focused scenario `006` passed; scenario `008` then exposed the separate classifier-contract defect below, so scenario `010`, the endpoint corpus, Matrix/full, and Chrome remained gated.

### Task 21: Make missing-detail intent metadata structural and continue it safely

**Evidence:** focused deployed run `eval-704078ae-4f14-4cb2-8893-e023e2497663` failed before confirmation with no tool execution. Two privacy-safe direct diagnostics showed the first calendar turn consistently persisted a metadata-free clarification, while the time-only continuation classified once as another generic clarification and once as the intended calendar tool. The classifier schema allowed that output, its calendar few-shot omitted `candidateIntents`, and the classifier transcript discarded the event metadata. This is classifier-contract variance, not an endpoint, date-gate, runner, or Matrix defect. Both diagnostics completed cleanup `8/8`; Matrix/full remained closed.

- [x] Add RED → GREEN schema tests requiring every `needs_clarification` to identify its blocker and every `missing_required_details` result to carry non-empty `missingFields` plus at least one canonical `candidateIntent`; keep `not_enough_context` available without a guessed tool.
- [x] Add a separately guarded active-clarification context containing only validated blocker and canonical tool enums. Ignore arbitrary payload fields, raw missing-field names, malformed legacy metadata, duplicate assistant events, and stale chains after a newer user turn.
- [x] Update and version the classifier plus repair prompts so a reply supplying the requested detail continues one active candidate unless the user cancels or changes topic. Give repair a bounded current-turn context because the bounded original-prompt preview ends before the transcript.
- [x] Cover metadata-free repair, duplicate candidate normalization, malformed/empty candidate lists, stale topic boundaries, payload non-disclosure, and the exact missing-time continuation shape; retain 100% branch coverage for the classifier.
- [ ] Close every Critical/Important independent-review finding and run `pnpm run ci:tracked` on the exact final diff.
- [ ] Commit, push, merge, wait for the exact Home Dev revision, rerun preflight, and require three consecutive focused scenario `008` passes followed by focused `006` and `010` passes.
- [ ] Require the complete 20-scenario endpoint gate to exit `0`; only then run `full` once and require its fresh endpoint corpus plus the authorized Matrix smoke to exit `0` with MiniMax M3.
- [ ] Complete the logged-in desktop/mobile Chrome audit and record final privacy-safe evidence.

**Acceptance:** metadata-free missing-detail classifications fail structural validation and repair with the current turn available; only validated active intent metadata crosses turns; explicit cancellation/topic changes cannot inherit a stale tool; scenario `008` is stable rather than retry-passing; and endpoint, Matrix, and browser gates remain ordered and fail closed.

**Review status:** Task 21 shipped through PR `#2335`; all GitHub checks and the exact local tracked CI passed, two independent reviews approved the final change, and Home Dev ran exact merge `803b13c2480a4efb6b9881255209aa35107b2085`. The first focused scenario `008` run then completed all three turns with zero deterministic failures and exactly one completed `create_calendar_event`, but MiniMax M3 assigned `missing_information` to the final concise completion reply. A privacy-safe product-only diagnostic confirmed that the reply identified both the calendar action and completion without asking another question. Cleanup passed `12/12`. This isolates a judge false negative; the stability series stopped after that first non-pass and Matrix/full remained closed.

### Task 22: Treat a named, deterministically completed action as a complete concise success reply

**Evidence:** focused deployed run `eval-418a6c13-5fb8-4b3d-98a0-e6a14c4309ac` passed every deterministic assertion and the first two MiniMax verdicts. Its final reply was concise, named the calendar action, communicated completion, and contained no question, while closed `technicalFacts.toolOutcome` proved `create_calendar_event` completed. MiniMax nevertheless classified the reply as `missing_information` because it did not repeat intentionally redacted event details.

- [x] Add a RED prompt/version regression requiring MiniMax to treat a reply that identifies the closed completed action as complete when the semantic criterion only asks whether that action succeeded.
- [x] Exclude bare acknowledgements and replies that do not identify the completed action; do not relax deterministic argument, tool-count, transition, timeline, cleanup, or confirmation assertions.
- [x] Explicitly prohibit `missing_information` and `unhelpful` solely because title, date, time, content, or other redacted tool arguments are omitted; preserve the raw-argument privacy boundary.
- [ ] Close every Critical/Important independent-review finding and run focused package checks plus `pnpm run ci:tracked` on the exact final diff.
- [ ] Commit, push, merge, wait for exact Home Dev deployment, and rerun the 12-check preflight.
- [ ] Require three consecutive focused scenario `008` passes, then focused `006` and `010` passes, without retrying through any failure.
- [ ] Require the complete 20-scenario endpoint gate to exit `0`; only then run `full` once and require its fresh endpoint corpus plus the authorized Matrix smoke to exit `0` with MiniMax M3.
- [ ] Complete the logged-in desktop/mobile Chrome audit and record final privacy-safe evidence.

**Acceptance:** concise success replies are evaluated against the observable sanitized contract and closed tool outcome rather than unavailable raw arguments; incomplete or unrelated replies still fail; the three-run stability gate, focused regressions, 20-scenario endpoint gate, fresh full-plus-Matrix gate, and browser audit all pass in order.

### Deferred perfection (recorded, not implemented in this loop)

- Dedicated portable WhatsApp integration accounts and cross-machine credential bootstrap.
- Automatic conversion of every debug-session request into a newly curated scenario and pull request.
- Richer judge calibration fixtures, `failedSemanticCriterionIndexes`, and per-criterion diagnostics beyond the active closed failure-code mapping.
- A per-user Intex Agent model selector matching the existing Default Model client contract. The current Home Dev UI exposes only the global default/fallback model and prompt preferences; implement the already frozen model-selection design separately after the evaluation baseline is stable.
