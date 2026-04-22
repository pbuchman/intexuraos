# Pub/Sub-driven PR Event Evaluator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `unifiedEvaluator.evaluate(...)` out of the GitHub webhook's fire-and-forget `void ... .catch(...)` and into a dedicated Pub/Sub push subscription handler, so PR triage survives Cloud Run CPU throttling and revision rollovers.

**Architecture:**
- The webhook (`apps/code-agent/src/routes/webhooks/github.ts:639`) stops calling `unifiedEvaluator.evaluate(...)` directly. Instead, it publishes a `PRTriageEvent { eventId }` to a new topic `intexuraos-pr-triage-${env}`.
- A new push subscription routes the event to a new internal endpoint `POST /internal/code/pubsub/pr-triage` on code-agent. That handler awaits `unifiedEvaluator.evaluate(savedEvent, logger)` to completion, returns 200 on success, returns 5xx on transient failure (Pub/Sub retries with backoff; DLQ after 5 attempts).
- Because the evaluator now runs *inside an in-flight HTTP request*, Cloud Run keeps CPU allocated for the full duration. Because publish + ack happens before the webhook returns, deploys mid-webhook no longer drop work.

**Tech Stack:** Fastify, `@google-cloud/pubsub` via `BasePubSubPublisher`, Firestore (`github-pr-events`), Cloud Run push subscriptions with OIDC auth, Terraform module `terraform/modules/pubsub-push`, vitest + nock + fake Firestore.

**Endpoint Changes:**
- **Created:** `POST /internal/code/pubsub/pr-triage` on code-agent (Pub/Sub push target, OIDC-auth or `X-Internal-Auth`)
- **Modified:** `POST /webhooks/github` on code-agent — replaces inline `void unifiedEvaluator.evaluate(...)` with publish to new topic
- **Removed:** none
- **Unchanged:** all other webhook handlers, automation log endpoints, evaluator internals

---

## File Structure

