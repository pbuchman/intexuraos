# Intex Agent Automated Evaluation Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Every production change follows RED → GREEN → review.

**Goal:** Provide one repository command that runs every tracked Intex Agent scenario on Home Dev, verifies tool/session behavior deterministically, evaluates every assistant response with MiniMax M3, performs one safe Matrix round-trip, and writes a complete report.

**Architecture:** A small evaluator under `tools/intex-agent-evals` runs on Home Dev and calls the existing local/dev-only `POST /internal/intex-agent/test/conversation` endpoint. The endpoint keeps the real Intex Agent LLM flow and mocked product tools, and additively exposes sanitized per-turn evidence already computed by the domain runner. Deterministic assertions remain authoritative; MiniMax M3 evaluates response semantics. The same command finishes with one real Matrix smoke whose prompt forbids product-tool side effects.

**Tech Stack:** TypeScript 5.7, Node.js 22, pnpm 10, Vitest 4, Zod 3, the existing Intex Agent test endpoint, the existing OpenRouter client, MiniMax M3, SSH, Matrix/Synapse on Home Dev.

## Status and authority

This is the only executable implementation plan for the current Intex Agent testing scope.

It supersedes the previous four-plan implementation graph for evaluation infrastructure, per-user model selection, automatic regression promotion, and dedicated-account WhatsApp canaries. Those larger designs remain in the repository only as the frozen “perfect system” backlog linked at the end. They are not prerequisites or executable instructions.

The ten narrative scenarios in [`2026-06-24-intex-agent-dev-api-test-scenarios.md`](../specs/2026-06-24-intex-agent-dev-api-test-scenarios.md) are the behavioral source for the initial executable corpus. The completed endpoint plan in [`2026-07-01-intex-agent-internal-test-conversation-endpoint.md`](./2026-07-01-intex-agent-internal-test-conversation-endpoint.md) is historical context, not work to repeat.

### Current implementation status — 2026-07-17

- Tasks 1–8 are implemented, independently reviewed, and green in `pnpm run ci:tracked`.
- Delivered commits through Task 8: `deada8c2d` (20-turn endpoint), `839a9dda6` + `6acb58c64` (strict evaluator contract), `f2eed4d60` + `fb656ce44` + `c15b0c2fe` (20-scenario corpus), `52680fd04` + `56b24fe21` (secure Home Dev configuration and preflight), `c2d673683` + `6cd0dd44e` + `3033e438f` (scenario lifecycle), `4382f9223` + `f40dda449` (MiniMax M3 judge), `e75bc6f3a` (safe Matrix smoke), and `6f1fbb351` (CLI, reports, and Home Dev wrapper).
- The offline completion audit is implemented and independently approved: every correlated assistant reply is judged, scenarios 001–010 enforce their source lifecycle semantics, tool/error evidence is closed and privacy-safe, setup is non-echoing, and the Home Dev wrapper accepts only one private framed CLI stream with selector/status validation. A fresh `pnpm run ci:tracked` passed on 2026-07-17.
- The only remaining executable work is the Task 9 live lane: deliver the implementation through `development`, prove Home Dev health and deployed revision, then run `preflight` → `endpoint` → `full`. It remains gated on the user's explicit “odpal testy” instruction.
- No real endpoint corpus, MiniMax M3 judge run, or Matrix message has been executed yet. Offline/unit/contract success is not final acceptance.
- The “Deferred perfection backlog” remains intentionally frozen and must not be implemented as part of this plan.

### Live contract correction — 2026-07-18

- Home Dev A/B evidence showed that OpenRouter's mixed MiniMax M3 endpoint pool can ignore `response_format: { type: 'json_object' }`; the affected path returned `finish_reason: 'stop'` with `message.content: null`, while the otherwise identical prompt-only request returned the expected final string and kept reasoning separate.
- The evaluator therefore uses prompt-enforced strict JSON, `JSON.parse`, strict local Zod validation, and at most one same-model repair. It does not send `response_format`, parse `message.reasoning`, add `provider.require_parameters`, change the judge model, or add a fallback.
- This is a narrow evidence-based correction to the original JSON-object-mode constraint. All privacy, fail-closed, cost-accounting, temperature, model, and repair constraints remain authoritative.

## Global constraints

