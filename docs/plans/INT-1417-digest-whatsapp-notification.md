# INT-1417 — WhatsApp delivery for Digest Mobile Notification summaries

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `runDigestForGroup` persists a new digest summary, also publish a WhatsApp message containing the digest headline + top bullets with a CTA button that links to the full digest in the web app.

**Architecture:**
- Confine the change to `apps/mobile-notifications-service`. The existing `apps/whatsapp-service` consumer already handles `ctaUrl` payloads — no consumer changes.
- Follow the `apps/research-agent` pattern: add a domain port (`DigestNotifier`) with a Noop default and a `WhatsAppDigestNotifier` concrete adapter that wraps `createWhatsAppSendPublisher` from `@intexuraos/infra-pubsub`.
- Invoke the notifier from `runDigestForGroup` only after both `digestRepository.save` and `groupStateRepository.save` succeed, so the WhatsApp notification accurately reflects what was persisted. Publish failures log and no-op — they must not fail the digest pipeline (the persisted digest is the source of truth).
- Build the CTA URL from `INTEXURAOS_WEB_APP_URL` + `/#/notifications/digests/<groupKey>/<date>` — the exact digest that was just saved (per review memory INT-1417/mem_318cb71f: CTAs must target the newly-created resource, not a stale parent).

**Tech Stack:**
- TypeScript (strict mode)
- `@intexuraos/infra-pubsub` → `createWhatsAppSendPublisher` (existing)
- `@intexuraos/common-core` → `Result`, `Logger`
- `@intexuraos/infra-sentry` → `createAppLogger`
- Vitest (in-memory fakes, no network)

**Endpoint Changes:**
- Modified: none (no HTTP contract changes).
- Created: none.
- Removed: none.
- Unchanged: `POST /internal/notifications/digest/run-group`, `POST /internal/notifications/digest/run-yesterday`, all `/notifications/digests/*` user routes. WhatsApp Pub/Sub subscriber (`POST /internal/whatsapp/pubsub/send-message`) is consumed as-is.

---

## File Structure

**Create**
- `apps/mobile-notifications-service/src/domain/services/digestNotifier.ts` — port interface + error type + Noop implementation.
- `apps/mobile-notifications-service/src/infra/notification/whatsappDigestNotifier.ts` — concrete implementation using `WhatsAppSendPublisher`.
- `apps/mobile-notifications-service/src/infra/notification/formatDigestMessage.ts` — pure message formatter (headline + bullets truncation).
- `apps/mobile-notifications-service/src/infra/notification/index.ts` — barrel.
- `apps/mobile-notifications-service/src/__tests__/infra/notification/whatsappDigestNotifier.test.ts`
- `apps/mobile-notifications-service/src/__tests__/infra/notification/formatDigestMessage.test.ts`

**Modify**
- `apps/mobile-notifications-service/src/services.ts` — add `digestNotifier: DigestNotifier` to `ServiceContainer`; wire `WhatsAppDigestNotifier` from env vars (fallback to `NoopDigestNotifier` when config is missing).
- `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts` — after persisting summary + state, call `services.digestNotifier.sendDigestReady(...)`; swallow error after logging.
- `apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts` — include `digestNotifier` in the test container (default Noop).
- `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts` — assert notifier is called exactly once on happy path, zero times on lock-held / save-failure paths, and that failures from the notifier do not fail the use case.
- `apps/mobile-notifications-service/src/index.ts` — add `INTEXURAOS_WEB_APP_URL` and `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` to `REQUIRED_ENV`.
- `terraform/environments/dev/main.tf` — extend the `module "mobile_notifications_service"` `env_vars` block with `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` and `INTEXURAOS_WEB_APP_URL`.
- `ecosystem.config.cjs` — extend `SERVICE_ENV_MAPPINGS['mobile-notifications-service']` with `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC` (WEB_APP_URL already in `COMMON_SERVICE_ENV`).

---

