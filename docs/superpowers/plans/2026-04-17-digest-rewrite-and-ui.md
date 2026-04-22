# Digest Rewrite & UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix cross-day content contamination in WhatsApp group digests, replace prose `narrative` with hybrid `headline + bullets`, and redesign the digest list UI (drop heatmap, add month navigation).

**Architecture:** Three independent subsystems ship together: (1) mobile-notifications-service bug fix (add time-range filter to notification repo; apply CET day bounds in `runDigestForGroup`); (2) shared schema + LLM-prompts package change (new `headline`/`bullets` fields, prompt v2.0.0); (3) web UI (remove heatmap, new row layout, new detail component, month-based navigation). All existing `notification_daily_digests` docs are purged before deploy — legacy format not supported in new code.

**Tech Stack:** TypeScript strict mode, Fastify, Firestore, Zod, Vite + React + TailwindCSS, Vitest, Playwright (manual smoke only).

---

## Endpoint Changes

**Modified:** none (route shapes preserved).
**Created:** none.
**Removed:** none.
**Unchanged:**
- `POST /internal/notifications/digest/run`
- `POST /internal/notifications/digest/run-yesterday`
- `GET /notifications/digests/backfill/:runId`
- `GET /notifications/digests` (query params unchanged; response body shape evolves because `DailySummary` gains `headline`/`bullets`)
- `GET /notifications/digests/:groupKey/:date`
- `POST /notifications/digests/run`
- `POST /notifications/digests/backfill`
- `GET /notifications/digests/:groupKey/:date/state`

Response body fields **added**: `summary.headline: string`, `summary.bullets: string[]`. Field `summary.narrative` is **removed** — all legacy docs purged before deploy.

---

## File Structure

### Created
- `apps/mobile-notifications-service/src/domain/usecases/cetDayBounds.ts` — converts `YYYY-MM-DD` CET date to `{ fromSec, toSec }` unix-second boundaries (inclusive-exclusive).
- `apps/mobile-notifications-service/src/__tests__/domain/usecases/cetDayBounds.test.ts`
- `apps/web/src/components/notification-digests/DigestHighlight.tsx` — replaces `DigestNarrative.tsx`; renders `headline` + `bullets`.
- `apps/web/src/components/notification-digests/__tests__/DigestHighlight.test.tsx`
- `apps/web/src/components/notification-digests/MonthPicker.tsx` — prev/current/next month nav control.
- `apps/web/src/components/notification-digests/__tests__/MonthPicker.test.tsx`
- `apps/web/src/utils/__tests__/digestDates.test.ts` (if missing) — tests for new month helpers.

### Modified
- `apps/mobile-notifications-service/src/domain/notifications/ports/notificationRepository.ts` — add `postTimeSecFrom` + `postTimeSecTo` to `FilterOptions`.
- `apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts` — apply `timestamp` range filter in `buildQuery` and in `batchSize` heuristic.
- `apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts` — new cases for the time-range filter.
- `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts` — compute bounds via `cetDayBounds(input.date)` and pass them to the repo.
- `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts` — assert the filter is passed through.
- `apps/mobile-notifications-service/src/domain/messageFilter.ts` — no-op; bounds live in repo (keep filter focused on dedup/meta).
- `apps/mobile-notifications-service/src/domain/schemas/digestSchemas.ts` — add `headline: z.string().min(1)` and `bullets: z.array(z.string().min(1)).min(3).max(7)`; **remove** `narrative` field entirely.
- `apps/mobile-notifications-service/src/__tests__/digestSchemas.test.ts` — cover new fields.
- `packages/llm-prompts/src/digest/digestPrompt.ts` — rewrite content spec (headline + 3–7 bullets, explicit no-copy rule); bump `DIGEST_PROMPT_VERSION` to `2.0.0`.
- `packages/llm-prompts/src/digest/examples.ts` — add `headline` + `bullets` to both examples; shorten or drop `narrative`.
- `packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts` — assert new instructions + version.
- `apps/web/src/types/notificationDigests.ts` — add `headline` + `bullets` as required; **remove** `narrative` field.
- `apps/web/src/components/notification-digests/DigestRow.tsx` — show `headline` (fallback: "Brak wiadomości tego dnia") on one compact row.
- `apps/web/src/components/notification-digests/index.ts` — swap `DigestNarrative` export for `DigestHighlight`.
- `apps/web/src/pages/NotificationDigestViewPage.tsx` — use `DigestHighlight` instead of `DigestNarrative`.
- `apps/web/src/pages/NotificationDigestsPage.tsx` — remove `DigestHeatmap`; add `MonthPicker`; remove rolling-window date header copy.
- `apps/web/src/hooks/useDigestList.ts` — accept `month: 'YYYY-MM'`; compute from/to from month bounds; persist month in `localStorage` optional.
- `apps/web/src/utils/digestDates.ts` — add `firstDayOfMonth`, `lastDayOfMonth`, `shiftMonth`, `currentMonthIso`.

### Deleted
- `apps/web/src/components/notification-digests/DigestHeatmap.tsx`
- `apps/web/src/components/notification-digests/DigestNarrative.tsx` (superseded by `DigestHighlight.tsx`)

---

## Task 1: CET day bounds utility