- The only evaluation judge is `or:minimax/minimax-m3` (`minimax/minimax-m3` at the raw OpenRouter boundary).
- Claude Sonnet is not used as judge, fallback, repair model, or retry model.
- A MiniMax failure, invalid JSON, missing credential, or timeout is an infrastructure failure. It never silently passes or switches models.
- The judge uses prompt-enforced strict JSON, strict local Zod validation, temperature `0`, and at most one structured repair. It does not parse reasoning as the answer.
- The system under test uses the currently deployed Intex Agent model. Product model selection is outside this plan.
- The endpoint accepts from 1 through exactly 20 product turns. The independent provider tool-loop limit remains unchanged.
- Product tools stay mocked in the endpoint scenario suite.
- Every synthetic test user is removed through the existing cleanup utility in a `finally` path; cleanup failure is exit `2`.
- All tracked scenario content is synthetic. No real e-mail, Auth0 user ID, phone number, Matrix room ID, message, or token enters Git.
- Home Dev is fixed: SSH alias `home-dev`, repository `~/deploy/intexuraos`, Intex Agent port `8134`, WhatsApp Service port `8113`, Matrix adapter port `8099`.
- Machine-specific account data and Matrix paths live only in `~/.config/intexuraos/intex-agent-evals.json` on Home Dev with mode `0600`.
- The workstation wrapper passes its exact implementation commit as a required ancestor; Home Dev refuses the run until `~/deploy/intexuraos` contains that revision.
- `full` runs the endpoint corpus and one safe Matrix smoke. `endpoint` exists for a run with no real message.
- The Matrix smoke is safe with respect to product tools, but it is not storage-free: it creates one real outbound Matrix/WhatsApp prompt and one real Intex Agent session on the configured operator account. Synthetic endpoint cleanup must not delete those operator-owned records; dedicated-account lifecycle cleanup remains deferred.
- No evaluation gateway, new cloud service, Terraform, WIF, GitHub Actions, dedicated account, or production rollout work belongs to this plan.
- Reports are written below ignored `.artifacts/intex-agent-evals/` and are never committed.
- Exit `0`: all deterministic and MiniMax checks passed. Exit `1`: behavioral failure. Exit `2`: configuration, connectivity, endpoint, judge, or reporting failure.
- Before each implementation commit, run task-scoped tests and `pnpm run ci:tracked`.

## Endpoint Changes

### Modified

- `POST /internal/intex-agent/test/conversation`: increase from 5 to 20 turns, confirmation reference maximum from 4 to 19, request body limit from 64 KiB to 256 KiB, and additive sanitized per-turn `toolCalls`, `sessionAfterTurn`, and `timelineEvents` evidence. Sanitized `user_message` event payloads also retain `sourceType`.

### Created

- None.

### Removed

- None.

### Unchanged

- Internal authentication, local/dev-only availability, `live_llm_mock_tools` mode, exact `test-intex-agent-<runId>` namespace, every existing response field, production `404`, and the independent provider tool-loop limit.

## Canonical operator contract

After implementation:

```bash
pnpm --silent run eval:intex-agent:setup
pnpm --silent run eval:intex-agent:preflight
pnpm --silent run eval:intex-agent:endpoint
pnpm --silent run eval:intex-agent
pnpm --silent run eval:intex-agent --scenario intex-eval-003
pnpm --silent run eval:intex-agent:matrix-smoke
```

From this workstation, the canonical wrapper is:

```bash
scripts/run-intex-agent-evals-home-dev.sh setup
scripts/run-intex-agent-evals-home-dev.sh preflight
scripts/run-intex-agent-evals-home-dev.sh endpoint
scripts/run-intex-agent-evals-home-dev.sh full
scripts/run-intex-agent-evals-home-dev.sh scenario intex-eval-003
scripts/run-intex-agent-evals-home-dev.sh matrix-smoke
```

Future-agent interpretation:

- “Skonfiguruj testy Intex Agenta” means the one-time interactive `setup`.
- “Odpal testy Intex Agenta” means `full`.
- “Odpal testy bez live” means `endpoint`.
- “Odpal scenariusz …” means `scenario <id>`.
- “Odpal test Matrix” means `matrix-smoke`.

The phrase “odpal testy” is the explicit authorization for the one safe Matrix message included in `full`. Merely inspecting status or editing code is not.

## Success criteria

1. The endpoint accepts and executes 1–20 turns and rejects 0 or 21.
2. All tracked scenarios can be listed and validated offline.
3. One command connects to Home Dev and runs the entire tracked corpus.
4. Every scenario verifies expected/forbidden tools and required session behavior.
5. Every assistant response receives a strict MiniMax M3 verdict.
6. Failures identify scenario, turn, deterministic mismatch, and judge criterion without secrets.
7. JSON and Markdown reports exist for every run.
8. Preflight identifies endpoints, environment, judge, scenario count, and configured account alias without real identifiers.
9. Full mode verifies one Matrix → WhatsApp → Intex Agent → Matrix response from the WhatsApp puppet without authorizing any product-tool side effect. This smoke proves transport and reply semantics; deterministic tool behavior is proven by the endpoint corpus.
10. A new Codex session can run everything from the repository runbook without rediscovering paths, ports, or commands.