## Pre-Flight (do these before starting)

- Read `/repo/apps/research-agent/src/infra/notification/WhatsAppNotificationSender.ts` and `/repo/apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` — these are the two reference patterns.
- Read `/repo/packages/infra-pubsub/src/whatsappSendPublisher.ts` lines 1-88 — the publisher signature you'll call.
- Read `/repo/apps/mobile-notifications-service/src/services.ts` (all 56 lines) — the DI shape you'll extend.
- Read `/repo/apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts` (all 125 lines) — know exactly where to hook the call.
- Read `/repo/apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts` — test container shape.
- Run `pnpm build` from the repo root once to make sure `packages/infra-pubsub/dist` exists (so import `@intexuraos/infra-pubsub` resolves in tests).

---

## Task 1: Domain port — `DigestNotifier`

**Files:**
- Create: `apps/mobile-notifications-service/src/domain/services/digestNotifier.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile-notifications-service/src/__tests__/domain/services/digestNotifier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { NoopDigestNotifier } from '../../../domain/services/digestNotifier.js';

describe('NoopDigestNotifier', () => {
  it('returns ok without publishing anything', async () => {
    const notifier = new NoopDigestNotifier();
    const result = await notifier.sendDigestReady({
      userId: 'u',
      groupKey: 'g',
      date: '2026-04-15',
      headline: 'h',
      bullets: ['b1', 'b2', 'b3'],
      messageCount: 10,
    });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm -C apps/mobile-notifications-service test -- digestNotifier.test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/mobile-notifications-service/src/domain/services/digestNotifier.ts`:

```typescript
import { ok, type Result } from '@intexuraos/common-core';

export interface DigestNotificationError {
  readonly code: 'notification_failed';
  readonly message: string;
}

export interface DigestReadyInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string; // YYYY-MM-DD
  readonly headline: string;
  readonly bullets: readonly string[];
  readonly messageCount: number;
}

export interface DigestNotifier {
  sendDigestReady(input: DigestReadyInput): Promise<Result<void, DigestNotificationError>>;
}

export class NoopDigestNotifier implements DigestNotifier {
  async sendDigestReady(_input: DigestReadyInput): Promise<Result<void, DigestNotificationError>> {
    return await Promise.resolve(ok(undefined));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm -C apps/mobile-notifications-service test -- digestNotifier.test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/services/digestNotifier.ts \
        apps/mobile-notifications-service/src/__tests__/domain/services/digestNotifier.test.ts
git commit -m "feat(mobile-notifications-service): add DigestNotifier port and Noop impl (INT-1417)"
```

---

## Task 2: Pure message formatter

**Files:**
- Create: `apps/mobile-notifications-service/src/infra/notification/formatDigestMessage.ts`
- Test: `apps/mobile-notifications-service/src/__tests__/infra/notification/formatDigestMessage.test.ts`

**Design notes:**
- WhatsApp text is capped at 1024 characters for interactive CTA messages. Keep headroom: hard-cap at 900 chars total body; truncate bullets first (keep at most 5), then truncate each bullet to 180 chars with `…`.
- Message shape (mirrors the code-agent style: emoji + title + blank line + body):

```
📬 <headline>

• <bullet 1>
• <bullet 2>
…

<messageCount> messages today
```

- [ ] **Step 1: Write the failing tests**

