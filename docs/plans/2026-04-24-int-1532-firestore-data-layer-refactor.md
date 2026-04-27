# INT-1532 — Firestore Data Layer Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** [INT-1532](https://linear.app/pbuchman/issue/INT-1532)
**Parent review:** `docs/reviews/2026-04-24-refactoring-analysis.md` §4
**Goal:** Eliminate drift between the Firestore registry, the `firestore.indexes.json` artifact, and the live database by tightening pre-merge tooling, cleaning up orphaned indexes/collections, consolidating the `code-agent` repository layer, splitting the shared `whatsapp_user_mappings` document, and introducing a versioned-schema convention for new writes.

**Architecture:** Five fully-parallel workstreams, each scoped to a single ownership boundary (root tooling, `apps/code-agent`, `apps/whatsapp-service`, `workers/orchestrator`, `packages/infra-firestore`). Cross-cutting contracts (registry shape, schema version field, repository factory shape) are defined upfront in §"Shared Contracts" so each subtask can land independently.

**Tech Stack:** Node ESM scripts (`*.mjs`), TypeScript strict-mode services, Firestore SDK (`@google-cloud/firestore`), Zod schemas in `packages/infra-firestore`, ESLint flat config, vitest, pnpm workspaces.

---

## Endpoint Changes

| Type        | Endpoint                                                 | Notes                                                                                                |
| ----------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Modified    | none (no HTTP surface change in apps)                    | Repository internals only.                                                                           |
| Created     | none                                                     |                                                                                                      |
| Removed     | none                                                     |                                                                                                      |
| Unchanged   | `/internal/whatsapp/notifications/preferences` (GET/PUT) | Underlying Firestore document is split, but the public envelope shape is preserved.                  |
| Unchanged   | `/internal/whatsapp/users/{id}` etc.                     | `WhatsAppUserMappingPublic` projection unchanged; `notificationLevel` already excluded.              |

> **Out of scope for this issue:** the `/internal/code/metrics` endpoint that replaces `view-metrics.ts` reads from `code_tasks/{taskId}/turn_metrics`; if it doesn't exist yet, the orchestrator subtask either (a) wires a thin client that calls an existing code-agent endpoint, or (b) defers the script to code-agent with a `pnpm script` entry. Decision delegated to the code-agent owner — see Subtask 3.

---

## Shared Contracts (read first; every subtask depends on these)

These contracts are the only cross-subtask coupling. They are defined here so all five subtasks can be executed in parallel by independent agents.

### C1. `firestore-collections.json` schema (extension)

Existing schema (one entry per collection):

```json
{
  "collections": {
    "<collection_name>": {
      "owner": "<service-or-worker-name>",
      "description": "<human description>",
      "subcollections": ["<optional>"]
    }
  }
}
```

This plan adds two **optional** fields, both backwards-compatible:

```json
{
  "collections": {
    "<collection_name>": {
      "owner": "<service-or-worker-name>",
      "description": "...",
      "subcollections": ["..."],
      "indexCollectionGroups": ["<alias-1>", "<alias-2>"],
      "scanPaths": ["apps/<svc>/src/infra/repositories", "apps/<svc>/src/scripts"]
    }
  }
}
```

- `indexCollectionGroups` (optional `string[]`): every distinct `collectionGroup` value used in `firestore.indexes.json` for this logical collection. Defaults to `[<collection_name>]` if absent. Required when (a) the collection has subcollection indexes (e.g. `code_tasks` → `turn_metrics`, `logs`) or (b) historical naming created aliases (e.g. `github-pr-events` plus the snake_case `github_pr_events`).
- `scanPaths` (optional `string[]`): additional repo-relative directories the ownership-verification script must scan beyond the default `apps/<owner>/src/infra/firestore/`. Used to bring `apps/code-agent/src/infra/repositories/` and `apps/code-agent/src/scripts/` under enforcement without breaking other services.

**Owner:** Subtask 2 owns this schema change and is the only subtask that edits `firestore-collections.json` outside its own collection rows. Subtasks 3, 4, and 5 may add `scanPaths`/`indexCollectionGroups` entries for collections they own.

### C2. ESLint `no-unbounded-firestore-get` rule

A new local ESLint rule lives at `eslint-rules/no-unbounded-firestore-get.cjs` and is registered via the existing flat config at `eslint.config.mjs`.

- **Disallowed:** `someThing.collection('<name>').get()` and `firestore.collection('<name>').get()` when the immediately-preceding chain segment is **not** `.limit(...)`, `.where(...)`, `.startAfter(...)`, `.startAt(...)`, `.endBefore(...)`, `.endAt(...)`, or `.select(...)`.
- **Allowed:** `db.collection('x').limit(N).get()`, `db.collection('x').where(...).get()`, `db.collection('x').doc(id).get()`.
- **Rule severity:** `error`. To opt out, callers must add `// eslint-disable-next-line no-unbounded-firestore-get -- <reason>` (the reason is required by an existing CI script — see `scripts/verify-pattern-suppression.mjs`).

**Owner:** Subtask 1 ships the rule. Subtask 3 is the only consumer that needs to fix existing offenders inside `apps/code-agent/`.

### C3. `withSchemaVersion` write helper

Lives at `packages/infra-firestore/src/schemaVersion.ts`:

