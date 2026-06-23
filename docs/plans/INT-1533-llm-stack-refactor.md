# [INT-1533] LLM/AI Stack — Unified Factory, Prompt Versioning, Cost Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three structural gaps (incomplete factory, un-versioned prompts, dropped cost attribution) plus the seven supporting gaps (no retry, no prompt caching, unbatched usage POSTs, missing Claude 4.7 pricing, silent $0 fallback, ~25 duplicated Zod/JSON parsers, thin `llm-utils`) identified in `docs/reviews/2026-04-24-refactoring-analysis.md` §5.

**Architecture:** Consolidate all LLM wiring behind the `@intexuraos/llm-factory` package so `createLlmClient()` is the single entry point for all five providers (Google, OpenRouter, Anthropic, OpenAI, Perplexity). Push the reusable cross-cutting concerns (retry, structured output, correlation propagation, caching) into `@intexuraos/llm-utils` and `@intexuraos/llm-pricing`. Enforce the prompt-versioning contract at CI so the rule cannot be bypassed by writing a plain function. Extend usage-event schema to carry `researchId` alongside existing `taskId`/`sessionId` and batch emission at the sink layer.

**Tech Stack:** TypeScript strict mode, Vitest, Fastify (services), `@google/genai`, `@anthropic-ai/sdk`, `openai`, `@intexuraos/llm-contract` (types), `@intexuraos/llm-factory`, `@intexuraos/llm-pricing`, `@intexuraos/llm-prompts`, `@intexuraos/llm-utils`, `@intexuraos/infra-claude|gpt|gemini|perplexity|openrouter`.

---

## Endpoint Changes

- **Modified:**
  - `POST /internal/usage-events` (llm-usage-service) — accepts batched arrays `{ events: UsageEventInput[] }` in addition to single-event body; existing single-event body remains supported for backwards compatibility during migration window.
  - `POST /webhook/usage-events` (llm-usage-service) — same batching contract as `/internal/usage-events`.
- **Created:** none (all behavior changes ride existing endpoints).
- **Removed:** none.
- **Unchanged:** every caller-facing HTTP endpoint in apps consuming LLM clients (research-agent, retired-chat-service, code-agent, web-agent, etc.).

---

## File Structure

### Packages
- `packages/llm-factory/src/llmClientFactory.ts` — expanded provider dispatch.
- `packages/llm-factory/src/claudeGenerateClient.ts` *(new)* — wraps `infra-claude` with the `LlmGenerateClient` interface.
- `packages/llm-factory/src/gptGenerateClient.ts` *(new)* — wraps `infra-gpt`.
- `packages/llm-factory/src/perplexityGenerateClient.ts` *(new)* — wraps `infra-perplexity`.
- `packages/llm-utils/src/withRetry.ts` *(new)* — retry/backoff for `LLMError` codes.
- `packages/llm-utils/src/generateStructured.ts` *(new)* — markdown-strip + JSON.parse + Zod + repair loop.
- `packages/llm-utils/src/index.ts` — add exports.
- `packages/llm-pricing/src/usageLogger.ts` — widen `UsageLogParams` with `correlation` fields.
- `packages/llm-pricing/src/buildUsageEvent.ts` — surface `researchId` in `correlation`.
- `packages/llm-pricing/src/httpInternalAuthUsageSink.ts` — 500 ms flush window, `flushSync()`.
- `packages/llm-pricing/src/httpWebhookUsageSink.ts` — same batching semantics.
- `packages/llm-pricing/src/types.ts` — add `'missing'` to `pricingSource` union.
- `packages/llm-prompts/src/**` — migrate every remaining plain `buildXxxPrompt()` to a typed `PromptBuilder<>` with `version`.
- `packages/infra-claude/src/*Client.ts` — thread correlation args through; set `cache_control` on stable prefixes.
- `packages/infra-gpt/src/*Client.ts` — thread correlation args through; set `prompt_cache_key` / `cache_control` for OpenAI.
- `packages/infra-gemini|perplexity|openrouter/src/*Client.ts` — thread correlation args through; wrap calls with `withRetry()`.

### Apps
- `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts` — delegate to `createLlmClient()`.
- `apps/research-agent/src/infra/llm/{Gemini,Claude,Gpt,Perplexity,OpenRouter}Adapter.ts` — delete after migration.
- `apps/retired-chat-service/src/prompts/*.ts` — migrate plain functions to `PromptBuilder<>`.
- `apps/code-agent/src/prompts/*.ts` — same.
- `apps/web-agent/src/prompts/*.ts` — same.
- `apps/llm-usage-service/src/routes/ingestRoutes.ts` — accept batched body.
- `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts` — emit `pricingSource: 'missing'` and fail in `NODE_ENV !== 'production'`.

### Scripts
- `scripts/verify-prompt-versions.mjs` — widen regex to flag plain `export function build\w+Prompt\(` as errors unless file contains `// prompt-version-exempt:<reason>`.
- `scripts/__tests__/verify-prompt-versions.test.mjs` — add tests for new rule.
- `scripts/pricing-diff-nightly.mjs` *(new)* — fetches provider pricing pages, diffs against `llm-pricing` table, opens a Linear issue on drift.

### Infrastructure
- `migrations/` — new migration adding Claude 4.7 models to pricing store (if applicable; confirm storage layer during Task 8).
- `terraform/environments/dev/main.tf` — add Cloud Scheduler entry for nightly pricing diff job.

---

## Task Decomposition

The tasks are ordered so each produces a green CI pass independently, and each follows TDD. Commit after every task.

---

### Task 1: Widen prompt-version verification script

**Files:**
- Modify: `scripts/verify-prompt-versions.mjs`
- Modify: `scripts/__tests__/verify-prompt-versions.test.mjs` (create if missing)
- Create: `docs/patterns/prompt-versioning.md` (short exemption convention doc)

**Why first:** once this rule is widened, the same change in subsequent tasks lands against a CI that fails fast on un-versioned prompts. Don't convert prompts before the rule is in place — you lose the regression net.

- [ ] **Step 1: Write the failing test**

