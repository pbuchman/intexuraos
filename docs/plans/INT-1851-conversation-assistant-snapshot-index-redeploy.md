# Conversation Assistant Snapshot Index Redeploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Conversation Assistant session snapshot loading and PDF export by deploying the missing Firestore composite index for owner-filtered turn reads.

**Architecture:** The failing backend path is `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts#getSessionSnapshotById()`, which reads `whatsapp_conversation_assistant_turns` with `sessionId ==`, `userId ==`, `createdAt ASC`, and document id ASC. Source migration `119_private-whatsapp-reaction-target-index.mjs` already declares that composite index, but live Firestore only has the older `sessionId + createdAt + __name__` index and `_migrations` only showed migration `118` applied during planning. Add a forward-only migration that redeploys the aggregated Firestore index artifact without editing immutable migrations 118 or 119.

**Tech Stack:** Node 22, TypeScript/Vitest, Firestore migrations in `migrations/*.mjs`, Firebase Firestore Admin API, WhatsApp service Fastify routes.

## Global Constraints

- Do not modify applied migration files `migrations/118_whatsapp-conversation-assistant-indexes.mjs` or `migrations/119_private-whatsapp-reaction-target-index.mjs`; migrations are immutable.
- Use migration id `121` because `migrations/manifest.json` currently has `lastReservedId: "120"`.
- Do not duplicate the existing `119` index declaration; use a redeploy migration whose `up()` calls `context.deployIndexes()`.
- Use service-account credentials explicitly for live Firestore checks and migration deployment: `GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json`.
- Target project for live verification and deployment is `intexuraos-dev-pbuchman`.
- No HTTP endpoint behavior, request shape, response shape, or UI behavior changes are required.

---

## Current Evidence

- User-visible failure: `Failed to load Conversation Assistant session snapshot: 9 FAILED_PRECONDITION: The query requires an index`.
- Firebase index URL decodes to collection group `whatsapp_conversation_assistant_turns` with fields `sessionId ASC`, `userId ASC`, `createdAt ASC`, `__name__ ASC`.
- Code path: `getSessionSnapshotById()` in `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts` runs exactly that query inside the transaction used by session loading and PDF export.
- Source artifact already contains the required index in `migrations/119_private-whatsapp-reaction-target-index.mjs` and committed `firestore.indexes.json`.
- Live planning check through Firestore Admin API returned only one deployed `whatsapp_conversation_assistant_turns` index: `sessionId ASC`, `createdAt ASC`, `__name__ ASC`, state `READY`.
- Live `_migrations` planning check returned `118` as applied and did not return records for `119` or `120`.

## Endpoint Changes

Modified: none.

Created: none.

Removed: none.

Unchanged:
- `GET /whatsapp/conversation-assistant/sessions/:sessionId`
- `GET /whatsapp/conversation-assistant/sessions/:sessionId/turns`
- `GET /whatsapp/conversation-assistant/sessions/:sessionId/export.pdf`

## File Structure

- Create `migrations/121_whatsapp-conversation-assistant-snapshot-index-redeploy.mjs`: forward-only migration that redeploys the aggregated Firestore index artifact so the index from migration 119 reaches live Firestore.
- Create `migrations/__tests__/121-whatsapp-conversation-assistant-snapshot-index-redeploy.test.ts`: migration metadata and `up()` behavior test.
- Regenerate `firestore.indexes.json` with `node scripts/migrate.mjs --write-artifacts-only`; no diff is expected unless the branch has drifted from migration aggregation.

### Task 1: Add the Forward-Only Redeploy Migration

**Files:**
- Create: `migrations/121_whatsapp-conversation-assistant-snapshot-index-redeploy.mjs`
- Create: `migrations/__tests__/121-whatsapp-conversation-assistant-snapshot-index-redeploy.test.ts`

**Interfaces:**
- Consumes: migration runner context with `deployIndexes(): Promise<void>`.
- Produces: migration module exports `metadata`, `indexes`, and `up(context)`.