**Create:**
- `packages/infra-pubsub/src/prTriagePublisher.ts` — new publisher class extending `BasePubSubPublisher`
- `packages/infra-pubsub/src/__tests__/prTriagePublisher.test.ts` — unit test for the publisher
- `apps/code-agent/src/routes/webhooks/prTriagePubsubRoute.ts` — Fastify plugin registering `POST /internal/code/pubsub/pr-triage`
- `apps/code-agent/src/__tests__/routes/webhooks/prTriagePubsubRoute.test.ts` — route tests
- `apps/code-agent/src/routes/webhooks/pubsubHelpers.ts` — shared `authenticatePubSub` + `decodePubSubMessage` helpers (copied/adapted from `apps/bookmarks-agent/src/routes/pubsubHelpers.ts` because routes can't cross-import between apps)
- `terraform/environments/dev/pubsub_pr_triage.tf` — new Terraform file invoking the `pubsub-push` module

**Modify:**
- `packages/infra-pubsub/src/types.ts` — add `PRTriageEvent` and `PRTriagePublisherConfig` types
- `packages/infra-pubsub/src/index.ts` — re-export the new publisher
- `apps/code-agent/src/config.ts` — add `prTriageTopic: string` to `Config`
- `apps/code-agent/src/index.ts` — add `INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC` to `PRODUCTION_ONLY_ENV` and pass it to `initServices`
- `apps/code-agent/src/services.ts` — add `prTriagePublisher` to `ServiceContainer` + `ServiceConfig`, instantiate it, expose via `getServices()`
- `apps/code-agent/src/routes/webhooks/github.ts` (lines 636–647) — replace the `void unifiedEvaluator.evaluate(...)` block with a `prTriagePublisher.publishPRTriage({ eventId: savedEvent.id, ... })` call (still fire-and-forget for the webhook response, but the publish is fast and the work itself runs in a separate request)
- `apps/code-agent/src/routes/webhooks/index.ts` (or wherever webhook plugins are registered) — register the new `prTriagePubsubRoute`
- `ecosystem.config.cjs` — add `INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC` for `code-agent`
- `terraform/environments/dev/main.tf` — add `INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC` to code-agent's `env_vars`

**No changes:** `unifiedEvaluator.ts`, `createReviewTask.ts`, `automationCommentRenderer.ts`, `gitHubWebhookRules.ts`, `firestore-collections.json` (collection ownership unchanged).

---

### Task 1: Add PRTriageEvent type + publisher config

**Files:**
- Modify: `packages/infra-pubsub/src/types.ts` (append at end)

- [ ] **Step 1: Add the type definitions**

```typescript
/**
 * Event published when a GitHub PR webhook event has been persisted to
 * Firestore and needs unified evaluation (hard rules + LLM triage).
 *
 * The event carries only the Firestore eventId — the push subscription
 * handler reloads the full GitHubPREvent from `github-pr-events`. This
 * keeps the message small and avoids serialization drift.
 */
export interface PRTriageEvent {
  type: 'code.pr.triage.requested';
  /** Firestore document ID of the saved github-pr-events record. */
  eventId: string;
  /** Repository for logging / dedup; reload from Firestore is the source of truth. */
  repository: string;
  /** PR number for logging. */
  pullRequestNumber: number;
  /** Correlation ID for tracing across services. */
  correlationId: string;
  /** Event timestamp (ISO 8601). */
  timestamp: string;
}

export interface PRTriagePublisherConfig {
  projectId: string;
  topicName: string;
  logger: import('pino').Logger;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/infra-pubsub/src/types.ts
git commit -m "feat(infra-pubsub): add PRTriageEvent type for code-agent triage decoupling"
```

---

### Task 2: Add the PRTriagePublisher class with TDD

**Files:**
- Create: `packages/infra-pubsub/src/__tests__/prTriagePublisher.test.ts`
- Create: `packages/infra-pubsub/src/prTriagePublisher.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/infra-pubsub/src/__tests__/prTriagePublisher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createPRTriagePublisher } from '../prTriagePublisher.js';
import type { Logger } from 'pino';

const stubLogger = (): Logger => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
  fatal: vi.fn(), child: vi.fn(() => stubLogger()),
} as unknown as Logger);

describe('PRTriagePublisher', () => {
  it('builds and publishes a PRTriageEvent with the supplied fields', async () => {
    const publishMessage = vi.fn().mockResolvedValue('msg-id');
    const topic = vi.fn(() => ({ publishMessage }));

    const publisher = createPRTriagePublisher({
      projectId: 'p',
      topicName: 't',
      logger: stubLogger(),
    });
    // @ts-expect-error -- swap private pubsub for stub
    publisher.pubsub = { topic };

    const result = await publisher.publishPRTriage({
      eventId: 'evt-1',
      repository: 'pbuchman/intexuraos',
      pullRequestNumber: 1860,
      correlationId: 'corr-1',
    });

    expect(result.ok).toBe(true);
    expect(topic).toHaveBeenCalledWith('t');
    expect(publishMessage).toHaveBeenCalledTimes(1);
    const data = JSON.parse(
      Buffer.from(publishMessage.mock.calls[0][0].data).toString('utf-8')
    );
    expect(data).toMatchObject({
      type: 'code.pr.triage.requested',
      eventId: 'evt-1',
      repository: 'pbuchman/intexuraos',
      pullRequestNumber: 1860,
      correlationId: 'corr-1',
    });
    expect(typeof data.timestamp).toBe('string');
  });

  it('returns ok and logs debug when topicName is empty (skip-publish mode)', async () => {
    const publishMessage = vi.fn();
    const topic = vi.fn(() => ({ publishMessage }));
    const logger = stubLogger();

    const publisher = createPRTriagePublisher({ projectId: 'p', topicName: '', logger });
    // @ts-expect-error -- swap private pubsub for stub
    publisher.pubsub = { topic };

    const result = await publisher.publishPRTriage({
      eventId: 'evt-1',
      repository: 'r/x',
      pullRequestNumber: 1,
      correlationId: 'c',
    });

    expect(result.ok).toBe(true);
    expect(publishMessage).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @intexuraos/infra-pubsub test -- prTriagePublisher.test.ts
```

Expected: FAIL — `Cannot find module '../prTriagePublisher.js'`.

- [ ] **Step 3: Implement the publisher**

```typescript
// packages/infra-pubsub/src/prTriagePublisher.ts
/**
 * PR Triage Publisher.
 *
 * Publishes PRTriageEvent so a Pub/Sub push subscription can run
 * code-agent's unifiedEvaluator inside its own request lifetime
 * (avoiding webhook fire-and-forget being killed by Cloud Run CPU
 * throttling or revision rollovers).
 */
import { type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher } from './basePublisher.js';
import type {
  PublishError,
  PRTriageEvent,
  PRTriagePublisherConfig,
} from './types.js';

export interface PRTriagePublisher {
  publishPRTriage(params: {
    eventId: string;
    repository: string;
    pullRequestNumber: number;
    correlationId: string;
  }): Promise<Result<void, PublishError>>;
}

class PRTriagePublisherImpl extends BasePubSubPublisher implements PRTriagePublisher {
  private readonly topicName: string;

  constructor(config: PRTriagePublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publishPRTriage(params: {
    eventId: string;
    repository: string;
    pullRequestNumber: number;
    correlationId: string;
  }): Promise<Result<void, PublishError>> {
    const event: PRTriageEvent = {
      type: 'code.pr.triage.requested',
      eventId: params.eventId,
      repository: params.repository,
      pullRequestNumber: params.pullRequestNumber,
      correlationId: params.correlationId,
      timestamp: new Date().toISOString(),
    };

    return await this.publishToTopic(
      this.topicName === '' ? null : this.topicName,
      event,
      {
        correlationId: params.correlationId,
        eventId: params.eventId,
        repository: params.repository,
        prNumber: params.pullRequestNumber,
      },
      'PR triage request'
    );
  }
}

export function createPRTriagePublisher(
  config: PRTriagePublisherConfig
): PRTriagePublisher {
  return new PRTriagePublisherImpl(config);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @intexuraos/infra-pubsub test -- prTriagePublisher.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Re-export from index.ts**

```typescript
// packages/infra-pubsub/src/index.ts — add to existing exports
export type {
  // ... existing types ...
  PRTriageEvent,
  PRTriagePublisherConfig,
} from './types.js';

export {
  type PRTriagePublisher,
  createPRTriagePublisher,
} from './prTriagePublisher.js';
```

- [ ] **Step 6: Build the package**

```bash
pnpm --filter @intexuraos/infra-pubsub build
```

Expected: build succeeds with no errors. The package is consumed by code-agent in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add packages/infra-pubsub/src/prTriagePublisher.ts packages/infra-pubsub/src/__tests__/prTriagePublisher.test.ts packages/infra-pubsub/src/index.ts
git commit -m "feat(infra-pubsub): add PRTriagePublisher for decoupled webhook triage"
```

---

### Task 3: Wire prTriagePublisher into code-agent's ServiceContainer

**Files:**
- Modify: `apps/code-agent/src/config.ts` (around line 26 and the `loadConfig` block at 48–80)
- Modify: `apps/code-agent/src/index.ts` (PRODUCTION_ONLY_ENV at line 35–48 and `initServices` call at 68–83)
- Modify: `apps/code-agent/src/services.ts` (ServiceContainer at 94–142, ServiceConfig at 145–161, instantiation block near line 338)

- [ ] **Step 1: Add `prTriageTopic` to the Config type and loader**

```typescript
// apps/code-agent/src/config.ts — add to Config interface
export interface Config {
  // ... existing fields ...
  whatsappSendTopic: string;
  prTriageTopic: string;   // NEW
  linearAgentUrl: string;
  // ...
}

// apps/code-agent/src/config.ts — add inside loadConfig()
const prTriageTopic = process.env['INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC'] ?? '';

return {
  // ... existing fields ...
  whatsappSendTopic,
  prTriageTopic,         // NEW
  linearAgentUrl,
  // ...
};
```

- [ ] **Step 2: Add the env var to PRODUCTION_ONLY_ENV and forward it via initServices**

```typescript
// apps/code-agent/src/index.ts — add to PRODUCTION_ONLY_ENV
const PRODUCTION_ONLY_ENV = [
  'INTEXURAOS_WHATSAPP_SERVICE_URL',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC',   // NEW
  'INTEXURAOS_LINEAR_AGENT_URL',
  // ... rest unchanged ...
];

// inside main(), in the initServices({ ... }) call, add:
initServices({
  // ... existing fields ...
  whatsappSendTopic: config.whatsappSendTopic,
  prTriageTopic: config.prTriageTopic,   // NEW
  linearAgentUrl: config.linearAgentUrl,
  // ...
});
```

- [ ] **Step 3: Add `prTriagePublisher` to ServiceContainer + ServiceConfig and instantiate it**

```typescript
// apps/code-agent/src/services.ts — add at the top, near other infra-pubsub imports
import {
  type WhatsAppSendPublisher,
  createWhatsAppSendPublisher,
  type PRTriagePublisher,           // NEW
  createPRTriagePublisher,          // NEW
} from '@intexuraos/infra-pubsub';

// ServiceContainer — add this field (group with other publishers if any, otherwise after whatsappNotifier)
export interface ServiceContainer {
  // ... existing fields ...
  unifiedEvaluator: UnifiedEvaluator;
  prTriagePublisher: PRTriagePublisher;   // NEW
  // ...
}

// ServiceConfig — add the field
export interface ServiceConfig {
  // ... existing fields ...
  whatsappSendTopic: string;
  prTriageTopic: string;            // NEW
  // ...
}

// Inside initServices(...) — instantiate near the existing publisher block (~line 338)
const prTriagePublisher = createPRTriagePublisher({
  projectId: config.gcpProjectId,
  topicName: config.prTriageTopic,
  logger: createAppLogger({ name: 'pr-triage-publisher' }),
});

// And add to the container assembly at the bottom of initServices:
container = {
  // ... existing fields ...
  unifiedEvaluator,
  prTriagePublisher,    // NEW
  // ...
};
```

- [ ] **Step 4: Type-check the workspace**

```bash
pnpm --filter @intexuraos/code-agent run typecheck
```

Expected: PASS. If you get `Property 'prTriagePublisher' is missing in setServices(...)` errors from tests, those are intentional and fixed in Task 4.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/config.ts apps/code-agent/src/index.ts apps/code-agent/src/services.ts
git commit -m "feat(code-agent): inject PRTriagePublisher into ServiceContainer"
```

---

### Task 4: Update test setServices() call sites

The repo enforces that all `setServices({fakes})` test helpers are kept in sync with `ServiceContainer` (see CLAUDE.md "Pre-Flight"). Adding a new field requires updating every test that calls `setServices`.

**Files:**
- Modify: every test file that calls `setServices(...)` for code-agent. Find the list with: `rg -l "setServices\(" apps/code-agent/src/__tests__`. There are roughly 30+ files.

- [ ] **Step 1: Find all setServices() call sites**

```bash
rg -l "setServices\(" apps/code-agent/src/__tests__
```

Expected: a list of test files. Note the count.

- [ ] **Step 2: In each file, add `prTriagePublisher` to the fakes object**

For every `setServices({...})` call, add:

```typescript
prTriagePublisher: {
  publishPRTriage: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
},
```

If the test file already imports `vi` from vitest, no extra import needed. Otherwise add `import { vi } from 'vitest';`.

For the `MockServices` *type alias* in helpers (search for `interface MockServices` or `type MockServices`), add:

```typescript
prTriagePublisher: import('@intexuraos/infra-pubsub').PRTriagePublisher;
```

Or simply `prTriagePublisher: { publishPRTriage: ReturnType<typeof vi.fn> }` if the file uses inline shapes.

- [ ] **Step 3: Run the full code-agent test suite**

```bash
pnpm --filter @intexuraos/code-agent test
```

Expected: all tests pass. Common failure: a missed `setServices` site — the error message will name the file. Add the field and re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/__tests__
git commit -m "test(code-agent): add prTriagePublisher to setServices() fakes"
```

---

### Task 5: Replace the webhook's fire-and-forget evaluator with publish

**Files:**
- Modify: `apps/code-agent/src/routes/webhooks/github.ts` (lines 636–647 — the `void unifiedEvaluator.evaluate(...)` block)
- Modify: `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts` (the existing tests that assert `unifiedEvaluator.evaluate` is called inline — search for `expect(services.unifiedEvaluator.evaluate)` and `mockServices.unifiedEvaluator.evaluate`)

- [ ] **Step 1: Write the failing test for the new publish behavior**

In `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`, add a new test alongside the existing webhook tests:

```typescript
it('publishes a PRTriageEvent instead of calling unifiedEvaluator inline (INT-XXXX)', async () => {
  // arrange: build webhook payload for a pull_request.opened event (reuse existing test helper buildPullRequestPayload or similar)
  const payload = buildPullRequestPayload({ action: 'opened', prNumber: 9999 });
  const signature = signWebhookPayload(payload, TEST_WEBHOOK_SECRET);

  // act
  const response = await server.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'x-hub-signature-256': signature,
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-9999',
      'content-type': 'application/json',
    },
    payload,
  });

  // assert: webhook returns 200, evaluator is NOT called inline,
  // and prTriagePublisher receives the eventId of the saved record
  expect(response.statusCode).toBe(200);
  expect(currentServices.unifiedEvaluator.evaluate).not.toHaveBeenCalled();
  expect(currentServices.prTriagePublisher.publishPRTriage).toHaveBeenCalledTimes(1);
  const arg = vi.mocked(currentServices.prTriagePublisher.publishPRTriage).mock.calls[0][0];
  expect(arg).toMatchObject({
    repository: expect.stringContaining('/'),
    pullRequestNumber: 9999,
  });
  expect(typeof arg.eventId).toBe('string');
  expect(arg.eventId.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @intexuraos/code-agent test -- github.test.ts -t 'publishes a PRTriageEvent'
```

Expected: FAIL — either `publishPRTriage` was not called, or `unifiedEvaluator.evaluate` was still called.

- [ ] **Step 3: Replace the fire-and-forget block in the webhook handler**

Open `apps/code-agent/src/routes/webhooks/github.ts` around line 636 and replace this block:

```typescript
const { unifiedEvaluator } = getServices();

// INT-744: Unified evaluation — hard rules + optional LLM triage
void unifiedEvaluator.evaluate(savedEvent, logger).catch((evalErr: unknown) => {
  logger.error({ evalErr }, 'Unhandled error in unified evaluator');
  void ensureDecisionAfterEvaluationFailure({
    auditEvent: auditResult.value,
    pendingEntry: pendingLogEntryResult.value,
    logger,
    errorMessage: getErrorMessage(evalErr, 'unknown_evaluation_error'),
  });
});
```

with:

```typescript
const { prTriagePublisher } = getServices();

// Decouple triage from the webhook request lifetime: publish a PRTriageEvent
// to Pub/Sub, which is delivered as a push to /internal/code/pubsub/pr-triage.
// The push handler awaits unifiedEvaluator.evaluate(...) inside its own
// request, so Cloud Run's CPU throttling and revision rollovers cannot drop
// triage work mid-flight (see docs/superpowers/plans/2026-04-17-pubsub-pr-event-evaluator.md).
const publishResult = await prTriagePublisher.publishPRTriage({
  eventId: savedEvent.id,
  repository: parsedEvent.repository,
  pullRequestNumber: parsedEvent.pullRequestNumber,
  correlationId: savedEvent.id,
});

if (!publishResult.ok) {
  logger.error(
    { error: publishResult.error, eventId: savedEvent.id }, // @allow-result-access -- narrowed by !publishResult.ok
    'Failed to publish PR triage event — falling back to inline evaluator'
  );
  // Fallback: run inline so we don't silently drop the event when Pub/Sub is unavailable.
  // This preserves the existing failure-mode behavior for development environments
  // where the topic may not be provisioned.
  const { unifiedEvaluator } = getServices();
  void unifiedEvaluator.evaluate(savedEvent, logger).catch((evalErr: unknown) => {
    logger.error({ evalErr }, 'Unhandled error in unified evaluator (fallback path)');
    void ensureDecisionAfterEvaluationFailure({
      auditEvent: auditResult.value,
      pendingEntry: pendingLogEntryResult.value,
      logger,
      errorMessage: getErrorMessage(evalErr, 'unknown_evaluation_error'),
    });
  });
}
```

- [ ] **Step 4: Update the existing webhook tests that asserted inline evaluator invocation**

Search the test file:

```bash
rg -n "unifiedEvaluator.evaluate" apps/code-agent/src/__tests__/routes/webhooks/github.test.ts
```

For each call site:
- If the test was asserting the evaluator runs after a happy-path webhook (e.g. lines around 538, 3480), change the assertion to check `prTriagePublisher.publishPRTriage` instead.
- If the test was asserting the evaluator is *not* called (e.g. line 2103, when hard rules skip), keep the existing assertion; in addition, assert `prTriagePublisher.publishPRTriage` was *also* not called for skip-by-hard-rules paths only if the skip happens *before* the publish point in `github.ts`. Otherwise (publish happens unconditionally for valid events), assert it was called.

Open `github.ts` and confirm where in the handler the publish happens — it's *after* save-event and *before* close/push handling, so it fires for any saved event regardless of hard-rule outcome (the rules run inside the evaluator). Adjust test expectations accordingly.

- [ ] **Step 5: Run the full webhook test suite**

```bash
pnpm --filter @intexuraos/code-agent test -- github.test.ts
```

Expected: all tests pass, including the new "publishes a PRTriageEvent" test from Step 1.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/webhooks/github.ts apps/code-agent/src/__tests__/routes/webhooks/github.test.ts
git commit -m "feat(code-agent): publish PRTriageEvent instead of inline fire-and-forget evaluator"
```

---

### Task 6: Add Pub/Sub helpers shared by code-agent webhook routes

**Files:**
- Create: `apps/code-agent/src/routes/webhooks/pubsubHelpers.ts`
- Create: `apps/code-agent/src/__tests__/routes/webhooks/pubsubHelpers.test.ts`

These mirror `apps/bookmarks-agent/src/routes/pubsubHelpers.ts`. Apps cannot import from each other (CLAUDE.md "Apps can't import other apps"), and the helper is too thin for a shared package.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/code-agent/src/__tests__/routes/webhooks/pubsubHelpers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { authenticatePubSub, decodePubSubMessage } from '../../../routes/webhooks/pubsubHelpers.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const fakeReply = (): FastifyReply => {
  const r = { fail: vi.fn().mockResolvedValue(undefined) };
  return r as unknown as FastifyReply;
};
const fakeRequest = (overrides: Partial<{ headers: Record<string, string>; body: unknown; url: string }>): FastifyRequest => {
  const r = {
    headers: overrides.headers ?? {},
    body: overrides.body,
    url: overrides.url ?? '/internal/code/pubsub/pr-triage',
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return r as unknown as FastifyRequest;
};

describe('authenticatePubSub', () => {
  it('returns true when the From header is noreply@google.com (OIDC validated by Cloud Run)', async () => {
    const req = fakeRequest({ headers: { from: 'noreply@google.com' } });
    const reply = fakeReply();
    expect(await authenticatePubSub(req, reply)).toBe(true);
    expect(reply.fail).not.toHaveBeenCalled();
  });

  it('falls back to internal-auth validation when From header is missing', async () => {
    const req = fakeRequest({ headers: { authorization: 'Bearer wrong' } });
    const reply = fakeReply();
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'expected-token';
    expect(await authenticatePubSub(req, reply)).toBe(false);
    expect(reply.fail).toHaveBeenCalledWith('UNAUTHORIZED', expect.any(String));
  });
});

describe('decodePubSubMessage', () => {
  it('decodes a valid base64 JSON envelope', () => {
    const payload = { type: 'code.pr.triage.requested', eventId: 'evt-1' };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const req = fakeRequest({ body: { message: { data, messageId: 'm1', publishTime: 't' } } });
    const result = decodePubSubMessage(req);
    expect(result).toEqual({ data: payload, messageId: 'm1' });
  });

  it('returns null on invalid JSON', () => {
    const data = Buffer.from('not json').toString('base64');
    const req = fakeRequest({ body: { message: { data, messageId: 'm2', publishTime: 't' } } });
    expect(decodePubSubMessage(req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @intexuraos/code-agent test -- pubsubHelpers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```typescript
// apps/code-agent/src/routes/webhooks/pubsubHelpers.ts
import { validateInternalAuth } from '@intexuraos/common-http';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface PubSubPushMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export async function authenticatePubSub(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const fromHeader = request.headers.from;
  const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

  if (isPubSubPush) {
    request.log.info(
      { from: fromHeader, userAgent: request.headers['user-agent'] },
      'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
    );
    return true;
  }

  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    request.log.warn(
      { reason: authResult.reason },
      `Internal auth failed for ${request.url}`
    );
    await reply.fail('UNAUTHORIZED', `Internal auth failed for ${request.url}`);
    return false;
  }
  return true;
}