```ts
import { Timestamp } from '@google-cloud/firestore';

export interface SchemaVersionedFields {
  schemaVersion: number;
  schemaUpdatedAt: Timestamp;
}

/** Stamp `schemaVersion` (current write contract version) and `schemaUpdatedAt`
 *  onto a document body. Idempotent — always overwrites both fields. */
export function withSchemaVersion<T extends object>(
  body: T,
  version: number,
  now: Timestamp = Timestamp.now(),
): T & SchemaVersionedFields {
  return { ...body, schemaVersion: version, schemaUpdatedAt: now };
}
```

- Exported from `packages/infra-firestore/src/index.ts`.
- New writes in code-agent / whatsapp-service repositories (Subtasks 3 and 4) use it; existing writes are NOT retro-stamped (avoids the immutable-migration anti-pattern).
- A companion `assertSchemaVersionLE(doc, max)` helper for read-side guards is OPTIONAL; do not ship if no consumer in this issue needs it.

**Owner:** Subtask 5 ships the helper + tests. Subtasks 3 and 4 import it once §5 lands; until then they add a `TODO(INT-1532-S5)` comment and stamp the field manually (`{ ...body, schemaVersion: 1, schemaUpdatedAt: Timestamp.now() }`) so they are NOT blocked.

### C4. Migration manifest

A new file `migrations/manifest.json` is the single source of truth for "which migration IDs exist on `development`". Format:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "lastReservedId": "097",
  "entries": [
    { "id": "001", "name": "initial-indexes-rules", "checksum": "sha256:…" },
    { "id": "002", "name": "initial-llm-pricing",  "checksum": "sha256:…" }
  ]
}
```

- `entries[].checksum` is the SHA-256 hex digest of the migration file's bytes at the moment it is added to the manifest (i.e. when its PR merges to `development`). It is NOT recomputed afterwards — that's the whole point of "immutable".
- `lastReservedId` is the highest reserved ID; new migrations claim `lastReservedId + 1` and update this field in the same PR that adds the migration.
- `migrations/manifest.json` is committed to git; CI fails if a PR adds a `migrations/NNN_*.mjs` without a corresponding manifest row.

**Owner:** Subtask 1 introduces the manifest schema, the bootstrap script that backfills it from current `migrations/`, and the verifier. No other subtask edits `manifest.json` (Subtask 2's cleanup migration adds itself as a normal new row).

### C5. Generated-artifact commit policy

Decision made in this plan to remove the policy ambiguity: **commit both `firestore.indexes.json` and `firestore.rules`**, and add a CI gate that regenerates and diffs.

- `.gitignore` removes the line that excludes `firestore.rules` (currently line ~62).
- `scripts/verify-firestore-artifacts.mjs` (new) re-runs the migration aggregation in dry-run mode against the current `migrations/` directory, writes to a temp dir, and `diff`s against the committed `firestore.indexes.json` and `firestore.rules`. Non-zero diff = CI failure.
- `scripts/migrate.mjs` learns a `--write-artifacts-only` flag that emits both files into the repo root without deploying. Engineers run this locally after authoring a migration; CI verifies they did.

**Owner:** Subtask 1.

### C6. Subtask boundary contract

Each subtask is self-contained and can land in any order:

| #    | Owner boundary                                                         | Inputs (read-only)                         | Outputs (writes)                                                                                    |
| ---- | ---------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 1    | root `scripts/`, `.husky/`, root cfg                                   | C1, C4, C5                                 | `verify-migrations.mjs`, `migrations/manifest.json`, ESLint rule (C2), pre-push hook, artifact gate |
| 2    | root `firestore-collections.json` + new migration `098_*.mjs`          | C1                                         | Cleanup migration, registry edits, ownership-script extensions                                      |
| 3    | `apps/code-agent/`, `workers/orchestrator/src/scripts/view-metrics.ts` | C1.scanPaths, C2, C3                       | Repo consolidation, paginated backfills, `view-metrics` relocation                                  |
| 4    | `apps/whatsapp-service/`                                               | C3                                         | Document split, registry row update                                                                 |
| 5    | `packages/infra-firestore/`                                            | —                                          | `withSchemaVersion` helper + tests                                                                  |

No subtask depends on another subtask's runtime code. Subtasks 3 and 4 reference C3 by interface only and ship a local stub if Subtask 5 has not landed yet.

---

## File Structure

### Subtask 1 — Platform tooling (root)

- Create: `migrations/manifest.json`
- Create: `scripts/bootstrap-migration-manifest.mjs` (one-shot, deletes itself in the PR after running)
- Create: `scripts/verify-firestore-artifacts.mjs`
- Create: `eslint-rules/no-unbounded-firestore-get.cjs`
- Create: `.husky/pre-push` (or extend existing — verify with `ls -a /repo/.husky`)
- Modify: `scripts/verify-migrations.mjs` (add immutability gate, manifest cross-check)
- Modify: `scripts/migrate.mjs` (add `--write-artifacts-only`)
- Modify: `eslint.config.mjs` (register the local rule)
- Modify: `.gitignore` (remove `firestore.rules` exclusion)
- Modify: `package.json` (add `verify:firestore-artifacts` to `ci:tracked`)
- Test: `scripts/__tests__/verify-migrations.test.mjs`
- Test: `scripts/__tests__/verify-firestore-artifacts.test.mjs`
- Test: `eslint-rules/__tests__/no-unbounded-firestore-get.test.cjs`

### Subtask 2 — Registry reconcile + cleanup migration

- Create: `migrations/098_cleanup-orphaned-indexes-and-registry.mjs`
- Modify: `scripts/verify-firestore-ownership.mjs` (scan extra paths, validate `collectionGroup`s, flag dead registry rows)
- Modify: `firestore-collections.json` (delete dead rows, add `indexCollectionGroups` aliases)
- Modify: `firestore.indexes.json` (regenerated by 098 — committed via Subtask 1's artifact gate)
- Test: `scripts/__tests__/verify-firestore-ownership.test.mjs`

### Subtask 3 — code-agent repo consolidation + view-metrics relocation

- Move: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts` → `apps/code-agent/src/infra/firestore/codeTaskRepository.ts`
- Move: `apps/code-agent/src/infra/repositories/codeTaskRepositoryWithGroupUpdates.ts` → `apps/code-agent/src/infra/firestore/codeTaskRepositoryWithGroupUpdates.ts`
- Move: `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts` → `apps/code-agent/src/infra/firestore/executionMemoryRepository.ts`
- Move: `apps/code-agent/src/infra/repositories/firestoreTurnMetricsRepository.ts` → `apps/code-agent/src/infra/firestore/turnMetricsRepository.ts`
- Move: `apps/code-agent/src/infra/repositories/firestoreLogLineRepository.ts` → `apps/code-agent/src/infra/firestore/logLineRepository.ts`
- Move: `apps/code-agent/src/infra/repositories/firestoreLogChunkRepository.ts` → `apps/code-agent/src/infra/firestore/logChunkRepository.ts`
- Move: `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryApplicationRepository.ts` → `apps/code-agent/src/infra/firestore/executionMemoryApplicationRepository.ts`
- Delete: `apps/code-agent/src/infra/repositories/` (empty after moves)
- Modify: `apps/code-agent/src/infra/migrations/agentRoutingContractMigration.ts` (paginated cursor stream)
- Modify: `apps/code-agent/src/scripts/backfillGroupSummaries.ts` (paginated cursor stream)
- Move: `workers/orchestrator/src/scripts/view-metrics.ts` → `apps/code-agent/src/scripts/view-metrics.ts`
- Modify: `workers/orchestrator/package.json` (drop `view-metrics` script if present)
- Modify: `apps/code-agent/package.json` (add `view-metrics` script)
- Modify: every importer of the moved repos (compiler-driven; expect ~10–15 files in `apps/code-agent/src/services.ts`, route files, and tests)
- Test: existing tests move with the files; add `paginatedCodeTasksScan.test.ts` for the cursor helper
- Add: `apps/code-agent/src/infra/firestore/paginatedScan.ts` — shared cursor-paged-`get` helper used by both backfills