- [ ] **Step 1: Write the failing migration test**

Create `migrations/__tests__/121-whatsapp-conversation-assistant-snapshot-index-redeploy.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../121_whatsapp-conversation-assistant-snapshot-index-redeploy.mjs'; // @allow-missing-js -- .mjs import

describe('migration 121 - conversation assistant snapshot index redeploy', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '121',
      name: 'whatsapp-conversation-assistant-snapshot-index-redeploy',
      description: 'Redeploy Firestore indexes for Conversation Assistant session snapshot reads',
      createdAt: '2026-07-05',
    });
  });

  it('does not duplicate the existing migration 119 index declaration', () => {
    expect(indexes).toEqual([]);
  });

  it('redeploys aggregated Firestore indexes in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the missing migration module**

Run:

```bash
pnpm exec vitest run --config migrations/vitest.config.ts migrations/__tests__/121-whatsapp-conversation-assistant-snapshot-index-redeploy.test.ts
```

Expected: FAIL with an import/module-not-found error for `121_whatsapp-conversation-assistant-snapshot-index-redeploy.mjs`.

- [ ] **Step 3: Create the migration**

Create `migrations/121_whatsapp-conversation-assistant-snapshot-index-redeploy.mjs`:

```javascript
/**
 * Migration 121: Redeploy WhatsApp Conversation Assistant snapshot indexes.
 *
 * Migration 119 already declares the owner-filtered turn snapshot index:
 * sessionId ASC, userId ASC, createdAt ASC, __name__ ASC.
 * This migration intentionally does not duplicate that index declaration; it
 * forces a forward-only redeploy of the aggregated Firestore index artifact.
 */

export const metadata = {
  id: '121',
  name: 'whatsapp-conversation-assistant-snapshot-index-redeploy',
  description: 'Redeploy Firestore indexes for Conversation Assistant session snapshot reads',
  createdAt: '2026-07-05',
};

export const indexes = [];

export async function up(context) {
  console.log('  Redeploying WhatsApp Conversation Assistant snapshot indexes...');
  await context.deployIndexes();
}
```

- [ ] **Step 4: Run the migration test and confirm it passes**

Run:

```bash
pnpm exec vitest run --config migrations/vitest.config.ts migrations/__tests__/121-whatsapp-conversation-assistant-snapshot-index-redeploy.test.ts
```

Expected: PASS.

### Task 2: Verify Migration Aggregation and Committed Artifacts

**Files:**
- Read: `migrations/119_private-whatsapp-reaction-target-index.mjs`
- Read: `firestore.indexes.json`
- Modify: `firestore.indexes.json` only if artifact generation produces a diff

**Interfaces:**
- Consumes: `scripts/migrate.mjs --write-artifacts-only` migration aggregation.
- Produces: committed Firestore artifacts that still include the snapshot index from migration 119.

- [ ] **Step 1: Regenerate Firestore artifacts from migrations**

Run:

```bash
node scripts/migrate.mjs --write-artifacts-only
```

Expected: command completes and writes `firestore.indexes.json` and `firestore.rules` from migration aggregation.

- [ ] **Step 2: Confirm the required source index remains present**

Run:

```bash
rg -n '"collectionGroup": "whatsapp_conversation_assistant_turns"|sessionId|userId|createdAt' firestore.indexes.json
```

Expected: `firestore.indexes.json` includes an index block for `whatsapp_conversation_assistant_turns` with fields in this order:

```json
[
  { "fieldPath": "sessionId", "order": "ASCENDING" },
  { "fieldPath": "userId", "order": "ASCENDING" },
  { "fieldPath": "createdAt", "order": "ASCENDING" },
  { "fieldPath": "__name__", "order": "ASCENDING" }
]
```

- [ ] **Step 3: Verify migration conventions**

Run:

```bash
pnpm run verify:migrations
```

Expected: PASS. The new migration is accepted as exactly `lastReservedId + 1` (`121`).

- [ ] **Step 4: Verify committed Firestore artifacts**

Run:

```bash
pnpm run verify:firestore-artifacts
```

Expected: PASS.

### Task 3: Deploy Pending Firestore Migrations and Prove the Live Index Exists

**Files:**
- Read: `_migrations` Firestore collection through the migration runner.
- No repository file changes.

**Interfaces:**
- Consumes: service account `/secrets/gcp-sa.json`.
- Produces: live Firestore composite index state `READY` for `sessionId + userId + createdAt + __name__`.

- [ ] **Step 1: Check pending migration status**

Run:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json \
INTEXURAOS_GCP_PROJECT_ID=intexuraos-dev-pbuchman \
pnpm run migrate:status
```