interface DecodedMessage<T> { data: T; messageId: string }

export function decodePubSubMessage<T = unknown>(
  request: FastifyRequest
): DecodedMessage<T> | null {
  const body = request.body as PubSubPushMessage;
  try {
    const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
    const eventData = JSON.parse(decoded) as T;
    return { data: eventData, messageId: body.message.messageId };
  } catch {
    request.log.error(
      { messageId: body.message.messageId },
      'Failed to decode PubSub message'
    );
    return null;
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @intexuraos/code-agent test -- pubsubHelpers.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhooks/pubsubHelpers.ts apps/code-agent/src/__tests__/routes/webhooks/pubsubHelpers.test.ts
git commit -m "feat(code-agent): add Pub/Sub auth + decode helpers for push subscriptions"
```

---

### Task 7: Implement the /internal/code/pubsub/pr-triage push handler with TDD

**Files:**
- Create: `apps/code-agent/src/__tests__/routes/webhooks/prTriagePubsubRoute.test.ts`
- Create: `apps/code-agent/src/routes/webhooks/prTriagePubsubRoute.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/code-agent/src/__tests__/routes/webhooks/prTriagePubsubRoute.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { buildServer } from '../../../server.js';
import { resetServices, setServices } from '../../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';
import type { Firestore } from '@google-cloud/firestore';

describe('POST /internal/code/pubsub/pr-triage', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let evaluateMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';

    evaluateMock = vi.fn().mockResolvedValue(undefined);

    const repo = createFirestoreGitHubPREventsRepository({ logger: console as never });
    // seed a github-pr-events doc so the route can reload it
    const seeded = await repo.save({
      githubEventId: 1,
      deliveryId: 'd1',
      repository: 'pbuchman/intexuraos',
      repositoryId: 1,
      pullRequestNumber: 9999,
      pullRequestId: 1,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'pbuchman',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: 'pbuchman',
      title: 't', body: '', state: 'open',
      isDraft: false, baseBranch: 'development',
      mergedAt: null, createdAt: new Date(),
      payload: {} as never,
    });
    if (!seeded.ok) throw new Error('seed failed');

    setServices({
      // ... use a helper to fill all fakes; only customize evaluator + repo + publisher
      unifiedEvaluator: { evaluate: evaluateMock },
      gitHubPREventRepo: repo,
      prTriagePublisher: { publishPRTriage: vi.fn() },
      // ... fill remainder via the shared mockServices helper used elsewhere
    } as never);

    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  function pushEnvelope(eventId: string): unknown {
    const payload = {
      type: 'code.pr.triage.requested',
      eventId,
      repository: 'pbuchman/intexuraos',
      pullRequestNumber: 9999,
      correlationId: 'corr-1',
      timestamp: new Date().toISOString(),
    };
    return {
      message: {
        data: Buffer.from(JSON.stringify(payload)).toString('base64'),
        messageId: 'msg-1',
        publishTime: new Date().toISOString(),
      },
      subscription: 'projects/p/subscriptions/intexuraos-pr-triage-dev-push',
    };
  }

  it('returns 200 and invokes unifiedEvaluator.evaluate when authenticated as Pub/Sub push', async () => {
    const eventId = (await fakeFirestore.collection('github-pr-events').listDocuments())[0].id;

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope(eventId),
    });

    expect(response.statusCode).toBe(200);
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(evaluateMock.mock.calls[0][0]).toMatchObject({
      id: eventId,
      pullRequestNumber: 9999,
      eventType: 'pull_request',
      action: 'opened',
    });
  });

  it('returns 200 and skips evaluation when the eventId is not found (avoid infinite redelivery)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope('does-not-exist'),
    });

    expect(response.statusCode).toBe(200);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it('returns 401 when neither Pub/Sub OIDC nor internal-auth is provided', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { 'content-type': 'application/json' },
      payload: pushEnvelope('any'),
    });
    expect(response.statusCode).toBe(401);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it('returns 500 (so Pub/Sub retries) when the evaluator throws', async () => {
    evaluateMock.mockRejectedValueOnce(new Error('LLM down'));
    const eventId = (await fakeFirestore.collection('github-pr-events').listDocuments())[0].id;

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope(eventId),
    });

    expect(response.statusCode).toBe(500);
  });
});
```

(Use the existing `mockServices` helper at `apps/code-agent/src/__tests__/helpers/mockServices.ts` to fill the rest of the container — see how `github-pre-events.test.ts` does it for a reference pattern.)

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @intexuraos/code-agent test -- prTriagePubsubRoute.test.ts
```

Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