## Locked file map

**Modify:**

- `apps/intex-agent/src/routes/testConversationRoutes.ts`
- `apps/intex-agent/src/domain/testConversation/testConversationTypes.ts`
- `apps/intex-agent/src/domain/testConversation/runTestConversation.ts`
- `apps/intex-agent/src/domain/testConversation/testConversationSanitizer.ts`
- `apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts`
- `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts`
- `apps/intex-agent/src/__tests__/domain/testConversationSanitizer.test.ts`
- `pnpm-workspace.yaml`
- `package.json`
- `.gitignore`
- `eslint.config.js`
- `tsconfig.tests-check.json`
- `scripts/lint-parallel.mjs`
- `scripts/typecheck-parallel.mjs`
- `scripts/verify-workspace-deps.mjs`
- `packages/llm-contract/src/types.ts`
- `packages/infra-openrouter/src/client.ts`
- `packages/infra-openrouter/src/__tests__/client.test.ts`
- `docs/services/intex-agent/technical.md`

**Create:**

- `tools/intex-agent-evals/package.json`
- `tools/intex-agent-evals/tsconfig.json`
- `tools/intex-agent-evals/src/types.ts`
- `tools/intex-agent-evals/src/scenarioSchema.ts`
- `tools/intex-agent-evals/src/scenarioCatalog.ts`
- `tools/intex-agent-evals/src/endpointClient.ts`
- `tools/intex-agent-evals/src/runEndpointScenario.ts`
- `tools/intex-agent-evals/src/runEndpointCorpus.ts`
- `tools/intex-agent-evals/src/preflight.ts`
- `tools/intex-agent-evals/src/deterministicEvaluator.ts`
- `tools/intex-agent-evals/src/minimaxJudge.ts`
- `tools/intex-agent-evals/src/reportWriter.ts`
- `tools/intex-agent-evals/src/cli.ts`
- `tools/intex-agent-evals/src/live/matrixClient.ts`
- `tools/intex-agent-evals/src/live/runMatrixSmoke.ts`
- `tools/intex-agent-evals/src/__tests__/*.test.ts`
- `tools/intex-agent-evals/scenarios/*.scenario.json`
- `scripts/run-intex-agent-evals-home-dev.sh`
- `scripts/__tests__/run-intex-agent-evals-home-dev.test.ts`
- `docs/testing/intex-agent-evals.md`

## Task 1: Raise the existing endpoint limit to 20 turns

**Produces:** the unchanged `2026-07-01` request contract with a larger accepted range.

- [x] Add route tests proving 20 message turns are accepted, 21 are rejected, confirmation index `19` passes the schema maximum and reaches the unchanged earlier-turn validation, and `20` is rejected by the schema.
- [x] Run `pnpm exec vitest run apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts` and confirm RED at schema validation.
- [x] Change only: body limit `64 * 1024` → `256 * 1024`, `turns.maxItems` `5` → `20`, and confirmation maximum `4` → `19`.
- [x] Add a domain test proving the runner executes 20 turns in order and returns the complete transcript.
- [x] Run route/domain tests and `pnpm run ci:tracked`.

**Acceptance:** no production route, tool-loop bound, auth rule, session behavior, or `test-intex-agent-*` namespace rule changes.

## Task 2: Create the evaluator workspace and scenario contract

**Produces:** an offline-validatable catalog.

```ts
export type AssertionValue = null | boolean | number | string;

export interface ValueAssertion {
  path: string;
  operator: 'equals' | 'contains' | 'exists' | 'absent';
  value?: AssertionValue;
}

export interface TurnExpectation {
  turnIndex: number;
  requiredToolCalls: Array<{
    toolName: IntexAgentToolName;
    count: number;
    argumentAssertions: ValueAssertion[];
  }>;
  forbiddenToolCalls: IntexAgentToolName[];
  transition: {
    action: 'started' | 'continued' | 'superseded_previous' | 'expired_previous';
    previousEndReason?: string;
  };
  sessionAfterTurn: {
    allowedStatuses: IntexAgentSessionStatus[];
    startReason?: IntexAgentSessionStartReason;
    endReason?: IntexAgentSessionEndReason;
    activeTool?: IntexAgentToolName;
  };
  timeline: {
    requiredEventTypes: IntexAgentSessionEventType[];
    forbiddenEventTypes: IntexAgentSessionEventType[];
    payloadAssertions: Array<{
      eventType: IntexAgentSessionEventType;
      assertions: ValueAssertion[];
    }>;
  };
  replies: Array<{
    replyIndex: number;
    semanticCriteria: string[];
  }>;
}

export interface IntexEvalScenario {
  schemaVersion: '1';
  id: `intex-eval-${string}`;
  title: string;
  description: string;
  currentDateTime: string;
  timeZone: string;
  turns: ScenarioTurn[];
  expected: {
    turns: TurnExpectation[];
  };
}
```

