# LLM Usage Date Filter Indexes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `POST /llm-usage/events/list` for date-range presets when provider filters are active by adding the missing Firestore composite index migration and regenerating the checked-in Firestore indexes artifact.

**Architecture:** Keep the fix in the Firestore migration layer. First pin the exact query shape used by `FirestoreUsageEventRepository.list()` when provider filters and oldest-first ordering are combined, then add one new immutable migration for the missing composite index, regenerate `firestore.indexes.json`, and apply the migration in dev so the index can build asynchronously.

**Tech Stack:** TypeScript, Vitest, Firestore composite indexes, Node migration scripts

---

## Endpoint Changes

- **Modified / Created / Removed:** none.
- **Unchanged:** `POST /llm-usage/events/list`

### Task 1: Lock The Failing Query Contract

**Files:**
- Modify: `apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageEventRepository.test.ts`
- Create: `migrations/__tests__/093-llm-usage-events-filtered-asc-indexes.test.ts`

- [ ] **Step 1: Add a repository test for provider-filtered oldest-first queries**

Add a test beside the existing sort/filter coverage that calls `repo.list()` with a time range, `filters.providers`, and `sortBy: { field: 'occurredAt', direction: 'asc' }`. Assert the Firestore mock receives:

```ts
expect(mockQuery.where).toHaveBeenCalledWith('occurredAt', '>=', '2026-04-01T00:00:00Z');
expect(mockQuery.where).toHaveBeenCalledWith('occurredAt', '<=', '2026-04-30T23:59:59Z');
expect(mockQuery.where).toHaveBeenCalledWith('request.provider', 'in', ['openai', 'anthropic']);
expect(mockQuery.orderBy).toHaveBeenCalledWith('occurredAt', 'asc');
expect(mockQuery.orderBy).toHaveBeenCalledWith('__name__', 'asc');
```

- [ ] **Step 2: Run the repository test to verify current behavior is captured**

Run: `pnpm vitest run apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageEventRepository.test.ts`

Expected: PASS. This is a contract test, not a failing runtime reproduction; it proves the exact query shape that the new index must satisfy.

- [ ] **Step 3: Add a migration unit test for the new index migration**

Create `migrations/__tests__/093-llm-usage-events-filtered-asc-indexes.test.ts` with the same structure as `migrations/__tests__/075-redeploy-execution-memory-indexes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexes, metadata, up } from '../093_llm-usage-events-filtered-asc-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 093 – llm usage events filtered asc indexes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(metadata).toMatchObject({
      id: '093',
      name: 'llm-usage-events-filtered-asc-indexes',
    });
  });

  it('defines the provider + occurredAt asc index', () => {
    expect(indexes).toContainEqual({
      collectionGroup: 'llm_usage_events',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'request.provider', order: 'ASCENDING' },
        { fieldPath: 'occurredAt', order: 'ASCENDING' },
        { fieldPath: '__name__', order: 'ASCENDING' },
      ],
    });
  });

  it('deploys indexes', async () => {
    const context = {
      firestore: {},
      projectId: 'test-project',
      deployIndexes: vi.fn().mockResolvedValue(undefined),
      deployRules: vi.fn().mockResolvedValue(undefined),
    };

    await up(context);

    expect(context.deployIndexes).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4: Run the migration test to verify it fails before the migration exists**

Run: `pnpm vitest run migrations/__tests__/093-llm-usage-events-filtered-asc-indexes.test.ts`

Expected: FAIL with module-not-found for `../093_llm-usage-events-filtered-asc-indexes.mjs`.

### Task 2: Add The Immutable Firestore Migration

**Files:**
- Create: `migrations/093_llm-usage-events-filtered-asc-indexes.mjs`
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Create migration 093 for filtered oldest-first index coverage**

Create `migrations/093_llm-usage-events-filtered-asc-indexes.mjs`:

```js
/**
 * Migration 093: Composite indexes for llm_usage_events filtered oldest-first queries
 *
 * FirestoreUsageEventRepository.list() always applies:
 *   .where('occurredAt', '>=', from).where('occurredAt', '<=', to)
 * and, when providers is the first populated array filter:
 *   .where('request.provider', 'in', [...])
 * For oldest-first sorting it then applies:
 *   .orderBy('occurredAt', 'asc').orderBy('__name__', 'asc')
 *
 * Migration 086 covers the DESC variant only. This migration adds the ASC
 * provider-filtered variant surfaced by INT-1354.
 */

export const metadata = {
  id: '093',
  name: 'llm-usage-events-filtered-asc-indexes',
  description: 'Composite indexes for llm_usage_events provider-filtered oldest-first queries',
  createdAt: '2026-04-13',
};