```typescript
// apps/code-agent/src/routes/webhooks/prTriagePubsubRoute.ts
import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { authenticatePubSub, decodePubSubMessage } from './pubsubHelpers.js';
import type { PRTriageEvent } from '@intexuraos/infra-pubsub';

export const prTriagePubsubRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post('/internal/code/pubsub/pr-triage', async (request, reply) => {
    logIncomingRequest(request);

    const authed = await authenticatePubSub(request, reply);
    if (!authed) return;

    const decoded = decodePubSubMessage<PRTriageEvent>(request);
    if (decoded === null) {
      // Decode failure — ack to prevent infinite redelivery; investigation happens via DLQ logs.
      return await reply.code(200).send({});
    }

    const { eventId, correlationId, repository, pullRequestNumber } = decoded.data;
    const requestLogger = request.log.child({
      correlationId,
      eventId,
      repository,
      prNumber: pullRequestNumber,
      messageId: decoded.messageId,
    });

    const { gitHubPREventRepo, unifiedEvaluator } = getServices();

    const fetchResult = await gitHubPREventRepo.findById(eventId);
    if (!fetchResult.ok) {
      requestLogger.error(
        { error: fetchResult.error.message }, // @allow-result-access -- narrowed by !fetchResult.ok
        'Failed to load github-pr-events doc for triage'
      );
      // Repository-level failure (Firestore down) → 500 so Pub/Sub retries.
      return await reply.code(500).send({ error: 'firestore_unavailable' });
    }

    const event = fetchResult.value; // @allow-result-access -- narrowed by !fetchResult.ok
    if (event === null) {
      requestLogger.warn('github-pr-events doc not found — acking to drop message');
      // Not-found is not retriable; ack to prevent the message from looping until DLQ.
      return await reply.code(200).send({});
    }

    try {
      await unifiedEvaluator.evaluate(event, requestLogger);
      return await reply.code(200).send({});
    } catch (err: unknown) {
      requestLogger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'unifiedEvaluator.evaluate threw — returning 500 for Pub/Sub retry'
      );
      return await reply.code(500).send({ error: 'evaluator_failed' });
    }
  });

  done();
};
```