`apps/mobile-notifications-service/src/__tests__/infra/notification/formatDigestMessage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatDigestMessage } from '../../../infra/notification/formatDigestMessage.js';

describe('formatDigestMessage', () => {
  it('emits emoji header, bullets and message count', () => {
    const msg = formatDigestMessage({
      headline: 'Quiet day on the lake',
      bullets: ['Rain forecast', 'New member joined', 'Gear tip on line X'],
      messageCount: 42,
    });
    expect(msg).toContain('📬 Quiet day on the lake');
    expect(msg).toContain('• Rain forecast');
    expect(msg).toContain('• New member joined');
    expect(msg).toContain('• Gear tip on line X');
    expect(msg).toContain('42 messages today');
  });

  it('keeps at most 5 bullets', () => {
    const msg = formatDigestMessage({
      headline: 'h',
      bullets: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      messageCount: 1,
    });
    expect(msg).toContain('• a');
    expect(msg).toContain('• e');
    expect(msg).not.toContain('• f');
    expect(msg).not.toContain('• g');
  });

  it('truncates each bullet to 180 chars with ellipsis', () => {
    const long = 'x'.repeat(500);
    const msg = formatDigestMessage({
      headline: 'h',
      bullets: [long],
      messageCount: 1,
    });
    const bulletLine = msg.split('\n').find((l) => l.startsWith('• ')) ?? '';
    expect(bulletLine.length).toBeLessThanOrEqual('• '.length + 180 + 1); // '…'
    expect(bulletLine.endsWith('…')).toBe(true);
  });

  it('keeps total body under 900 chars even with long headline', () => {
    const msg = formatDigestMessage({
      headline: 'y'.repeat(400),
      bullets: ['x'.repeat(180), 'x'.repeat(180), 'x'.repeat(180), 'x'.repeat(180), 'x'.repeat(180)],
      messageCount: 99,
    });
    expect(msg.length).toBeLessThanOrEqual(900);
  });

  it('uses singular grammar for one message', () => {
    const msg = formatDigestMessage({ headline: 'h', bullets: ['a', 'b', 'c'], messageCount: 1 });
    expect(msg).toContain('1 message today');
  });
});
```

- [ ] **Step 2: Run test — verify failure**

```
pnpm -C apps/mobile-notifications-service test -- formatDigestMessage.test
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/mobile-notifications-service/src/infra/notification/formatDigestMessage.ts`:

```typescript
const MAX_BULLETS = 5;
const MAX_BULLET_CHARS = 180;
const MAX_BODY_CHARS = 900;

export interface FormatDigestMessageInput {
  readonly headline: string;
  readonly bullets: readonly string[];
  readonly messageCount: number;
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…`;
}

export function formatDigestMessage(input: FormatDigestMessageInput): string {
  const bullets = input.bullets
    .slice(0, MAX_BULLETS)
    .map((b) => `• ${truncate(b, MAX_BULLET_CHARS)}`);
  const noun = input.messageCount === 1 ? 'message' : 'messages';
  const body = [
    `📬 ${input.headline}`,
    '',
    ...bullets,
    '',
    `${String(input.messageCount)} ${noun} today`,
  ].join('\n');
  return truncate(body, MAX_BODY_CHARS);
}
```

- [ ] **Step 4: Run tests — verify pass**

```
pnpm -C apps/mobile-notifications-service test -- formatDigestMessage.test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/infra/notification/formatDigestMessage.ts \
        apps/mobile-notifications-service/src/__tests__/infra/notification/formatDigestMessage.test.ts
git commit -m "feat(mobile-notifications-service): add formatDigestMessage helper (INT-1417)"
```

---

## Task 3: `WhatsAppDigestNotifier` adapter

**Files:**
- Create: `apps/mobile-notifications-service/src/infra/notification/whatsappDigestNotifier.ts`
- Create: `apps/mobile-notifications-service/src/infra/notification/index.ts`
- Test: `apps/mobile-notifications-service/src/__tests__/infra/notification/whatsappDigestNotifier.test.ts`

**Design notes:**
- Takes `WhatsAppSendPublisher` + `webAppUrl` + `logger` as config.
- Constructs `ctaUrl.url` = `${webAppUrl}/#/notifications/digests/${encodeURIComponent(groupKey)}/${encodeURIComponent(date)}` with `displayText: 'View Full Digest'`. The `#/` hash prefix is required by the web app's hash router.
- Uses `correlationId = 'digest-ready-<userId>-<groupKey>-<date>'` (stable, idempotent per digest-day).
- Maps `PublishError` → `DigestNotificationError { code: 'notification_failed', message }`.
- **Memory INT-1417 / mem_318cb71f** applies: the CTA must link to the exact `(groupKey, date)` that was just saved — never to `yesterdayCet()` or `latest`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile-notifications-service/src/__tests__/infra/notification/whatsappDigestNotifier.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher, PublishError } from '@intexuraos/infra-pubsub';
import { WhatsAppDigestNotifier } from '../../../infra/notification/whatsappDigestNotifier.js';

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakePublisher(impl: (params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]) => Promise<Result<void, PublishError>>): WhatsAppSendPublisher {
  return { publishSendMessage: impl };
}

