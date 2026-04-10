# INT-1341 — Track 2: Wire Orchestrator to llm-usage-service

## Status

- Linear issue: INT-1341
- Parent epic: INT-1338 (LLM Usage Service Phase 2)
- Dependencies: **INT-1339 (Track 4 — server-side cost calculation)** — MUST be merged and deployed to dev before flipping the feature flag on.
- Blocks: INT-1342 (Track 3 — shares the HMAC webhook HTTP client pattern this track establishes)
- Plan version: 1.0
- Author: Claude (agent thread)
- Target file: `workers/orchestrator/src/services/usage-publisher.ts` (new) and small edits to `turn-metrics-collector.ts` + `start.ts`.

---

## Executive summary

The orchestrator already parses on-disk Claude Code session JSONL files after every turn to produce
summed-per-turn resource metrics and posts them to `code-agent/internal/turn-metrics`. The per-call
token usage is aggregated away in that pipeline; nothing is sent to `llm-usage-service`. This track
adds a parallel code path that extracts the **same** JSONL entries and emits **one
`UsageEventInput` per entry containing `message.usage`** (preserving per-call granularity), batches
them into a single HTTP POST to `llm-usage-service/internal/webhooks/usage-events`, and reuses the
existing `WebhookClient` for HMAC signing, retries, and the pending-queue failover.

Two design points distinguish this from a naive implementation:

1. **No orchestrator-side pricing.** Events are emitted with `cost.billedUsd = 0`,
   `cost.providerReportedUsd = null`, `cost.calculatedUsd = null`, `cost.pricingSource =
   'calculated'`. The service (INT-1339) computes the cost server-side from its pricing table.
   This is why this track is blocked on Track 4.
2. **Deterministic event IDs.** The same JSONL file is re-read on retry (e.g., adoption) so events
   must be idempotent: `eventId = sha256("${taskId}:${attempt}:${entryIndex}:${timestamp}").slice(0, 24)`.

The orchestrator is **not** containerized and **not** managed by Terraform — it runs as a systemd
unit on home-dev and a LaunchAgent on macOS hosts. Env var plumbing therefore touches `start.ts`
REQUIRED_ENV, the host `.envrc`, and (for future Cloud Run deployment parity) the dev Terraform
`common_service_env_vars` block. There is **no ecosystem.config.cjs entry to update** — the
orchestrator is absent from that file (confirmed by grep).

---

## Pre-flight checks

Run these **before** opening a PR branch. Each item is a hard blocker.

1. **Verify INT-1339 is deployed to dev.**
   ```bash
   curl -s https://<dev-llm-usage-service-url>/internal/pricing \
     -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
     | jq '.data | keys'
   ```
   Must return a non-empty object with at least `claude-sonnet-4-5-20250929` and
   `claude-opus-4-5-20251101`. If it returns `404` or empty, stop — Track 4 is not ready.

2. **Verify the `/internal/webhooks/usage-events` endpoint is live in dev.** POST an empty events
   array with a valid HMAC and expect `200 {success: true, data: {accepted: 0, duplicates: 0,
   rejected: []}}`. If you get `401`, the `INTEXURAOS_ORCHESTRATOR_SECRET` on the orchestrator and
   the llm-usage-service do not match — fix that before proceeding.

3. **Read an actual JSONL session file from a recent dev task** (see Phase 1 for the exact
   mechanics). This verifies the `message.model` location hypothesis. **Do not skip this step** —
   it is the single highest-risk unknown in this plan.

4. **Confirm `pnpm run ci:tracked` currently passes on `development`.** You are about to add a
   new service that imports from `@intexuraos/llm-contract` — any pre-existing green baseline
   makes diagnosing new failures trivial.

5. **Locate the orchestrator's runtime environment file.** On home-dev this is typically
   `~/.code-orchestrator/.envrc` or loaded via `direnv allow` on the repo root `.envrc`. Confirm
   with `systemctl show --no-pager -p Environment code-orchestrator` (or the LaunchAgent plist on
   macOS). You need write access before Phase 8 can complete.

---

## Context files (with line numbers)

**Source files to modify:**

- `workers/orchestrator/src/services/turn-metrics-collector.ts` (360 lines)
  - Lines 41–53: `SessionEntry` interface — needs an optional `message.model` field after Phase 1.
  - Lines 201–229: `parseSessionJsonl` — already reads all entries; no change needed, but the
    extraction function will consume the same `entries` array in a sibling method.
  - Lines 305–330: `aggregateTokens` — **do not modify**; the new `extractUsageEvents` function
    runs in parallel and operates on the same input.
  - Lines 77–152: `collectAndPublish` — this is where the new `UsagePublisher.publishTurnUsage()`
    call is wired in, right after the existing `publish(metrics)` call at line 133.
  - Lines 146–151: the exact `try/catch` swallow-and-warn pattern to mirror for non-fatal failures.

- `workers/orchestrator/src/services/webhook-client.ts` (274 lines)
  - Lines 24–27: `signPayload()` — matches exactly the HMAC format validated at
    `apps/llm-usage-service/src/infra/webhookValidation.ts:60` (`timestamp.body` HMAC-SHA256 hex).
  - Lines 29–107: `WebhookClient.send()` — **reuse directly**; has retries, 4xx short-circuit,
    pending-queue failover, Result<void, WebhookError> return type.
  - Lines 183–219: `deliver()` — already sets `X-Internal-Auth`, `X-Request-Timestamp`,
    `X-Request-Signature` headers exactly as the service expects.

- `workers/orchestrator/src/services/isolation/types.ts` (249 lines)
  - Lines 25, 41–107: `WORKER_TYPES` — source of truth for provider mapping. Contains 11 worker
    types. Note `glm`/`qwen`/`kimi` all share the same DashScope base URL but different models.

- `workers/orchestrator/src/start.ts` (863 lines)
  - Lines 441–456: REQUIRED_ENV block — add `INTEXURAOS_LLM_USAGE_SERVICE_URL`.
  - Lines 750–759: `TurnMetricsCollector` construction site — inject the new `UsagePublisher`
    either as a sibling service passed to the collector, or as a field on
    `TurnMetricsCollectorConfig`. **Decision: inject as constructor arg #3 on
    `TurnMetricsCollector`.** See Phase 6.

- `workers/orchestrator/src/main.ts` — no changes needed (wiring happens in `start.ts` only).

**Files to read but not modify:**