You will need a `findById(eventId)` method on `GitHubPREventRepository`. Check whether it already exists:

```bash
rg -n "findById\(|findEventById" apps/code-agent/src/domain/repositories/gitHubPREventRepository.ts apps/code-agent/src/infra/firestore/gitHubPREventsRepository.ts
```

If absent, add it. The repository interface lives at `apps/code-agent/src/domain/repositories/gitHubPREventRepository.ts`. Add this method to the interface and to the Firestore impl:

```typescript
// In the interface (apps/code-agent/src/domain/repositories/gitHubPREventRepository.ts)
findById(eventId: string): Promise<Result<GitHubPREvent | null, RepositoryError>>;

// In the Firestore impl (apps/code-agent/src/infra/firestore/gitHubPREventsRepository.ts)
async findById(eventId: string): Promise<Result<GitHubPREvent | null, RepositoryError>> {
  try {
    const snap = await collection.doc(eventId).get();
    if (!snap.exists) return ok(null);
    const data = snap.data() ?? {};
    return ok(toGitHubPREvent(snap.id, data));   // reuse the existing data-mapping function;
                                                 // if it doesn't exist, factor it out from the
                                                 // existing query methods in the same file
  } catch (error) {
    return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
  }
}
```

If `toGitHubPREvent` does not yet exist as a shared helper, extract it from whichever method already maps Firestore docs to `GitHubPREvent` (likely a `findByDeliveryId` or similar — open the file and look). Don't duplicate the mapping logic.