**Files:**
- Create: `apps/mobile-notifications-service/src/domain/usecases/cetDayBounds.ts`
- Create: `apps/mobile-notifications-service/src/__tests__/domain/usecases/cetDayBounds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile-notifications-service/src/__tests__/domain/usecases/cetDayBounds.test.ts
import { describe, it, expect } from 'vitest';
import { cetDayBounds } from '../../../domain/usecases/cetDayBounds.js';

describe('cetDayBounds', () => {
  it('returns 00:00 CET (23:00 UTC prev day) .. 24:00 CET for a winter date (UTC+1)', () => {
    // 2026-02-10 CET = 2026-02-09T23:00:00Z .. 2026-02-10T23:00:00Z
    const bounds = cetDayBounds('2026-02-10');
    expect(new Date(bounds.fromSec * 1000).toISOString()).toBe('2026-02-09T23:00:00.000Z');
    expect(new Date(bounds.toSec * 1000).toISOString()).toBe('2026-02-10T23:00:00.000Z');
  });

  it('returns 00:00 CEST (22:00 UTC prev day) .. 24:00 CEST for a summer date (UTC+2)', () => {
    // 2026-07-15 CEST = 2026-07-14T22:00:00Z .. 2026-07-15T22:00:00Z
    const bounds = cetDayBounds('2026-07-15');
    expect(new Date(bounds.fromSec * 1000).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(new Date(bounds.toSec * 1000).toISOString()).toBe('2026-07-15T22:00:00.000Z');
  });

  it('emits bounds as unix seconds (not ms)', () => {
    const bounds = cetDayBounds('2026-04-17');
    expect(Number.isInteger(bounds.fromSec)).toBe(true);
    expect(bounds.toSec - bounds.fromSec).toBe(24 * 60 * 60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/domain/usecases/cetDayBounds.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/mobile-notifications-service/src/domain/usecases/cetDayBounds.ts
const TZ = 'Europe/Warsaw';

export interface DayBoundsSec {
  readonly fromSec: number;
  readonly toSec: number;
}

export function cetDayBounds(dateIso: string): DayBoundsSec {
  // Derive CET/CEST offset for the given local date by formatting a midday UTC
  // instant through Intl with timeZone=Europe/Warsaw and measuring the delta.
  const parts = dateIso.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    throw new Error(`cetDayBounds: invalid date ${dateIso}`);
  }
  // Find the UTC instant whose Europe/Warsaw local date is (y, m, d) at 00:00.
  // Brute-force search both sides of UTC midnight (one of ±1h, ±2h will match).
  const candidate = Date.UTC(y, m - 1, d);
  for (const offsetHours of [0, -1, -2, 1, 2]) {
    const t = candidate + offsetHours * 60 * 60 * 1000;
    const localParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(t));
    const localYear = localParts.find((p) => p.type === 'year')?.value;
    const localMonth = localParts.find((p) => p.type === 'month')?.value;
    const localDay = localParts.find((p) => p.type === 'day')?.value;
    const localHour = localParts.find((p) => p.type === 'hour')?.value;
    const localMinute = localParts.find((p) => p.type === 'minute')?.value;
    if (
      localYear === String(y) &&
      localMonth === String(m).padStart(2, '0') &&
      localDay === String(d).padStart(2, '0') &&
      localHour === '00' &&
      localMinute === '00'
    ) {
      const fromSec = Math.floor(t / 1000);
      return { fromSec, toSec: fromSec + 24 * 60 * 60 };
    }
  }
  throw new Error(`cetDayBounds: could not resolve ${dateIso} in ${TZ}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/domain/usecases/cetDayBounds.test.ts
```
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/usecases/cetDayBounds.ts apps/mobile-notifications-service/src/__tests__/domain/usecases/cetDayBounds.test.ts
git commit -m "feat(mobile-notifications): add cetDayBounds utility"
```

---

## Task 2: Extend notification repo port with time-range filter

**Files:**
- Modify: `apps/mobile-notifications-service/src/domain/notifications/ports/notificationRepository.ts:21-25`

- [ ] **Step 1: Write the failing test (via downstream test update)**

Update the existing repo test to assert the new filter fields on `FilterOptions` are honored. Add to `apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts` at the end of the `findByUserIdPaginated` describe block:

```ts
it('filters by postTimeSec range when postTimeSecFrom/postTimeSecTo are set', async () => {
  // Seed three notifications for the same user with distinct timestamps (ms).
  const mk = (text: string, timestampMs: number, notifId: string): CreateNotificationInput => ({
    userId: 'user-range',
    source: 'android',
    device: 'dev',
    app: 'com.whatsapp',
    title: 'Grupa',
    text,
    timestamp: timestampMs,
    postTime: String(Math.floor(timestampMs / 1000)),
    notificationId: notifId,
  });
  await repository.save(mk('t1', 100_000, 'r1'));
  await repository.save(mk('t2', 200_000, 'r2'));
  await repository.save(mk('t3', 300_000, 'r3'));

  const result = await repository.findByUserIdPaginated('user-range', {
    limit: 10,
    filter: { postTimeSecFrom: 150, postTimeSecTo: 250, app: ['com.whatsapp'] },
  });
  if (!result.ok) throw new Error(`unexpected: ${result.error.message}`);
  const texts = result.value.notifications.map((n) => n.text).sort();
  expect(texts).toEqual(['t2']);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/infra/firestoreNotificationRepository.test.ts -t 'postTimeSec range'
```
Expected: FAIL — field rejected by type or filter not applied.

- [ ] **Step 3: Update the port to add the new fields**

```ts
// apps/mobile-notifications-service/src/domain/notifications/ports/notificationRepository.ts
export interface FilterOptions {
  source?: string[];
  app?: string[];
  title?: string;
  /** Inclusive lower bound on notification `timestamp` (stored as milliseconds). Unit: seconds. */
  postTimeSecFrom?: number;
  /** Exclusive upper bound on notification `timestamp`. Unit: seconds. */
  postTimeSecTo?: number;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/notifications/ports/notificationRepository.ts
git commit -m "feat(mobile-notifications): add postTimeSec range to FilterOptions"
```

---

## Task 3: Apply time-range filter in firestore notification repo

**Files:**
- Modify: `apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts:143-163`

- [ ] **Step 1: Keep the failing test from Task 2**

- [ ] **Step 2: Implement the filter**

In `buildQuery`, after the `app in` clause, add:

```ts
if (options.filter?.postTimeSecFrom !== undefined) {
  query = query.where('timestamp', '>=', options.filter.postTimeSecFrom * 1000);
}
if (options.filter?.postTimeSecTo !== undefined) {
  query = query.where('timestamp', '<', options.filter.postTimeSecTo * 1000);
}
```

> Rationale: `timestamp` in the doc is unix **milliseconds** (see `notification.ts:20`). The filter is expressed in seconds to match `postTimeSec` semantics used elsewhere; convert on the boundary.