- `workers/orchestrator/src/services/runtime/processors/claude-log-processor.ts` (191 lines) —
  **confirmed wrong hook point**. It only processes the stream-JSON format which contains `type:
  system/subtype: init` messages with model name, plus `type: result` messages. It has **no**
  access to `message.usage` per-call data, which lives only in the on-disk JSONL. Stay in
  `turn-metrics-collector.ts`.

- `workers/orchestrator/src/services/isolation/docker-provider.ts` (1679 lines)
  - Line 135, 439, 624–716: shows how `workerType` is passed into the container and how
    `ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL` are set. The orchestrator knows the worker type at
    task dispatch time; `TurnMetricsCollector.collectAndPublish` receives `taskId`/`attempt` but
    **not** `workerType`. Phase 7 must add `workerType` to the `collectAndPublish` params.

- `workers/orchestrator/src/types/task.ts` (157 lines) — `Task.workerType: WorkerType` is the
  field to plumb through.

- `apps/llm-usage-service/src/routes/schemas/usageEventSchema.ts` (207 lines)
  - Lines 16–164: **strict** base schema with `additionalProperties: false` at every level.
  - Lines 176–194: `OrchestratorUsageEventInput` — requires `source.service === 'orchestrator'`
    and `source.workerLocation` (non-empty string).
  - Lines 107–117: `usage` object requires **all 11 fields** including ones we cannot populate
    from JSONL (`reasoningTokens`, `thinkingTokens`, `webSearchCalls`, `groundingEnabled`,
    `imageCount`). These all become `0`/`false`.
  - Lines 136–147: `correlation` requires **all 6 fields** with `null` as the default for
    `requestId`, `traceId`, `researchId`, `sessionId`. We populate `taskId` and `attempt`.

- `apps/llm-usage-service/src/routes/webhookUsageRoutes.ts` (88 lines)
  - Line 79: ingress tag is `'orchestrator_webhook'` (hardcoded by the route) — we cannot set it
    from the orchestrator side, and we don't need to.

- `apps/llm-usage-service/src/infra/webhookValidation.ts` (78 lines)
  - Line 48: **15-minute replay window** — our signature's timestamp must be within 15 minutes
    of the service's clock. `WebhookClient.deliver()` already generates the timestamp at send
    time, so this is fine unless pending-queue retries sit longer than 15 minutes. See Risks.

- `packages/internal-clients/src/usage-service/types.ts` (182 lines) — the `UsageEventInput`
  type we build is exactly this type. Do **not** use `UsageServiceClient.ingestEvents()` — that
  client targets the `/internal/usage/events` route (without the `webhooks/` prefix) which uses
  a different auth scheme (`X-Internal-Auth` only, no HMAC). This track uses the HMAC-signed
  webhook path directly.

- `packages/llm-contract/src/supportedModels.ts:133–139` — `LlmProviders` constants. Note:
  `'google'`, `'openai'`, `'anthropic'`, `'perplexity'`, `'openrouter'`. **There is no `'zai'`,
  `'dashscope'`, `'minimax'`, `'mimo'`, or `'xiaomi'` provider.** The schema will reject
  anything else. Phase 5 handles mapping these to the closest allowed value.

- `workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts` (723 lines) — existing
  test patterns. Uses `vi.mock('node:fs/promises')` + inline JSONL string fixtures. This plan
  keeps the same pattern and adds a separate `describe('extractUsageEvents')` block plus a
  new `describe('UsagePublisher')` block in a new test file.

- `terraform/environments/dev/main.tf:310` — `INTEXURAOS_LLM_USAGE_SERVICE_URL` already defined
  in `common_service_env_vars` for Cloud Run services. Orchestrator is not Cloud Run, so this
  block **does not apply to it at runtime**, but the plan must still document where the URL
  originates for future hosted orchestrator deployment. See Phase 8 for the specific three-place
  plumbing this orchestrator needs (which is different from the standard apps three-place
  pattern).

- `ecosystem.config.cjs` — **confirmed absent**: grep for `orchestrator` returns no matches.
  PM2 does not run the orchestrator. **Skip this file in Phase 8.**

---

## Endpoint changes

### Modified
- None. No existing endpoint is altered.

### Created
- None. The orchestrator gains no new incoming routes.

### Outgoing HTTP (new)
- `POST <INTEXURAOS_LLM_USAGE_SERVICE_URL>/internal/webhooks/usage-events`
  - Auth: HMAC-SHA256 over `${timestamp}.${rawJsonBody}` using
    `INTEXURAOS_ORCHESTRATOR_SECRET`, plus the existing `X-Internal-Auth` bearer.
  - Body: `{ schemaVersion: 1, events: UsageEventInput[] }`.
  - Retries: 3 attempts, 5s/15s/45s backoff (inherited from `WebhookClient`).
  - On 4xx: no retry, dropped with `warn` log (matches existing `WebhookClient` behavior).
  - On 5xx/network/timeout: queued into `pendingWebhooks` state file for background retry.

### Removed
- None. The existing `POST /internal/turn-metrics` on `code-agent` is **kept as-is**; both
  posts happen on every turn. No cleanup is part of this track.

### Unchanged
- `POST <codeAgentUrl>/internal/turn-metrics` — still populated from `aggregateTokens()` summed
  data, still using the same HMAC pattern.

---

## Step-by-step implementation

### Phase 1 — Verify JSONL shape (DO NOT SKIP)

This is the single highest-risk unknown. The `SessionEntry` interface declares no `message.model`
field, but the Anthropic SDK format typically includes it. Before writing any code, confirm the
exact JSON path.

**Steps:**

1. SSH to home-dev (or the dev host running the orchestrator).
2. Find a recent Claude session directory:
   ```bash
   ls -lt ~/.code-orchestrator/secrets/claude-session-* | head -5
   ```
3. Pick the most recent task that ran successfully and print one assistant entry:
   ```bash
   SESSION=~/.code-orchestrator/secrets/claude-session-task_<id>
   find "$SESSION/projects" -name '*.jsonl' | head -1 \
     | xargs -I{} head -100 {} \
     | jq -c 'select(.message.usage != null) | {type, timestamp, model: .message.model, model_alt: .message.metadata.model, usage: .message.usage}' \
     | head -5
   ```
4. Record the findings in the PR description under a "JSONL shape verification" heading:
   - Is `message.model` present? (Almost certainly **yes** — confirmed by
     `claude-log-processor.ts:37` which extracts `model` from the stream init message.)
   - Is `message.id` (Anthropic request ID) present? If so, we can use it as a more stable
     `eventId` ingredient.
   - Is `message.stop_reason` present? Useful for `operation` classification later.
   - Are there user entries (`type: "user"`) that also have `message.usage`? (Possible for tool
     results that include cache hits.)
   - Does GLM produce the same shape, or does it have provider-specific fields? (Verify by
     submitting a trivial GLM task first.)