- [ ] **Step 4: Register the route in the webhook plugin index**

Find where webhook routes are registered (e.g. `apps/code-agent/src/routes/webhooks/index.ts` or wherever `fastify.register(githubWebhookRoute)` is called) and add:

```typescript
import { prTriagePubsubRoute } from './prTriagePubsubRoute.js';

// inside the registration plugin:
fastify.register(prTriagePubsubRoute);
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
pnpm --filter @intexuraos/code-agent test -- prTriagePubsubRoute.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/webhooks/prTriagePubsubRoute.ts apps/code-agent/src/__tests__/routes/webhooks/prTriagePubsubRoute.test.ts apps/code-agent/src/domain/repositories/gitHubPREventRepository.ts apps/code-agent/src/infra/firestore/gitHubPREventsRepository.ts
# include the route registration file in this commit too
git commit -m "feat(code-agent): add /internal/code/pubsub/pr-triage push handler"
```

---

### Task 8: Add the Terraform topic + push subscription

**Files:**
- Create: `terraform/environments/dev/pubsub_pr_triage.tf`
- Modify: `terraform/environments/dev/main.tf` — add `INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC` to code-agent's `env_vars` block

- [ ] **Step 1: Locate code-agent's env_vars block and add the topic env var**

```bash
rg -n "module \"code_agent\"|module.code_agent " terraform/environments/dev/main.tf | head -20
```