### Subtask 4 — whatsapp-service document split

- Modify: `apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts` (drop `notificationLevel` knowledge)
- Modify: `apps/whatsapp-service/src/infra/firestore/notificationPreferencesRepository.ts` (read/write a separate document)
- Create: `apps/whatsapp-service/src/infra/firestore/notificationPreferencesMigration.ts` (data-migration helper, idempotent, used once)
- Create: `migrations/099_split-whatsapp-notification-preferences.mjs` (registers a new collection + invokes the helper) — depends on Subtask 1's manifest claim policy; if Subtask 1 has not landed, claim ID 099 manually in `manifest.json`
- Modify: `firestore-collections.json` (add `whatsapp_notification_preferences` row, update the `whatsapp_user_mappings` description to remove the `notificationLevel` mention)
- Test: `apps/whatsapp-service/src/__tests__/infra/notificationPreferencesRepository.test.ts` (update for new doc shape; add backfill happy-path)

### Subtask 5 — packages/infra-firestore schema-version helper

- Create: `packages/infra-firestore/src/schemaVersion.ts`
- Modify: `packages/infra-firestore/src/index.ts` (re-export)
- Test: `packages/infra-firestore/src/__tests__/schemaVersion.test.ts`
- Modify: `packages/infra-firestore/package.json` if exports list is enumerated

---

## Subtask 1 — Platform Tooling

**Files:** see "File Structure" above.

- [ ] **Step 1.1: Bootstrap the manifest from current `migrations/`**

Create `scripts/bootstrap-migration-manifest.mjs`:

```js
#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const migrationsDir = join(repoRoot, 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => /^\d{3}_.+\.mjs$/.test(f))
  .sort();

const entries = files.map((f) => {
  const [, id, name] = f.match(/^(\d{3})_(.+)\.mjs$/);
  const bytes = readFileSync(join(migrationsDir, f));
  const checksum = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  return { id, name, checksum };
});

const lastReservedId = entries.at(-1)?.id ?? '000';
const manifest = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  lastReservedId,
  entries,
};

writeFileSync(join(migrationsDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote manifest with ${entries.length} entries (latest: ${lastReservedId})`);
```

Run: `node scripts/bootstrap-migration-manifest.mjs`. Verify the resulting file looks sane (97 entries today). Commit `manifest.json`. Delete the bootstrap script in the same PR (`git rm scripts/bootstrap-migration-manifest.mjs`).

- [ ] **Step 1.2: Write failing test for migration immutability gate**

Create `scripts/__tests__/verify-migrations.test.mjs`. Spin up a temp dir with a fixture manifest + two migration files; mutate one of them; assert `verifyMigrations()` returns an error containing `checksum mismatch`. Initial run must FAIL because the gate isn't implemented yet.

- [ ] **Step 1.3: Implement immutability + manifest cross-check in `verify-migrations.mjs`**

Add two phases AFTER the existing sequential-ID check:
1. Load `migrations/manifest.json`. For every `entries[i]`, recompute `sha256` of `migrations/<id>_<name>.mjs` and compare to `entries[i].checksum`. Mismatch → `errors.push("Migration ${id} has been modified after merge — checksums differ. Migrations are immutable.")`.
2. For every file `migrations/NNN_*.mjs` not present in `manifest.json`, require it to be `lastReservedId + 1` (allow exactly one new migration per PR). Otherwise → `errors.push("New migration ${id} must equal lastReservedId+1=${expected}.")`.

Run the test: it must PASS.

- [ ] **Step 1.4: Wire the new gate into `pnpm run ci:tracked`**

Verify by reading `package.json` that `verify-migrations` is already invoked by `ci:tracked`. If not, add it. Run `pnpm run verify:workspace:tracked -- migrations` to sanity-check (the `migrations` workspace exists per `Glob` output of `migrations/vitest.config.ts`).

- [ ] **Step 1.5: Add the pre-push hook**

Inspect `/repo/.husky/`. If no `pre-push` exists, create one:

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
node scripts/verify-migrations.mjs || exit 1
```