- [x] Add the workspace and package configuration.
- [x] Define evaluator-owned strict wire schemas; import only the canonical tool-name catalog from `@intexuraos/llm-prompts`, never types from `apps/intex-agent`.
- [x] Restrict tracked turns to synthetic text/voice messages and confirmation buttons. Generate message IDs and timestamps at runtime; do not allow tracked user IDs, senders, reply contexts, source URLs, or raw tool mocks in schema version 1.
- [x] Write failing tests for unknown fields, duplicate IDs, filename/ID mismatch, 0/21 turns, invalid tools/events/statuses/transitions, duplicate or out-of-range turn/reply indexes, invalid or tool-incompatible paths/operators, empty per-reply criteria, missing turn expectations, invalid confirmation references, and real-looking identity fields.
- [x] Implement strict Zod parsing and catalog loading from `scenarios/*.scenario.json`; require fixed synthetic `currentDateTime` and IANA `timeZone`, exact turn-expectation coverage, contiguous reply indexes, and scalar assertion values.
- [x] Extend repository lint, source/test typecheck, and workspace-dependency discovery so the new `tools/intex-agent-evals` package is checked by normal CI without changing Vitest coverage exclusions.
- [x] Add `pnpm --filter @intexuraos/intex-agent-evals validate` with no network access.
- [x] Run package tests and `pnpm run ci:tracked`.

## Task 3: Encode the initial full corpus

**Produces:** exactly 20 executable scenarios in version 1, with an exact expectation for every turn and every assistant reply.

| ID | Required behavior |
| --- | --- |
| `intex-eval-001` | Create a note in one message |
| `intex-eval-002` | Create a calendar event in one message |
| `intex-eval-003` | Missing calendar date → clarification → create event |
| `intex-eval-004` | Explicit new session supersedes pending clarification |
| `intex-eval-005` | Unsupported request uses no tool |
| `intex-eval-006` | Follow-up after completion remains coherent |
| `intex-eval-007` | Ambiguous note-like request selects `create_note` |
| `intex-eval-008` | Missing calendar time → clarification → create event |
| `intex-eval-009` | New-session command without work uses no tool |
| `intex-eval-010` | Voice transcript follows normal note semantics |
| `intex-eval-011` | Calendar query selects `query_calendar_events` |
| `intex-eval-012` | Research request selects `create_research` |
| `intex-eval-013` | Bare URL selects `create_link` |
| `intex-eval-014` | Code request selects `create_code_task` |
| `intex-eval-015` | External-save request selects `save_external` |
| `intex-eval-016` | Preference read selects `get_user_preferences` |
| `intex-eval-017` | Preference creation selects `add_user_preference` |
| `intex-eval-018` | Preference change selects `update_user_preference` |
| `intex-eval-019` | Preference deletion selects `delete_user_preference` |
| `intex-eval-020` | Exactly 20 turns retain context: 18 context messages, save request on turn 19, accepted confirmation and `create_note` only on turn 20 |

- [x] Translate scenarios 001–010 from the existing narrative spec.
- [x] Add 011–019 so every current Intex tool has a positive selection case.
- [x] Add accepted `confirmation_button` turns for every mutating tool. Tool execution is expected only on the confirmation turn; the preceding request turn expects `confirmation_requested` and no tool call.
- [x] Make scenario 020 use 18 information-collection turns without save authorization, one explicit save request, and one accepted confirmation, for exactly 20 turns total.
- [x] Preserve scenario 010's `whatsapp_audio_transcript` source type as deterministic per-turn event evidence.
- [x] Add a catalog snapshot test asserting 20 unique IDs, every current tool name, exact turn-expectation coverage, exact reply-expectation coverage, and at least one argument assertion, session transition, and timeline-event assertion for every relevant scenario class.
- [x] Run offline validation, snapshots, and `pnpm run ci:tracked`.