Expected: `119_private-whatsapp-reaction-target-index`, `120_calendar-schedules-indexes`, and `121_whatsapp-conversation-assistant-snapshot-index-redeploy` show as pending unless another worker has already applied them.

- [ ] **Step 2: Deploy pending migrations**

Run:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json \
pnpm run migrate -- --project intexuraos-dev-pbuchman
```

Expected: all pending migrations complete successfully. At minimum, the run must apply migration `119` or `121` and call `deployIndexes()` so Firestore receives the aggregated index artifact.

- [ ] **Step 3: Verify the live Firestore Admin API reports the snapshot index as READY**

Run:

```bash
node --input-type=module <<'EOF'
import { readFileSync } from 'node:fs';
import { cert } from 'firebase-admin/app';

const serviceAccount = JSON.parse(readFileSync('/secrets/gcp-sa.json', 'utf8'));
const credential = cert(serviceAccount);
const token = await credential.getAccessToken();
const url =
  'https://firestore.googleapis.com/v1/projects/intexuraos-dev-pbuchman/databases/(default)/collectionGroups/whatsapp_conversation_assistant_turns/indexes';
const response = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
const data = await response.json();
if (!response.ok) {
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

const target = (data.indexes ?? []).find((index) => {
  const fields = (index.fields ?? []).map((field) => `${field.fieldPath ?? '__name__'}:${field.order}`);
  return (
    index.state === 'READY' &&
    fields.join('|') ===
      'sessionId:ASCENDING|userId:ASCENDING|createdAt:ASCENDING|__name__:ASCENDING'
  );
});

console.log(JSON.stringify({ hasSnapshotIndex: target !== undefined, state: target?.state ?? null }, null, 2));
if (target === undefined) process.exit(1);
EOF
```

Expected:

```json
{
  "hasSnapshotIndex": true,
  "state": "READY"
}
```

### Task 4: Run Regression Verification

**Files:**
- Read: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Read: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Read: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Read: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`

**Interfaces:**
- Consumes: existing fake Firestore and route tests.
- Produces: proof that the repository and route behavior remains unchanged while Firestore can execute the live index-backed query.

- [ ] **Step 1: Run targeted WhatsApp service regression tests**

Run:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tracked CI before committing**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 3: Commit the migration plan implementation**

Run:

```bash
git add migrations/121_whatsapp-conversation-assistant-snapshot-index-redeploy.mjs migrations/__tests__/121-whatsapp-conversation-assistant-snapshot-index-redeploy.test.ts firestore.indexes.json firestore.rules
git commit -m "fix: redeploy conversation assistant snapshot index"
```

Expected: commit succeeds only after `pnpm run ci:tracked` passes. If `firestore.indexes.json` or `firestore.rules` have no diff, `git add` will ignore them.

## Self-Review Checklist

- The plan fixes the reported `FAILED_PRECONDITION` by deploying the missing Firestore composite index for the exact query shape.
- No immutable migration file is modified.
- The new migration is forward-only, idempotent, and covered by a targeted test.
- Live verification confirms the Firestore index state is `READY`.
- Conversation Assistant session loading and PDF export endpoints remain unchanged.