If a `pre-push` already exists, append the verifier line. Make it executable: `chmod +x .husky/pre-push`.

- [ ] **Step 1.6: Write failing test for the ESLint rule**

Create `eslint-rules/__tests__/no-unbounded-firestore-get.test.cjs` using `eslint`'s `RuleTester`:

```js
const { RuleTester } = require('eslint');
const rule = require('../no-unbounded-firestore-get.cjs');
const tester = new RuleTester({ parserOptions: { ecmaVersion: 2022, sourceType: 'module' } });
tester.run('no-unbounded-firestore-get', rule, {
  valid: [
    "db.collection('x').limit(10).get()",
    "db.collection('x').where('a','==',1).get()",
    "db.collection('x').doc('y').get()",
  ],
  invalid: [
    { code: "db.collection('x').get()", errors: [{ messageId: 'unbounded' }] },
    { code: "firestore.collection('code_tasks').get()", errors: [{ messageId: 'unbounded' }] },
  ],
});
```

- [ ] **Step 1.7: Implement the ESLint rule**

`eslint-rules/no-unbounded-firestore-get.cjs`:

```js
'use strict';
const SAFE_INTERMEDIATES = new Set([
  'limit', 'where', 'startAfter', 'startAt', 'endBefore', 'endAt', 'select', 'doc', 'orderBy',
]);
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid .collection(x).get() without a bounded query' },
    messages: {
      unbounded: 'Direct .collection(x).get() is unbounded; use .limit(N), .where(...), or paginated cursors.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // node.callee.property?.name === 'get' AND no args
        if (node.callee.type !== 'MemberExpression') return;
        if (node.callee.property.name !== 'get' || node.arguments.length !== 0) return;
        // Walk back to find the chain root.
        let cur = node.callee.object;
        while (cur && cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression') {
          const segName = cur.callee.property.name;
          if (SAFE_INTERMEDIATES.has(segName)) return; // bounded
          cur = cur.callee.object;
        }
        // If the immediate predecessor was a `.collection(...)` call, flag it.
        const parent = node.callee.object;
        if (
          parent.type === 'CallExpression' &&
          parent.callee.type === 'MemberExpression' &&
          parent.callee.property.name === 'collection'
        ) {
          context.report({ node, messageId: 'unbounded' });
        }
      },
    };
  },
};
```

Run the test: it must PASS.

- [ ] **Step 1.8: Register the rule in `eslint.config.mjs`**

Add the local plugin so the rule is enforced repo-wide. Check the existing plugin registration pattern (search `eslint.config.mjs` for `plugins:`) and follow it. Make the severity `error`. Allow per-line opt-out with the standard `// eslint-disable-next-line ... -- reason` comment that `verify-pattern-suppression.mjs` already requires.

- [ ] **Step 1.9: Decide and apply C5 (artifact commit policy)**

Edit `.gitignore` and remove the `firestore.rules` exclusion line (keep the comment about `firestore.indexes.json` being tracked). Run `node scripts/migrate.mjs --write-artifacts-only` (implement this flag as a thin wrapper around the existing aggregation that writes to the repo root and exits 0) and commit the resulting `firestore.rules`.

- [ ] **Step 1.10: Implement and test `verify-firestore-artifacts.mjs`**

Test (`scripts/__tests__/verify-firestore-artifacts.test.mjs`): seed a temp dir with two migration fixtures, run the verifier with `committedRulesPath` set to a hand-crafted (intentionally wrong) file, expect a non-zero exit and a diff line.

Implementation: invoke the same aggregation `migrate.mjs` already uses, write to `os.tmpdir()`, and `diff` against the committed files. Wire into `package.json` `ci:tracked` after `verify-migrations`.

- [ ] **Step 1.11: Run full CI and commit**

```bash
pnpm run ci:tracked | tee /tmp/ci-output-int1532-s1.txt
git add scripts/verify-migrations.mjs scripts/verify-firestore-artifacts.mjs scripts/migrate.mjs \
        migrations/manifest.json eslint-rules/ eslint.config.mjs .gitignore .husky/pre-push \
        package.json firestore.rules
git commit -m "chore(int-1532-s1): platform tooling — migration immutability, artifact gate, no-unbounded-firestore-get"
```

---