describe('WhatsAppDigestNotifier', () => {
  it('publishes a WhatsApp message with a CTA pointing at the saved digest', async () => {
    const captured: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0][] = [];
    const publisher = fakePublisher(async (p) => { captured.push(p); return ok(undefined); });
    const notifier = new WhatsAppDigestNotifier({
      publisher,
      webAppUrl: 'https://intexuraos.cloud',
      logger: noopLogger,
    });
    const result = await notifier.sendDigestReady({
      userId: 'u1',
      groupKey: 'my group',
      date: '2026-04-15',
      headline: 'Quiet day',
      bullets: ['a', 'b', 'c'],
      messageCount: 7,
    });
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.userId).toBe('u1');
    expect(captured[0]?.message).toContain('Quiet day');
    expect(captured[0]?.ctaUrl?.displayText).toBe('View Full Digest');
    expect(captured[0]?.ctaUrl?.url).toBe(
      'https://intexuraos.cloud/#/notifications/digests/my%20group/2026-04-15'
    );
    expect(captured[0]?.correlationId).toBe('digest-ready-u1-my group-2026-04-15');
  });

  it('returns notification_failed error when publisher returns err', async () => {
    const publisher = fakePublisher(async () => err({ code: 'PUBLISH_FAILED', message: 'boom' }));
    const notifier = new WhatsAppDigestNotifier({
      publisher,
      webAppUrl: 'https://intexuraos.cloud',
      logger: noopLogger,
    });
    const result = await notifier.sendDigestReady({
      userId: 'u', groupKey: 'g', date: '2026-04-15',
      headline: 'h', bullets: ['a', 'b', 'c'], messageCount: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('notification_failed');
    expect(result.error.message).toContain('boom');
  });

  it('trims trailing slash in webAppUrl before building the CTA', async () => {
    const captured: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0][] = [];
    const publisher = fakePublisher(async (p) => { captured.push(p); return ok(undefined); });
    const notifier = new WhatsAppDigestNotifier({
      publisher,
      webAppUrl: 'https://intexuraos.cloud/',
      logger: noopLogger,
    });
    await notifier.sendDigestReady({
      userId: 'u', groupKey: 'g', date: '2026-04-15',
      headline: 'h', bullets: ['a', 'b', 'c'], messageCount: 1,
    });
    expect(captured[0]?.ctaUrl?.url).toBe('https://intexuraos.cloud/#/notifications/digests/g/2026-04-15');
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

```
pnpm -C apps/mobile-notifications-service test -- whatsappDigestNotifier.test
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/mobile-notifications-service/src/infra/notification/whatsappDigestNotifier.ts`:

```typescript
import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type {
  DigestNotificationError,
  DigestNotifier,
  DigestReadyInput,
} from '../../domain/services/digestNotifier.js';
import { formatDigestMessage } from './formatDigestMessage.js';

export interface WhatsAppDigestNotifierConfig {
  readonly publisher: WhatsAppSendPublisher;
  readonly webAppUrl: string;
  readonly logger: Logger;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function buildDigestUrl(webAppUrl: string, groupKey: string, date: string): string {
  const base = stripTrailingSlash(webAppUrl);
  return `${base}/#/notifications/digests/${encodeURIComponent(groupKey)}/${encodeURIComponent(date)}`;
}

export class WhatsAppDigestNotifier implements DigestNotifier {
  private readonly publisher: WhatsAppSendPublisher;
  private readonly webAppUrl: string;
  private readonly logger: Logger;

  constructor(config: WhatsAppDigestNotifierConfig) {
    this.publisher = config.publisher;
    this.webAppUrl = config.webAppUrl;
    this.logger = config.logger;
  }

  async sendDigestReady(input: DigestReadyInput): Promise<Result<void, DigestNotificationError>> {
    const message = formatDigestMessage({
      headline: input.headline,
      bullets: input.bullets,
      messageCount: input.messageCount,
    });
    const ctaUrl = { displayText: 'View Full Digest', url: buildDigestUrl(this.webAppUrl, input.groupKey, input.date) };
    const correlationId = `digest-ready-${input.userId}-${input.groupKey}-${input.date}`;

    const published = await this.publisher.publishSendMessage({
      userId: input.userId,
      message,
      ctaUrl,
      correlationId,
    });

    if (!published.ok) {
      this.logger.error(
        { userId: input.userId, groupKey: input.groupKey, date: input.date, error: published.error },
        'WhatsAppDigestNotifier: publish failed'
      );
      return err({ code: 'notification_failed', message: published.error.message });
    }

    this.logger.info(
      { userId: input.userId, groupKey: input.groupKey, date: input.date, correlationId },
      'WhatsAppDigestNotifier: digest-ready message published'
    );
    return ok(undefined);
  }
}
```

`apps/mobile-notifications-service/src/infra/notification/index.ts`:

```typescript
export { WhatsAppDigestNotifier } from './whatsappDigestNotifier.js';
export type { WhatsAppDigestNotifierConfig } from './whatsappDigestNotifier.js';
export { formatDigestMessage } from './formatDigestMessage.js';
export type { FormatDigestMessageInput } from './formatDigestMessage.js';
```

- [ ] **Step 4: Run tests — verify pass**

```
pnpm -C apps/mobile-notifications-service test -- whatsappDigestNotifier.test
```
Expected: PASS (all three assertions, including the CTA URL target).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/infra/notification/ \
        apps/mobile-notifications-service/src/__tests__/infra/notification/whatsappDigestNotifier.test.ts
git commit -m "feat(mobile-notifications-service): add WhatsAppDigestNotifier adapter (INT-1417)"
```

---

## Task 4: Wire `DigestNotifier` into the service container

**Files:**
- Modify: `apps/mobile-notifications-service/src/services.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts`

- [ ] **Step 1: Update the test helper (red, then green together with container)**

Edit `apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts`:

- Add the import at the top:

```typescript
import { NoopDigestNotifier } from '../../domain/services/digestNotifier.js';
import type { DigestNotifier } from '../../domain/services/digestNotifier.js';
```

- Add to the `container` literal (after `digestSubscriptions`):

```typescript
    digestNotifier: overrides.digestNotifier ?? new NoopDigestNotifier(),
```

This will fail to typecheck until `ServiceContainer` has `digestNotifier` — that's the red state.

- [ ] **Step 2: Extend the container**

Edit `apps/mobile-notifications-service/src/services.ts`:

- Add imports:

```typescript
import { createAppLogger } from '@intexuraos/infra-sentry';
import { createWhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { DigestNotifier } from './domain/services/digestNotifier.js';
import { NoopDigestNotifier } from './domain/services/digestNotifier.js';
import { WhatsAppDigestNotifier } from './infra/notification/index.js';
```

- Add field to `ServiceContainer`:

```typescript
  digestNotifier: DigestNotifier;
```

- Add a factory function (above `getServices`):

```typescript
function createDigestNotifier(): DigestNotifier {
  const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];
  const topicName = process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'];
  const webAppUrl = process.env['INTEXURAOS_WEB_APP_URL'];
  if (
    projectId === undefined || projectId === '' ||
    topicName === undefined || topicName === '' ||
    webAppUrl === undefined || webAppUrl === ''
  ) {
    return new NoopDigestNotifier();
  }
  const logger = createAppLogger({ name: 'whatsapp-digest-notifier' });
  const publisher = createWhatsAppSendPublisher({ projectId, topicName, logger });
  return new WhatsAppDigestNotifier({ publisher, webAppUrl, logger });
}
```

- Update the lazy init:

```typescript
  container ??= {
    signatureConnectionRepository: new FirestoreSignatureConnectionRepository(),
    notificationRepository: new FirestoreNotificationRepository(),
    notificationFiltersRepository: new FirestoreNotificationFiltersRepository(),
    digestRepository: new FirestoreDigestRepository(),
    groupStateRepository: new FirestoreGroupStateRepository(),
    digestLockRepository: new FirestoreDigestLockRepository(),
    backfillRunRepository: new FirestoreBackfillRunRepository(),
    digestSubscriptions: DIGEST_SUBSCRIPTIONS,
    digestNotifier: createDigestNotifier(),
  };
```

- [ ] **Step 3: Run the existing test suite to verify nothing else regressed**

```
pnpm -C apps/mobile-notifications-service test
```
Expected: all pre-existing tests pass (the container literal now includes `digestNotifier`, and `mockServices` provides a Noop default for unrelated tests).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile-notifications-service/src/services.ts \
        apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts
git commit -m "feat(mobile-notifications-service): wire DigestNotifier into ServiceContainer (INT-1417)"
```

---

## Task 5: Invoke the notifier from `runDigestForGroup`

**Files:**
- Modify: `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts`

**Design notes:**
- Call the notifier **after both saves succeed** — before `return ok(...)`, still inside the try. If the notifier fails, log and continue: the digest is already persisted and the run must report success.
- Skip the notifier when `generation > 1` is NOT required; the task says "When a new Digest ... is generated and saved" — send on every successful save. If the user later wants to suppress regenerations, it's a trivial follow-up (add `if (persistSummary.value.generation === 1)` gate). Call this out in the PR description as an open question.

- [ ] **Step 1: Extend the happy-path test (red)**

Open `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts` and add a new test inside the `describe('runDigestForGroup', ...)` block:

```typescript
  it('publishes a WhatsApp digest-ready notification after successful save', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    const sent: unknown[] = [];
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: true } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => ({ ok: true, value: undefined }),
      },
      digestNotifier: {
        sendDigestReady: async (input) => { sent.push(input); return { ok: true as const, value: undefined }; },
      },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    const call = sent[0] as { userId: string; groupKey: string; date: string; headline: string; bullets: readonly string[]; messageCount: number };
    expect(call.userId).toBe('u');
    expect(call.groupKey).toBe('g');
    expect(call.date).toBe('2026-04-15');
    expect(call.headline).toBe(EXAMPLE_SUMMARY.headline);
    expect(call.bullets).toEqual(EXAMPLE_SUMMARY.bullets);
    expect(call.messageCount).toBe(EXAMPLE_SUMMARY.messageCount);
  });

  it('does NOT notify when the lock is held', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    const notifier = { sendDigestReady: vi.fn(async () => ({ ok: true as const, value: undefined })) };
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: false, heldBy: 'cron' } }),
        release: async () => ({ ok: true, value: undefined }),
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
      digestNotifier: notifier,
    });
    await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(notifier.sendDigestReady).not.toHaveBeenCalled();
  });

  it('does NOT notify when digestRepository.save fails', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    const notifier = { sendDigestReady: vi.fn(async () => ({ ok: true as const, value: undefined })) };
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: false as const, error: { code: 'INTERNAL_ERROR', message: 'boom' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
      digestNotifier: notifier,
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(false);
    expect(notifier.sendDigestReady).not.toHaveBeenCalled();
  });

  it('still returns ok(...) when the digest notifier fails', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }),
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
      digestNotifier: {
        sendDigestReady: async () => ({ ok: false as const, error: { code: 'notification_failed', message: 'pubsub down' } }),
      },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(true);
  });