**Acceptance:** “full corpus” means all tracked scenarios. It does not claim 95% production coverage.

## Task 4: Add fixed Home Dev configuration and preflight

**Sequencing annotation:** Task 4 is library-first. It implements the secure config repository, `setupEvaluatorConfig()`, `runPreflight()`, production account/readiness adapters, and Matrix `/whoami`, with an injected `MiniMaxProbePort`. Task 6 implements the single production MiniMax M3 adapter used by both probe and judge. Task 7 adds the non-echoing TTY, `setup`/`preflight` command dispatch, safe formatter, root scripts, and SSH wrapper. Consequently, Task 4 can be fully accepted offline with fakes, but the real operator `preflight` is accepted only after Tasks 6 and 7 are wired. Task 8 extends the same Matrix client with sync/send behavior; it does not reimplement identity checks.

**Machine-local file:** `~/.config/intexuraos/intex-agent-evals.json` on Home Dev, mode `0600`.

Strict keys:

| Key | Contract |
| --- | --- |
| `schemaVersion` | Exact integer `1` |
| `accountAlias` | Safe operator-facing label; no e-mail or external identifier |
| `userId` | Non-empty canonical Auth0 subject |
| `matrixUserId` | Non-empty Matrix user ID expected from `/health` and `/whoami` |
| `matrixAccessTokenFile` | Absolute path to a readable regular file owned by the Home Dev user |
| `matrixTargetsFile` | Absolute path to a readable regular JSON file owned by the Home Dev user |

The real values exist only in the mode-`0600` Home Dev file. Existing `INTEXURAOS_INTERNAL_AUTH_TOKEN` and `INTEXURAOS_OPENROUTER_APP_API_KEY` come from direnv.

- [x] Add the library workflow behind the one-time interactive `setup` command. `setupEvaluatorConfig()` accepts an in-memory candidate, validates it before writing, creates the parent directory with mode `0700`, and exclusively writes a new non-symlink config with mode `0600`. It may succeed idempotently for an identical safe file but refuses an existing differing config. Task 7 owns non-echoing TTY collection and command dispatch.
- [x] During setup, prove the supplied canonical ID is one enabled Firebase identity with one active private WhatsApp account and matching Matrix delivery target. Do not attempt e-mail-to-user discovery and never source the user ID from the adapter's legacy compatibility field.
- [x] Verify the configured token/targets paths resolve to readable regular files owned by the Home Dev user; validate content shape/non-emptiness without printing it.
- [x] Write fake-client tests for missing/unsafe config, wrong environment, unavailable service, `401`, missing/disabled Firebase identity, inactive private account, Matrix setup-required, wrong Matrix identity, and every closed `MiniMaxProbePort` failure. Require Linux, exact hostname `home-dev`, and `INTEXURAOS_ENVIRONMENT=dev`; the environment variable alone does not distinguish local from Home Dev.
- [x] Check `127.0.0.1:8134/health`, `127.0.0.1:8113/health`, `127.0.0.1:8099/health`, and WhatsApp `matrix-delivery-status/:userId`.
- [x] Check the configured Firebase UID with the existing Admin SDK and require `disabled !== true`; do not fetch or print profile fields.
- [x] Verify Matrix state `running`, direct Matrix `/account/whoami` equality with the configured Matrix identity, and delivery `ready`.
- [x] Define and orchestrate one `MiniMaxProbePort` call as the final preflight check. Task 6 supplies its only production implementation: one minimal MiniMax M3 prompt-enforced JSON request with strict Zod parsing, no fallback, and no alternative model.
- [x] Return only closed safe results containing host, fixed ports, readiness, judge model, scenario count, and `accountAlias`. Task 7 owns printing those results and cannot print arbitrary exception text.

**Acceptance:** offline Task 4 tests prove secure config handling and the full readiness orchestration through injected fakes. A real command-level preflight is not complete until Tasks 6 and 7 provide the production MiniMax adapter and CLI. Never print token, e-mail, real user ID, room ID, phone, secret path, or private message. WhatsApp delivery readiness here is configuration readiness; the one Task 8 send is the end-to-end delivery proof.

## Task 5: Run scenarios and deterministic assertions