## Subtask 2 — Registry reconcile + cleanup migration

**Files:** `scripts/verify-firestore-ownership.mjs`, `firestore-collections.json`, `migrations/098_cleanup-orphaned-indexes-and-registry.mjs`.

- [ ] **Step 2.1: Catalogue the orphans (read-only investigation)**

Run `Grep` for each suspect `collectionGroup` (`compositeFeeds`, `composite_feeds`, `composite_feed_snapshots`, `custom_data_sources`, `dataSource`, `visualizations`, `writing_samples`) under `apps/`, `workers/`, `packages/`. Record findings in a one-paragraph comment block at the top of `098_*.mjs`. Any orphan with ZERO references is fair game to delete; any orphan with references must instead be added to the registry under its true owner.

- [ ] **Step 2.2: Write failing tests for the extended ownership scanner**

Update `scripts/__tests__/verify-firestore-ownership.test.mjs` (create if missing) with three new fixtures:

1. A registry row with `scanPaths: ["apps/code-agent/src/infra/repositories"]` and a TS file at that path referencing the collection — must NOT be flagged as undeclared.
2. An indexes fixture containing a `collectionGroup` not present in any registry row's `indexCollectionGroups` (or as a top-level key) — must be flagged with `ORPHAN_INDEX`.
3. A registry row with `owner: "code-agent"` but ZERO matches anywhere under `apps/code-agent` — must produce a warning (NOT an error, to avoid bricking CI when a deletion is mid-flight).

- [ ] **Step 2.3: Extend `verify-firestore-ownership.mjs`**

1. Replace the hard-coded `firestoreDir = join(appsDir, service, 'src', 'infra', 'firestore')` with a per-collection scan that includes both that default AND every `scanPaths[]` from the registry row.
2. Also scan `workers/<owner>/src/` when `owner` matches a `workers/*` directory.
3. After existing checks, walk `firestore.indexes.json`. For each `collectionGroup` value, look up which registry row claims it (via `indexCollectionGroups` or top-level key). Unmatched values → `violations.push({ type: 'ORPHAN_INDEX', collection, … })`.
4. For each registry row, if zero references exist anywhere in scanned paths, emit a warning (NOT error) line `Registry entry '<name>' has no code references — consider deleting`.

Run tests: must PASS.

- [ ] **Step 2.4: Author migration `098_cleanup-orphaned-indexes-and-registry.mjs`**

```js
export const metadata = {
  id: '098',
  name: 'cleanup-orphaned-indexes-and-registry',
  description: 'Delete orphaned data-insights-agent indexes and reconcile registry aliases',
  createdAt: '2026-04-24',
};

// Authoritative list — the indexes module emits the union; this migration
// simply removes the historical ones by NOT redeclaring them. Because the
// aggregator dedupes, we use `indexes: []` and rely on the migration runner's
// future "drop indexes not in aggregate" semantics. If the runner does not
// support drops yet, leave a code comment + manually run `firebase firestore:indexes`
// against the listed names — see runbook in step 2.5.

export const indexes = [];
export const rules = {};

export async function up(context) {
  // No data mutation. This migration exists to record the registry+indexes
  // reconciliation and bump the manifest. The aggregated `firestore.indexes.json`
  // regenerated after this migration must not contain the orphans.
  await context.deployIndexes();
  await context.deployRules();
  context.logger.info('Cleanup migration 098 applied (no data mutation).');
}
```

> ⚠️ Per `mem_112a93e6` (signature contract): `up` MUST take `(context)`, not `(db)`, and Firestore access goes through `context.firestore`. Do not regress.

- [ ] **Step 2.5: If the migration runner does not auto-drop, document the manual step**

Add `migrations/098_cleanup-orphaned-indexes-and-registry.runbook.md` listing the exact `gcloud firestore indexes composite delete` commands per orphan, scoped to project `intexuraos-dev-pbuchman`. The runbook is reference-only; CI does not execute it.

- [ ] **Step 2.6: Edit `firestore-collections.json`**

Delete dead rows confirmed in step 2.1 (do NOT delete rows that match active code). Add `indexCollectionGroups` aliases where the `collectionGroup` column shows historical naming (e.g. `github-pr-events` and any snake_case variant used in indexes). Add `scanPaths` to every code-agent collection that lives under `apps/code-agent/src/infra/repositories/` today (these will MOVE in Subtask 3 — keeping `scanPaths` keeps the registry honest in either world).

Concrete `scanPaths` to add for collections owned by `code-agent`:

```json
"scanPaths": ["apps/code-agent/src/infra/repositories", "apps/code-agent/src/scripts"]
```

Apply to: `code_tasks`, `execution_memories`, `execution_memory_applications`, `task_group_summaries`, `user_group_counts`. Do NOT add `scanPaths` for collections already under `src/infra/firestore/` only.

- [ ] **Step 2.7: Update manifest, regenerate artifacts, run CI, commit**

```bash
# Claim the next ID in manifest.json (097 → 098).
# Regenerate the artifacts that Subtask 1's gate will compare against.
node scripts/migrate.mjs --write-artifacts-only
pnpm run ci:tracked | tee /tmp/ci-output-int1532-s2.txt
git add migrations/098_*.mjs migrations/098_*.runbook.md migrations/manifest.json \
        scripts/verify-firestore-ownership.mjs firestore-collections.json \
        firestore.indexes.json firestore.rules
git commit -m "chore(int-1532-s2): reconcile firestore registry + indexes (cleanup migration 098)"
```