- [ ] **Step 3: Run the test**

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/infra/firestoreNotificationRepository.test.ts -t 'postTimeSec range'
```
Expected: PASS.

- [ ] **Step 4: Firestore composite index — document the requirement**

Add a migration to declare the composite index `(userId ASC, app ASC?, timestamp ASC)` if missing.

Check existing migrations:

```bash
ls apps/mobile-notifications-service/migrations
```

Add a new migration file `apps/mobile-notifications-service/migrations/NNN-add-notifications-timestamp-index.mjs` following the pattern used by the existing files. If no index is needed (single-field `timestamp` on top of existing `userId + receivedAt` can work for small datasets), document why in the migration comment.

Script template (adapt NNN and existing style):

```js
export default {
  name: 'add-notifications-timestamp-index',
  description: 'Composite index for timestamp range queries in digest generation',
  async up({ firestore }) {
    // Index is declared via terraform/firestore-indexes or gcloud; this migration
    // serves as a marker so deploys before prod have the index available.
  },
};
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts apps/mobile-notifications-service/migrations/
git commit -m "feat(mobile-notifications): honor postTimeSec range in firestore repo"
```

---

## Task 4: Pass CET day bounds from `runDigestForGroup`

**Files:**
- Modify: `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts:62-69`
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the runDigestForGroup test file:

```ts
it('passes CET day bounds to notification repo based on input.date', async () => {
  const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
  let capturedFrom: number | undefined;
  let capturedTo: number | undefined;
  setMockServices({
    digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
    notificationRepository: {
      ...fakeNotificationRepo([]),
      findByUserIdPaginated: async (_userId, opts) => {
        capturedFrom = opts?.filter?.postTimeSecFrom;
        capturedTo = opts?.filter?.postTimeSecTo;
        return { ok: true as const, value: { notifications: [] } };
      },
    },
    digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
    groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
  });

  await runDigestForGroup(
    { llmClient: llm, logger: noopLogger, modelId: 'm' },
    { userId: 'u', groupKey: 'grupa-wedkarska-skool', groupTitlePrefix: 'Grupa Wędkarska Skool', date: '2026-04-17', holder: 'manual' },
  );

  // 2026-04-17 CEST (UTC+2): from = 2026-04-16T22:00:00Z .. to = 2026-04-17T22:00:00Z
  expect(capturedFrom).toBeDefined();
  expect(capturedTo).toBeDefined();
  expect(new Date((capturedFrom ?? 0) * 1000).toISOString()).toBe('2026-04-16T22:00:00.000Z');
  expect(new Date((capturedTo ?? 0) * 1000).toISOString()).toBe('2026-04-17T22:00:00.000Z');
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/domain/usecases/runDigestForGroup.test.ts -t 'CET day bounds'
```
Expected: FAIL — bounds undefined.

- [ ] **Step 3: Implement**

Edit `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts`:

```ts
import { cetDayBounds } from './cetDayBounds.js';

// ...inside runDigestForGroup, replace the messages fetch:
const bounds = cetDayBounds(input.date);
const [previousState, lastSummaries, messages] = await Promise.all([
  services.groupStateRepository.getByDate({
    userId: input.userId, groupKey: input.groupKey, date: previousDate(input.date),
  }),
  services.digestRepository.findRecentByGroup({
    userId: input.userId, groupKey: input.groupKey, limit: PREVIOUS_SUMMARIES_WINDOW,
  }),
  services.notificationRepository.findByUserIdPaginated(input.userId, {
    limit: 1000,
    filter: {
      title: input.groupTitlePrefix,
      app: ['com.whatsapp'],
      postTimeSecFrom: bounds.fromSec,
      postTimeSecTo: bounds.toSec,
    },
  }),
]);
```

- [ ] **Step 4: Run all runDigestForGroup tests**

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/domain/usecases/runDigestForGroup.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts
git commit -m "fix(mobile-notifications): isolate digest input to target CET day"
```

---

## Task 5: Schema — replace `narrative` with `headline` + `bullets`

**Files:**
- Modify: `apps/mobile-notifications-service/src/domain/schemas/digestSchemas.ts:11-39`
- Modify: `apps/mobile-notifications-service/src/__tests__/digestSchemas.test.ts`

- [ ] **Step 1: Write the failing test**

Add to digestSchemas.test.ts:

```ts
import { DailySummarySchema } from '../domain/schemas/digestSchemas.js';

describe('DailySummarySchema — hybrid content fields', () => {
  const base = {
    date: '2026-04-17', groupKey: 'g', messageCount: 10,
    threads: [], moderatorPosts: [], openQuestions: [], activityOutliers: [],
  };

  it('requires headline and bullets', () => {
    const r = DailySummarySchema.safeParse(base);
    expect(r.success).toBe(false);
  });

  it('accepts 3 to 7 bullets', () => {
    const ok = DailySummarySchema.safeParse({
      ...base,
      headline: 'Lede w jednym zdaniu.',
      bullets: ['a', 'b', 'c'],
    });
    expect(ok.success).toBe(true);

    const tooFew = DailySummarySchema.safeParse({
      ...base, headline: 'x', bullets: ['a', 'b'],
    });
    expect(tooFew.success).toBe(false);

    const tooMany = DailySummarySchema.safeParse({
      ...base, headline: 'x', bullets: Array(8).fill('x'),
    });
    expect(tooMany.success).toBe(false);
  });

  it('rejects unknown narrative field (legacy removed)', () => {
    const withNarrative = DailySummarySchema.safeParse({
      ...base, headline: 'x', bullets: ['a', 'b', 'c'], narrative: 'Prose here.',
    });
    // Zod by default strips unknown keys on object schemas; assert the parsed
    // result no longer carries `narrative` so old data can't leak through.
    if (withNarrative.success) {
      expect((withNarrative.data as Record<string, unknown>)['narrative']).toBeUndefined();
    } else {
      // If the schema is declared .strict(), the parse will fail — that's fine too.
      expect(withNarrative.success).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/digestSchemas.test.ts -t 'hybrid content'
```
Expected: FAIL — schema rejects new fields.

- [ ] **Step 3: Update schema**

In `apps/mobile-notifications-service/src/domain/schemas/digestSchemas.ts`, replace the `DailySummarySchema` body:

```ts
export const DailySummarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  groupKey: z.string(),
  messageCount: z.number().int().nonnegative(),
  headline: z.string().min(1).max(200),
  bullets: z.array(z.string().min(1).max(300)).min(3).max(7),
  threads: z.array(
    z.object({
      topic: z.string(),
      participants: z.array(z.string()),
      resolved: z.boolean(),
      keyFacts: z.array(z.string()),
    }),
  ),
  moderatorPosts: z.array(
    z.object({ time: z.string(), topic: z.string(), summary: z.string() }),
  ),
  openQuestions: z.array(z.string()),
  activityOutliers: z.array(
    z.object({ sender: z.string(), messageCount: z.number().int().positive(), note: z.string() }),
  ),
});
```

> `narrative` is removed. All legacy docs are purged in Task 14 before deploy, so no consumer will see an old `narrative`.

- [ ] **Step 4: Run all schema tests**

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/digestSchemas.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/schemas/digestSchemas.ts apps/mobile-notifications-service/src/__tests__/digestSchemas.test.ts
git commit -m "feat(mobile-notifications): digest schema adds headline + bullets"
```

---

## Task 6: Rewrite digest prompt (v2.0.0)

**Files:**
- Modify: `packages/llm-prompts/src/digest/digestPrompt.ts`
- Modify: `packages/llm-prompts/src/digest/examples.ts`
- Modify: `packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts`

- [ ] **Step 1: Update tests to assert new instructions**

Replace the body of `digestPrompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildDigestPrompt, DIGEST_PROMPT_VERSION } from '../digestPrompt.js';

describe('buildDigestPrompt', () => {
  const baseInput = {
    userId: 'google-oauth2|test-user',
    groupKey: 'grupa-wedkarska-skool',
    date: '2026-04-15',
    previousState: null,
    last3Summaries: [],
    todaysMessages: [{ sender: 'Test', text: 'Cześć', postTimeSec: 1776380400 }],
  };

  it('returns a non-empty prompt with the date and group key', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('2026-04-15');
    expect(prompt).toContain('grupa-wedkarska-skool');
  });

  it('embeds both few-shot examples', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt).toContain('2026-04-08');
    expect(prompt).toContain('2026-04-11');
  });

  it('instructs the model to write Polish narratives', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain('po polsku');
  });

  it('instructs the model to output headline + bullets (hybrid format)', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt).toMatch(/headline/i);
    expect(prompt).toMatch(/bullets/i);
    expect(prompt).toMatch(/3.{0,10}7/);
  });

  it('forbids copying from last3Summaries', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain('nie kopiuj');
  });

  it('exposes semver version 2.x', () => {
    expect(DIGEST_PROMPT_VERSION).toMatch(/^2\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/llm-prompts && pnpm vitest run src/digest/__tests__/digestPrompt.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Rewrite `digestPrompt.ts`**

```ts
// packages/llm-prompts/src/digest/digestPrompt.ts
import { COLD_START_EXAMPLE, WITH_CONTEXT_EXAMPLE } from './examples.js';

export const DIGEST_PROMPT_VERSION = '2.0.0';

const COLD_START_JSON = JSON.stringify(COLD_START_EXAMPLE, null, 2);
const WITH_CONTEXT_JSON = JSON.stringify(WITH_CONTEXT_EXAMPLE, null, 2);

export interface DigestPromptInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string;
  readonly previousState: unknown;
  readonly last3Summaries: readonly unknown[];
  readonly todaysMessages: readonly {
    readonly sender: string;
    readonly text: string;
    readonly postTimeSec: number;
  }[];
}

export function buildDigestPrompt(input: DigestPromptInput): string {
  const messagesText = input.todaysMessages
    .map((m) => {
      const ts = new Date(m.postTimeSec * 1000).toISOString().slice(11, 16);
      return `[${ts}] ${m.sender}: ${m.text}`;
    })
    .join('\n');

  const stateJson = JSON.stringify(input.previousState ?? {}, null, 2);
  const summariesJson = JSON.stringify(input.last3Summaries, null, 2);

  return `Jesteś asystentem agregującym dzień rozmów z grupy WhatsApp wędkarskiej w schemat AggregationOutput (JSON).

Format treści:
- headline: JEDNO krótkie zdanie (do 200 znaków) po polsku, oddające najważniejsze tematy dnia. Nie stosuj szablonów typu "Dzień upłynął pod znakiem…".
- bullets: 3 do 7 krótkich wypunktowań po polsku. Każde jest konkretnym faktem z dzisiejszych wiadomości (kto, co, decyzja, skutek). Nie dublują się z treścią threads, moderatorPosts czy openQuestions — są najbardziej istotnymi faktami dnia w stylu "nagłówków notatki".
- Nie używaj pola narrative — pozostaw je puste lub pomiń.

Zasady treści:
- Cała narracja, opisy wątków, notatki, podsumowania moderatorskie i pytania otwarte muszą być po polsku.
- Klucze enum, identyfikatory wątków (kebab-case), groupKey i daty (YYYY-MM-DD) – po angielsku.
- NIE KOPIUJ dosłownie tekstu z previousState ani z last3Summaries. Te dane są wyłącznie kontekstem historycznym — opisują poprzednie dni, a nie dzisiejszy. Jeśli dzisiaj nie wydarzyło się nic w danym wątku, pomiń go.
- Wynikiem jest JEDEN obiekt JSON o polach { dailySummary, stateUpdate } pasujący do schematu Zod.
- recentSummaryDates: dopisz dzisiejszą datę, przytnij do ostatnich 30 dni.
- identityLedger: zwiększaj liczniki dla nadawców widocznych dzisiaj; dodawaj nowych z role='newcomer'; pozostałych zachowaj bez zmian.
- moderatorEvents: tylko append (nigdy nie usuwaj).
- openThreads: przenoś z aktualizacją lastSignal/lastSignalDate; usuwaj wyłącznie gdy dzisiejsze wiadomości jednoznacznie zamykają temat.
- Nie wymyślaj informacji – jeżeli czegoś brakuje, użyj pustej tablicy.
- Wynik MUSI być prawidłowym JSON-em (bez bloków markdown, bez komentarzy, bez końcowych przecinków).

Przykład 1 (cold start, pusty stan):
${COLD_START_JSON}

Przykład 2 (stan + 3-dniowe okno):
${WITH_CONTEXT_JSON}

Dane wejściowe dla bieżącego uruchomienia:

userId: ${input.userId}
groupKey: ${input.groupKey}
date: ${input.date}

previousState (lub {} dla cold start) — KONTEKST TYLKO:
${stateJson}

last3Summaries (poprzednie dni; KONTEKST TYLKO, NIE KOPIUJ):
${summariesJson}

todaysMessages (po dedup, posortowane rosnąco po czasie) — JEDYNE ŹRÓDŁO FAKTÓW:
${messagesText}

Zwróć wyłącznie obiekt JSON AggregationOutput.`;
}
```

- [ ] **Step 4: Update examples.ts — add `headline` and `bullets` to both examples**

In `packages/llm-prompts/src/digest/examples.ts`, for `COLD_START_EXAMPLE.dailySummary`, add:

```ts
    headline: 'Michał zapowiedział nagranie nowego filmu w sobotę, a Henryk dołączył jako nowicjusz z problemami dostępowymi.',
    bullets: [
      'Grzegorz dwukrotnie podbił pytanie o stary film; Michał zapowiedział nagranie nowego w sobotę i publikację na platformie.',
      'Henryk Kerber (76 l.) został powitany; Robert wyjaśnił mu mechanikę punktów i poziomów na Skool.',
      'Michał wysłał Henrykowi testową wiadomość, aby zdiagnozować problem z dostępem — brak potwierdzenia rozwiązania.',
      'Wieczorny luz towarzyski: powitania, żarty, wymiana kawałów.',
      'Porady: cięty czerwony robak w zanęcie na leszcza; rekomendacje zanęt na lina w chłodnej wodzie.',
    ],
```

(Keep `narrative` field present for backwards compat — the model can leave it out, but keeping it in the example shows the model what NOT to focus on.)

For `WITH_CONTEXT_EXAMPLE.dailySummary`, add:

```ts
    headline: 'Ożywiona dyskusja o fermentowanych zanętach w chłodnej wodzie i poszukiwanie darmowych map głębokości.',
    bullets: [
      'Grzegorz szukał darmowej aplikacji z mapami głębokości; ADAM12 polecił płatną Fish Deeper, Mateusz zaznaczył, że dany staw nie jest zeskanowany.',
      'Hubert zakwestionował sens fermentu w połowie kwietnia; Mateusz sprostował, że fermentacja zachodzi też w niższych temperaturach, a dyfuzja zapachów jest wolniejsza.',
      'Ireneusz podał link do odpowiedniej lekcji na platformie — wątek domknięty.',
      'Hubert kilkukrotnie prosił Michała o prywatną odpowiedź na Skool — bez reakcji.',
    ],
```

- [ ] **Step 5: Run tests**

```bash
cd packages/llm-prompts && pnpm vitest run src/digest/__tests__/
```
Expected: PASS — both `digestPrompt.test.ts` and `digestRepairPrompt.test.ts`.

Also verify the `AggregationOutputSchema` accepts the updated examples (run the service test suite):

```bash
cd apps/mobile-notifications-service && pnpm vitest run src/__tests__/digestSchemas.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-prompts/src/digest/
git commit -m "feat(llm-prompts): digest v2.0.0 — headline+bullets, no-copy rule"
```

---

## Task 7: Web types — mirror schema changes

**Files:**
- Modify: `apps/web/src/types/notificationDigests.ts:29-38`

- [ ] **Step 1: Update the TS type**

```ts
// apps/web/src/types/notificationDigests.ts
export interface DailySummary {
  readonly date: string;
  readonly groupKey: string;
  readonly messageCount: number;
  readonly headline: string;
  readonly bullets: readonly string[];
  readonly threads: readonly DigestThread[];
  readonly moderatorPosts: readonly DigestModeratorPost[];
  readonly openQuestions: readonly string[];
  readonly activityOutliers: readonly DigestActivityOutlier[];
}
```

- [ ] **Step 2: Do not commit yet**

Typecheck will fail in `DigestRow.tsx` and `DigestNarrative.tsx` — they read `narrative`. Those consumers are fixed in Tasks 8 and 9 and committed together with the type update. Leave the working tree with the type change staged-but-uncommitted until Task 8.

---

## Task 8: `DigestHighlight` component (replaces `DigestNarrative`)

**Files:**
- Create: `apps/web/src/components/notification-digests/DigestHighlight.tsx`
- Create: `apps/web/src/components/notification-digests/__tests__/DigestHighlight.test.tsx`
- Delete: `apps/web/src/components/notification-digests/DigestNarrative.tsx`
- Modify: `apps/web/src/components/notification-digests/index.ts`
- Modify: `apps/web/src/pages/NotificationDigestViewPage.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/notification-digests/__tests__/DigestHighlight.test.tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DigestHighlight } from '../DigestHighlight.js';

describe('DigestHighlight', () => {
  it('renders headline and every bullet', () => {
    render(
      <DigestHighlight
        headline="Wyciek przepisów i debata o echosondach."
        bullets={['Michał: wyciek do Przasnysza.', 'Echosondy: Garmin vs Deeper.', 'Henryk (76 l.) onboarding Skool.']}
      />
    );
    expect(screen.getByText(/Wyciek przepisów/)).toBeInTheDocument();
    expect(screen.getByText(/Michał: wyciek/)).toBeInTheDocument();
    expect(screen.getByText(/Garmin vs Deeper/)).toBeInTheDocument();
    expect(screen.getByText(/Henryk \(76 l\.\) onboarding Skool/)).toBeInTheDocument();
  });

  it('returns null when headline is empty and bullets are empty', () => {
    const { container } = render(<DigestHighlight headline="" bullets={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/web && pnpm vitest run src/components/notification-digests/__tests__/DigestHighlight.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

```tsx
// apps/web/src/components/notification-digests/DigestHighlight.tsx
import { Card } from '@/components';

interface DigestHighlightProps {
  readonly headline: string;
  readonly bullets: readonly string[];
}

export function DigestHighlight({
  headline,
  bullets,
}: DigestHighlightProps): React.JSX.Element | null {
  if (headline.trim() === '' || bullets.length === 0) return null;

  return (
    <Card className="mb-6">
      <h3 lang="pl" className="mb-3 text-lg font-semibold leading-snug text-slate-900 dark:text-slate-100">
        {headline}
      </h3>
      <ul lang="pl" className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {bullets.map((b, i) => (
          <li key={`${String(i)}-${b.slice(0, 24)}`}>{b}</li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 4: Update `index.ts`**

```ts
// apps/web/src/components/notification-digests/index.ts
export { DigestRow } from './DigestRow.js';
export { DigestHeader } from './DigestHeader.js';
export { DigestHighlight } from './DigestHighlight.js';
export { DigestThreads } from './DigestThreads.js';
export { DigestModeratorPosts } from './DigestModeratorPosts.js';
export { DigestState } from './DigestState.js';
export { DigestActions } from './DigestActions.js';
export { RegenerateConfirmModal } from './RegenerateConfirmModal.js';
export { BackfillRangeModal } from './BackfillRangeModal.js';
export { BackfillProgressGrid } from './BackfillProgressGrid.js';
export { MonthPicker } from './MonthPicker.js';
```

> `DigestHeatmap` and `DigestNarrative` are intentionally dropped. `MonthPicker` is added in Task 10.

- [ ] **Step 5: Update detail page**

In `apps/web/src/pages/NotificationDigestViewPage.tsx`, change the import and the render:

```tsx
import { DigestHighlight } from '@/components/notification-digests';
// ...
<DigestHighlight
  headline={digest.summary.headline}
  bullets={digest.summary.bullets}
/>
```

Remove the `DigestNarrative` import.

- [ ] **Step 6: Delete `DigestNarrative.tsx`**

```bash
git rm apps/web/src/components/notification-digests/DigestNarrative.tsx
```

- [ ] **Step 7: Run all web tests for this module**

```bash
cd apps/web && pnpm vitest run src/components/notification-digests src/pages
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/notification-digests/ apps/web/src/pages/NotificationDigestViewPage.tsx apps/web/src/types/notificationDigests.ts
git commit -m "feat(web): replace DigestNarrative with DigestHighlight (headline+bullets)"
```

---

## Task 9: `DigestRow` — show headline on list rows

**Files:**
- Modify: `apps/web/src/components/notification-digests/DigestRow.tsx:42-44`

- [ ] **Step 1: Add a test**

```tsx
// apps/web/src/components/notification-digests/__tests__/DigestRow.test.tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DigestRow } from '../DigestRow.js';

const baseSummary = {
  date: '2026-04-17',
  groupKey: 'grupa-wedkarska-skool',
  messageCount: 412,
  headline: 'Wyciek przepisów i debata o echosondach.',
  bullets: ['a', 'b', 'c'],
  threads: [],
  moderatorPosts: [],
  openQuestions: [],
  activityOutliers: [],
};

describe('DigestRow', () => {
  it('shows headline when present', () => {
    render(
      <MemoryRouter>
        <DigestRow digest={{ summary: baseSummary, generation: 1, generatedAt: '', modelId: '' }} />
      </MemoryRouter>
    );
    expect(screen.getByText(/Wyciek przepisów/)).toBeInTheDocument();
  });

  it('renders "no messages" copy when headline is empty', () => {
    const empty = { ...baseSummary, headline: '', bullets: [] };
    render(
      <MemoryRouter>
        <DigestRow digest={{ summary: empty, generation: 1, generatedAt: '', modelId: '' }} />
      </MemoryRouter>
    );
    expect(screen.getByText(/Brak wiadomości tego dnia/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Update the row**

Replace the inner text block at `DigestRow.tsx:42-44`:

```tsx
<p className="truncate text-xs text-slate-500 dark:text-slate-400">
  {summary.headline !== '' ? summary.headline : 'Brak wiadomości tego dnia'}
</p>
```

- [ ] **Step 3: Run tests**

```bash
cd apps/web && pnpm vitest run src/components/notification-digests/__tests__/DigestRow.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/notification-digests/DigestRow.tsx apps/web/src/components/notification-digests/__tests__/DigestRow.test.tsx
git commit -m "feat(web): DigestRow shows headline with narrative fallback"
```

---

## Task 10: Month navigation helpers + `MonthPicker` component

**Files:**
- Modify: `apps/web/src/utils/digestDates.ts`
- Create: `apps/web/src/utils/__tests__/digestDates.test.ts` (if not present — verify first)
- Create: `apps/web/src/components/notification-digests/MonthPicker.tsx`
- Create: `apps/web/src/components/notification-digests/__tests__/MonthPicker.test.tsx`

- [ ] **Step 1: Add tests for month helpers**

```ts
// apps/web/src/utils/__tests__/digestDates.test.ts
import { describe, it, expect } from 'vitest';
import { firstDayOfMonth, lastDayOfMonth, shiftMonth, currentMonthIso, monthLabelPl } from '../digestDates.js';

describe('digestDates month helpers', () => {
  it('firstDayOfMonth / lastDayOfMonth handle leap February', () => {
    expect(firstDayOfMonth('2024-02')).toBe('2024-02-01');
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29');
  });

  it('lastDayOfMonth handles 30/31 day months', () => {
    expect(lastDayOfMonth('2026-04')).toBe('2026-04-30');
    expect(lastDayOfMonth('2026-07')).toBe('2026-07-31');
  });

  it('shiftMonth wraps years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-04', 0)).toBe('2026-04');
  });

  it('currentMonthIso returns YYYY-MM from today', () => {
    expect(currentMonthIso()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('monthLabelPl returns Polish month name and year', () => {
    expect(monthLabelPl('2026-04')).toMatch(/kwieci(eń|en)/i);
    expect(monthLabelPl('2026-04')).toContain('2026');
  });
});
```

- [ ] **Step 2: Implement helpers**

Append to `apps/web/src/utils/digestDates.ts`:

```ts
export function currentMonthIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${String(y)}-${m}`;
}

export function firstDayOfMonth(monthIso: string): string {
  return `${monthIso}-01`;
}

export function lastDayOfMonth(monthIso: string): string {
  const parts = monthIso.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  if (y === undefined || m === undefined) throw new Error(`lastDayOfMonth: invalid ${monthIso}`);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthIso}-${String(lastDay).padStart(2, '0')}`;
}

export function shiftMonth(monthIso: string, delta: number): string {
  const parts = monthIso.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  if (y === undefined || m === undefined) throw new Error(`shiftMonth: invalid ${monthIso}`);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabelPl(monthIso: string): string {
  const parts = monthIso.split('-').map((s) => parseInt(s, 10));
  const y = parts[0];
  const m = parts[1];
  if (y === undefined || m === undefined) return monthIso;
  const label = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 15)));
  return label;
}
```

- [ ] **Step 3: Run helper tests**

```bash
cd apps/web && pnpm vitest run src/utils/__tests__/digestDates.test.ts
```
Expected: PASS.

- [ ] **Step 4: Add MonthPicker test**

```tsx
// apps/web/src/components/notification-digests/__tests__/MonthPicker.test.tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonthPicker } from '../MonthPicker.js';

describe('MonthPicker', () => {
  it('renders Polish month label and year', () => {
    render(<MonthPicker month="2026-04" onChange={() => {}} />);
    expect(screen.getByText(/kwiecień|kwietnia|kwieci/i)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('shifts -1 month on prev click', () => {
    const onChange = vi.fn();
    render(<MonthPicker month="2026-04" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Poprzedni miesiąc/i));
    expect(onChange).toHaveBeenCalledWith('2026-03');
  });

  it('shifts +1 month on next click', () => {
    const onChange = vi.fn();
    render(<MonthPicker month="2026-04" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Następny miesiąc/i));
    expect(onChange).toHaveBeenCalledWith('2026-05');
  });
});
```

- [ ] **Step 5: Implement MonthPicker**

```tsx
// apps/web/src/components/notification-digests/MonthPicker.tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabelPl, shiftMonth } from '@/utils/digestDates';

interface MonthPickerProps {
  readonly month: string; // YYYY-MM
  readonly onChange: (month: string) => void;
}

export function MonthPicker({ month, onChange }: MonthPickerProps): React.JSX.Element {
  const label = monthLabelPl(month);
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800">
      <button
        type="button"
        aria-label="Poprzedni miesiąc"
        onClick={(): void => { onChange(shiftMonth(month, -1)); }}
        className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[12ch] px-2 text-center font-medium capitalize text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <button
        type="button"
        aria-label="Następny miesiąc"
        onClick={(): void => { onChange(shiftMonth(month, 1)); }}
        className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Run MonthPicker tests**

```bash
cd apps/web && pnpm vitest run src/components/notification-digests/__tests__/MonthPicker.test.tsx
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/utils/ apps/web/src/components/notification-digests/MonthPicker.tsx apps/web/src/components/notification-digests/__tests__/MonthPicker.test.tsx
git commit -m "feat(web): month navigation helpers and MonthPicker component"
```

---

## Task 11: `useDigestList` — month-based range

**Files:**
- Modify: `apps/web/src/hooks/useDigestList.ts`
- Modify: `apps/web/src/hooks/__tests__/useDigestList.test.ts`

- [ ] **Step 1: Update test to use month param**

Replace or augment the existing `useDigestList` test cases to assert:

```ts
it('computes fromDate/toDate from month when provided', async () => {
  // Configure fetch mock or the API wrapper to capture options
  // (follow the existing pattern in the file).
  const capture: { from?: string; to?: string } = {};
  // ...replace listDigests mock to capture options.fromDate / options.toDate
  renderHook(() => useDigestList({ groupKey: 'g', month: '2026-04' }), { wrapper });
  await act(async () => {});
  expect(capture.from).toBe('2026-04-01');
  expect(capture.to).toBe('2026-04-30');
});

it('defaults to currentMonthIso when month is omitted', async () => {
  // Stub Date via vi.useFakeTimers if needed, or assert against the
  // regex /^\d{4}-\d{2}-01$/ for fromDate.
});
```

(Follow the existing fake-API pattern in this test file.)

- [ ] **Step 2: Update `UseDigestListOptions` + hook**

```ts
// apps/web/src/hooks/useDigestList.ts (key diffs)
import { currentMonthIso, firstDayOfMonth, lastDayOfMonth } from '@/utils/digestDates';

export interface UseDigestListOptions {
  readonly groupKey: string;
  /** `YYYY-MM`. Defaults to the current month. */
  readonly month?: string;
}

export function useDigestList(options: UseDigestListOptions): UseDigestListResult {
  const month = options.month ?? currentMonthIso();
  const fromDate = firstDayOfMonth(month);
  const toDate = lastDayOfMonth(month);
  // ...rest unchanged
}
```

Keep `fromDate` / `toDate` returned in `UseDigestListResult` so callers can still render the date span if needed.

- [ ] **Step 3: Run hook tests**

```bash
cd apps/web && pnpm vitest run src/hooks/__tests__/useDigestList.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useDigestList.ts apps/web/src/hooks/__tests__/useDigestList.test.ts
git commit -m "feat(web): useDigestList accepts month (YYYY-MM), drops rolling window"
```

---

## Task 12: `NotificationDigestsPage` — remove heatmap, add MonthPicker

**Files:**
- Modify: `apps/web/src/pages/NotificationDigestsPage.tsx`
- Delete: `apps/web/src/components/notification-digests/DigestHeatmap.tsx`

- [ ] **Step 1: Rewrite the page to use MonthPicker**

Replace the relevant hunks:

```tsx
// imports:
import { BackfillRangeModal, DigestRow, MonthPicker } from '@/components/notification-digests';
import { currentMonthIso } from '@/utils/digestDates';

// inside the component, add:
const [month, setMonth] = useState<string>(() => currentMonthIso());

const {
  items, loading, error, filter, sort,
  setFilter, setSort,
} = useDigestList({ groupKey, month });

// Replace the <DigestHeatmap … /> block with:
<div className="mb-4 flex items-center justify-between">
  <MonthPicker month={month} onChange={setMonth} />
  <span className="text-xs text-slate-500 dark:text-slate-400">
    {String(items.length)} {items.length === 1 ? 'dzień' : 'dni'} · {String(regeneratedCount)} wygenerowanych ponownie
  </span>
</div>
```

Remove:
- The old `<DigestHeatmap .../>` JSX block.
- The `DigestHeatmap` import.
- The dependency on `fromDate` / `toDate` from the hook return (unused in the new layout).

- [ ] **Step 2: Delete `DigestHeatmap.tsx`**

```bash
git rm apps/web/src/components/notification-digests/DigestHeatmap.tsx
```

- [ ] **Step 3: Typecheck + tests**

```bash
cd apps/web && pnpm typecheck && pnpm vitest run src/pages src/components/notification-digests
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/NotificationDigestsPage.tsx apps/web/src/components/notification-digests/
git commit -m "feat(web): drop digest heatmap, add month-based navigation to list"
```

---

## Task 13: Wire verification and full CI

- [ ] **Step 1: Verify mobile-notifications-service workspace**

```bash
pnpm run verify:workspace:tracked -- mobile-notifications-service
```
Expected: PASS.

- [ ] **Step 2: Verify llm-prompts package**

```bash
cd packages/llm-prompts && pnpm test && pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 3: Verify web app**

```bash
pnpm run verify:workspace:tracked -- web
```
Expected: PASS (web app exception: coverage not enforced).

- [ ] **Step 4: Full ci:tracked**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-digest-rewrite.txt
```
Expected: PASS. If any failure appears (even in other workspaces), fix it before committing or ask the user.

- [ ] **Step 5: Commit any catch-up fixes**

If Task 5/7 leaves `narrative` consumers elsewhere in the codebase that break, fix them. Search:

```bash
rg -n "\.narrative" apps/ packages/ --type ts
```

Only touch sites in the digest feature surface. Commit with a focused message.

---

## Task 14: Purge legacy `notification_daily_digests` and `notification_group_states`

**Files:** none (one-off runtime script)

Rationale: new schema has no `narrative` field. Existing docs lack `headline`/`bullets` and would render blank cards. Purge them; user will backfill after deploy.

- [ ] **Step 1: Dry-run the count**

```bash
cd packages/infra-firestore && GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json node -e "
const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore({ projectId: 'intexuraos-dev-pbuchman' });
(async () => {
  for (const col of ['notification_daily_digests', 'notification_group_states', 'notification_digest_locks', 'notification_digest_backfill_runs']) {
    const snap = await db.collection(col).get();
    console.log(col, snap.size, 'docs');
  }
})().catch(e => { console.error(e); process.exit(1); });
"
```
Expected: current counts (was 8 daily + 8 states at time of plan writing).

- [ ] **Step 2: Ask the user for explicit delete confirmation**

Use AskUserQuestion with the live counts. Do NOT run Step 3 before the user approves.

- [ ] **Step 3: Delete in batches**

```bash
cd packages/infra-firestore && GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json node -e "
const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore({ projectId: 'intexuraos-dev-pbuchman' });
async function purgeAll(col) {
  while (true) {
    const snap = await db.collection(col).limit(500).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    console.log('deleted', snap.size, 'from', col);
  }
}
(async () => {
  for (const col of ['notification_daily_digests', 'notification_group_states', 'notification_digest_locks', 'notification_digest_backfill_runs']) {
    await purgeAll(col);
  }
})().catch(e => { console.error(e); process.exit(1); });
"
```
Expected: `deleted N from collection` lines until all collections empty.

- [ ] **Step 4: Verify empty**

Repeat Step 1; expect all zeros.

- [ ] **Step 5: No commit**

This is a dev-Firestore data-only operation; nothing to commit.

---

## Task 15: Manual UI smoke test

**Files:** none (Playwright / browser manual run)

- [ ] **Step 1: Rebuild packages and restart dev shell**

```bash
pnpm -w build --filter @intexuraos/llm-prompts --filter mobile-notifications-service && pm2 restart mobile-notifications-service
```

- [ ] **Step 2: Trigger a one-day regeneration in the UI**

Log in via dev.intexuraos.cloud. Go to Notifications → Podsumowania dzienne. Click today's row → click "Wygeneruj ponownie". Confirm the new digest displays `headline + bullets`, no Heatmap above, and that the headline is distinct from prior days' content.

- [ ] **Step 3: Month navigation**

Use `MonthPicker` to navigate to the previous month. Confirm list updates to that month's dates only.

- [ ] **Step 4: Backfill**

Open "Uzupełnij zakres" and run a backfill for the last 7 days. Watch the progress page, then return to the list and verify distinct headlines per day (no template repetition).

If the content is still templated across days, spot-check Firestore:

```bash
cd packages/infra-firestore && GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json node -e "..."
```
and compare the `summary.headline` values. Different every day = success.

---

## Task 16: Commit final polish, push, open PR

- [ ] **Step 1: Branch hygiene**

```bash
git status
git log --oneline origin/development..HEAD
```
Expected: list of focused commits from Tasks 1–13, no stray edits.

- [ ] **Step 2: Rebase onto development**

```bash
git fetch origin development && git rebase origin/development
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --base development --title "fix(digests): isolate per-day input; hybrid headline/bullets; UI cleanup" --body "$(cat <<'EOF'
## Summary
- Digest generation previously fed the same ~1000 most-recent notifications into every day's LLM call, so headlines and events were identical across days. Fixed by passing CET day bounds (`cetDayBounds`) into the notification repo query.
- Rewrote prompt to v2.0.0: structured `headline` (one sentence) + `bullets` (3–7 concrete facts). Explicit no-copy rule against `previousState` / `last3Summaries`. Updated few-shot examples.
- Web UI: dropped `DigestHeatmap`; added `MonthPicker` with Polish labels; replaced `DigestNarrative` with `DigestHighlight` (headline + bulleted list). Legacy docs render old narrative with a "regenerate" hint until the user runs a backfill.

## Test plan
- [ ] `pnpm run ci:tracked` green
- [ ] Manually regenerated a digest on dev; confirm headline varies day-to-day
- [ ] Ran a 7-day backfill; inspected Firestore summaries for distinct `headline` per day
- [ ] Month navigation: prev/current/next work, list scopes to the selected month
- [ ] Legacy doc (no `headline`) shows fallback prose with regenerate banner

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every user requirement has an owning task.
  - Prompt rewrite for hybrid format → Task 6
  - Fix unnecessary line breaks (headline + bullets replace prose) → Tasks 5, 7, 8, 9
  - Remove tiles (heatmap) → Task 12
  - Single-line list (already DigestRow; reinforced) → Task 9
  - Month-boundary navigation → Tasks 10, 11, 12
  - Click item → detail shows hybrid → Task 8
  - Root-cause fix (contamination) → Tasks 1, 2, 3, 4
- [ ] **Placeholder scan:** No "TODO", "fill in", or "similar to above" left.
- [ ] **Type consistency:** `DailySummary` shape is identical between `digestSchemas.ts` (Zod) and `apps/web/src/types/notificationDigests.ts` (TS). `headline: string`, `bullets: readonly string[]`, `narrative?: string`. `cetDayBounds` returns `{ fromSec, toSec }` used identically in Tasks 1 and 4.
- [ ] **No Linear ID**: user confirmed none required for cross-linking.
