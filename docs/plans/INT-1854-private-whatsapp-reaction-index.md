# Private WhatsApp Chat Reaction Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore private WhatsApp conversation message loading when selecting a chat by adding the Firestore composite indexes required by chat-scoped inline reaction hydration.

**Architecture:** Keep web/API behavior unchanged. Add a forward-only Firestore migration that augments the existing private WhatsApp reaction indexes with the chat-first field ordering emitted by Firestore's missing-index error, covering both normalized and legacy reaction-target query branches. Regenerate tracked Firestore artifacts and update migration manifest metadata without modifying existing migrations.

**Tech Stack:** Node ESM migrations, Firestore composite indexes, Vitest, pnpm, Linear/GitHub planning workflow.

## Global Constraints

- Do not modify existing migration files; migrations are immutable after publication.
- `whatsapp_private_messages` is owned by `whatsapp-service`; keep the collection owner unchanged.
- Add indexes through `migrations/*.mjs` and regenerated `firestore.indexes.json`; do not create persistent Firestore indexes directly in Firebase Console.
- Use `gh` for GitHub status, PR, diff, log, and PR operations when available; use `git` only for commands `gh` does not provide, such as `git add` and `git commit`.
- Run verification from the repo root and do not commit until `pnpm run ci:tracked` passes.

---

## Root Cause

Selecting a private WhatsApp conversation calls `GET /whatsapp/private/chats/:chatId/messages` in `apps/whatsapp-service/src/routes/privateReadRoutes.ts`. That route loads messages through `findMessages()` and then calls `hydrateInlineReactions()`, which calls `privateWhatsAppRepository.findReactionsForMessageIds()` with `chatId`.

`findReactionsForMessageIds()` in `apps/whatsapp-service/src/infra/firestore/privateWhatsAppRepository.ts` builds a chat-scoped reaction query over `whatsapp_private_messages` with these fields:

- `chatId == <selected chat>`
- `messageType == "reaction"`
- `reaction.targetMessageId in <current page targets>`
- `sourceAccountId == <current private account>`
- `orderBy eventTimestamp asc`
- `orderBy __name__ asc`

The Firestore error in INT-1854 generated this exact required index field order:

```text
chatId ASC
messageType ASC
reaction.targetMessageId ASC
sourceAccountId ASC
eventTimestamp ASC
__name__ ASC
```

Existing migration `migrations/119_private-whatsapp-reaction-target-index.mjs` defines a source-account-first chat-scoped reaction index, but it does not define the chat-first index order requested by Firestore. The implementation must add a new migration with the missing chat-first shape and the analogous legacy reaction-target shape so the legacy branch does not fail after the normalized branch is fixed.

## Endpoint Changes

Modified: none.

Created: none.

Removed: none.

Unchanged: `GET /whatsapp/private/chats/:chatId/messages` continues returning private chat messages with inline reactions; the fix is an index-only infrastructure/data-plane change.

---

### Task 1: Write the failing migration test

**Files:**
- Create: `migrations/__tests__/121-private-whatsapp-chat-reaction-scope-indexes.test.ts`

**Interfaces:**
- Consumes: Firestore index shape from INT-1854 and existing migration-test pattern from `migrations/__tests__/119-private-whatsapp-reaction-target-index.test.ts`.
- Produces: A failing test that defines the exact required indexes before implementation exists.

- [ ] **Step 1: Add the failing test**

Create `migrations/__tests__/121-private-whatsapp-chat-reaction-scope-indexes.test.ts` with:

```typescript
import { describe, expect, it, vi } from 'vitest';

import { indexes, metadata, up } from '../121_private-whatsapp-chat-reaction-scope-indexes.mjs'; // @allow-missing-js -- .mjs import

describe('migration 121 - private WhatsApp chat reaction scope indexes', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '121',
      name: 'private-whatsapp-chat-reaction-scope-indexes',
      description: 'Chat-first indexes for private WhatsApp inline reaction hydration',
      createdAt: '2026-07-05',
    });
  });

  it('defines chat-scoped reaction indexes in Firestore requested field order', () => {
    expect(indexes).toEqual([
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'messageType', order: 'ASCENDING' },
          { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      },
      {
        collectionGroup: 'whatsapp_private_messages',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'chatId', order: 'ASCENDING' },
          { fieldPath: 'messageType', order: 'ASCENDING' },
          { fieldPath: 'rawMatrixEvent.content.`m.relates_to`.event_id', order: 'ASCENDING' },
          { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
          { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      },
    ]);
  });

  it('deploys indexes in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
pnpm --filter migrations test -- migrations/__tests__/121-private-whatsapp-chat-reaction-scope-indexes.test.ts
```