---

## Subtask 3 — code-agent repo consolidation, paginated backfills, view-metrics relocation

**Files:** see "File Structure".

- [ ] **Step 3.1: Read the types BEFORE moving anything (Pre-Flight)**

Open `apps/code-agent/src/services.ts` and identify every import from `infra/repositories/`. Open every test under `apps/code-agent/src/__tests__/` that imports from `infra/repositories/` (use `Grep -- "from '.*infra/repositories"`). List them in a scratchpad — these are the files that must be patched in lockstep with each move.

- [ ] **Step 3.2: Create the shared paginated-scan helper (test first)**

Test (`apps/code-agent/src/__tests__/infra/firestore/paginatedScan.test.ts`): seed an in-memory Firestore fake with 250 docs, call `paginatedScan(query, { batchSize: 50 }, async (doc) => collected.push(doc.id))`, expect 5 batches and 250 collected IDs.

Implementation (`apps/code-agent/src/infra/firestore/paginatedScan.ts`):

```ts
import type { Query, QueryDocumentSnapshot } from '@google-cloud/firestore';

export interface PaginatedScanOptions {
  batchSize: number;
}

/** Cursor-paged scan. The query MUST be ordered (e.g. `.orderBy('createdAt')` or
 *  `.orderBy(FieldPath.documentId())`); otherwise startAfter is undefined.
 *  The callback receives one doc at a time; throw to abort. */
export async function paginatedScan(
  baseQuery: Query,
  options: PaginatedScanOptions,
  onDoc: (doc: QueryDocumentSnapshot) => Promise<void>,
): Promise<{ scanned: number }> {
  let cursor: QueryDocumentSnapshot | undefined;
  let scanned = 0;
  for (;;) {
    let q = baseQuery.limit(options.batchSize);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      await onDoc(doc);
      scanned++;
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < options.batchSize) break;
  }
  return { scanned };
}
```

Run the test: it must PASS.

- [ ] **Step 3.3: Replace the unbounded scan in `agentRoutingContractMigration.ts`**

Modify `apps/code-agent/src/infra/migrations/agentRoutingContractMigration.ts`:

1. Replace `const snapshot = await firestore.collection('code_tasks').get(); for (const doc of snapshot.docs) { … }` with `paginatedScan(firestore.collection('code_tasks').orderBy(FieldPath.documentId()), { batchSize: 200 }, async (doc) => { … })`.
2. Apply the same change in `assertNoLegacyAgentRoutingContractValues` (use a smaller batch size — 50 — because it short-circuits at 10 offenders).
3. Add a unit test verifying the migration walks all 250 fixture docs (mirrors the helper test).

Run the new test: must PASS.

- [ ] **Step 3.4: Replace the unbounded scan in `backfillGroupSummaries.ts`**

Same pattern as 3.3. The script may already do its own paging — verify by reading the file first; only convert the offending site. After the change, the ESLint rule from Subtask 1 must not flag this file.

- [ ] **Step 3.5: Move repos one file at a time, run tests after each move**

For each repository file listed in "File Structure", do:

```bash
git mv apps/code-agent/src/infra/repositories/<old>.ts apps/code-agent/src/infra/firestore/<new>.ts
# Update every importer (compiler errors will pinpoint them) — fix and re-export from services.ts.
pnpm --filter @intexuraos/code-agent test
```

Commit after each move so a bad rename can be reverted in isolation.

- [ ] **Step 3.6: Delete the empty `repositories/` directory**

Verify it is empty (`ls apps/code-agent/src/infra/repositories`); delete with `git rm -r`.

- [ ] **Step 3.7: Stamp `schemaVersion` on new writes (per C3)**

In each moved repository's `create` / `add` / `set` paths, wrap the body with `withSchemaVersion(body, 1)` from `@intexuraos/infra-firestore`. If Subtask 5 has not landed yet, inline the snippet from C3 with a `// TODO(INT-1532-S5): switch to import once helper lands` comment. Existing documents are NOT migrated — only new writes.

Add one unit test per repo confirming a freshly-created doc carries `schemaVersion: 1` and `schemaUpdatedAt: <Timestamp>`.

- [ ] **Step 3.8: Relocate `view-metrics.ts`**

```bash
git mv workers/orchestrator/src/scripts/view-metrics.ts apps/code-agent/src/scripts/view-metrics.ts
```

Update `package.json` scripts in both packages so the binary runs from `apps/code-agent` (e.g. `pnpm --filter @intexuraos/code-agent view-metrics …`). Update any docs in `docs/` that mention the old path (run `Grep -i 'view-metrics' docs/`).

- [ ] **Step 3.9: Run `pnpm run verify:workspace:tracked -- code-agent` and the orchestrator workspace**

Both must pass — orchestrator should still build (the script removal is the only change). If `code-agent` coverage drops below 95% on a moved file, restore tests rather than reaching for `v8 ignore`.

- [ ] **Step 3.10: Commit**

```bash
git add apps/code-agent/ workers/orchestrator/
git commit -m "refactor(int-1532-s3): consolidate code-agent firestore layer; paginate backfills; relocate view-metrics"
```

---

## Subtask 4 — whatsapp-service document split

**Files:** `apps/whatsapp-service/src/infra/firestore/notificationPreferencesRepository.ts`, `apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts`, `migrations/099_split-whatsapp-notification-preferences.mjs`, registry.