Find the `module "code_agent"` declaration and its `env_vars = merge(...)` block. Add:

```terraform
INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC = "intexuraos-pr-triage-${var.environment}"
```

- [ ] **Step 2: Create the Pub/Sub module invocation**

```terraform
# terraform/environments/dev/pubsub_pr_triage.tf
# Topic + push subscription that decouples GitHub webhook ingestion from
# unifiedEvaluator triage. Webhook publishes to this topic; the push
# subscription invokes /internal/code/pubsub/pr-triage on code-agent so
# evaluation runs inside its own request lifetime (Cloud Run CPU
# throttling and revision rollovers can no longer drop triage work).

module "pubsub_pr_triage" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-pr-triage-${var.environment}"
  labels         = local.common_labels

  push_endpoint              = "${module.code_agent.service_url}/internal/code/pubsub/pr-triage"
  push_service_account_email = module.iam.service_accounts["code_agent"]
  push_audience              = module.code_agent.service_url

  # Triage runs an LLM + Linear API + Firestore writes; budget room above default 60s.
  ack_deadline_seconds = 300

  publisher_service_accounts = {
    code_agent = module.iam.service_accounts["code_agent"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
    module.code_agent,
  ]
}
```

- [ ] **Step 3: Format and validate Terraform**

```bash
cd terraform/environments/dev && terraform fmt -check && terraform validate
```

Expected: no diff from `fmt`, `validate` succeeds. If `validate` complains about uninitialized providers, run `terraform init` first.

- [ ] **Step 4: Plan against dev**

```bash
cd terraform/environments/dev && terraform plan -out=/tmp/pr-triage.tfplan
```

Expected output: `Plan: 4 to add, 1 to change, 0 to destroy.`
- 4 adds = topic, dlq topic, push subscription, dlq subscription, plus IAM bindings (count may vary by ±2 depending on `for_each` resolution)
- 1 change = the `code_agent` Cloud Run service revision (new env var)

Inspect the diff to confirm no unexpected changes.

- [ ] **Step 5: Commit (do not apply yet — apply happens in Task 10)**

```bash
git add terraform/environments/dev/pubsub_pr_triage.tf terraform/environments/dev/main.tf
git commit -m "infra(terraform): provision PR triage topic + push subscription for code-agent"
```

---

### Task 9: Add the env var to ecosystem.config.cjs (PM2 dev shells)

**Files:**
- Modify: `ecosystem.config.cjs`

- [ ] **Step 1: Locate code-agent's env block**

```bash
rg -n "code-agent|INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC" ecosystem.config.cjs | head -20
```

Find the `code-agent` app entry (the section setting `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` for code-agent).

- [ ] **Step 2: Add the var with a dev fallback**

In code-agent's `env: { ... }` block, add:

```javascript
INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC:
  process.env.INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC ?? 'intexuraos-pr-triage-dev',
```