```

Note: the existing happy-path test already uses `setMockServices` without passing `digestNotifier`; it will default to the Noop from Task 4, so it continues to pass.

- [ ] **Step 2: Run tests — verify failures**

```
pnpm -C apps/mobile-notifications-service test -- runDigestForGroup.test
```
Expected: the four new tests fail (no notifier call wired yet).

- [ ] **Step 3: Wire the notifier call in the use case**

Edit `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts`:

Replace the block starting at `const persistState = await services.groupStateRepository.save({` (line 103) through `return ok({ ... });` (line 115) with:

```typescript
    const persistState = await services.groupStateRepository.save({
      state: aggregation.value.stateUpdate,
      date: input.date,
    });
    if (!persistState.ok) return err(persistenceFailed(persistState.error.message));

    // Fire-and-log WhatsApp digest notification. The digest is already persisted;
    // a notification failure must not fail the use case (observed via logger).
    const notified = await services.digestNotifier.sendDigestReady({
      userId: input.userId,
      groupKey: input.groupKey,
      date: input.date,
      headline: aggregation.value.dailySummary.headline,
      bullets: aggregation.value.dailySummary.bullets,
      messageCount: aggregation.value.dailySummary.messageCount,
    });
    if (!notified.ok) {
      deps.logger.warn(
        { userId: input.userId, groupKey: input.groupKey, date: input.date, error: notified.error },
        'runDigestForGroup: digest notifier failed; digest still persisted',
      );
    }

    return ok({
      summary: aggregation.value.dailySummary,
      state: aggregation.value.stateUpdate,
      generation: persistSummary.value.generation,
      modelId: deps.modelId,
      regenerated: persistSummary.value.generation > 1,
    });
```

- [ ] **Step 4: Run tests — verify pass**

```
pnpm -C apps/mobile-notifications-service test
```
Expected: all tests pass (new ones plus all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts \
        apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts
git commit -m "feat(mobile-notifications-service): publish WhatsApp digest-ready notification on save (INT-1417)"
```

---

## Task 6: Env var registration in all three locations

Per CLAUDE.md, every new `INTEXURAOS_*` required by a service must be declared in three places.

- [ ] **Step 1: Declare in service `REQUIRED_ENV`**

Edit `apps/mobile-notifications-service/src/index.ts` — append to `REQUIRED_ENV`:

```typescript
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_WEB_APP_URL',
```

Final array:

```typescript
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_DIGEST_LLM_MODEL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_WEB_APP_URL',
];
```

- [ ] **Step 2: Declare in Terraform dev env**

Edit `terraform/environments/dev/main.tf`, inside `module "mobile_notifications_service"` (around line 997), extend the `env_vars` block:

```hcl
  env_vars = merge(local.common_service_env_vars, {
    INTEXURAOS_DIGEST_LLM_MODEL           = "or:google/gemini-3-flash-preview"
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC = "intexuraos-whatsapp-send-${var.environment}"
    INTEXURAOS_WEB_APP_URL                = "https://${var.web_app_domain}"
  })
```

Note: `INTEXURAOS_WEB_APP_URL` is NOT part of `local.common_service_env_vars` (verified against `terraform/environments/dev/main.tf` lines 278-303) — it MUST be declared explicitly here, matching the pattern used by `research_agent` (line 1141) and `actions_agent` (line 1207).

- [ ] **Step 3: Declare in PM2 dev shell**

Edit `ecosystem.config.cjs`, in `SERVICE_ENV_MAPPINGS['mobile-notifications-service']` (around line 167):

```javascript
  'mobile-notifications-service': {
    INTEXURAOS_DIGEST_LLM_MODEL:
      process.env.INTEXURAOS_DIGEST_LLM_MODEL ?? 'or:google/gemini-3-flash-preview',
    INTEXURAOS_OPENROUTER_APP_API_KEY: process.env.INTEXURAOS_OPENROUTER_APP_API_KEY,
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
      process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
  },
```

Note: `INTEXURAOS_WEB_APP_URL` is already in `COMMON_SERVICE_ENV` (line 23) — do not re-declare.

- [ ] **Step 4: Run env-var sync verifier**

```
node scripts/verify-env-vars.mjs
```
Expected: exits 0 (no missing / mismatched env vars). If it fails, read the output — the three locations must be consistent.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/index.ts \
        terraform/environments/dev/main.tf \
        ecosystem.config.cjs
git commit -m "chore(mobile-notifications-service): register WhatsApp send topic env var in 3 locations (INT-1417)"
```

---

## Task 7: Full verification

- [ ] **Step 1: Workspace verification**

```
pnpm run verify:workspace:tracked -- mobile-notifications-service
```
Expected: all tasks green (typecheck, lint, tests, coverage ≥95%).

- [ ] **Step 2: Global CI**

```
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int-1417.txt
```
Expected: exit 0. If anything fails in ANY workspace, per the Commit Gate, fix it before merging — do not say "other services".

- [ ] **Step 3: Hand-verify message shape via unit output**

```
pnpm -C apps/mobile-notifications-service test -- whatsappDigestNotifier.test --reporter=verbose
```
Expected: the CTA URL assertion (`https://intexuraos.cloud/#/notifications/digests/...`) passes — this is the memory-driven CTA-target guarantee.

- [ ] **Step 4: If all green, push & open the implementation PR** (not this planning PR)

```
gh pr create --title "[INT-1417] Enable WhatsApp delivery for Digest Mobile Notification summaries" --body "Fixes INT-1417 ..."
```

---

## Key Decisions

- **Where to publish:** use-case level (`runDigestForGroup`), not the repository. Aligns with research-agent/actions-agent patterns; keeps infra leaf-free of domain.
- **Failure mode:** notifier errors are logged as warnings and swallowed. The persisted digest is the source of truth and must never be "rolled back" by a transient Pub/Sub outage.
- **CTA target:** points to the exact `(groupKey, date)` just saved. Per review memory `mem_318cb71f`, CTAs in notifications must target the *new* resource — here that means the specific digest day that was just persisted, not a generic "latest" view.
- **Regeneration:** notification fires on every successful save, including `generation > 1`. If we later discover this is noisy, gating on `persistSummary.value.generation === 1` is a one-line follow-up.
- **No subtasks:** change is confined to one service; plan-doc delivery is sufficient.

## Open Questions

1. Should we suppress WhatsApp on regeneration (`generation > 1`)? Default: no. Raise with the user in the implementation PR.
2. `INTEXURAOS_WEB_APP_URL` at dev shell time defaults to `http://localhost:3000`. The CTA URL in local dev will be non-clickable on the phone — acceptable, since WhatsApp delivery in dev is end-to-end tested only in Cloud Run.

## Self-Review Checklist

- [x] Every spec requirement has a matching task (WhatsApp notification on save → Task 5; button linking to full digest → Task 3; follow existing patterns → matches `actions-agent` / `code-agent` / `research-agent`).
- [x] No placeholders / "TBD" / "similar to Task N".
- [x] Type consistency: `DigestNotifier`, `DigestReadyInput`, `DigestNotificationError` are defined in Task 1 and used verbatim in Tasks 3–5.
- [x] `formatDigestMessage` is referenced in Task 3 after being defined in Task 2.
- [x] Env var names (`INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, `INTEXURAOS_WEB_APP_URL`) are identical across Tasks 4 and 6.
- [x] CTA URL format (`${webAppUrl}/#/notifications/digests/<encoded-groupKey>/<encoded-date>`) matches the web route in `apps/web/src/App.tsx:552`.