**Target shape:** `whatsapp_user_mappings/{userId}` keeps `{ phoneNumbers, connected, createdAt, updatedAt }`. A new top-level collection `whatsapp_notification_preferences/{userId}` holds `{ notificationLevel, schemaVersion, schemaUpdatedAt, createdAt, updatedAt }`.

- [ ] **Step 4.1: Add the new collection to the registry**

Add to `firestore-collections.json`:

```json
"whatsapp_notification_preferences": {
  "owner": "whatsapp-service",
  "description": "Per-user notification importance level ('all'|'important', default 'all'). Split from whatsapp_user_mappings (INT-1532)."
}
```

Update the existing `whatsapp_user_mappings` description to drop the `notificationLevel` mention.

- [ ] **Step 4.2: Write failing test for the new repository shape**

Update `apps/whatsapp-service/src/__tests__/infra/notificationPreferencesRepository.test.ts`:

```ts
it('reads notificationLevel from the dedicated collection', async () => {
  const fake = new FakeFirestore();
  await fake
    .collection('whatsapp_notification_preferences')
    .doc('user-1')
    .set({ notificationLevel: 'important', schemaVersion: 1, schemaUpdatedAt: Timestamp.now() });

  const result = await getPreferences('user-1');
  expect(result.ok).toBe(true);
  expect(result.value.notificationLevel).toBe('important');
});

it('does NOT read notificationLevel from whatsapp_user_mappings', async () => {
  const fake = new FakeFirestore();
  await fake
    .collection('whatsapp_user_mappings')
    .doc('user-1')
    .set({ userId: 'user-1', notificationLevel: 'important', phoneNumbers: [], connected: false });

  const result = await getPreferences('user-1');
  expect(result.value.notificationLevel).toBe('all'); // default — must NOT leak from mapping doc
});
```

- [ ] **Step 4.3: Rewrite `notificationPreferencesRepository.ts`**

Read/write `whatsapp_notification_preferences/{userId}` only. Stamp `schemaVersion: 1` per C3. Default to `DEFAULT_NOTIFICATION_LEVEL` when the doc is absent. Run tests: must PASS.

- [ ] **Step 4.4: Strip `notificationLevel` from `userMappingRepository.ts`**

Delete the `notificationLevel?: 'all' | 'important'` field from `WhatsAppUserMappingDoc`. Confirm no other consumer reads it (use `Grep`). Existing docs in production retain the field on disk — that's intentional; the migration step will read+copy+delete.

- [ ] **Step 4.5: Author migration `099_split-whatsapp-notification-preferences.mjs`**

```js
export const metadata = {
  id: '099',
  name: 'split-whatsapp-notification-preferences',
  description: 'Move notificationLevel out of whatsapp_user_mappings into whatsapp_notification_preferences (INT-1532)',
  createdAt: '2026-04-24',
};
export const indexes = [];
export const rules = {
  collections: {
    'whatsapp_notification_preferences/{userId}': {
      comment: 'Per-user WhatsApp notification importance level',
      get: 'isOwner(resource.data.userId)',
      list: 'false',
      write: 'false',
    },
  },
};

export async function up(context) {
  const { firestore, logger } = context;
  // Pagination: 200 docs/batch, ordered by document ID.
  let cursor;
  let migrated = 0;
  for (;;) {
    let q = firestore.collection('whatsapp_user_mappings').orderBy('__name__').limit(200);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const data = doc.data() ?? {};
      if (data.notificationLevel === 'all' || data.notificationLevel === 'important') {
        const target = firestore.collection('whatsapp_notification_preferences').doc(doc.id);
        const now = new Date();
        await target.set({
          userId: doc.id,
          notificationLevel: data.notificationLevel,
          schemaVersion: 1,
          schemaUpdatedAt: now,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }, { merge: true });
        migrated++;
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < 200) break;
  }
  logger.info({ migrated }, 'Backfilled whatsapp_notification_preferences');
}
```

> ⚠️ The migration is **read-and-copy only** — it does NOT delete `notificationLevel` from the source doc. Field cleanup is out of scope to keep the migration trivially reversible if the deploy needs to roll back. A follow-up migration (out of this issue) can drop the field once the new path has been live for ≥7 days.

