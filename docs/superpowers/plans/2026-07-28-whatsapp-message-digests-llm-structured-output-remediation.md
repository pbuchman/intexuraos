# WhatsApp Message Digests — LLM Structured Output Remediation

> Status: active — execute sequentially after the source-query gate and before saving the MVP digest.

## Goal

Make Message Digest aggregation use a Gemini-compatible structured-output transport schema while
retaining every application-owned validation invariant, and make the shared OpenRouter client map a
top-level error envelope returned with HTTP 200 instead of throwing a misleading client exception.
Then resume the unchanged group preview in the already running system Google Chrome.

## Evidence and root cause

- The real WhatsApp source query now returns `200`; generation reaches OpenRouter and fails before
  token usage with `OPENROUTER_CLIENT_ERROR`.
- A synthetic request with the configured key/model and no `response_format` succeeds.
- The official OpenRouter structured-output example succeeds against the same model.
- OpenRouter model metadata reports active Google AI Studio endpoints with both `response_format`
  and `structured_outputs` support.
- The Message Digest transport schema returns HTTP 200 with only `{ error: { code: 400 } }` and no
  `choices`. The shared client assumes `choices` exists, raises a `TypeError`, and loses the provider
  category.
- Gemini documents a JSON Schema subset. The digest schema uses provider-side string length,
  `pattern`, `uniqueItems`, and a large `maxItems`; a synthetic digest-shaped schema succeeds only
  after those transport constraints are removed. Isolating `maxItems: 1000` reproduces the provider
  rejection.
- The application Zod schema already enforces non-empty/bounded headline, bounded summary and
  continuity memory, at most 1,000 evidence refs, 64-hex refs, uniqueness, and membership in the
  exact source-message set. A single bounded repair attempt remains in place.

## Safety invariants

- Do not weaken `MessageDigestAggregateSchema` or allowed-evidence validation.
- No unvalidated provider output may reach preview, persistence, continuity memory, or delivery.
- Keep `strict: true`, the four required fields, root `additionalProperties: false`, and basic field
  types in the transport schema.
- Provider error messages must never be logged together with prompts or source content. The shared
  client may return its existing typed error to its caller; Message Digest continues mapping it to
  the safe `LLM_UNAVAILABLE` domain code.
- Synthetic live probes must contain no private source data and must not print generated content or
  credentials.
- Do not run full CI or workspace-wide tests in this remediation.

## Task 1: Add RED provider-schema and application-boundary contracts

**Modify:**

- `apps/message-digest-service/src/infra/llm/messageDigestAggregator.test.ts`
- `packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts`

1. Capture the aggregate call's `responseFormat` and require the exact provider schema:
   - root object, four required properties, `additionalProperties: false`;
   - three strings and one array of string items;
   - no `minLength`, `maxLength`, `pattern`, `uniqueItems`, or `maxItems` transport keywords.
2. Extend application-schema coverage so overlong continuity memory and more than 1,000 evidence refs
   remain rejected independently of the transport schema.
3. Run only these two test files and observe the transport contract RED before implementation.

## Task 2: Narrow only the provider transport schema

**Modify:**

- `apps/message-digest-service/src/infra/llm/messageDigestAggregator.ts`

Remove unsupported/oversized validation keywords only from `RESPONSE_FORMAT`. Do not change parsing,
sanitization, Zod schemas, repair behavior, source budgets, prompts, or persisted output types.

## Task 3: Add a RED HTTP-200 error-envelope contract

**Modify:**

- `packages/infra-openrouter/src/__tests__/client.test.ts`

Mock HTTP 200 with `{ error: { code: 400, message: 'Request contains an invalid argument.' } }`, use
one attempt, and require:

- a typed `API_ERROR` result with the provider message,
- usage failure category `OPENROUTER_HTTP_400`, and
- no successful content/usage path.

The current client must be observed RED because it records `OPENROUTER_CLIENT_ERROR` from a
`TypeError`.

## Task 4: Parse OpenRouter error envelopes before completion data

**Modify:**

- `packages/infra-openrouter/src/client.ts`

After JSON parsing, inspect only the top-level response shape. If it contains an error object, create
the existing `OpenRouterApiError` using a valid numeric code (fallback 500) and a non-empty message
(fallback generic), then let existing mapping/usage logic handle it. Do not log or retain the raw
response body. Valid completion and research paths remain unchanged.

## Task 5: Close the focused automated gate

Run, in order:

```bash
pnpm --filter @intexuraos/message-digest-service exec vitest run src/infra/llm/messageDigestAggregator.test.ts
pnpm --filter @intexuraos/llm-prompts exec vitest run src/message-digest/__tests__/messageDigestPrompt.test.ts
pnpm --filter @intexuraos/infra-openrouter exec vitest run src/__tests__/client.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/llm-prompts typecheck
pnpm --filter @intexuraos/infra-openrouter typecheck
pnpm exec eslint apps/message-digest-service/src/infra/llm/messageDigestAggregator.ts apps/message-digest-service/src/infra/llm/messageDigestAggregator.test.ts packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts packages/infra-openrouter/src/client.ts packages/infra-openrouter/src/__tests__/client.test.ts --max-warnings 0
pnpm exec prettier --check apps/message-digest-service/src/infra/llm/messageDigestAggregator.ts apps/message-digest-service/src/infra/llm/messageDigestAggregator.test.ts packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts packages/infra-openrouter/src/client.ts packages/infra-openrouter/src/__tests__/client.test.ts docs/superpowers/plans/2026-07-28-whatsapp-message-digests-llm-structured-output-remediation.md
git diff --check
```

## Task 6: Verify provider and unchanged Chrome preview

1. Run one synthetic provider probe with the exact new transport schema; require a completion shape
   and print only status/shape/token counts.
2. Let the local Message Digest Service reload and verify its isolated Firestore/PubSub bindings and
   health.
3. Click `Try preview again` in the same modal without changing source, instructions, or schedule.
4. Classify generated/no-activity without printing private output. Any distinct next failure gets a
   separate written plan before code changes.

## Completion gate

Both RED contracts must turn GREEN; application bounds must remain GREEN; three focused package test
files, three typechecks, lint/format/diff checks, the synthetic provider probe, and the unchanged
Chrome preview must pass. No commit, full CI, browser switch, or production mutation is allowed in
this fragment.