5. **⚠ DECISION NEEDED:** if `message.model` is **missing** from JSONL (unlikely but possible if
   `ANTHROPIC_MODEL=opus` override changes the format), fall back to
   `WORKER_TYPES[workerType].model ?? 'unknown'` as the model name. Document the fallback in the
   PR body so reviewers know why the model string may be coarser than expected.

6. **⚠ DECISION NEEDED:** if GLM's JSONL deviates in structure (e.g., nested differently under
   `message.raw_response`), the `extractUsageEvents` function must branch on `workerType` or
   operate on a provider-specific normalizer. Prefer branching on `workerType` over sniffing the
   JSON shape.

Do not proceed to Phase 2 until these decisions are logged in the PR description.

### Phase 2 — Extend SessionEntry type

Given Phase 1 confirms `message.model` exists, extend the interface in
`workers/orchestrator/src/services/turn-metrics-collector.ts`:

```ts
interface SessionEntry {
  type: string;
  timestamp?: string;
  subtype?: string;
  message?: {
    id?: string;            // Anthropic request ID if present
    model?: string;         // Model name, e.g. "claude-sonnet-4-5-20250929"
    stop_reason?: string;   // "end_turn" | "tool_use" | "max_tokens" | ...
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}
```

Leave all existing consumers untouched — the added fields are optional so
`classifyTime` and `aggregateTokens` compile without change.

### Phase 3 — Write failing tests FIRST (test-driven)

#### 3a. Create the fixture directory

Check if `workers/orchestrator/src/__tests__/fixtures/` exists. If not, create it with one file:

**Path:** `workers/orchestrator/src/__tests__/fixtures/session-jsonl-sample.jsonl`

**Content:** a realistic two-call sample matching the shape confirmed in Phase 1. Example
(sanitized; update after Phase 1 verification):

```jsonl
{"type":"user","timestamp":"2026-04-10T12:00:00.000Z","message":{"role":"user","content":"ping"}}
{"type":"assistant","timestamp":"2026-04-10T12:00:02.500Z","message":{"id":"msg_01abc","model":"claude-sonnet-4-5-20250929","stop_reason":"end_turn","usage":{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}}
{"type":"user","timestamp":"2026-04-10T12:00:03.000Z","message":{"role":"user","content":"follow up"}}
{"type":"assistant","timestamp":"2026-04-10T12:00:05.100Z","message":{"id":"msg_02def","model":"claude-sonnet-4-5-20250929","stop_reason":"tool_use","usage":{"input_tokens":85,"output_tokens":12,"cache_read_input_tokens":1100,"cache_creation_input_tokens":0}}}
```

#### 3b. Add tests to the existing `turn-metrics-collector.test.ts` file

New top-level `describe` block to add (near the end of the file, before the closing `});`):

```ts
describe('extractUsageEvents', () => {
  const taskId = 'task_test_123';
  const attempt = 1;
  const workerLocation = 'home-dev';
  const environment = 'dev' as const;

  it('emits one event per entry with message.usage', () => {
    const entries = [
      { type: 'user', timestamp: '2026-04-10T12:00:00.000Z' },
      {
        type: 'assistant',
        timestamp: '2026-04-10T12:00:02.500Z',
        message: {
          id: 'msg_01',
          model: 'claude-sonnet-4-5-20250929',
          usage: {
            input_tokens: 120,
            output_tokens: 45,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 200,
          },
        },
      },
    ];

    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'opus', workerLocation, environment,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.usage.inputTokens).toBe(120);
    expect(events[0]?.usage.outputTokens).toBe(45);
    expect(events[0]?.usage.cacheReadTokens).toBe(1000);
    expect(events[0]?.usage.cacheWriteTokens).toBe(200);
    expect(events[0]?.usage.totalTokens).toBe(120 + 45 + 1000 + 200);
    expect(events[0]?.request.provider).toBe('anthropic');
    expect(events[0]?.request.model).toBe('claude-sonnet-4-5-20250929');
    expect(events[0]?.request.operation).toBe('other');
    expect(events[0]?.cost.billedUsd).toBe(0);
    expect(events[0]?.cost.pricingSource).toBe('calculated');
    expect(events[0]?.source.service).toBe('orchestrator');
    expect(events[0]?.source.workerLocation).toBe('home-dev');
    expect(events[0]?.correlation.taskId).toBe(taskId);
    expect(events[0]?.correlation.attempt).toBe(attempt);
  });

  it('skips entries without message.usage', () => {
    const entries = [
      { type: 'user', timestamp: '2026-04-10T12:00:00.000Z' },
      { type: 'system', subtype: 'progress', timestamp: '2026-04-10T12:00:01.000Z' },
    ];
    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'opus', workerLocation, environment,
    });
    expect(events).toHaveLength(0);
  });

  it('handles missing cache tokens as zero', () => {
    const entries = [{
      type: 'assistant',
      timestamp: '2026-04-10T12:00:02.500Z',
      message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 50, output_tokens: 25 } },
    }];
    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'opus', workerLocation, environment,
    });
    expect(events[0]?.usage.cacheReadTokens).toBe(0);
    expect(events[0]?.usage.cacheWriteTokens).toBe(0);
    expect(events[0]?.usage.totalTokens).toBe(75);
  });

  it('falls back to workerType model when message.model missing', () => {
    const entries = [{
      type: 'assistant',
      timestamp: '2026-04-10T12:00:02.500Z',
      message: { usage: { input_tokens: 10, output_tokens: 5 } },
    }];
    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'glm', workerLocation, environment,
    });
    expect(events[0]?.request.model).toBe('glm-5'); // WORKER_TYPES.glm.model
  });

  it('falls back to "unknown" when neither message.model nor WORKER_TYPES model is set', () => {
    const entries = [{
      type: 'assistant',
      timestamp: '2026-04-10T12:00:02.500Z',
      message: { usage: { input_tokens: 10, output_tokens: 5 } },
    }];
    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'auto', workerLocation, environment,
    });
    // WORKER_TYPES.auto.model is undefined
    expect(events[0]?.request.model).toBe('unknown');
  });

  it('uses occurredAt = entry.timestamp when present', () => {
    const entries = [{
      type: 'assistant',
      timestamp: '2026-04-10T12:00:02.500Z',
      message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 1, output_tokens: 1 } },
    }];
    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'opus', workerLocation, environment,
    });
    expect(events[0]?.occurredAt).toBe('2026-04-10T12:00:02.500Z');
  });

  it('falls back to now() when entry.timestamp missing', () => {
    const before = new Date().toISOString();
    const entries = [{
      type: 'assistant',
      message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 1, output_tokens: 1 } },
    }];
    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'opus', workerLocation, environment,
    });
    const after = new Date().toISOString();
    expect(events[0]?.occurredAt >= before).toBe(true);
    expect(events[0]?.occurredAt <= after).toBe(true);
  });

  it('produces deterministic eventId for the same entry', () => {
    const entries = [{
      type: 'assistant',
      timestamp: '2026-04-10T12:00:02.500Z',
      message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 1, output_tokens: 1 } },
    }];
    const a = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'opus', workerLocation, environment,
    });
    const b = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'opus', workerLocation, environment,
    });
    expect(a[0]?.eventId).toBe(b[0]?.eventId);
  });

  it('produces different eventIds for different entries in the same turn', () => {
    const entries = [
      {
        type: 'assistant',
        timestamp: '2026-04-10T12:00:02.500Z',
        message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 1, output_tokens: 1 } },
      },
      {
        type: 'assistant',
        timestamp: '2026-04-10T12:00:05.100Z',
        message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 2, output_tokens: 2 } },
      },
    ];
    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType: 'opus', workerLocation, environment,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.eventId).not.toBe(events[1]?.eventId);
  });

  it.each([
    ['opus', 'anthropic'],
    ['auto', 'anthropic'],
    ['sonnet', 'anthropic'],
    ['minimax', 'anthropic'],    // see DECISION NEEDED below
    ['mimo-pro', 'anthropic'],
    ['glm', 'anthropic'],
    ['qwen', 'anthropic'],
    ['kimi', 'anthropic'],
    ['openrouter-free', 'openrouter'],
  ] as const)('maps worker type %s to provider %s', (workerType, expectedProvider) => {
    const entries = [{
      type: 'assistant',
      timestamp: '2026-04-10T12:00:02.500Z',
      message: { model: 'm', usage: { input_tokens: 1, output_tokens: 1 } },
    }];
    const events = collector.extractUsageEvents(entries, {
      taskId, attempt, workerType, workerLocation, environment,
    });
    expect(events[0]?.request.provider).toBe(expectedProvider);
  });
});
```