Claim ID 099 in `manifest.json` (Subtask 1 controls the manifest; if Subtask 1 hasn't merged yet, append the row manually and document the dependency in the PR description).

- [ ] **Step 4.6: Run service CI and commit**

```bash
pnpm run verify:workspace:tracked -- whatsapp-service | tee /tmp/ci-output-int1532-s4.txt
node scripts/migrate.mjs --write-artifacts-only  # if Subtask 1 has landed
git add apps/whatsapp-service/ migrations/099_*.mjs migrations/manifest.json firestore-collections.json firestore.rules firestore.indexes.json
git commit -m "feat(int-1532-s4): split whatsapp_user_mappings notificationLevel into dedicated collection"
```

---

## Subtask 5 — `packages/infra-firestore` schema-version helper

- [ ] **Step 5.1: Write the test first**

`packages/infra-firestore/src/__tests__/schemaVersion.test.ts`:

```ts
import { Timestamp } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import { withSchemaVersion } from '../schemaVersion.js';

describe('withSchemaVersion', () => {
  it('stamps schemaVersion and schemaUpdatedAt onto an empty body', () => {
    const now = Timestamp.fromDate(new Date('2026-04-24T12:00:00Z'));
    const out = withSchemaVersion({}, 3, now);
    expect(out.schemaVersion).toBe(3);
    expect(out.schemaUpdatedAt).toBe(now);
  });

  it('preserves caller fields', () => {
    const out = withSchemaVersion({ foo: 'bar' }, 1);
    expect(out.foo).toBe('bar');
    expect(out.schemaVersion).toBe(1);
    expect(out.schemaUpdatedAt).toBeInstanceOf(Timestamp);
  });

  it('overwrites prior schemaVersion if the caller supplied one', () => {
    const out = withSchemaVersion({ schemaVersion: 1 } as { schemaVersion: number }, 5);
    expect(out.schemaVersion).toBe(5);
  });
});
```

Run: must FAIL (module not yet present).

- [ ] **Step 5.2: Implement `schemaVersion.ts`**

Use the exact code from §C3 above. Export from `packages/infra-firestore/src/index.ts`.

Run the test: must PASS. Verify branch coverage = 100% for the new file (no `v8 ignore` allowed — the function has zero branches).

- [ ] **Step 5.3: Build and run package CI**

```bash
pnpm --filter @intexuraos/infra-firestore build
pnpm --filter @intexuraos/infra-firestore test
pnpm run verify:workspace:tracked -- infra-firestore | tee /tmp/ci-output-int1532-s5.txt
```

- [ ] **Step 5.4: Commit**

```bash
git add packages/infra-firestore/
git commit -m "feat(int-1532-s5): add withSchemaVersion helper for new Firestore writes"
```

---

## Self-Review Checklist (already executed by the planner)

- [x] **Spec coverage:** Each of the 8 plan bullets in the original Linear description maps to a task: (1) → S1.3-1.5, (2) → S2.3, (3) → S2.4, (4) → S1.9, (5) → S3.8, (6) → S3.3-3.4 + S1.6-1.8, (7) → S3.5-3.7 + S5, (8) → S4.
- [x] **Placeholder scan:** No "TBD"/"add appropriate"/"similar to". Every code block is concrete.
- [x] **Type consistency:** `withSchemaVersion(body, version, now?)` signature is identical in C3, S5.1, S5.2, S3.7, S4.5. `paginatedScan(query, { batchSize }, onDoc)` is identical in C-ref, S3.2, S3.3, S3.4, and matches the inline pagination in S4.5.
- [x] **No subtask depends on another:** Subtasks 3 and 4 reference C3 behind a `TODO` if Subtask 5 has not landed; Subtask 2 reserves manifest ID `098` and Subtask 4 reserves `099` so the manifest write is the only ordering requirement.

---

## Acceptance Criteria

1. `pnpm run ci:tracked` passes on a clean branch with all five subtask commits squashed in.
2. `node scripts/verify-migrations.mjs` rejects a manually-mutated migration file (manual smoke test on the planning PR).
3. `node scripts/verify-firestore-ownership.mjs` reports zero `ORPHAN_INDEX` and zero `UNDECLARED` violations.
4. `firestore.indexes.json` no longer references `compositeFeeds`, `composite_feeds`, `composite_feed_snapshots`, `custom_data_sources`, `dataSource`, `visualizations`, `writing_samples` (whichever are confirmed dead in S2.1).
5. `apps/code-agent/src/infra/repositories/` no longer exists; the equivalent files live under `apps/code-agent/src/infra/firestore/` and are scanned by ownership verification.
6. `workers/orchestrator/src/scripts/view-metrics.ts` no longer exists; the equivalent script lives under `apps/code-agent/src/scripts/`.
7. `getPreferences('user-1')` returns the default `'all'` even when an old `whatsapp_user_mappings/user-1` document carries a stale `notificationLevel` field — i.e. the prose-enforced ownership rule is now structurally enforced.
8. `firestore.rules` is committed and a CI gate fails when it diverges from the migration aggregation.
9. The ESLint rule blocks a freshly-introduced `db.collection('foo').get()` and allows `db.collection('foo').limit(50).get()`.
10. Coverage for new files (`schemaVersion.ts`, `paginatedScan.ts`, the ESLint rule, the new verifier scripts) is 100% branch (no `v8 ignore`).

---

## Test Plan

- Per-subtask test commands are inlined above; run each in isolation before merging that subtask.
- Cross-subtask smoke test (run after all five land):
  - `pnpm run ci:tracked`
  - `node scripts/verify-migrations.mjs`
  - `node scripts/verify-firestore-ownership.mjs`
  - `node scripts/verify-firestore-artifacts.mjs`
  - `pnpm --filter @intexuraos/whatsapp-service test`
  - `pnpm --filter @intexuraos/code-agent test`

---

## Notes for Executing Agents

- Migration immutability rule: **never** `git commit --amend` or `git rebase -i` an already-merged migration file. The new `verify-migrations.mjs` will block your push.
- Per memory `mem_112a93e6`, migrations MUST use `up(context)` and access Firestore via `context.firestore` — not a `db` parameter. Both new migrations (098, 099) follow this contract.
- Per memory `mem_d500b73e` / `mem_6e32653e`, the code-agent task repository decomposition has already been started in this codebase (look at `task-serializer.ts`, `task-query-builder.ts`, `task-dedup.ts`) — Subtask 3 simply RELOCATES the orchestrating adapter without re-decomposing it. Do not blow up the plan by attempting another split.
- Do not introduce dependencies between subtasks at runtime. The contract in §C is the only coupling allowed.