export const indexes = [
  {
    collectionGroup: 'llm_usage_events',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'request.provider', order: 'ASCENDING' },
      { fieldPath: 'occurredAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['llm_usage_events'];

export async function up(context) {
  console.log('  Deploying llm_usage_events provider-filtered ASC indexes (1 index)...');
  await context.deployIndexes();
}

export async function down() {
  console.log(
    '  Removing llm_usage_events provider-filtered ASC indexes requires manual deletion via Firebase console'
  );
}
```

Scope note: keep this migration limited to `request.provider`, because that is the only end-user filter exposed by `apps/web/src/pages/LlmUsagePage.tsx` today. Do not speculate by adding service/component/model ASC variants unless the implementation worker finds a real UI path or failing query for them.

- [ ] **Step 2: Run the migration test to verify it now passes**

Run: `pnpm vitest run migrations/__tests__/093-llm-usage-events-filtered-asc-indexes.test.ts`

Expected: PASS

- [ ] **Step 3: Regenerate the Firestore indexes artifact from migrations**

Run: `node scripts/generate-firestore-config.mjs`

Expected: output includes `Generated firestore.indexes.json`, and the resulting file contains:

```json
{
  "collectionGroup": "llm_usage_events",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "request.provider", "order": "ASCENDING" },
    { "fieldPath": "occurredAt", "order": "ASCENDING" },
    { "fieldPath": "__name__", "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 4: Verify the generated file contains the new composite index**

Run: `rg -n '"collectionGroup": "llm_usage_events"|"request.provider"|"occurredAt"|"__name__"' firestore.indexes.json`

Expected: a `llm_usage_events` block appears with `request.provider`, `occurredAt`, and `__name__` all marked `ASCENDING`.

- [ ] **Step 5: Commit the migration and regenerated artifact**

```bash
git add apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageEventRepository.test.ts migrations/093_llm-usage-events-filtered-asc-indexes.mjs migrations/__tests__/093-llm-usage-events-filtered-asc-indexes.test.ts firestore.indexes.json
git commit -m "feat: add llm usage filtered asc firestore index"
```

### Task 3: Apply And Verify In Dev

**Files:**
- Modify: none
- Verify against: `migrations/093_llm-usage-events-filtered-asc-indexes.mjs`, `firestore.indexes.json`

- [ ] **Step 1: Re-run the focused verification suite**

Run:

```bash
pnpm vitest run apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageEventRepository.test.ts
pnpm vitest run migrations/__tests__/093-llm-usage-events-filtered-asc-indexes.test.ts
```

Expected: PASS for both commands.

- [ ] **Step 2: Apply the migration to the dev Firestore project**

Run:

```bash
pnpm run migrate -- --project intexuraos-dev-pbuchman
```

Expected: migration `093` is marked applied, `firestore.indexes.json` is regenerated during the run, and Firebase begins building the new composite index.

- [ ] **Step 3: Confirm migration status and index deployment readiness**

Run:

```bash
pnpm run migrate:status
gcloud firestore indexes composite list --project=intexuraos-dev-pbuchman --format=json | rg 'llm_usage_events|request.provider|occurredAt'
```

Expected:
- `093` shows as applied in migration status
- the new `llm_usage_events` composite index is present in Firestore (it may remain `BUILDING` before turning `READY`)

- [ ] **Step 4: Manually smoke-test the failing flow in dev**

Verify on `https://dev.intexuraos.cloud/#/llm-usage`:

1. Select `Today`, `Yesterday`, `Last 7d`, and `Last 30d`
2. Toggle at least one provider chip
3. Switch sort to `Oldest first`
4. Confirm `POST /api/llm-usage/llm-usage/events/list` stops returning `FAILED_PRECONDITION`

- [ ] **Step 5: Run full tracked CI before merge**

Run: `pnpm run ci:tracked`

Expected: PASS

- [ ] **Step 6: Commit any final verification-only updates**

```bash
git add firestore.indexes.json
git commit -m "chore: apply llm usage firestore migration"
```

## Notes For The Implementation Worker

- `apps/web/src/pages/LlmUsagePage.tsx` exposes only the provider filter, so keep the migration tight unless fresh evidence shows additional filtered oldest-first queries are reachable.
- `migrations/086_llm-usage-events-list-indexes.mjs`, `087_llm-usage-events-filter-sort-indexes.mjs`, and `091_llm-usage-events-asc-index.mjs` are immutable context only; do not edit them.
- `firestore.indexes.json` is generated output. Any change to it must come from the migration scripts, not from manual hand-editing.