- [x] First add failing Intex Agent domain/sanitizer tests for per-turn evidence, including explicit-new-session events across both affected sessions and preserved `sourceType`.
- [x] Add required sanitized fields to every endpoint turn result: the turn's `toolCalls` slice, immediate `sessionAfterTurn` snapshot, and all `timelineEvents` caused by that turn. Keep every existing top-level field for compatibility and never expose raw tool arguments or private text.
- [x] Add one shared privacy-safe synthetic-evidence summarizer for both pending confirmations and executed test-tool calls. It recognizes only whole `INTEX-EVAL-NNN` / `INTEX-EVAL-NNN-FNN` markers, emits only a count and domain-separated SHA-256 digest, and never emits marker values or raw arguments. Use the same summary in `confirmation_requested.payload.argsSummary` and captured `toolCalls[].argsSummary`; tests must prove suffix-boundary safety, secret independence, preview/execution equality, and missing-marker detection. Delivered early in `c15b0c2fe` to close Task 3 review.
- [x] Make the default preference mutation mocks return canonical prompt blocks through the production preference normalizer/renderer (empty after delete), so add/update/delete completion replies represent the resulting state before the existing sanitizer redacts private preference content. Delivered early in `c15b0c2fe` to close Task 3 review.
- [x] Write failing tests for missing required calls, extra forbidden calls, wrong turn/count, missing reply, invalid transition, timeout, and malformed endpoint response.
- [x] Implement the authenticated endpoint client.
- [x] Generate a unique lowercase `runId` and exact `test-intex-agent-<runId>` user per scenario.
- [x] Evaluate tool name/count/turn and safe `argsSummary` assertions, the exact transition action, the immediate session snapshot, and per-turn required/forbidden timeline events plus allowed payload assertions.
- [x] Apply tool argument assertions to every matching required call. For one timeline payload-assertion group, require one event of that type whose single payload satisfies every assertion.
- [x] Treat deterministic synthetic-marker assertions as the authority for redacted free-text arguments. MiniMax judges confirmation intent, clarity, and tone from the sanitized reply plus the deterministic outcome; it must not infer that redacted private text was visible.
- [x] Require an exact `(turnIndex, replyIndex)` bijection between actual assistant replies and scenario reply expectations; an extra or missing reply is a deterministic failure.
- [x] Never compare exact assistant wording deterministically.
- [x] Continue after a behavioral failure so the report covers the entire corpus.
- [x] Add scenario/corpus lifecycle modules with an injected fake `JudgeReplies` seam; Task 6 supplies its real MiniMax implementation. Keep endpoint, deterministic, judge, and cleanup results separate so no `finally` return can erase prior evidence.
- [x] In a `finally` path, build the existing cleanup input through its exported `parseArgs()`, call `runCleanup()` from `scripts/cleanup-intex-agent-test-conversations.mjs` for the scenario's exact synthetic user/run pair, and require deleted-count equality with the discovered target count.
- [x] Add tests proving cleanup runs after pass, behavioral failure, endpoint failure, and judge failure; treat cleanup failure as infrastructure failure without hiding the earlier verdict.

**Acceptance:** deterministic failure always makes the scenario fail, regardless of judge output. `behavioralTranscript` is report-only and never the source of a pass verdict.

## Task 6: Add the MiniMax M3 judge

```ts
const MiniMaxJudgeVerdictSchema = z.object({
  pass: z.boolean(),
  score: z.number().int().min(1).max(5),
  criteria: z.object({
    understoodIntent: z.boolean(),
    helpful: z.boolean(),
    conciseAndClear: z.boolean(),
    professionalTone: z.boolean(),
    noPassiveAggression: z.boolean(),
  }).strict(),
  failures: z.array(z.enum([
    'misunderstood_intent',
    'missing_information',
    'unhelpful',
    'unclear',
    'bad_tone',
    'unsupported_claim',
  ])),
  rationale: z.string().min(1).max(600),
}).strict();
```

- [x] Test exact MiniMax model selection, prompt-enforced strict JSON without `responseFormat`, temperature 0, one repair, and absence of alternative models.
- [x] Use `createOpenRouterClient` directly with raw model `minimax/minimax-m3`; do not widen the Intex tool-calling allowlist.
- [x] Use versioned `PromptBuilder` prompts and call `generateChat`; do not use the generic structured helper, strip Markdown fences, or confuse one structured repair with the client's same-model transient transport retries.
- [x] Judge each reply independently from synthetic scenario criteria plus sanitized technical facts.
- [x] Expose a separate Matrix-smoke judge seam on the same MiniMax evaluator. It uses closed transport facts and the same model/schema/repair/usage accounting, and never fabricates endpoint-only tool/session facts.
- [x] Preserve `(scenarioId, turnIndex, replyIndex)` in verdicts.
- [x] Require verdict coherence: `pass === true` exactly when all five criteria are true and `failures` is empty; reject duplicate failure enums. Score remains reported but does not define pass.
- [x] Treat invalid output after one repair as exit `2`.
- [x] Add optional `providerReportedUsd` to the public chat usage result and propagate the already-extracted OpenRouter value without changing existing normalized `costUsd` semantics. Judge success requires this finite non-negative provider value and sums it with input/output/total tokens across the initial and repair responses.