> ⚠ DECISION NEEDED (resolved provisionally above): the llm-usage-service schema hardcodes
> `PROVIDER_VALUES = Object.values(LlmProviders)` which contains only
> `google|openai|anthropic|perplexity|openrouter`. There is no provider name that matches GLM,
> Qwen, Kimi, MiniMax, or MiMo. **Provisional decision: map all Anthropic-compatible proxy
> providers (i.e., any `WORKER_TYPES[*].apiBaseUrl` that exposes the `/v1/messages` endpoint) to
> `'anthropic'`**, because the JSONL format and model names are Anthropic-shaped. The service's
> pricing table will need entries for these model names (`glm-5`, `qwen3.5-plus`, `kimi-k2.5`,
> `MiniMax-M2.7`, `mimo-v2-pro`) tagged under provider `anthropic`, or fall back to
> `pricingSource: 'external'` with `billedUsd = 0`. **Confirm with the INT-1339 author before
> merging.** If the pricing service needs distinct providers, an INT-1338-followup must extend
> `LlmProviders` first.
>
> Codex worker type (`codex`, `codex-xhigh`) is **skipped** by this extractor — Codex uses a
> different runtime (`runtime: 'codex'`) that does not write the Claude JSONL format.
> `extractUsageEvents` should return `[]` for Codex worker types and log an info message at the
> call site. Add a test:
>
> ```ts
> it('returns empty array for codex worker type', () => {
>   const events = collector.extractUsageEvents(entries, { ...base, workerType: 'codex' });
>   expect(events).toEqual([]);
> });
> ```

Run `pnpm --filter orchestrator test` — **all new tests must fail with "extractUsageEvents is
not a function"** before you move to Phase 4.

### Phase 4 — Implement `extractUsageEvents`

Add a new public method on `TurnMetricsCollector` (in
`turn-metrics-collector.ts`). Import the `UsageEventInput` type, the `LlmProviders` constant,
and the `WORKER_TYPES` lookup.

```ts
import { createHash, createHmac } from 'node:crypto';
import type { UsageEventInput } from '@intexuraos/internal-clients/usage-service';
import { LlmProviders, type LlmProvider } from '@intexuraos/llm-contract';
import { WORKER_TYPES, type WorkerType } from './isolation/types.js';

export interface ExtractUsageEventsParams {
  taskId: string;
  attempt: number;
  workerType: WorkerType;
  workerLocation: string;
  environment: 'dev' | 'prod' | 'test';
}

/**
 * Extract one UsageEventInput per JSONL entry that has `message.usage`.
 * Idempotent: the same (entries, params) input produces the same eventIds.
 * Returns [] for codex worker type (different runtime, not Claude JSONL).
 */
extractUsageEvents(
  entries: SessionEntry[],
  params: ExtractUsageEventsParams,
): UsageEventInput[] {
  const workerTypeConfig = WORKER_TYPES[params.workerType];
  if (workerTypeConfig.runtime !== 'claude') {
    return [];
  }

  const provider = selectProvider(params.workerType);
  const fallbackModel = workerTypeConfig.model ?? 'unknown';

  const events: UsageEventInput[] = [];
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    /* v8 ignore next -- ts-type: noUncheckedIndexedAccess undefined narrowing */
    if (entry === undefined) continue;
    const usage = entry.message?.usage;
    if (usage === undefined) continue;

    const occurredAt = entry.timestamp ?? new Date().toISOString();
    const model = entry.message?.model ?? fallbackModel;

    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

    const eventId = deriveEventId({
      taskId: params.taskId,
      attempt: params.attempt,
      entryIndex: idx,
      timestamp: occurredAt,
    });

    events.push({
      schemaVersion: 1,
      eventId,
      occurredAt,
      owner: {
        type: 'system',
        id: `orchestrator:${params.taskId}`,
      },
      source: {
        service: 'orchestrator',
        component: 'turn-metrics-collector',
        client: 'claude-code',
        environment: params.environment,
        workerLocation: params.workerLocation,
      },
      request: {
        provider,
        model,
        operation: 'other',
        success: true,
        durationMs: 0,
      },
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cachedTokens: 0,
        reasoningTokens: 0,
        thinkingTokens: 0,
        webSearchCalls: 0,
        groundingEnabled: false,
        imageCount: 0,
      },
      cost: {
        billedUsd: 0,
        providerReportedUsd: null,
        calculatedUsd: null,
        pricingSource: 'calculated',
      },
      correlation: {
        requestId: entry.message?.id ?? null,
        traceId: null,
        taskId: params.taskId,
        researchId: null,
        attempt: params.attempt,
        sessionId: null,
      },
      error: null,
    });
  }
  return events;
}
```