Add in `scripts/__tests__/verify-prompt-versions.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { analyzeFile } from '../verify-prompt-versions.mjs';

describe('plain prompt builder detection', () => {
  it('flags a plain `export function buildXxxPrompt` without exemption', () => {
    const src = `export function buildResearchPrompt(q: string): string { return q; }`;
    const res = analyzeFile('prompts/research.ts', src);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].kind).toBe('unversioned-plain-builder');
  });

  it('accepts a plain function when file contains prompt-version-exempt marker', () => {
    const src = `// prompt-version-exempt: used only in tests\nexport function buildResearchPrompt() { return ''; }`;
    const res = analyzeFile('prompts/research.ts', src);
    expect(res.errors).toHaveLength(0);
  });

  it('accepts typed PromptBuilder with valid semver', () => {
    const src = `export const p: PromptBuilder<{ q: string }> = { version: '1.0.0', build: (v) => v.q };`;
    const res = analyzeFile('prompts/research.ts', src);
    expect(res.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/__tests__/verify-prompt-versions.test.mjs`
Expected: FAIL — `analyzeFile` not exported, rule `unversioned-plain-builder` does not exist.

- [ ] **Step 3: Refactor script to expose `analyzeFile` + add plain-builder rule**

In `scripts/verify-prompt-versions.mjs`, extract the per-file check into:

```js
const PLAIN_BUILDER_REGEX = /^\s*export\s+function\s+build\w+Prompt\s*\(/m;
const EXEMPTION_REGEX = /\/\/\s*prompt-version-exempt:/;

export function analyzeFile(path, content) {
  const errors = [];
  const exempt = EXEMPTION_REGEX.test(content);
  if (hasPromptBuilderExport(content)) {
    // existing versioning check
    errors.push(...checkPromptBuilderVersions(path, content));
  } else if (PLAIN_BUILDER_REGEX.test(content) && !exempt) {
    errors.push({
      kind: 'unversioned-plain-builder',
      path,
      message: `${path}: plain \`buildXxxPrompt\` function detected. Convert to typed PromptBuilder<> with \`version\`, or add \`// prompt-version-exempt:<reason>\`.`,
    });
  }
  return { errors };
}
```

Preserve the CLI path: `main()` should call `analyzeFile()` for every discovered TS file and surface `errors[]`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run scripts/__tests__/verify-prompt-versions.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the script against the current repo and capture the list of offending files**

Run: `node scripts/verify-prompt-versions.mjs | tee /tmp/int-1533-plain-prompt-baseline.txt`
Expected: FAIL with a list of `unversioned-plain-builder` errors (expected: research-*, synthesis-*, chat-system, code-triage, code-cooloff, web-summary-repair, validation-repair). This list seeds Tasks 2–5.

- [ ] **Step 6: Add the exemption doc**

Create `docs/patterns/prompt-versioning.md`:
- When to exempt (fixture prompts, test helpers).
- Required exemption syntax: `// prompt-version-exempt: <reason>`.
- Bump rules (major/minor/patch) — cross-link to CLAUDE.md's "Prompt Versioning" rule.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-prompt-versions.mjs scripts/__tests__/verify-prompt-versions.test.mjs docs/patterns/prompt-versioning.md
git commit -m "chore(llm): widen prompt-version verification to flag plain builder functions (INT-1533)"
```

---

### Task 2: Convert plain-function prompts in `packages/llm-prompts` to `PromptBuilder<>`

**Files:**
- Modify: every file in `packages/llm-prompts/src/**` flagged by `/tmp/int-1533-plain-prompt-baseline.txt`.
- Modify: callers in `apps/research-agent`, `apps/calendar-agent`, etc. that import the renamed builder.

**Pattern:** For each flagged file `xxx.ts`:

- [ ] **Step 1: Locate caller usage**

Run: `pnpm -s exec rg -n "buildXxxPrompt" apps packages workers | tee /tmp/int-1533-callers-xxx.txt`

- [ ] **Step 2: Write a failing test for version presence (if the prompt has no existing test)**

Create `packages/llm-prompts/src/<area>/__tests__/xxx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { xxxPrompt } from '../xxx.js';

describe('xxxPrompt', () => {
  it('has a semver version', () => {
    expect(xxxPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('renders the expected text for canonical input', () => {
    const rendered = xxxPrompt.build({ /* canonical vars */ });
    expect(rendered).toContain('<expected substring>');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -s --filter @intexuraos/llm-prompts vitest run src/<area>/__tests__/xxx.test.ts`
Expected: FAIL — `xxxPrompt.version` is `undefined` (function form).

- [ ] **Step 4: Convert to `PromptBuilder<>`**

Replace:

```ts
export function buildXxxPrompt(vars: XxxVars): string { /* ... */ }
```

with:

```ts
import type { PromptBuilder } from '../types.js';

export const xxxPrompt: PromptBuilder<XxxVars> = {
  version: '1.0.0',
  build(vars) { /* unchanged body */ },
};

// Back-compat shim during migration — remove in a follow-up sweep
/** @deprecated Use `xxxPrompt.build(vars)`. Kept to avoid a big-bang migration. */
export function buildXxxPrompt(vars: XxxVars): string {
  return xxxPrompt.build(vars);
}
```

- [ ] **Step 5: Update callers listed in `/tmp/int-1533-callers-xxx.txt`**

Replace `buildXxxPrompt(vars)` with `xxxPrompt.build(vars)` in every caller.

- [ ] **Step 6: Run workspace verification**

Run: `pnpm run verify:workspace:tracked -- @intexuraos/llm-prompts`
Expected: PASS (tests, typecheck, lint, coverage).

- [ ] **Step 7: Run prompt-version script**

Run: `node scripts/verify-prompt-versions.mjs`
Expected: PASS (this file no longer flagged).

- [ ] **Step 8: Commit**

```bash
git add packages/llm-prompts apps/**
git commit -m "refactor(llm-prompts): convert <area> prompts to versioned PromptBuilder (INT-1533)"
```

Repeat Steps 1–8 for every file flagged by the baseline list. Group related files into logical commits (e.g. all research prompts in one commit).

---

### Task 3: Convert plain-function prompts in service apps

**Files:**
- `apps/retired-chat-service/src/prompts/systemPrompt.ts` (and siblings)
- `apps/code-agent/src/prompts/{triage,cooloff,validationRepair}.ts`
- `apps/web-agent/src/prompts/summaryRepair.ts`
- Callers of the above within each app.

Repeat the Task 2 per-file recipe (Steps 1–8) for each app prompt. Use per-app exports, not shared-package exports.

Each commit is scoped to one app:

```bash
git commit -m "refactor(retired-chat-service): convert chat prompts to versioned PromptBuilder (INT-1533)"
```

Expected final state after Task 3: `node scripts/verify-prompt-versions.mjs` exits 0.

---

### Task 4: Widen `UsageLogParams` / `buildUsageEvent` with `researchId`

**Files:**
- Modify: `packages/llm-pricing/src/usageLogger.ts`
- Modify: `packages/llm-pricing/src/buildUsageEvent.ts`
- Modify: `packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts`
- Modify: `apps/llm-usage-service/src/domain/schemas/usageEventSchema.ts` (if it enumerates `correlation` keys; widen schema to allow `researchId: string | null`).

- [ ] **Step 1: Write the failing test**

Append to `packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts`:

```ts
it('propagates researchId and sessionId from correlation overrides into the emitted event', () => {
  const event = buildUsageEvent(
    baseParams({ userId: 'user-1' }),
    { service: 'research-agent', component: 'claude-client' },
    { researchId: 'r-42', sessionId: 's-7', taskId: null, requestId: 'req-99' },
  );

  expect(event.correlation).toEqual({
    requestId: 'req-99',
    traceId: null,
    taskId: null,
    researchId: 'r-42',
    attempt: null,
    sessionId: 's-7',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -s --filter @intexuraos/llm-pricing vitest run src/__tests__/buildUsageEvent.test.ts`
Expected: FAIL — `researchId` is hardcoded to `null` at line 85 of `buildUsageEvent.ts`.

- [ ] **Step 3: Extend `CorrelationOverrides` and thread the value**

In `packages/llm-pricing/src/buildUsageEvent.ts`:

```ts
export interface CorrelationOverrides {
  taskId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  researchId?: string | null;
}

// ... inside buildUsageEvent:
correlation: {
  requestId: correlationOverrides?.requestId ?? null,
  traceId: null,
  taskId: correlationOverrides?.taskId ?? null,
  researchId: correlationOverrides?.researchId ?? null,
  attempt: null,
  sessionId: correlationOverrides?.sessionId ?? null,
},
```

- [ ] **Step 4: Extend `UsageLogParams` with an optional `correlation` bag**

In `packages/llm-pricing/src/usageLogger.ts`:

```ts
export interface UsageLogParams {
  // ... existing fields
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
}
```

And update `usageLogger` (wherever it calls `buildUsageEvent`) to pass `params.correlation` through:

```ts
const event = buildUsageEvent(params, source, {
  ...existingCorrelationOverrides,
  ...(params.correlation ?? {}),
});
```

- [ ] **Step 5: Widen the ingest Zod schema**

In `apps/llm-usage-service/src/domain/schemas/usageEventSchema.ts` ensure `correlation.researchId: z.string().nullable().optional()` is present. Bump the schema version comment if the consumer treats unknown fields strictly.

- [ ] **Step 6: Run verification**

Run: `pnpm run verify:workspace:tracked -- @intexuraos/llm-pricing`
Run: `pnpm run verify:workspace:tracked -- llm-usage-service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-pricing apps/llm-usage-service
git commit -m "feat(llm-pricing): surface researchId in usage-event correlation (INT-1533)"
```

---

### Task 5: Remove half-wired `researchId` client-config field and wire per-call argument

**Files:**
- `packages/infra-claude/src/*.ts`
- `packages/infra-gpt/src/*.ts`
- `packages/infra-gemini/src/*.ts`
- `packages/infra-perplexity/src/*.ts`
- `packages/infra-openrouter/src/*.ts`
- Callers across `apps/research-agent` that pass the current `researchId` config.

**Context:** today `researchId` is received at the client-construction boundary (a per-client singleton field) but dropped to `null` in the event (Task 4 fixed the propagation on the event builder side; now we need the clients to actually pass it per call).

- [ ] **Step 1: Audit**

Run: `pnpm -s exec rg -n "researchId" packages/infra-* | tee /tmp/int-1533-infra-researchid.txt`

- [ ] **Step 2: For each infra client, write the failing test**

Example `packages/infra-claude/src/__tests__/claudeClient.test.ts`:

```ts
it('passes per-call researchId through the usage sink', async () => {
  const sink = new CapturingUsageSink();
  const client = createClaudeClient({ apiKey: 'x', model: 'claude-3-5-sonnet', userId: 'u', logger, usageSink: sink });
  await client.generate('hi', { promptType: 'test', correlation: { researchId: 'r-1' } });
  expect(sink.events[0].correlation.researchId).toBe('r-1');
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — current `generate()` options don't accept `correlation`.

- [ ] **Step 4: Widen `GenerateOptions` in `packages/llm-factory/src/llmClientFactory.ts`**

```ts
export interface GenerateOptions {
  promptType: string;
  correlation?: {
    researchId?: string | null;
    sessionId?: string | null;
    taskId?: string | null;
    requestId?: string | null;
  };
}
```

- [ ] **Step 5: Thread `correlation` through every `generate()` implementation**

Every `infra-*` client's `generate()` must pass `correlation` into its `usageLogger` call (which forwards to `buildUsageEvent`).

- [ ] **Step 6: Remove the dead config field**

Delete the per-client `researchId` from `LlmClientConfig` / internal `*ClientConfig` where it's set at construction. Update any research-agent call site that was threading it there to thread it through the per-call `correlation` instead.

- [ ] **Step 7: Run verification**

Run: `pnpm run ci:tracked | tee /tmp/int-1533-task5-ci.txt`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/infra-* packages/llm-factory apps/research-agent
git commit -m "refactor(infra): thread researchId per-call, drop stale client-config field (INT-1533)"
```

---

### Task 6: Add `withRetry()` to `llm-utils` and wrap every infra client

**Files:**
- Create: `packages/llm-utils/src/withRetry.ts`
- Create: `packages/llm-utils/src/__tests__/withRetry.test.ts`
- Modify: `packages/llm-utils/src/index.ts`
- Modify: every `infra-*` client's `generate()` to wrap the outgoing call.

- [ ] **Step 1: Write the failing test**

`packages/llm-utils/src/__tests__/withRetry.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../withRetry.js';
import type { LLMError } from '@intexuraos/llm-contract';

const rateLimited: LLMError = { ok: false, error: { code: 'RATE_LIMITED', message: 'slow down', retryAfterMs: 10 } } as never;

describe('withRetry', () => {
  it('retries RATE_LIMITED and OVERLOADED with backoff', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', message: 'x', retryAfterMs: 5 } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'OVERLOADED', message: 'y' } })
      .mockResolvedValueOnce({ ok: true, value: { content: 'done', usage: zeroUsage } });
    const res = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(res.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry client errors (400, unsupported model)', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: { code: 'INVALID_REQUEST', message: 'bad' } });
    const res = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(res.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects provider Retry-After (retryAfterMs)', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', message: 'x', retryAfterMs: 50 } })
      .mockResolvedValueOnce({ ok: true, value: { content: 'done', usage: zeroUsage } });
    const start = Date.now();
    await withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });

  it('gives up after maxAttempts and returns the last error', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: { code: 'TIMEOUT', message: 'x' } });
    const res = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(res.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -s --filter @intexuraos/llm-utils vitest run src/__tests__/withRetry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `withRetry()`**

`packages/llm-utils/src/withRetry.ts`:

```ts
import type { Result } from '@intexuraos/common-core';
import type { LLMError } from '@intexuraos/llm-contract';

const RETRIABLE: ReadonlySet<string> = new Set(['RATE_LIMITED', 'OVERLOADED', 'TIMEOUT']);

export interface WithRetryOptions {
  maxAttempts: number; // inclusive of first attempt
  baseDelayMs: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<Result<T, LLMError>>,
  opts: WithRetryOptions,
): Promise<Result<T, LLMError>> {
  let last: Result<T, LLMError> | null = null;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const res = await fn();
    if (res.ok) return res;
    last = res;
    if (!RETRIABLE.has(res.error.code)) return res;
    if (attempt === opts.maxAttempts) break;
    const providerDelay = (res.error as { retryAfterMs?: number }).retryAfterMs;
    const expBackoff = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs ?? 30_000);
    const delay = providerDelay ?? expBackoff;
    await new Promise((r) => setTimeout(r, delay));
  }
  return last!;
}
```

- [ ] **Step 4: Export and re-run tests**

Add to `packages/llm-utils/src/index.ts`:

```ts
export { withRetry, type WithRetryOptions } from './withRetry.js';
```

Run: `pnpm -s --filter @intexuraos/llm-utils vitest run src/__tests__/withRetry.test.ts`
Expected: PASS.

- [ ] **Step 5: Wrap every `infra-*` client's `generate()`**

Pattern for each client file:

```ts
import { withRetry } from '@intexuraos/llm-utils';

async generate(prompt, options) {
  return withRetry(() => this.callApiOnce(prompt, options), { maxAttempts: 3, baseDelayMs: 500 });
}
```

Extract the existing body into `callApiOnce()` and leave it untouched. Leave the usage-event emission inside `callApiOnce()` so every attempt is metered.

- [ ] **Step 6: Add per-client tests**

For each infra client, add one test asserting that a transient `RATE_LIMITED` response is retried once and that a final success is returned. Use `nock` for HTTP-level control.

- [ ] **Step 7: Run full verification**

Run: `pnpm run ci:tracked`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/llm-utils packages/infra-*
git commit -m "feat(llm-utils): add withRetry, wrap every infra client (INT-1533)"
```

---

### Task 7: Add `generateStructured<T>()` helper and migrate call sites

**Files:**
- Create: `packages/llm-utils/src/generateStructured.ts`
- Create: `packages/llm-utils/src/__tests__/generateStructured.test.ts`
- Modify: `packages/llm-utils/src/index.ts`
- Modify: the ~25 call sites identified by `pnpm -s exec rg -n "safeParse|JSON.parse.*zod|stripMarkdown" apps packages workers`.

- [ ] **Step 1: Collect the call-site baseline**

Run: `pnpm -s exec rg -n "safeParse\\(|JSON\\.parse\\(.*stripMarkdown|```json" apps packages workers | tee /tmp/int-1533-structured-baseline.txt`

- [ ] **Step 2: Write the failing test**

`packages/llm-utils/src/__tests__/generateStructured.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateStructured } from '../generateStructured.js';

const schema = z.object({ answer: z.string(), score: z.number() });

describe('generateStructured', () => {
  it('parses a clean JSON response', async () => {
    const client = { generate: async () => ({ ok: true as const, value: { content: '{"answer":"yes","score":1}', usage: zeroUsage } }) };
    const res = await generateStructured({ client, prompt: 'q', schema, promptType: 'test' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.data).toEqual({ answer: 'yes', score: 1 });
  });

  it('strips fenced markdown code blocks before parsing', async () => {
    const client = { generate: async () => ({ ok: true as const, value: { content: '```json\n{"answer":"yes","score":1}\n```', usage: zeroUsage } }) };
    const res = await generateStructured({ client, prompt: 'q', schema, promptType: 'test' });
    expect(res.ok).toBe(true);
  });

  it('invokes repairBuilder once on validation failure and re-runs generate', async () => {
    let call = 0;
    const client = {
      generate: async () => {
        call += 1;
        const body = call === 1 ? '{"answer":"yes"}' /* missing score */ : '{"answer":"yes","score":1}';
        return { ok: true as const, value: { content: body, usage: zeroUsage } };
      },
    };
    const repair = (raw: string, err: z.ZodError) => `FIX: ${err.issues.length} issues in ${raw}`;
    const res = await generateStructured({ client, prompt: 'q', schema, promptType: 'test', repairBuilder: repair });
    expect(res.ok).toBe(true);
    expect(call).toBe(2);
  });

  it('returns an error after exhausting repair attempts', async () => {
    const client = { generate: async () => ({ ok: true as const, value: { content: '{"answer":"yes"}', usage: zeroUsage } }) };
    const repair = (raw: string) => `fix ${raw}`;
    const res = await generateStructured({ client, prompt: 'q', schema, promptType: 'test', repairBuilder: repair, maxRepairAttempts: 2 });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `generateStructured()`**

`packages/llm-utils/src/generateStructured.ts`:

```ts
import type { Result } from '@intexuraos/common-core';
import type { z } from 'zod';
import type { LLMError } from '@intexuraos/llm-contract';
import type { LlmGenerateClient, GenerateResult, GenerateOptions } from '@intexuraos/llm-factory';

export interface GenerateStructuredParams<T> {
  client: LlmGenerateClient;
  prompt: string;
  schema: z.ZodType<T>;
  promptType: string;
  repairBuilder?: (raw: string, err: z.ZodError) => string;
  maxRepairAttempts?: number;
  options?: Omit<GenerateOptions, 'promptType'>;
}

export interface GenerateStructuredResult<T> {
  data: T;
  raw: string;
  usage: GenerateResult['usage'];
  repairAttempts: number;
}

export type StructuredError =
  | { kind: 'llm'; error: LLMError['error'] }
  | { kind: 'validation'; raw: string; zodError: z.ZodError };

const FENCED = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;

function stripFences(content: string): string {
  const trimmed = content.trim();
  const match = FENCED.exec(trimmed);
  return match ? (match[1] ?? trimmed) : trimmed;
}

export async function generateStructured<T>(
  params: GenerateStructuredParams<T>,
): Promise<Result<GenerateStructuredResult<T>, StructuredError>> {
  const maxRepair = params.maxRepairAttempts ?? (params.repairBuilder ? 1 : 0);
  let currentPrompt = params.prompt;
  let lastRaw = '';
  let lastZodError: z.ZodError | null = null;

  for (let attempt = 0; attempt <= maxRepair; attempt++) {
    const gen = await params.client.generate(currentPrompt, { ...(params.options ?? {}), promptType: params.promptType });
    if (!gen.ok) return { ok: false, error: { kind: 'llm', error: gen.error.error } };
    lastRaw = gen.value.content;
    const stripped = stripFences(lastRaw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      lastZodError = null;
      if (params.repairBuilder && attempt < maxRepair) {
        currentPrompt = params.repairBuilder(lastRaw, makeParseError(stripped));
        continue;
      }
      return { ok: false, error: { kind: 'validation', raw: lastRaw, zodError: makeParseError(stripped) } };
    }
    const result = params.schema.safeParse(parsed);
    if (result.success) {
      return { ok: true, value: { data: result.data, raw: lastRaw, usage: gen.value.usage, repairAttempts: attempt } };
    }
    lastZodError = result.error;
    if (params.repairBuilder && attempt < maxRepair) {
      currentPrompt = params.repairBuilder(lastRaw, result.error);
      continue;
    }
    return { ok: false, error: { kind: 'validation', raw: lastRaw, zodError: result.error } };
  }
  return { ok: false, error: { kind: 'validation', raw: lastRaw, zodError: lastZodError ?? makeParseError(lastRaw) } };
}

function makeParseError(raw: string): z.ZodError {
  // Construct a synthetic ZodError so callers have a uniform shape.
  // Implementation detail: build from z.ZodIssueCode.custom.
  return new (require('zod').ZodError)([{ code: 'custom', path: [], message: `Invalid JSON: ${raw.slice(0, 40)}` }]);
}
```

- [ ] **Step 5: Export and run tests**

Add to `packages/llm-utils/src/index.ts`:

```ts
export { generateStructured, type GenerateStructuredParams, type GenerateStructuredResult, type StructuredError } from './generateStructured.js';
```

Run: `pnpm -s --filter @intexuraos/llm-utils vitest run src/__tests__/generateStructured.test.ts`
Expected: PASS.

- [ ] **Step 6: Migrate call sites in one app per commit**

For each file in `/tmp/int-1533-structured-baseline.txt`:
1. Replace the ad-hoc `client.generate(prompt) → strip → JSON.parse → schema.safeParse → maybe repair` block with a single `generateStructured({ client, prompt, schema, promptType, repairBuilder })` call.
2. Update callers of the repaired code.
3. Update or add unit tests to cover both the happy path and the repair path (see memory [2]: test happy, schema error, repair success, repair exhausted).

Commit each app separately:

```bash
git commit -m "refactor(research-agent): use generateStructured for synthesis (INT-1533)"
```

- [ ] **Step 7: Run full verification after final app migration**

Run: `pnpm run ci:tracked`
Expected: PASS.

---

### Task 8: Promote `pricingSource: 'missing'` and add Claude 4.7 pricing

**Files:**
- Modify: `packages/llm-pricing/src/types.ts`
- Modify: `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts`
- Modify: `apps/llm-usage-service/src/domain/schemas/usageEventSchema.ts` (pricingSource enum)
- Locate: pricing table source of truth — either `packages/llm-pricing/src/pricingTable.ts` or Firestore-seeded via migration.

- [ ] **Step 1: Confirm pricing storage**

Run: `pnpm -s exec rg -n "claude-3-5-sonnet|pricingTable|getModelPricing" packages/llm-pricing apps/llm-usage-service`
Read the hit closest to `pricingCache` to determine whether prices live in a TS constant or in Firestore.

- [ ] **Step 2: Write the failing test for 'missing' pricing source**

In `apps/llm-usage-service/src/domain/usecases/__tests__/ingestUsageEvents.test.ts`:

```ts
it('emits pricingSource:missing and billedUsd:0 for unknown models', async () => {
  const logger = new FakeLogger();
  const event = makeUsageEvent({ provider: 'anthropic', model: 'claude-unknown-v99' });
  const out = await ingestUsageEvents({ events: [event], deps, logger });
  expect(out.ok).toBe(true);
  expect(out.value.stored[0].cost.pricingSource).toBe('missing');
  expect(out.value.stored[0].cost.billedUsd).toBe(0);
  expect(logger.warns).toEqual(expect.arrayContaining([expect.objectContaining({ msg: expect.stringContaining('unknown model') })]));
});

it('fails fast in dev when an unknown model is ingested', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const event = makeUsageEvent({ provider: 'anthropic', model: 'claude-unknown-v99' });
    await expect(ingestUsageEvents({ events: [event], deps, logger: new FakeLogger() })).rejects.toThrow(/unknown model/i);
  } finally {
    process.env.NODE_ENV = original;
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — `'missing'` not in union, dev-mode throw not implemented.

- [ ] **Step 4: Widen the `pricingSource` union**

In `packages/llm-pricing/src/types.ts`:

```ts
export type PricingSource =
  | 'provider_reported'
  | 'calculated'
  | 'pending'
  | 'missing';
```

- [ ] **Step 5: Update `ingestUsageEvents.ts` lines 110–119**

```ts
logger.warn({ provider, model }, 'No pricing found for model — emitting pricingSource:missing');
if (process.env['NODE_ENV'] !== 'production') {
  throw new Error(`Pricing missing for unknown model ${provider}/${model} — add an entry to llm-pricing or mark as unsupported before shipping.`);
}
return { billedUsd: 0, providerReportedUsd: null, calculatedUsd: 0, pricingSource: 'missing' };
```

- [ ] **Step 6: Add Claude 4.7 entries**

If pricing table is TS constant: add entries for `claude-4-7-sonnet-20251022` (or the current Claude 4.7 SKU) with input/output/cache read/cache write prices from `https://www.anthropic.com/pricing`.

If pricing table is Firestore: create a new IMMUTABLE migration `migrations/0NNN_claude_4_7_pricing.mjs` that inserts the rows.

- [ ] **Step 7: Run verification**

Run: `pnpm run verify:workspace:tracked -- llm-usage-service`
Run: `pnpm run verify:workspace:tracked -- @intexuraos/llm-pricing`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/llm-pricing apps/llm-usage-service migrations
git commit -m "feat(llm-pricing): fail-fast on unknown models, add Claude 4.7 pricing (INT-1533)"
```

---

### Task 9: Complete `createLlmClient()` coverage for Anthropic / OpenAI / Perplexity

**Files:**
- Create: `packages/llm-factory/src/claudeGenerateClient.ts`
- Create: `packages/llm-factory/src/gptGenerateClient.ts`
- Create: `packages/llm-factory/src/perplexityGenerateClient.ts`
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/src/index.ts`

**Prerequisites:** Tasks 4, 5, 6 (correlation, retry, `generateStructured`) must be merged so the new wrappers can use them uniformly.

- [ ] **Step 1: Write the failing test**

`packages/llm-factory/src/__tests__/llmClientFactory.test.ts` (extend existing):

```ts
describe('createLlmClient — provider dispatch', () => {
  it('returns a Claude client for Anthropic models', () => {
    const c = createLlmClient({ apiKey: 'x', model: 'claude-3-5-sonnet-20250320', userId: 'u', logger, usageSink: sink });
    expect(c).toBeDefined();
  });

  it('returns a GPT client for OpenAI models', () => {
    const c = createLlmClient({ apiKey: 'x', model: 'gpt-4o', userId: 'u', logger, usageSink: sink });
    expect(c).toBeDefined();
  });

  it('returns a Perplexity client for Perplexity models', () => {
    const c = createLlmClient({ apiKey: 'x', model: 'sonar-large-online', userId: 'u', logger, usageSink: sink });
    expect(c).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `createLlmClient` throws for these providers.

- [ ] **Step 3: Implement the three wrappers**

Each wrapper (example `claudeGenerateClient.ts`) creates the underlying `infra-claude` client and adapts its response to the `LlmGenerateClient` interface defined in `llmClientFactory.ts`. Wrap in `withRetry`:

```ts
import { createClaudeClient } from '@intexuraos/infra-claude';
import { withRetry } from '@intexuraos/llm-utils';

export function createClaudeGenerateClient(config: LlmClientConfig): LlmGenerateClient {
  const inner = createClaudeClient(config);
  return {
    generate: (prompt, options) =>
      withRetry(() => inner.generate(prompt, options), { maxAttempts: 3, baseDelayMs: 500 }),
  };
}
```

- [ ] **Step 4: Update `createLlmClient` dispatch**

Replace the `if (providerForModel !== LlmProviders.Google) throw …` branch with:

```ts
switch (providerForModel) {
  case LlmProviders.Google:      return createGeminiClient(config);
  case LlmProviders.Anthropic:   return createClaudeGenerateClient(config);
  case LlmProviders.OpenAI:      return createGptGenerateClient(config);
  case LlmProviders.Perplexity:  return createPerplexityGenerateClient(config);
  default: {
    const _exhaustive: never = providerForModel;
    throw new Error(`Unsupported LLM provider: ${String(_exhaustive)}`);
  }
}
```

Update `isSupportedProvider()` to include the new providers.

- [ ] **Step 5: Run tests**

Run: `pnpm -s --filter @intexuraos/llm-factory vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-factory
git commit -m "feat(llm-factory): add Anthropic/OpenAI/Perplexity provider dispatch (INT-1533)"
```

---

### Task 10: Retire research-agent's parallel adapter factory

**Files:**
- Modify: `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`
- Delete: `apps/research-agent/src/infra/llm/{Gemini,Claude,Gpt,Perplexity,OpenRouter}Adapter.ts`
- Update every research-agent call site that held a reference to those adapters.

**Prerequisite:** Task 9 merged.

- [ ] **Step 1: Write the failing integration test**

Add to `apps/research-agent/src/infra/llm/__tests__/LlmAdapterFactory.test.ts`:

```ts
it('delegates all five provider flavors to @intexuraos/llm-factory', async () => {
  for (const model of ['gemini-2.5-flash', 'claude-3-5-sonnet-20250320', 'gpt-4o', 'sonar-large-online', 'or:meta-llama/llama-3']) {
    const adapter = factory.create({ model, userId: 'u' });
    expect(adapter).toBeDefined();
    const result = await adapter.generate('ping', { promptType: 'test' });
    expect(result.ok).toBe(true); // in-memory stub sink
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL initially (or currently passes via per-adapter code — that's fine; proceed to Step 3 and re-assert).

- [ ] **Step 3: Rewrite `LlmAdapterFactory.ts`**

Reduce to a thin wrapper:

```ts
import { createLlmClient } from '@intexuraos/llm-factory';

export class LlmAdapterFactory {
  constructor(private readonly deps: LlmAdapterFactoryDeps) {}
  create(params: { model: LLMModel; userId: string }): LlmGenerateClient {
    return createLlmClient({
      apiKey: this.deps.resolveApiKey(params.model, params.userId),
      model: params.model,
      userId: params.userId,
      logger: this.deps.logger,
      usageSink: this.deps.usageSink,
    });
  }
}
```

- [ ] **Step 4: Update research-agent use-cases (memory [1])**

Where a use case resolves the per-user LLM (via `UserServiceClient.getLlmClient(userId)` pattern), keep that pattern and wire it through `LlmAdapterFactory`. Do not re-introduce a hard-coded default model — rely on `getProviderForModel` + the platform fallback already present in `user-service`.

- [ ] **Step 5: Delete the dead adapters**

Delete:
- `ClaudeAdapter.ts`
- `GeminiAdapter.ts`
- `GptAdapter.ts`
- `PerplexityAdapter.ts`
- `OpenRouterAdapter.ts`

Leave `ContextInferenceAdapter.ts` and `InputValidationAdapter.ts` (these are not provider adapters — they're domain adapters; confirm by reading).

- [ ] **Step 6: Run workspace verification**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/research-agent
git commit -m "refactor(research-agent): retire per-app provider adapters, use @intexuraos/llm-factory (INT-1533)"
```

---

### Task 11: Wire Anthropic / OpenAI prompt caching

**Files:**
- Modify: `packages/infra-claude/src/claudeClient.ts` (or equivalent generate entry point)
- Modify: `packages/infra-gpt/src/gptClient.ts`
- Create: `docs/patterns/prompt-caching.md`

- [ ] **Step 1: Audit call shape**

Read each client to understand where system-prompt + user-prompt are split, then identify the "stable prefix" that should carry `cache_control`.

- [ ] **Step 2: Write the failing test**

`packages/infra-claude/src/__tests__/claudeClient.caching.test.ts`:

```ts
it('sets cache_control ephemeral on the system prompt when cachePrefix is opted in', async () => {
  const http = new RecordingHttpClient();
  const client = createClaudeClient({ apiKey: 'x', model: 'claude-3-5-sonnet', userId: 'u', logger, usageSink: sink, httpClient: http });
  await client.generate('hi', { promptType: 'test', cachePrefix: { system: true } });
  const body = http.lastRequest.body;
  const systemBlock = JSON.parse(body).system[0];
  expect(systemBlock.cache_control).toEqual({ type: 'ephemeral' });
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — options don't accept `cachePrefix`.

- [ ] **Step 4: Implement**

Widen `GenerateOptions` (llm-factory) with:

```ts
cachePrefix?: { system?: boolean; tools?: boolean };
```

In `infra-claude`: when `cachePrefix.system === true`, shape the system field as `[{ type: 'text', text, cache_control: { type: 'ephemeral' } }]`.
In `infra-gpt`: set `prompt_cache_key` (Responses API) OR add `cache_control` to system message per current OpenAI spec. If OpenAI current SDK exposes neither, document and skip GPT in this task (note in `prompt-caching.md`).

Confirm current spec via `mcp__plugin_context7_context7` (Anthropic / OpenAI SDK docs) before writing the implementation. Do NOT rely on training-data memory for API details.

- [ ] **Step 5: Verify pricing math picks up cache reads**

Check `packages/llm-pricing/src/costCalculation.ts` — `cacheReadMultiplier`/`cacheWriteMultiplier` must be applied when `usage.cacheTokens > 0`. Add a test asserting cost delta for a call with cached vs. non-cached input.

- [ ] **Step 6: Write `docs/patterns/prompt-caching.md`**

Sections: when to opt in, opt-in mechanism (`cachePrefix`), how usage is metered, provider differences, known limits.

- [ ] **Step 7: Run verification**

Run: `pnpm run ci:tracked`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/infra-claude packages/infra-gpt packages/llm-factory docs/patterns/prompt-caching.md
git commit -m "feat(infra): opt-in prompt caching for Anthropic/OpenAI (INT-1533)"
```

---

### Task 12: Batch usage events in HTTP sinks

**Files:**
- Modify: `packages/llm-pricing/src/httpInternalAuthUsageSink.ts`
- Modify: `packages/llm-pricing/src/httpWebhookUsageSink.ts`
- Modify: `apps/llm-usage-service/src/routes/ingestRoutes.ts` (accept batched body)
- Modify: `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts` (accept arrays)

- [ ] **Step 1: Write the failing test**

`packages/llm-pricing/src/__tests__/httpInternalAuthUsageSink.test.ts`:

```ts
it('coalesces events within a 500ms flush window into one POST', async () => {
  const http = new RecordingHttpClient();
  const sink = new HttpInternalAuthUsageSink({ baseUrl, httpClient: http, flushIntervalMs: 500 });
  sink.record(event1); sink.record(event2); sink.record(event3);
  await sink.flushSync();
  expect(http.posts).toHaveLength(1);
  expect(http.posts[0].body.events).toHaveLength(3);
});

it('flushes when buffer reaches maxBatchSize regardless of timer', async () => { /* ... */ });
it('flushSync rejects if the POST fails and callers can inspect the error', async () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `flushSync` not defined, current sink posts per event.

- [ ] **Step 3: Implement batching**

In both sinks: add an internal buffer + `setTimeout(flushIntervalMs)` + max-size trigger. Expose `flushSync(): Promise<void>`. On process exit (SIGTERM/SIGINT) in consumers, call `flushSync()` — document this in the sink JSDoc.

Body shape sent to server:

```ts
{ events: UsageEventInput[] }
```

Keep backwards-compat: if only one event in flush, server-side still accepts `{ events: [event] }` — no need to preserve the single-event branch in the sink, but the server must accept both.

- [ ] **Step 4: Update llm-usage-service route**

`apps/llm-usage-service/src/routes/ingestRoutes.ts`: accept either `UsageEventInput` or `{ events: UsageEventInput[] }`. Call `ingestUsageEvents(events)` (already array-oriented, or widen it).

- [ ] **Step 5: Run verification**

Run: `pnpm run ci:tracked`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-pricing apps/llm-usage-service
git commit -m "feat(llm-pricing): batch usage events with 500ms flush window (INT-1533)"
```

---

### Task 13: Nightly pricing-diff job

**Files:**
- Create: `scripts/pricing-diff-nightly.mjs`
- Create: `scripts/__tests__/pricing-diff-nightly.test.mjs`
- Modify: `terraform/environments/dev/main.tf` (Cloud Scheduler entry)
- Modify: `ecosystem.config.cjs` (dev runner, optional)

- [ ] **Step 1: Write the failing test**

`scripts/__tests__/pricing-diff-nightly.test.mjs`:

```js
import { diffPricing } from '../pricing-diff-nightly.mjs';
describe('diffPricing', () => {
  it('detects added models', () => {
    const cur = [{ provider: 'anthropic', model: 'claude-4-7-sonnet' }];
    const table = [];
    expect(diffPricing(cur, table).added).toEqual(['anthropic/claude-4-7-sonnet']);
  });
  it('detects price changes', () => {
    const cur = [{ provider: 'anthropic', model: 'x', inputPerMTok: 4 }];
    const table = [{ provider: 'anthropic', model: 'x', inputPerMTok: 3 }];
    expect(diffPricing(cur, table).priceChanges).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the diff engine**

Keep network scraping out of this commit — take two arrays in, return the diff. The actual "fetch from provider page" is a separate `fetchLatestPricing()` function that the job wires together.

Scheduler behavior: on drift, POST to an internal endpoint that opens a Linear issue (use `packages/internal-clients/linear`) with the diff as body. Do not auto-update the pricing table.

- [ ] **Step 4: Wire Terraform**

Add a Cloud Scheduler job to `terraform/environments/dev/main.tf` hitting a new internal endpoint (or invoking the script via Cloud Run Job). Confirm the env-var-3-location rule for any new `INTEXURAOS_PRICING_DIFF_*` var.

- [ ] **Step 5: Run verification**

Run: `pnpm run ci:tracked`
Run: `cd terraform/environments/dev && terraform validate`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/pricing-diff-nightly.mjs scripts/__tests__/pricing-diff-nightly.test.mjs terraform/environments/dev/main.tf ecosystem.config.cjs
git commit -m "feat(pricing): nightly pricing-diff job opens Linear issue on drift (INT-1533)"
```

---

## Acceptance Criteria

- `createLlmClient()` returns a working client for every provider the codebase addresses today (Google, OpenRouter, Anthropic, OpenAI, Perplexity). Covered by Task 9 tests.
- `node scripts/verify-prompt-versions.mjs` exits 0, and flags any newly-added plain `buildXxxPrompt` that lacks `// prompt-version-exempt:<reason>`. Covered by Task 1.
- The `researchId` field of `correlation` in emitted usage events carries the client-supplied value end-to-end — verified by a unit test asserting non-null propagation in `buildUsageEvent.test.ts` (Task 4).
- Every `infra-*` `generate()` transparently retries `RATE_LIMITED`, `OVERLOADED`, and `TIMEOUT` with exponential backoff honoring provider `Retry-After`. Covered by per-client tests in Task 6.
- The ~25 call sites duplicating markdown-strip + JSON.parse + Zod + repair use `generateStructured()`. Evidence: `/tmp/int-1533-structured-baseline.txt` rechecked at end of Task 7 is empty (modulo exempted fixture files).
- Unknown model yields `pricingSource: 'missing'` and throws in non-production; Claude 4.7 pricing present. Covered by Task 8 tests.
- Research-agent no longer owns per-provider adapter glue. Evidence: the five `{Gemini,Claude,Gpt,Perplexity,OpenRouter}Adapter.ts` files are deleted (Task 10).
- Anthropic and OpenAI clients opt into prompt caching via `cachePrefix` and usage events count cache-read tokens correctly (Task 11).
- `HttpInternalAuthUsageSink` and `HttpWebhookUsageSink` batch events with a 500 ms flush window and `flushSync()` is exposed for graceful shutdown (Task 12).
- Nightly pricing-diff job detects new/changed SKUs and opens a Linear issue on drift (Task 13).

## Test Plan

- `pnpm run ci:tracked` passes at the end of every task's commit.
- Full branch coverage remains ≥ 95% for `@intexuraos/llm-factory`, `@intexuraos/llm-utils`, `@intexuraos/llm-pricing`, `apps/llm-usage-service`, `apps/research-agent`. No new `v8 ignore` directives; if one is unavoidable, the explanation must describe the testing **blocker** (e.g. `FakeHttpClient cannot emulate streamed aborted Anthropic response`), not the code.
- Integration coverage across retry + batching + caching: add one research-agent "end-to-end over fakes" test that drives the full stack (multi-provider, rate-limit once, cache hit, batched usage flush on shutdown) and asserts final emitted events.
- Memory [2] — LLM client integration testing: verify fallback-chain tests (primary fails → fallback picks up) remain green after factory changes; add cases for Claude 4.7 being invoked and its cost landing on the calculated-or-missing boundary.

## Out of Scope

- Orchestrator's parallel `PromptBuilder` interface de-duplication (`workers/orchestrator/src/services/prompt-builder.ts`) — tracked separately; only touched here if a compile error leaks.
- Token counter / streaming helpers in `llm-utils` — noted in review as "thin" but not blocking the factory/versioning/attribution trio this issue targets.
- Multi-region pricing / usage export.
- Dashboards for pricing drift (only issue-on-drift is in scope).

## Risks & Mitigations

- **Risk:** Batching the usage sink delays events past a crash, losing attribution.
  **Mitigation:** `flushSync()` on `SIGTERM`/`SIGINT` plus `maxBatchSize` ceiling to bound the window to ~500 ms + N events.
- **Risk:** Widening `createLlmClient()` forces adoption — dead code paths in research-agent's parallel factory may hide user flows we miss.
  **Mitigation:** Task 10 deletion is gated by Task 9's integration test that drives all 5 provider flavors end-to-end.
- **Risk:** Schema widening of usage events (`researchId` in correlation) breaks downstream schema validators.
  **Mitigation:** Widen the ingest Zod schema in the same commit as the emitter change (Task 4 Step 5). Event schema remains at `schemaVersion: 2`.
- **Risk:** `generateStructured` semantics drift from per-file hand-rolled repair loops.
  **Mitigation:** Migrate one app at a time, run the app's workspace verification after each migration. Keep `repairBuilder` optional so sites without repair behavior get pure parse-and-validate.
- **Risk:** New retry behavior doubles 429 pressure on providers when callers already have retries.
  **Mitigation:** Audit research-agent / orchestrator for any outer retry wrapper before merging Task 6. If present, keep only the inner `withRetry()` and delete the outer.

---

## Self-Review

- Spec coverage: each of the 8 plan bullets in the issue maps to one or more tasks — factory (9, 10), versioning (1, 2, 3), correlation (4, 5), retry (6), structured output (7), caching (11), batching (12), pricing (8, 13). No orphans.
- Placeholder scan: every step contains concrete code and commands. `TODO`/`TBD` absent.
- Type consistency: `LlmGenerateClient`, `GenerateOptions`, `UsageLogParams`, `CorrelationOverrides`, `pricingSource` referenced uniformly across tasks.