**Acceptance:** scenario pass = deterministic pass AND all reply-level MiniMax verdicts pass.

## Task 7: Add CLI, reports, package scripts, and SSH wrapper

**Sequencing annotation:** Task 8's Matrix library and fakes are implemented before Task 7's production composition, so the remaining execution order is `4 → 5 → 6 → 8 → 7 → 9`. Task numbering is retained for traceability. Task 7 must wire the real Task 8 implementation; it must not introduce a temporary or stub production `full` / `matrix-smoke` command.

- [x] Test commands `setup`, `preflight`, `endpoint`, `full`, `scenario <id>`, `matrix-smoke`, unknown input, and exit-code propagation.
- [x] Support both exact scenario selectors `scenario <id>` and `--scenario <id>`; reject every other flag/extra argument. Normalize SSH, revision, and unexpected process statuses to infrastructure exit `2`, while preserving remote `0`, `1`, and `2`.
- [x] Write `.artifacts/intex-agent-evals/<runId>/report.json` and `report.md` atomically through a restrictive temporary directory plus rename, with totals, tool/turn summaries, judge verdicts, provider-reported cost, duration, and safe failure codes. Evaluation commands produce reports; `setup` and `preflight` print safe summaries only.
- [x] Ignore the artifact root in Git.
- [x] Add root scripts `eval:intex-agent:setup`, `eval:intex-agent:preflight`, `eval:intex-agent:endpoint`, `eval:intex-agent`, and `eval:intex-agent:matrix-smoke`.
- [x] Continue corpus and the authorized Matrix smoke after behavioral failures so the report is complete; stop before later scenarios or Matrix only after infrastructure, cleanup, judge-protocol, or reporting failure. Exit precedence is `2` over `1` over `0`, while preserving all earlier verdicts.
- [x] Implement the wrapper with a closed selector set and fixed `home-dev` / `~/deploy/intexuraos`.
- [x] Execute remotely through `zsh -lic` and `direnv exec .`. Never forward secrets as SSH arguments.
- [x] Resolve the local implementation SHA, pass it only as the revision proof, and require remote `git merge-base --is-ancestor <requiredSha> HEAD` before preflight or tests.
- [x] Refuse to use HEAD as revision proof when any evaluator implementation path is staged, modified, or untracked.
- [x] Test exact quoting, unknown-selector rejection, revision mismatch, exit normalization, and safe-output pass-through. The wrapper never adds environment/argv/remote-command text to output; the evaluator CLI owns the allowlisted safe output contract and never emits raw errors or secrets.

**Acceptance:** `scripts/run-intex-agent-evals-home-dev.sh full` is the single command used when the user says “odpal testy”.

## Task 8: Add the safe Matrix round-trip

**Execution note:** implement this task before Task 7, as required by the sequencing annotation above.

- [x] Test readiness failure, send failure, timeout, unrelated events, self-authored events, valid reply, and MiniMax rejection with fakes.
- [x] Refactor Task 4 readiness behind a callback-scoped validated-account-context helper. The CLI runs full preflight first; Task 8 reuses the same checks immediately before send as a just-in-time account/Matrix/WhatsApp recheck, without rerunning the catalog or MiniMax probe and without returning secret context.
- [x] Read token/target paths only from the mode-0600 machine-local config.
- [x] Capture a Matrix sync cursor before sending.
- [x] Resolve the adapter health `sourceAccountId` against the machine-local targets file and select only its `intex_agent` room; verify Matrix `/account/whoami` equals the configured Matrix identity.
- [x] Call `POST /internal/whatsapp/private/outbound-matrix-messages` with the machine-local user ID, `startNewSession: true`, a unique idempotency key, and a synthetic prompt that explicitly asks the agent to request missing note content and not save anything yet.
- [x] Ensure the prompt cannot authorize a note, calendar, research, link, code, external-save, or preference side effect.
- [x] Poll only the configured `intex_agent` room from the captured cursor.
- [x] Ignore self messages, bridge bookkeeping, reactions, edits, and non-text events.
- [x] Accept only the first new non-redacted `m.text` event whose sender matches the existing WhatsApp puppet predicate; reject/ignore self, bridge-bot, unknown-sender, limited-timeline, and unrelated-room evidence.
- [x] Judge the first new assistant text through the dedicated MiniMax M3 Matrix seam; return/report only the closed verdict fields and usage, never rationale or message text.
- [x] Retain no token, room/user/event ID, phone, or room history in reports.