Helper (file-scoped, below the class):

```ts
function deriveEventId(params: {
  taskId: string;
  attempt: number;
  entryIndex: number;
  timestamp: string;
}): string {
  const input = `${params.taskId}:${String(params.attempt)}:${String(params.entryIndex)}:${params.timestamp}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}
```

`operation: 'other'` — Phase 1 can revise this to classify `stop_reason === 'tool_use'` as
`'tool_calling'`, but the first version ships `'other'` for everything to minimize risk. **Do
not change this without explicit user sign-off.**

`durationMs: 0` — the JSONL does not record per-call latency. The service will need to aggregate
across events; if we later want per-call duration we must hook `claude-log-processor.ts` on
`type: result` and pair it with the preceding assistant entry, which is out of scope.

### Phase 5 — Provider selection

Add below the class:

```ts
function selectProvider(workerType: WorkerType): LlmProvider {
  switch (workerType) {
    case 'openrouter-free':
      return LlmProviders.OpenRouter;
    case 'opus':
    case 'auto':
    case 'sonnet':
    case 'minimax':
    case 'mimo-pro':
    case 'glm':
    case 'qwen':
    case 'kimi':
      // All use the Anthropic /v1/messages wire format (confirmed via WORKER_TYPES apiBaseUrl
      // suffixes: /anthropic). Map to 'anthropic' so the event passes the schema's provider
      // enum. Model name (e.g. 'glm-5') carries the disambiguation for the pricing table.
      return LlmProviders.Anthropic;
    case 'codex':
    case 'codex-xhigh':
      // Unreachable: runtime !== 'claude' check in extractUsageEvents short-circuits.
      /* v8 ignore next -- auth-guard: codex worker types filtered out upstream @preserve */
      return LlmProviders.OpenAI;
  }
}
```

Exhaustive switch — TypeScript will fail the build if a new worker type is added to
`WORKER_TYPES` without updating this function. Do **not** add a `default` branch — that would
defeat the compile-time safety net.

### Phase 6 — Create the UsagePublisher service

**New file:** `workers/orchestrator/src/services/usage-publisher.ts`

```ts
import type { Logger } from '@intexuraos/common-core';
import type { UsageEventInput } from '@intexuraos/internal-clients/usage-service';
import type { WebhookClient } from './webhook-client.js';

export interface UsagePublisherConfig {
  usageServiceUrl: string;
  orchestratorSecret: string;
  enabled: boolean;
}

export class UsagePublisher {
  constructor(
    private readonly config: UsagePublisherConfig,
    private readonly webhookClient: WebhookClient,
    private readonly logger: Logger,
  ) {}