Expected: FAIL because `../121_private-whatsapp-chat-reaction-scope-indexes.mjs` does not exist.

---

### Task 2: Add the forward-only index migration

**Files:**
- Create: `migrations/121_private-whatsapp-chat-reaction-scope-indexes.mjs`
- Test: `migrations/__tests__/121-private-whatsapp-chat-reaction-scope-indexes.test.ts`

**Interfaces:**
- Consumes: The test from Task 1.
- Produces: `metadata`, `indexes`, and `up(context)` exports for the missing Firestore indexes.

- [ ] **Step 1: Create the migration**

Create `migrations/121_private-whatsapp-chat-reaction-scope-indexes.mjs` with:

```javascript
/**
 * Migration 121: Private WhatsApp chat-scoped reaction indexes.
 *
 * Required by whatsapp-service private chat message reads to hydrate inline reactions
 * when Firestore chooses chat-first equality field ordering.
 */

export const metadata = {
  id: '121',
  name: 'private-whatsapp-chat-reaction-scope-indexes',
  description: 'Chat-first indexes for private WhatsApp inline reaction hydration',
  createdAt: '2026-07-05',
};

export const indexes = [
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'reaction.targetMessageId', order: 'ASCENDING' },
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_private_messages',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'chatId', order: 'ASCENDING' },
      { fieldPath: 'messageType', order: 'ASCENDING' },
      { fieldPath: 'rawMatrixEvent.content.`m.relates_to`.event_id', order: 'ASCENDING' },
      { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
      { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying private WhatsApp chat-scoped reaction indexes');
  await context.deployIndexes();
}
```

- [ ] **Step 2: Run the migration test and confirm it passes**

Run:

```bash
pnpm --filter migrations test -- migrations/__tests__/121-private-whatsapp-chat-reaction-scope-indexes.test.ts
```

Expected: PASS.

---

### Task 3: Regenerate Firestore artifacts and reserve migration 121

**Files:**
- Modify: `firestore.indexes.json`
- Modify: `firestore.rules`
- Modify: `migrations/manifest.json`
- Test: `scripts/verify-migrations.mjs`
- Test: `scripts/verify-firestore-artifacts.mjs`

**Interfaces:**
- Consumes: Migration `121_private-whatsapp-chat-reaction-scope-indexes.mjs`.
- Produces: Tracked Firestore artifacts and manifest metadata that CI accepts.

- [ ] **Step 1: Regenerate tracked Firestore artifacts**

Run:

```bash
node scripts/migrate.mjs --write-artifacts-only
```

Expected: command prints that it wrote `firestore.indexes.json` and `firestore.rules`.

- [ ] **Step 2: Compute the migration manifest checksum**

Run:

```bash
node - <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = 'migrations/121_private-whatsapp-chat-reaction-scope-indexes.mjs';
console.log(`sha256:${createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex')}`);
NODE
```

Expected: prints one `sha256:<64 hex chars>` checksum for migration 121.

- [ ] **Step 3: Update the migration manifest**

Modify `migrations/manifest.json` by changing the top-level `lastReservedId` value from `"120"` to `"121"`. Append a new entry after the existing `120` entry with `id` set to `"121"`, `name` set to `"private-whatsapp-chat-reaction-scope-indexes"`, and `checksum` set to the exact `sha256:<64 hex chars>` value printed in Step 2. Keep every existing manifest entry unchanged except for appending the `121` entry.

- [ ] **Step 4: Assert the generated index artifact contains both chat-first shapes**

Run:

```bash
node - <<'NODE'
const { readFileSync } = require('node:fs');
const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;
const expected = [
  ['chatId', 'messageType', 'reaction.targetMessageId', 'sourceAccountId', 'eventTimestamp', '__name__'],
  ['chatId', 'messageType', 'rawMatrixEvent.content.`m.relates_to`.event_id', 'sourceAccountId', 'eventTimestamp', '__name__'],
];
for (const fields of expected) {
  const found = indexes.some((index) =>
    index.collectionGroup === 'whatsapp_private_messages' &&
    index.queryScope === 'COLLECTION' &&
    JSON.stringify(index.fields.map((field) => field.fieldPath)) === JSON.stringify(fields) &&
    index.fields.every((field) => field.order === 'ASCENDING')
  );
  if (!found) {
    throw new Error(`Missing index: ${fields.join(', ')}`);
  }
}
console.log('chat-scoped private WhatsApp reaction indexes present');
NODE
```

Expected: prints `chat-scoped private WhatsApp reaction indexes present`.

- [ ] **Step 5: Run migration artifact verification**

Run:

```bash
pnpm verify:migrations
pnpm verify:firestore-artifacts
```

Expected: both commands pass.

---

### Task 4: Verify the repository change

**Files:**
- Test: `migrations/__tests__/121-private-whatsapp-chat-reaction-scope-indexes.test.ts`
- Test: tracked files changed by this implementation

**Interfaces:**
- Consumes: Completed migration, generated artifacts, and manifest update.
- Produces: Evidence that the change is safe to commit and review.

- [ ] **Step 1: Run the focused migration test**

Run:

```bash
pnpm --filter migrations test -- migrations/__tests__/121-private-whatsapp-chat-reaction-scope-indexes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run migration dry-run with service-account credentials**

Run:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json \
INTEXURAOS_GCP_PROJECT_ID=intexuraos-dev-pbuchman \
node scripts/migrate.mjs --dry-run
```

Expected: reports migration `121_private-whatsapp-chat-reaction-scope-indexes` as pending and prints that it would deploy Firestore indexes. If `/secrets/gcp-sa.json` is not available in the execution environment, use the repository-standard service-account key path from `.claude/reference/firestore-access.md`.

- [ ] **Step 3: Run tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add migrations/121_private-whatsapp-chat-reaction-scope-indexes.mjs \
  migrations/__tests__/121-private-whatsapp-chat-reaction-scope-indexes.test.ts \
  migrations/manifest.json \
  firestore.indexes.json \
  firestore.rules
git commit -m "fix: add private whatsapp chat reaction indexes"
```

Expected: commit succeeds after all verification above passes.

---

### Task 5: Deploy and confirm the index-backed query

**Files:**
- No source files.
- Operational command: `scripts/migrate.mjs`

**Interfaces:**
- Consumes: Merged implementation PR with migration 121.
- Produces: Live Firestore index deployment and product verification for selected private conversations.

- [ ] **Step 1: Apply pending migrations after merge**

Run from the deployed checkout:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json \
INTEXURAOS_GCP_PROJECT_ID=intexuraos-dev-pbuchman \
node scripts/migrate.mjs
```

Expected: migration `121_private-whatsapp-chat-reaction-scope-indexes` completes and Firebase starts building the new indexes.

- [ ] **Step 2: Confirm the selected conversation no longer fails**

Open the private WhatsApp messages view, select a conversation, and wait for messages to load.

Expected: the selected conversation renders messages; the backend does not return `Failed to query private WhatsApp reactions`.

- [ ] **Step 3: Check logs when `gcloud` is available**

Run:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="whatsapp-service" AND textPayload:"Failed to query private WhatsApp reactions"' \
  --project=intexuraos-dev-pbuchman \
  --limit=20 \
  --format=json
```

Expected: no new matching failures after the index finishes building and the conversation view is retried.

## Self-Review Checklist

- The plan covers the reported selected-conversation failure path and names the exact missing index fields from the Firestore error.
- The plan adds a new migration instead of editing immutable migration 119.
- The plan covers both normalized and legacy chat-scoped reaction-target query branches.
- The plan includes migration tests, generated artifact verification, manifest verification, dry-run verification, and `pnpm run ci:tracked`.
- No endpoint behavior changes are required.