**Acceptance:** `endpoint` never sends a real message. `full` and `matrix-smoke` each send exactly one safe outbound prompt and may persist its real bridge/message metadata plus one real Intex Agent session on the configured operator account. The prompt never authorizes a product side effect, and synthetic cleanup never targets these records. This Matrix smoke does not claim hidden tool-call auditing; deterministic tool selection is covered by the endpoint corpus.

## Task 9: Write the runbook and prove the workflow

- [x] Write `docs/testing/intex-agent-evals.md` with commands, fixed Home Dev host/repo/ports, machine-local config path/schema, scenario/report directories, exit codes, and failure triage.
- [x] Update Intex Agent technical docs for 20 turns and link the runbook.
- [ ] After local CI and review, deliver the exact implementation commit through the existing `development` → Home Dev deployment path; do not add a second deployment mechanism.
- [ ] Wait for Home Dev health, verify the implementation commit is an ancestor of the remote deployed HEAD, and only then run live acceptance.
- [ ] Run:

```bash
pnpm --filter @intexuraos/intex-agent-evals validate
pnpm --filter @intexuraos/intex-agent-evals test
pnpm exec vitest run apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts
pnpm run ci:tracked
scripts/run-intex-agent-evals-home-dev.sh setup # one time, only when protected config is absent
scripts/run-intex-agent-evals-home-dev.sh preflight
scripts/run-intex-agent-evals-home-dev.sh endpoint
scripts/run-intex-agent-evals-home-dev.sh full
```

**Final acceptance:** preserve report paths in the handoff, state MiniMax cost, and list failed scenario IDs. Unit tests alone are insufficient; Home Dev `full` must pass.

## Deferred perfection backlog — frozen, do not implement now

The following would make the system more comprehensive or portable, but is intentionally excluded:

- user-configurable Intex Agent model selection and a three-product-model matrix;
- a verified DeepSeek product-model identifier and DeepSeek-specific exact-20 evidence;
- mechanical 95% capability coverage and a large generated catalog;
- repetitions, statistical flake policy, baselines, drift alerts, nightly CI, and protected releases;
- a restricted evaluation gateway, separate evaluation credential, budgets, IAM, WIF, and attestation;
- automatic debug-session → privacy-safe regression draft → review → promotion;
- authoring/verifying skill teams for regression scenarios;
- a dedicated Auth0/WhatsApp/Matrix account instead of the current operator account;
- real tool-side-effect canaries with cleanup;
- browser automation for Auth0, settings, and Element;
- Meta delivery receipts, correlation, crash recovery, tombstones, TTL, and drills;
- multi-machine bootstrap, containerized runner, and portable secret management;
- portable native no-replace report-directory publication with filesystem-specific atomic collision guarantees;
- an independent judge for future rows where MiniMax M3 itself is the product model;
- release activation gates, signed evidence, artifact provenance, and deployment attestation.

Frozen historical material:

- [`2026-07-14-intex-agent-automated-testing-design-review.md`](../specs/2026-07-14-intex-agent-automated-testing-design-review.md)
- [`2026-07-14-intex-agent-evaluation-foundation-design.md`](../specs/2026-07-14-intex-agent-evaluation-foundation-design.md)
- [`2026-07-14-intex-agent-user-model-selection-design.md`](../specs/2026-07-14-intex-agent-user-model-selection-design.md)
- [`2026-07-14-intex-session-regression-skills-design.md`](../specs/2026-07-14-intex-session-regression-skills-design.md)
- [`2026-07-14-intex-agent-whatsapp-live-canary-design.md`](../specs/2026-07-14-intex-agent-whatsapp-live-canary-design.md)

These documents are non-authoritative for current implementation. Every historical Sonnet-as-judge decision is superseded by the MiniMax M3-only rule above.

## Plan self-review

- **Scope:** one endpoint change, one evaluator, one 20-scenario corpus, one MiniMax judge, one Home Dev wrapper, one safe Matrix smoke.
- **Prerequisites:** existing Home Dev SSH/services, current direnv secrets, one mode-0600 account config.
- **Privacy:** real account and Matrix values remain outside Git.
- **Model:** MiniMax M3 is the sole judge; deployed Intex model is the system under test.
- **Completion:** Home Dev `full` report must pass.