  async publishTurnUsage(params: {
    taskId: string;
    events: UsageEventInput[];
  }): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug(
        { taskId: params.taskId, count: params.events.length },
        'UsagePublisher disabled by feature flag — skipping',
      );
      return;
    }

    if (params.events.length === 0) {
      return;
    }

    const url = `${this.config.usageServiceUrl}/internal/webhooks/usage-events`;
    const payload = {
      schemaVersion: 1 as const,
      events: params.events,
    };

    const result = await this.webhookClient.send({
      url,
      secret: this.config.orchestratorSecret,
      payload,
      taskId: params.taskId,
    });

    if (!result.ok) {
      // WebhookClient.send() already queues non-4xx failures to pendingWebhooks.
      // 4xx errors are permanent — schema mismatch, invalid provider, etc. — and must surface
      // in logs loudly so we notice. Non-fatal by design: the turn metrics still landed.
      this.logger.warn(
        {
          taskId: params.taskId,
          errorType: result.error.type,
          errorMessage: result.error.message,
          eventCount: params.events.length,
        },
        'UsagePublisher delivery failed (non-fatal, may be queued)',
      );
      return;
    }

    this.logger.info(
      { taskId: params.taskId, eventCount: params.events.length },
      'Published per-call usage events to llm-usage-service',
    );
  }
}
```

**Test file:** `workers/orchestrator/src/__tests__/usage-publisher.test.ts`

Tests to include:

- `publishTurnUsage` returns early when `enabled: false`, does not call `webhookClient.send`.
- `publishTurnUsage` returns early when `events.length === 0`, does not call `webhookClient.send`.
- `publishTurnUsage` calls `webhookClient.send` with the expected `url`, `payload`,
  `taskId`, and `secret` when enabled and events are non-empty.
- `publishTurnUsage` logs a warn (and does not throw) when `webhookClient.send` returns
  `{ok: false, error: {type: '5xx', ...}}`.
- `publishTurnUsage` logs a warn when the error is `4xx` (distinct from 5xx so we see the
  "permanent schema error" signal separately).
- `publishTurnUsage` logs an info with correct eventCount on success.

Use a `FakeWebhookClient` implementing `{ send: vi.fn() }` — **do not** instantiate the real
`WebhookClient`, which requires `StatePersistence`.

### Phase 7 — Wire into `collectAndPublish`

Update `TurnMetricsCollector` constructor signature and `collectAndPublish` method.

1. Add `workerType` and `workerLocation` to `TurnMetricsCollectorConfig`:

```ts
export interface TurnMetricsCollectorConfig {
  codeAgentUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
  secretsBasePath: string;
  sharedCredsPath?: string;
  workerLocation: string;          // NEW — e.g. 'home-dev', 'mac-dev'
  environment: 'dev' | 'prod' | 'test';  // NEW
}
```

2. Inject `UsagePublisher` as a constructor parameter:

```ts
export class TurnMetricsCollector {
  constructor(
    private readonly config: TurnMetricsCollectorConfig,
    private readonly logger: Logger,
    private readonly usagePublisher?: UsagePublisher,  // optional for backward-compat in tests
  ) {}
```

3. Add `workerType` to `collectAndPublish` params:

```ts
async collectAndPublish(params: {
  taskId: string;
  containerId: string;
  attempt: number;
  startedAt: string;
  completedAt: string;
  workerType: WorkerType;          // NEW
}): Promise<void> {
```

4. At the end of `collectAndPublish`, **after** the existing `await this.publish(metrics)` call
   (currently line 133), add:

```ts
      if (this.usagePublisher !== undefined) {
        try {
          // Re-read the entries — we don't plumb them out of parseSessionJsonl today.
          // Cheapest fix: call parseSessionJsonl again? No — expensive I/O. Better:
          // refactor parseSessionJsonl to return entries alongside timeClassification and tokens.
          // See step 5 below.
          const events = this.extractUsageEvents(sessionData.entries, {
            taskId: params.taskId,
            attempt: params.attempt,
            workerType: params.workerType,
            workerLocation: this.config.workerLocation,
            environment: this.config.environment,
          });
          await this.usagePublisher.publishTurnUsage({
            taskId: params.taskId,
            events,
          });
        } catch (error) {
          this.logger.warn(
            { taskId: params.taskId, error },
            'UsagePublisher extract/publish failed (non-fatal)',
          );
        }
      }
```

5. **Refactor `parseSessionJsonl`** to return `entries` alongside existing fields:

```ts
async parseSessionJsonl(...): Promise<{
  entries: SessionEntry[];
  timeClassification: TimeClassification;
  tokens: TokenAggregation;
}> {
  // ... existing code ...
  return {
    entries,
    timeClassification: this.classifyTime(entries),
    tokens: this.aggregateTokens(entries),
  };
}
```

Update existing tests that destructure `parseSessionJsonl` return — all currently call
`result.tokens.*` and `result.timeClassification.*`, so adding a third field is additive.

6. Update `task-dispatcher.ts` callers of `collectAndPublish` to pass `workerType: task.workerType`.
   Grep for `collectAndPublish(` to find call sites — expected to be one location.

### Phase 8 — Env var plumbing

The orchestrator's three-location pattern differs from standard apps because (a) it runs outside
PM2 and (b) it is outside Terraform management. The actual three locations for this track:

#### Location 1: `workers/orchestrator/src/start.ts`

Add to the REQUIRED_ENV block near line 441–456:

```ts
const llmUsageServiceUrl = getRequiredEnv('INTEXURAOS_LLM_USAGE_SERVICE_URL');
const workerLocation = getRequiredEnv('INTEXURAOS_WORKER_LOCATION');
// environment: reuse existing or add a new required env
const environment = getRequiredEnv('INTEXURAOS_ENVIRONMENT') as 'dev' | 'prod' | 'test';
```

Validate `environment` is one of the three allowed values; throw a precondition error otherwise
(match the existing style that writes to stderr and `process.exit(1)`).

Feature flag (non-required, default off):

```ts
const usagePublisherEnabled = getOptionalEnv('INTEXURAOS_USAGE_PUBLISHER_ENABLED', '0') === '1';
```

Wire the service construction after `webhookClient` is created:

```ts
const usagePublisher = new UsagePublisher(
  {
    usageServiceUrl: llmUsageServiceUrl,
    orchestratorSecret,
    enabled: usagePublisherEnabled,
  },
  webhookClient,
  logger,
);
```

Pass it into `TurnMetricsCollector`:

```ts
const turnMetricsCollector = new TurnMetricsCollector(
  {
    codeAgentUrl: config.codeAgentUrl,
    orchestratorSecret: config.orchestratorSecret,
    internalAuthToken: config.internalAuthToken,
    secretsBasePath,
    sharedCredsPath,
    workerLocation,
    environment,
  },
  logger,
  usagePublisher,
);
```

#### Location 2: `.envrc` (repo root + orchestrator host `.envrc`)

Add (with a comment block):

```bash
# --- Track 2 (INT-1341): orchestrator → llm-usage-service webhook ---
export INTEXURAOS_LLM_USAGE_SERVICE_URL="http://localhost:8132"  # dev default; override on home-dev
export INTEXURAOS_WORKER_LOCATION="home-dev"                     # or 'mac-dev', 'office-pc'
export INTEXURAOS_ENVIRONMENT="dev"
export INTEXURAOS_USAGE_PUBLISHER_ENABLED="0"                    # flip to 1 after Phase 10 verification
```

On home-dev, the `.envrc` at `~/` or wherever direnv loads is **the** source of truth. Confirm
with `ssh home-dev 'direnv exec . printenv | grep INTEXURAOS_LLM_USAGE_SERVICE_URL'` after
making the change.

For prod orchestrator (future): `INTEXURAOS_LLM_USAGE_SERVICE_URL` should point to the Cloud Run
URL of `llm-usage-service` (same value as
`https://${local.services.llm_usage_service.name}-${local.cloud_run_url_suffix}` in
`terraform/environments/dev/main.tf:310`).

#### Location 3: `terraform/environments/dev/main.tf` — documentation comment only

The orchestrator is not a Terraform-managed service. Do **not** add the orchestrator to the
Cloud Run service list. Do add a **comment** in the `common_service_env_vars` block noting that
the orchestrator consumes `INTEXURAOS_LLM_USAGE_SERVICE_URL` from its host `.envrc` and must be
kept in sync with the Cloud Run value:

```hcl
    INTEXURAOS_LLM_USAGE_SERVICE_URL            = "https://${local.services.llm_usage_service.name}-${local.cloud_run_url_suffix}"
    # NOTE: orchestrator (workers/orchestrator) reads the same env var from its host .envrc on
    # home-dev / mac-dev. Keep in sync — see workers/orchestrator/DEPLOYMENT.md.
```

**`ecosystem.config.cjs` is NOT touched** — orchestrator is not present in that file
(verified by grep).

### Phase 9 — Idempotency / eventId strategy

Already covered inline in Phase 4's `deriveEventId`. Reasoning:

- **Why include `taskId`:** isolates different tasks that happen to reuse the same attempt
  number.
- **Why include `attempt`:** the same `taskId` can have multiple retry attempts, each with its
  own JSONL entries at the same index.
- **Why include `entryIndex`:** the file may contain many entries with the same timestamp (they
  are written at burst speed). Index disambiguates within a single file read.
- **Why include `timestamp`:** guards against off-by-one errors in the index if the file is
  re-read after new lines appended (adoption flow reads the file mid-flight).
- **Why NOT include `message.id`:** confirmed-present fields are better than optional ones for a
  primary key. If Phase 1 shows `message.id` is reliable, we can switch to
  `sha256("${taskId}:${attempt}:${message.id}")` in a follow-up.
- **Why `sha256(...).slice(0, 24)`:** llm-usage-service schema requires non-empty string; 24 hex
  chars give 96 bits of entropy (birthday collision floor ≈ 2^48 entries, well above our
  lifetime volume). Full 64-char hashes work too but bloat the payload.

**Idempotency guarantee:** if the orchestrator restarts mid-turn, adopts a running container,
and re-parses the JSONL file, it will produce the same eventIds → the service's dedup logic
(INT-1339 Phase 2) returns `duplicates > 0` and `accepted` reflects only net-new events.

### Phase 10 — Integration test against a real llm-usage-service in dev

**Pre-condition:** Phase 1–9 complete, CI green, feature flag `INTEXURAOS_USAGE_PUBLISHER_ENABLED=1`
set on one orchestrator instance (home-dev).

1. Restart the orchestrator: `sudo systemctl restart code-orchestrator` (Linux) or
   `launchctl kickstart -k gui/$(id -u)/com.intexuraos.orchestrator` (macOS).
2. Verify the new env var was picked up:
   ```bash
   journalctl -u code-orchestrator -n 50 | grep -E 'INTEXURAOS_LLM_USAGE_SERVICE_URL|UsagePublisher'
   ```
   Expect a log line like `Starting orchestrator` followed by the service construction
   succeeding (no precondition failures).
3. Submit a trivial planning task via the web UI or `curl code-agent` — pick the smallest
   possible task so the session has <5 assistant entries.
4. Tail orchestrator logs and look for:
   ```
   Published per-call usage events to llm-usage-service (eventCount=N)
   ```
5. Query llm-usage-service for the events:
   ```bash
   curl -sS \
     -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"timeRange":{"from":"2026-04-10T00:00:00Z","to":"2026-04-11T00:00:00Z"},"filters":{"services":["orchestrator"]}}' \
     "$INTEXURAOS_LLM_USAGE_SERVICE_URL/internal/usage/query" | jq
   ```
   Expect `rows` count matching the number of assistant turns in the session and `totals.calls`
   matching the `apiCallCount` from the turn metrics publish.
6. Verify dedup: submit the same task again. The second submission creates a new session (fresh
   taskId), so events should all be `accepted`, not `duplicates`. To test dedup specifically,
   kill-and-restart the orchestrator mid-turn and confirm adoption reuses the same taskId — the
   next `publishTurnUsage` call should have `duplicates > 0`.
7. Verify `cost.billedUsd > 0` server-side: the service should compute cost from the pricing
   table. If all events show `billedUsd = 0`, INT-1339 is missing pricing rows for that model —
   file a blocker.
8. Verify schema compliance: check for any `rejected` events in the webhook response logs on the
   llm-usage-service side:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="llm-usage-service" AND textPayload:"rejected"' \
     --project=intexuraos-dev-pbuchman --limit=20 --format=json
   ```
   Any rejection with `code: 'FST_ERR_VALIDATION'` means the orchestrator sent a schema
   violation — fix before flipping the flag globally.

If any step fails, **revert the feature flag** (`INTEXURAOS_USAGE_PUBLISHER_ENABLED=0`) and
restart. The orchestrator stays functional because the publisher is gated.

---

## Test plan

| File                                                                                 | What it covers                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts`                  | Extended with `describe('extractUsageEvents')` — all cases enumerated in Phase 3b (10+ tests). Covers empty entries, missing `message.usage`, all cache-token variants, missing `timestamp`, model fallback chain (`message.model` → `WORKER_TYPES[workerType].model` → `'unknown'`), deterministic eventId, codex early-return, provider selection switch. |
| `workers/orchestrator/src/__tests__/usage-publisher.test.ts` (NEW)                   | `UsagePublisher.publishTurnUsage` — feature flag gate, empty events short-circuit, webhookClient invocation args, 4xx/5xx warn logs, success info log. Uses a `FakeWebhookClient` matching the interface.                                                                                                                                                   |
| `workers/orchestrator/src/__tests__/fixtures/session-jsonl-sample.jsonl` (NEW)       | Golden JSONL sample matching Phase 1 verified shape. Loaded by turn-metrics-collector tests via `readFile` mock.                                                                                                                                                                                                                                            |
| `workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts` (existing tests) | Must continue to pass after adding `workerLocation`/`environment` to `TurnMetricsCollectorConfig`. Update the `const config` fixture at the top of the file to include the new required fields.                                                                                                                                                             |
| `workers/orchestrator/src/__tests__/start.test.ts` (if it exists)                    | Add assertion that `INTEXURAOS_LLM_USAGE_SERVICE_URL` is required; missing value causes `process.exit(1)`. Likely skip this if the file is covered by `v8 ignore module-init` already.                                                                                                                                                                      |

**Coverage goal:** 95% branch coverage on `extractUsageEvents`, `selectProvider`, and the full
`UsagePublisher` class. The `codex` early-return branch in `extractUsageEvents` is covered by
one test; the `workerType` switch in `selectProvider` is covered by the `it.each` table.

**Run locally before PR:**

```bash
pnpm --filter orchestrator test
pnpm run verify:workspace:tracked -- orchestrator
pnpm run ci:tracked
```

---

## Rollout plan

1. **Merge with flag OFF.** `INTEXURAOS_USAGE_PUBLISHER_ENABLED=0` is the default in `.envrc`.
   Code ships dark. No behavior change.
2. **Flip flag on home-dev only.** Edit home-dev's `.envrc`, restart orchestrator. Run Phase 10
   integration test. Observe for 24 hours. Watch for: (a) increased 5xx from llm-usage-service,
   (b) pendingWebhooks queue growth, (c) orchestrator memory growth, (d) unexpected `rejected`
   events in llm-usage-service logs.
3. **Flip flag on mac-dev (if applicable).** Same verification.
4. **Flip flag globally** by changing the default in `.envrc.local.example` to `1` and updating
   team onboarding docs.
5. **After 1 week of stability**, remove the flag entirely: delete the
   `INTEXURAOS_USAGE_PUBLISHER_ENABLED` check in `UsagePublisher.publishTurnUsage` and the env
   var read in `start.ts`. File this cleanup as a separate small PR.

---

## Acceptance criteria

- [ ] Phase 1 JSONL shape verification documented in PR body (model field location, GLM
      deviation notes).
- [ ] `extractUsageEvents` function produces valid `UsageEventInput[]` conforming to
      `OrchestratorUsageEventInput` schema (checked against schema JSON in local Ajv test).
- [ ] Deterministic `eventId` — two calls with the same input produce the same eventIds
      (proven by unit test).
- [ ] `collectAndPublish` invokes `UsagePublisher.publishTurnUsage` after the existing
      `publish(metrics)` call, inside the same try/catch swallow-and-warn envelope.
- [ ] `pnpm run ci:tracked` green.
- [ ] `pnpm --filter orchestrator test` green with 95%+ branch coverage on new code.
- [ ] `INTEXURAOS_LLM_USAGE_SERVICE_URL` is a hard REQUIRED_ENV in `start.ts`; missing value
      causes precondition failure at startup.
- [ ] `INTEXURAOS_USAGE_PUBLISHER_ENABLED=0` by default; the publisher is a no-op when disabled.
- [ ] Phase 10 integration test passes on home-dev: events visible via
      `/internal/usage/query`, `cost.billedUsd > 0` (requires INT-1339).
- [ ] When `llm-usage-service` is down, the orchestrator does NOT crash — confirmed by fault-
      injection test (temporarily point `INTEXURAOS_LLM_USAGE_SERVICE_URL` at a closed port).
- [ ] PR title contains `INT-1341`; PR body contains `Fixes INT-1341`.

---

## Risks and mitigations

| Risk                                                                          | Likelihood           | Impact                                                                                                                       | Mitigation                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message.model` field is absent from GLM/Qwen/Kimi JSONL                      | Medium               | Events tagged with fallback `WORKER_TYPES[*].model` (coarser granularity, model name still present)                          | Phase 1 verification; fallback chain `message.model → WORKER_TYPES.model → 'unknown'`                                                                                                                        |
| Provider enum does not accept `dashscope`/`glm`/`minimax`                     | **High — confirmed** | Schema rejects entire batch with 400                                                                                         | Map to `'anthropic'` in `selectProvider`; **⚠ DECISION NEEDED**: coordinate with INT-1339 pricing table to list these models under provider `anthropic`, or extend `LlmProviders` enum in a prerequisite PR  |
| Pending webhook queue grows unbounded during llm-usage-service outage         | Low                  | Disk growth; 24h TTL drops events                                                                                            | `WebhookClient.PENDING_WEBHOOK_TTL = 24h` (already implemented at `webhook-client.ts:22`); at high volume, the queue is in-memory + state file so the orchestrator can monitor `getPendingCount()` and alert |
| Duplicate events on orchestrator restart + container adoption                 | Medium               | Inflated call counts server-side                                                                                             | Deterministic `eventId` — service dedups. Verified by Phase 10 step 6.                                                                                                                                       |
| 15-minute HMAC replay window expires for pending-queue retries                | Medium               | Retries fail as `401 expired_signature`                                                                                      | `WebhookClient.retryPending` at `webhook-client.ts:131` regenerates `timestamp = Math.floor(now / 1000)` and re-signs — confirmed safe                                                                       |
| Breaking the existing turn-metrics publish to `code-agent` during refactor    | Low                  | Lost turn metrics visibility                                                                                                 | `publishTurnUsage` is **additive** — the existing `this.publish(metrics)` call is unchanged and runs first; publisher runs after in its own try/catch                                                        |
| `parseSessionJsonl` now returns a third field, breaks existing tests          | Low                  | Test failures                                                                                                                | Update the 2 existing `parseSessionJsonl` test assertions to destructure `{ entries, timeClassification, tokens }` — covered in Phase 7 step 5                                                               |
| Env var missing on one host but not another → orchestrator crashes at startup | Medium               | Orchestrator down on that host                                                                                               | Use `getOptionalEnv` for the feature flag only. Use `getRequiredEnv` for `INTEXURAOS_LLM_USAGE_SERVICE_URL` so missing config is loud and fast                                                               |
| Unknown model string (e.g. future Claude 5) fails pricing lookup              | Medium               | Cost stays 0 for those events                                                                                                | Service-side responsibility (INT-1339); orchestrator sends the raw model string and lets the service decide pricing-source fallback                                                                          |
| I/O cost of re-reading JSONL                                                  | Low                  | Negligible — already read once per turn in `parseSessionJsonl`; the refactor returns `entries` so no additional read happens | N/A                                                                                                                                                                                                          |
| Shipping without INT-1339 live                                                | **High**             | Events land but `cost.billedUsd` stays 0                                                                                     | Pre-flight check #1; feature flag default OFF protects against this                                                                                                                                          |

---

## Out of scope

- **Streaming per-call events** (as they arrive in `claude-log-processor.ts`). Post-turn batch
  only. Real-time streaming is INT-13xx-TBD follow-up.
- **Backfill of historical sessions.** The orchestrator has `claude-session-*` directories
  going back weeks — a one-off backfill script is out of scope. If needed, do it as a separate
  `scripts/backfill-usage-events.ts` PR.
- **Per-call operation detection** (tool_calling vs generate). All events use `operation:
  'other'` until we have a use case that requires finer classification. Do not add
  `stop_reason`-based classification speculatively.
- **Modifying `code-agent/internal/turn-metrics`.** The existing summed-per-turn publish stays.
  Track 2 is additive.
- **Extending `LlmProviders` enum** to add `'zai'`, `'dashscope'`, etc. If Phase 1 shows this
  is required, file a separate blocker issue under INT-1338 first.
- **Per-event `durationMs`.** JSONL has no per-call latency. `durationMs: 0` is a known limitation.
- **Per-event `owner.id` = real user ID.** The orchestrator does not have user context at the
  turn-metrics collection point. `owner.id = "orchestrator:${taskId}"` is the best we can do
  without plumbing user IDs through `code-agent → orchestrator → turn-metrics-collector`.
- **Cloud Run deployment of the orchestrator.** Orchestrator remains a native Node.js process
  on home-dev/mac-dev for this track.
- **Deleting the feature flag.** Rollout plan step 5 files a separate cleanup PR after 1 week
  of stability.

---

## Summary of ⚠ DECISION NEEDED items

1. **Phase 1 — GLM JSONL shape.** If GLM deviates from the Claude format, `extractUsageEvents`
   must branch on `workerType`. Blocker on verification.
2. **Phase 3/5 — Provider enum for non-Anthropic proxies.** Provisional decision: map all
   Anthropic-compatible proxies (`minimax`, `mimo-pro`, `glm`, `qwen`, `kimi`) to
   `LlmProviders.Anthropic`. Must be confirmed with INT-1339 author before merge, because it
   implies the pricing table lists `glm-5` etc. under the `anthropic` provider column.
3. **Phase 4 — Should `operation` classify `stop_reason === 'tool_use'` as `'tool_calling'`?**
   Provisional decision: **No** — ship `'other'` first, revisit after a week of data.
4. **Phase 9 — Use `message.id` (Anthropic request ID) as eventId input?** Provisional
   decision: **No** — use the positional hash first because presence is guaranteed, revisit
   when Phase 1 confirms `message.id` is always populated.