The fallback `intexuraos-pr-triage-dev` matches the topic name Terraform creates for `var.environment = "dev"` (see Task 8), so dev shells publish to the real dev topic.

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.cjs
git commit -m "chore(dev): add INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC for code-agent in PM2 ecosystem"
```

---

### Task 10: Run full CI, deploy infra, smoke-test on dev

**Files:** none (verification only)

- [ ] **Step 1: Run the repo-wide CI gate**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked.txt
```

Expected: PASS end-to-end. If it fails, fix the failure and re-run before applying infra.

- [ ] **Step 2: Apply Terraform (after CI passes)**

```bash
cd terraform/environments/dev && terraform apply /tmp/pr-triage.tfplan
```

Expected: `Apply complete! Resources: N added, 1 changed, 0 destroyed.` Confirm the `intexuraos-pr-triage-dev` topic exists:

```bash
gcloud pubsub topics describe intexuraos-pr-triage-dev --project=intexuraos-dev-pbuchman
gcloud pubsub subscriptions describe intexuraos-pr-triage-dev-push --project=intexuraos-dev-pbuchman
```

- [ ] **Step 3: Wait for the new code-agent revision to roll out**

```bash
gcloud run services describe intexuraos-code-agent --region=europe-central2 --project=intexuraos-dev-pbuchman --format='value(status.latestReadyRevisionName,status.latestCreatedRevisionName)'
```

Both fields should match. If not, wait or check `gcloud run revisions describe ...` for a deploy failure.

- [ ] **Step 4: Smoke test by opening a throwaway PR**

Open a trivial PR (e.g. add a blank line to a markdown file) targeting `development`. Observe:
1. The PR comment "IntexuraOS Automation" appears within seconds with `**HH:MM TZ** -- PR opened by @<sender>`.
2. Within ~30 seconds, the same comment is appended with `**HH:MM TZ** -- Triage → dispatching review (...)` and `**HH:MM TZ** -- Review dispatched | <worker> | [View task](...)`.
3. Cloud Run logs show the push handler ran:
   ```bash
   gcloud logging read 'resource.labels.service_name="intexuraos-code-agent" AND httpRequest.requestUrl=~"/internal/code/pubsub/pr-triage"' --project=intexuraos-dev-pbuchman --limit=10 --format='value(timestamp,httpRequest.status,jsonPayload.msg)' --freshness=10m
   ```
   Expected: at least one row with `status=200` and `msg=Authenticated Pub/Sub push request (OIDC validated by Cloud Run)`.

- [ ] **Step 5: Force a deploy mid-webhook to verify the original failure mode is fixed**

Open a second throwaway PR. Immediately trigger a redeploy of code-agent (e.g. push a no-op commit to `development` that triggers the deploy workflow). Confirm the second PR still gets a `Triage → dispatching` event in its automation comment within 30s, even with the deploy in flight.

- [ ] **Step 6: Verify DLQ is empty**

```bash
gcloud pubsub subscriptions pull intexuraos-pr-triage-dev-dlq-sub --project=intexuraos-dev-pbuchman --limit=10 --auto-ack=false
```

Expected: 0 messages.

- [ ] **Step 7: Push the branch and open a PR**

```bash
git push -u origin <branch>
gh pr create --base development --title "INT-XXXX: route PR triage through Pub/Sub push subscription" --body "$(cat <<'EOF'
## Summary
Replaces the GitHub webhook's fire-and-forget `void unifiedEvaluator.evaluate(...)` call with a Pub/Sub publish + push subscription. Triage now runs inside its own HTTP request, so Cloud Run CPU throttling and revision rollovers can no longer drop work mid-flight.

Fixes INT-XXXX.

## Test plan
- [x] Unit tests for new publisher, helpers, route handler
- [x] Existing webhook tests updated to assert publish-instead-of-evaluate
- [x] `pnpm run ci:tracked` passes
- [x] Terraform plan reviewed and applied to dev
- [x] Smoke test: PR opened on dev, triage event appears in PR comment
- [x] Smoke test: PR opened during code-agent redeploy, triage still runs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

(Replace `INT-XXXX` with the real Linear issue ID — ask the user if not provided.)

---

## Self-Review Notes

**Spec coverage:** every architectural concern from the diagnosis is addressed:
- Fire-and-forget evaluator → moved to push handler with `await` (Tasks 5, 7)
- CPU-throttling kill → handler runs inside in-flight HTTP request (Task 7)
- Deploy mid-webhook → publish completes synchronously before webhook returns; push subscription delivers to whichever revision is healthy (Tasks 5, 8, 10 step 5)
- Silent failure (no log, no error) → repo errors return 500, eval errors return 500, both trigger Pub/Sub retry; DLQ catches permanent failures (Task 7, Task 8 module config)

**Placeholder scan:** every code step has runnable code; no "TBD" / "similar to" references; expected output named for every command.

**Type consistency:** `PRTriageEvent` shape consistent across publisher (Task 2), webhook usage (Task 5), and route handler (Task 7). `findById(eventId): Promise<Result<GitHubPREvent | null, RepositoryError>>` consistent between interface and Firestore impl (Task 7).

**Open question for the executor:** the existing `MockServices` helper at `apps/code-agent/src/__tests__/helpers/mockServices.ts` may need `prTriagePublisher` added to its return shape — Task 4 covers per-test sites, but if there's a centralized factory, also update it there once and the per-test overrides become unnecessary.
