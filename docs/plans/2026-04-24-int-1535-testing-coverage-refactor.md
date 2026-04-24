# INT-1535 — Testing & Coverage Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the v8-ignore quality gate, extract a shared `@intexuraos/test-utils` package, standardize workspace vitest configs on a single shared base, refactor the orchestrator `task-dispatcher` fake into a scriptable state machine, replace real-time `setTimeout` waits with fake timers, document a `filesystem`/`node-mock` subcategory (or eliminate `vi.mock('node:*')` usage via `FakeFileSystem`), expand E2E coverage, and add an ESLint rule balancing `setServices`/`resetServices`.

**Architecture:** A single engineer (or serial subagent executor) works through tasks sequentially. Tasks are ordered so each later task can consume artifacts produced by earlier tasks (e.g. `packages/test-utils` lands before orchestrator adopts `FakeFileSystem`). Every task ends in a green `pnpm run ci:tracked` and a commit on branch `plan/int-1535-testing-coverage` (or subsequent feature branches off `development`). No subtasks or parallel agents are created — dependencies between workstreams (test-utils → adoption; blocker-keyword tightening → sweep) make parallel execution higher-risk than the wall-clock win justifies.

**Tech Stack:** TypeScript (strict), vitest 1.x + v8 coverage, pnpm workspaces, Fastify, Node ≥ 22, ESLint 9 flat config, existing `scripts/verify-v8-ignore.mjs` AST/regex validator.

**Scope boundaries (explicit non-goals):**
- No changes to production runtime code except the orchestrator `task-dispatcher.ts` seams required to expose detached-promise branches to v8.
- No changes to the `95%` branch-coverage threshold.
- No changes to `vitest.setup.ts` semantics — the shared base must reproduce current behavior byte-for-byte.
- No migration of all 15 duplicated `fakes.ts` files; only a 2–3 service pilot (Task 3.4) proves the contract before opening a follow-up issue for the rest.

**Evidence source:** `docs/reviews/2026-04-24-refactoring-analysis.md` §7 "Testing & Coverage".

---

## File Structure

### Created
- `packages/test-utils/package.json` — new workspace package `@intexuraos/test-utils`.
- `packages/test-utils/tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`.
- `packages/test-utils/src/index.ts` — barrel export.
- `packages/test-utils/src/createFakeLogger.ts`
- `packages/test-utils/src/createFakeAuthUser.ts`
- `packages/test-utils/src/BasePubSubFake.ts`
- `packages/test-utils/src/FakeHttpClient.ts`
- `packages/test-utils/src/TimestampAwareFirestoreFake.ts`
- `packages/test-utils/src/FakeFileSystem.ts`
- `packages/test-utils/src/__tests__/*.test.ts` — one test file per module.
- `vitest.shared.ts` — exports the shared base config (coverage include/exclude, thresholds, `setupFiles`, alias, pool, maxWorkers, timeouts).
- `.eslintrc.set-services.mjs` (or new `eslint-rules/balance-set-services.mjs`) — custom rule requiring `afterEach(resetServices)` when `beforeEach(setServices(…))` is used.
- `.github/workflows/e2e-nightly.yml` — nightly E2E workflow (if not already covered by existing `.github/workflows/e2e.yml` schedule; see Task 7.1 decision point).
- `workers/orchestrator/src/__tests__/helpers/ScriptableIsolationProvider.ts` — the new state-machine-style fake.

### Modified
- `scripts/verify-v8-ignore.mjs` — add duplicate-explanation detector (Phase B-2) and stricter `ts-type`/`source-map` blocker keyword list (prune weak keywords `conditional`, `ternary`, `spread` that describe code rather than the testing blocker).
- `.claude/reference/coverage-exemptions.md` — document the `filesystem`/`node-mock` decision (new subcategory OR adoption of `FakeFileSystem`; see Task 6 decision block).
- `vitest.config.ts` — switch root to consume `vitest.shared.ts` via `mergeConfig`.
- `apps/chat-agent/vitest.config.ts`
- `apps/cron-agent/vitest.config.ts`
- `apps/hellscript-agent/vitest.config.ts`
- `apps/web/vitest.config.ts` (shared-base-compatible subset; web has UI-test exception per CLAUDE.md)
- `packages/infra-otel/vitest.config.ts`
- `packages/internal-clients/vitest.config.ts`
- `migrations/vitest.config.ts`
- `e2e/vitest.config.ts` (opts out of coverage thresholds but still inherits alias + setupFiles)
- `workers/orchestrator/src/services/task-dispatcher.ts` — add seams exposing detached-promise branches so v8 can track them (no behavior change).
- `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` — migrate to `ScriptableIsolationProvider`; delete now-covered v8-ignore blocks (target: 25 removed).
- `workers/orchestrator/src/__tests__/log-forwarder.test.ts` — replace 4× `setTimeout(7000)` waits with `vi.useFakeTimers()` + `advanceTimersByTimeAsync`.
- `apps/image-service/src/infra/image/FakeImageGenerator.ts` → **move** to `apps/image-service/src/__tests__/fakes/FakeImageGenerator.ts`; update imports in `apps/image-service/src/infra/image/index.ts` and any test that imports it.
- `e2e/tests/*.spec.ts` — add `whatsapp→actions→todos` and `research→notion` flows.
- `workers/orchestrator/src/__tests__/mock-code-agent.test.ts` — delete (14-line `describe.skip` stub).
- `package.json` — add `"@intexuraos/test-utils"` workspace reference where consumed.
- 2–3 pilot services (e.g. `apps/user-service`, `apps/linear-agent`, `apps/notion-service`): delete shims in their `__tests__/fakes.ts` that are now owned by `@intexuraos/test-utils`; re-import from the new package.
- `.claude/reference/coverage-exemptions.md` — tighten "Explanation Quality" table with 3 new BAD→GOOD examples drawn from sweep results.

### Removed
- `workers/orchestrator/src/__tests__/mock-code-agent.test.ts` (after Task 8.1).
- Duplicate shims in pilot-migration `fakes.ts` (after Task 3.4).
- ~25 v8-ignore blocks in `task-dispatcher.ts` (after Task 4.3).
- Weak-explanation v8 ignores swept in Task 2.2 (target: ≥40 sites across ≥10 files).

---

## Task Ordering Rationale

1. **Infrastructure first** (shared base config, test-utils package) — unblocks everything else.
2. **Gate tightening** (verify-v8-ignore script changes + sweep) — runs before orchestrator refactor so the orchestrator changes are validated against the new gate.
3. **Orchestrator refactor** — biggest payoff, depends on test-utils (for `FakeFileSystem`) and scriptable fake.
4. **Cross-cutting cleanup** (timer test rewrite, node-mock decision, ESLint rule, file relocations).
5. **E2E expansion + stub deletion** — independent, landed last so a flaky E2E doesn't block earlier mechanical refactors.

---

## Task 1: Create `vitest.shared.ts` base config

**Files:**
- Create: `vitest.shared.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Extract root options into `vitest.shared.ts`**

Write `/repo/vitest.shared.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = __dirname;

/**
 * Shared vitest base for every workspace. Individual workspaces extend
 * this via `mergeConfig(sharedConfig, defineConfig({ ... }))`. The only
 * options a workspace SHOULD override are `test.include`, `test.exclude`,
 * `test.coverage.include`, and workspace-local `alias` entries.
 *
 * DO NOT redefine `setupFiles` — every workspace must inherit the global
 * Firebase/Notion/fetch mocks.
 */
export const sharedConfig: UserConfig = defineConfig({
  resolve: {
    alias: {
      '@notionhq/client': path.resolve(repoRoot, './vitest-mocks/notion-client.ts'),
      '@': path.resolve(repoRoot, './apps/web/src'),
    },
  },
  test: {
    globals: false,
    setupFiles: [path.resolve(repoRoot, './vitest.setup.ts')],
    sequence: { shuffle: false },
    pool: process.env.CI === 'true' ? 'forks' : 'threads',
    maxWorkers: process.env.CI === 'true' ? 2 : undefined,
    testTimeout: 10000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
    },
  },
});
```

- [ ] **Step 2: Rewrite root `vitest.config.ts` to consume the shared base**

```ts
import { mergeConfig, defineConfig } from 'vitest/config';
import { sharedConfig } from './vitest.shared';

// Root config keeps the monorepo-wide include/exclude list + the full
// coverage exclude list; everything else comes from sharedConfig.
export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['**/*.test.ts', '**/*.spec.ts'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        'e2e/**',
        '.claude/hooks/__tests__/**',
        '**/e2e-container.test.ts',
        '.claude/worktrees/**',
      ],
      coverage: {
        include: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.ts', 'workers/**/src/**/*.ts'],
        // NOTE: preserve the existing long `exclude` list from the
        // current root vitest.config.ts verbatim — do not re-author it.
      },
    },
  })
);
```

When porting the root, **copy the existing `coverage.exclude` list verbatim**. Do not rewrite it.

- [ ] **Step 3: Run root coverage sanity check**

Run: `pnpm run ci:tracked`
Expected: no change in pass/fail state from `main`.

- [ ] **Step 4: Commit**

```bash
git add vitest.shared.ts vitest.config.ts
git commit -m "refactor(vitest): extract shared base config (INT-1535)"
```

---

## Task 2: Tighten `verify-v8-ignore` gate and sweep weak explanations

**Files:**
- Modify: `scripts/verify-v8-ignore.mjs`
- Modify: `.claude/reference/coverage-exemptions.md`
- Modify: ~10 source files flagged by the sweep (see Step 2.3).

### Task 2.1: Add duplicate-explanation detector

- [ ] **Step 1: Write the failing self-test**

Append to `scripts/verify-v8-ignore.mjs` `selfTest()`:

```js
// Duplicate explanations within a single file must fail
const result7 = validateDuplicateExplanations([
  { type: 'start', category: 'ts-type', explanation: 'conditional property assignment based on undefined check', file: 'researchRoutes.ts', line: 10 },
  { type: 'start', category: 'ts-type', explanation: 'conditional property assignment based on undefined check', file: 'researchRoutes.ts', line: 42 },
]);
assert.equal(result7.errors.length, 1, 'duplicate explanations within one file should fail');
assert.ok(result7.errors[0].message.includes('duplicate'), 'error names the duplication');
```

Run: `node scripts/verify-v8-ignore.mjs --self-test`
Expected: FAIL — `validateDuplicateExplanations is not defined`.

- [ ] **Step 2: Implement `validateDuplicateExplanations`**

Add after `validateBlockerKeywords`:

```js
function validateDuplicateExplanations(comments) {
  const errors = [];
  const byFile = new Map();

  for (const comment of comments) {
    if (comment.type === 'stop') continue;
    if (!byFile.has(comment.file)) byFile.set(comment.file, new Map());
    const perFile = byFile.get(comment.file);
    const key = `${comment.category}|${comment.explanation.trim().toLowerCase()}`;
    if (!perFile.has(key)) perFile.set(key, []);
    perFile.get(key).push(comment);
  }

  const MAX_ALLOWED_DUPLICATES = 3; // tolerate 3× (true repeated patterns in one file)

  for (const [file, byKey] of byFile.entries()) {
    for (const [key, group] of byKey.entries()) {
      if (group.length > MAX_ALLOWED_DUPLICATES) {
        const [category, explanation] = key.split('|');
        errors.push({
          file,
          line: group[0].line,
          message:
            `Duplicate v8 ignore explanation (${group.length} copies, max ${MAX_ALLOWED_DUPLICATES}) — ` +
            `category="${category}", explanation="${explanation}". ` +
            `Either refactor so one block covers all branches, or differentiate explanations to name the unique blocker per site.`,
        });
      }
    }
  }
  return { errors };
}
```

Wire into `main()` alongside the existing phases:

```js
const { errors: duplicateErrors } = validateDuplicateExplanations(Array.from(validComments));
// ...
const allErrors = [
  ...syntaxErrors,
  ...blockerErrors,
  ...patternErrors,
  ...neverValidErrors,
  ...duplicateErrors,
  ...coverageErrors,
];
```

- [ ] **Step 3: Re-run self-test**

Run: `node scripts/verify-v8-ignore.mjs --self-test`
Expected: `All self-tests passed ✅`

- [ ] **Step 4: Run full validator against current repo**

Run: `node scripts/verify-v8-ignore.mjs 2>&1 | tee /tmp/v8-sweep.txt`

Expected: some duplicate-explanation failures (notably `researchRoutes.ts`). Capture the list — it feeds Task 2.3.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-v8-ignore.mjs
git commit -m "feat(verify-v8-ignore): reject duplicate explanations (INT-1535)"
```

### Task 2.2: Tighten `ts-type` keyword list

- [ ] **Step 1: Identify weak keywords**

Open `.claude/reference/coverage-exemptions.md` and `scripts/verify-v8-ignore.mjs`. The current `ts-type` allowlist includes `conditional`, `ternary`, `spread` — all three describe CODE rather than a BLOCKER. Memory [3] (mem_572f2361) confirms: "V8 ignore categories/explanations that claim coverage when a branch is not truly exercised" is the failure mode we're closing.

- [ ] **Step 2: Write self-test for new behavior**

Add to `selfTest()`:

```js
// 'conditional' alone is no longer enough — must pair with a blocker noun phrase
const result8 = validateBlockerKeywords([
  { type: 'start', category: 'ts-type', explanation: 'conditional property assignment', file: 'x.ts', line: 1 },
]);
assert.equal(result8.errors.length, 1, '"conditional" alone should fail after tightening');

const result9 = validateBlockerKeywords([
  { type: 'start', category: 'ts-type', explanation: 'TypeScript cannot narrow this conditional', file: 'x.ts', line: 1 },
]);
assert.equal(result9.errors.length, 0, '"cannot" still passes');
```

Run: `node scripts/verify-v8-ignore.mjs --self-test`
Expected: FAIL on `result8` (still currently passes because `conditional` matches).

- [ ] **Step 3: Remove weak keywords**

In `CATEGORY_SPECIFIC_KEYWORDS['ts-type']`, delete `'conditional'`, `'ternary'`, `'spread'`. Keep the six that name actual type-system mechanics (`type check`, `type narrowing`, `undefined check`, `null check`, `type system`, `nullish coalescing`, `optional property`).

- [ ] **Step 4: Re-run self-test**

Expected: `All self-tests passed ✅`.

- [ ] **Step 5: Do NOT commit yet**

The tightened gate will fail `pnpm run ci:tracked` until Task 2.3 sweeps the offending sites. Move to 2.3.

### Task 2.3: Sweep weak explanations

- [ ] **Step 1: Enumerate failing sites**

Run: `node scripts/verify-v8-ignore.mjs 2>&1 | tee /tmp/v8-sweep.txt`
Collect every "Explanation lacks blocker keyword" and "Duplicate v8 ignore explanation" line. Target: ≥40 sites across the repo, concentrated in `apps/*/src/routes/researchRoutes.ts`-style files.

- [ ] **Step 2: Rewrite explanations**

For each failing site, rewrite the `--` text following the BAD→GOOD examples in `.claude/reference/coverage-exemptions.md`. Apply memory [3] (mem_572f2361): the explanation must name the testing BLOCKER (what the fake/mock cannot produce) not the code (what the branch does).

Template:
- BAD: `conditional property assignment based on undefined check`
- GOOD: `noUncheckedIndexedAccess requires fallback despite prior .length check`
- GOOD: `FakeFirestore.doc().get() always returns exists=true, cannot simulate missing-doc branch`

For duplicates, collapse 9× copies in `researchRoutes.ts` into at most 3 — if 9 distinct sites truly share one blocker, wrap them in one helper function covered by one test; if blockers differ, differentiate wording.

- [ ] **Step 3: Verify sweep passes**

Run: `node scripts/verify-v8-ignore.mjs`
Expected: exit 0, no duplicate-explanation errors, no blocker-keyword errors.

- [ ] **Step 4: Run full CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-2.3.txt`
Expected: full pass. Coverage unchanged. Investigate any regression before committing (apply memory [2] mem_4344086c: if the tightening reveals a branch that was hidden by an over-broad ignore, EITHER write a test OR narrow the ignore to the truly untestable sub-branch).

- [ ] **Step 5: Update coverage-exemptions.md**

Append three new BAD→GOOD rows drawn from the sweep. Document the rationale for removing `conditional`/`ternary`/`spread` from the `ts-type` list in a new `### Changelog 2026-04` section.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-v8-ignore.mjs .claude/reference/coverage-exemptions.md apps packages workers
git commit -m "refactor(v8-ignore): tighten ts-type keywords; sweep weak explanations (INT-1535)"
```

---

## Task 3: Create `@intexuraos/test-utils` package

**Files:**
- Create: `packages/test-utils/package.json`, `tsconfig*.json`, `vitest.config.ts`, `src/**`.
- Modify: root `pnpm-workspace.yaml` if needed (already globs `packages/*`).

### Task 3.1: Scaffold the package

- [ ] **Step 1: Write the package manifest**

Create `/repo/packages/test-utils/package.json`:

```json
{
  "name": "@intexuraos/test-utils",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "import": "./src/index.ts", "types": "./src/index.ts" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "verify": "pnpm run build && pnpm run test"
  },
  "dependencies": {
    "@intexuraos/common-core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:",
    "@vitest/coverage-v8": "catalog:"
  }
}
```

Note: reference other `packages/*/package.json` for current `catalog:` versions — do not invent versions.

- [ ] **Step 2: Copy `tsconfig.json` + `tsconfig.build.json` from `packages/common-core`**

The `common-core` package is the canonical "leaf package" pattern (no domain logic, shared utilities). Use its tsconfigs verbatim, updating only the `extends`/paths.

- [ ] **Step 3: Write minimal `src/index.ts`**

```ts
export { createFakeLogger } from './createFakeLogger.js';
export { createFakeAuthUser } from './createFakeAuthUser.js';
export { BasePubSubFake } from './BasePubSubFake.js';
export { FakeHttpClient } from './FakeHttpClient.js';
export { TimestampAwareFirestoreFake } from './TimestampAwareFirestoreFake.js';
export { FakeFileSystem } from './FakeFileSystem.js';
```

- [ ] **Step 4: Workspace-level vitest config for the package**

Create `/repo/packages/test-utils/vitest.config.ts`:

```ts
import { mergeConfig, defineConfig } from 'vitest/config';
import { sharedConfig } from '../../vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
      coverage: { include: ['src/**/*.ts'] },
    },
  })
);
```

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: new `@intexuraos/test-utils` symlink appears in `node_modules/@intexuraos/`.

- [ ] **Step 6: Commit**

```bash
git add packages/test-utils
git commit -m "feat(test-utils): scaffold @intexuraos/test-utils package (INT-1535)"
```

### Task 3.2: Port `createFakeLogger` and `createFakeAuthUser`

These are the simplest; port first to validate the pattern.

- [ ] **Step 1: Find canonical implementations**

Read the existing implementations in (for example) `apps/user-service/src/__tests__/fakes.ts`. The `FakeLogger` is typically a `{ info, warn, error, debug } = vi.fn()` stub returning `self` for `child()`.

- [ ] **Step 2: Write failing test**

Create `/repo/packages/test-utils/src/__tests__/createFakeLogger.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createFakeLogger } from '../createFakeLogger.js';

describe('createFakeLogger', () => {
  it('records every log invocation per level', () => {
    const logger = createFakeLogger();
    logger.info({ route: '/x' }, 'hello');
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith({ route: '/x' }, 'hello');
  });

  it('child() returns a logger with the same methods', () => {
    const logger = createFakeLogger();
    const child = logger.child({ requestId: 'r1' });
    child.warn('w');
    expect(vi.mocked(child.warn)).toHaveBeenCalledWith('w');
  });
});
```

Run: `pnpm -F @intexuraos/test-utils test`
Expected: FAIL — `createFakeLogger` not exported.

- [ ] **Step 3: Implement**

`src/createFakeLogger.ts`:

```ts
import { vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';

export function createFakeLogger(): Logger {
  const base = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createFakeLogger()),
  };
  return base as unknown as Logger;
}
```

- [ ] **Step 4: Run**

Run: `pnpm -F @intexuraos/test-utils test`
Expected: PASS. Coverage 100%.

- [ ] **Step 5: Port `createFakeAuthUser`**

Find the canonical impl (e.g. `apps/whatsapp-service/src/__tests__/fakes.ts`). Repeat the TDD cycle: failing test first, then implementation.

- [ ] **Step 6: Commit**

```bash
git add packages/test-utils
git commit -m "feat(test-utils): createFakeLogger + createFakeAuthUser (INT-1535)"
```

### Task 3.3: Port `BasePubSubFake`, `FakeHttpClient`, `TimestampAwareFirestoreFake`, `FakeFileSystem`

Follow the same TDD pattern for each. Key contracts:

- **BasePubSubFake**: abstract helper with `published: PublishedMessage[]`, `publish(topic, data)`, `publishError(err)`. Concrete fakes extend it.
- **FakeHttpClient**: `enqueueResponse()` and `enqueueError()`; FIFO response queue keyed by `(method, url)`. Must support simulating `AbortError` (memory [1] mem_a047f467: optional methods need explicit `vi.mocked(...).mockResolvedValueOnce` — applies if `FakeHttpClient` exposes optional retry hooks).
- **TimestampAwareFirestoreFake**: wraps in-memory `Map<path, DocData>` and returns objects with `.toDate()` / `.toMillis()` on Timestamp fields — drops the duplicated shim present in every service's `fakes.ts`.
- **FakeFileSystem**: in-memory `Map<path, string>` with `readFile`, `writeFile`, `exists`, `mkdir`, `rm`. Its existence is the enabler for Task 6 option B.

- [ ] **Step 1-4 per fake: failing test → implement → pass → commit**

Each fake gets its own commit:
```bash
git commit -m "feat(test-utils): BasePubSubFake (INT-1535)"
git commit -m "feat(test-utils): FakeHttpClient with AbortError support (INT-1535)"
git commit -m "feat(test-utils): TimestampAwareFirestoreFake (INT-1535)"
git commit -m "feat(test-utils): FakeFileSystem (INT-1535)"
```

- [ ] **Step 5: Package coverage verification**

Run: `pnpm -F @intexuraos/test-utils test -- --coverage`
Expected: 95% branches on every module (per root threshold inherited from `vitest.shared.ts`).

### Task 3.4: Pilot migration — 2 services adopt `@intexuraos/test-utils`

Pick the two services with the smallest `__tests__/fakes.ts` (to minimize blast radius): likely `apps/mobile-notifications-service` and `apps/user-service`.

- [ ] **Step 1: Add dependency**

In both services' `package.json`:

```json
"devDependencies": {
  "@intexuraos/test-utils": "workspace:*"
}
```

Run: `pnpm install`

- [ ] **Step 2: Replace shims in `__tests__/fakes.ts`**

Delete the local `FakeLogger` / `FakeHttpClient` / etc. shims; replace with:

```ts
export { createFakeLogger, FakeHttpClient } from '@intexuraos/test-utils';
```

Leave service-specific fakes in place (they are not shared).

- [ ] **Step 3: Verify**

Run: `pnpm run verify:workspace:tracked -- mobile-notifications-service`
Run: `pnpm run verify:workspace:tracked -- user-service`
Expected: all tests pass, coverage unchanged.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(mobile-notifications-service,user-service): adopt @intexuraos/test-utils pilot (INT-1535)"
```

- [ ] **Step 5: Create follow-up issue**

Open a new Linear issue in the INT-1473 parent family: `Refactor: migrate remaining 13 services to @intexuraos/test-utils` with explicit enumeration of the remaining `fakes.ts` files. This is out of scope for INT-1535 — the pilot proves the contract; the full sweep is mechanical follow-up work.

---

## Task 4: Refactor orchestrator `task-dispatcher` fake + seams

**Files:**
- Create: `workers/orchestrator/src/__tests__/helpers/ScriptableIsolationProvider.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

### Task 4.1: Build `ScriptableIsolationProvider`

- [ ] **Step 1: Design the state-machine contract**

Read `workers/orchestrator/src/services/isolation/types.ts` to confirm the current `IsolationProvider` interface. The scriptable fake will own a FIFO `events` queue with entries like:

```ts
type ScriptEvent =
  | { kind: 'ready' }
  | { kind: 'log'; line: string }
  | { kind: 'claudeError'; message: string }
  | { kind: 'exit'; code: number }
  | { kind: 'crash'; error: Error };
```

`createWorker` returns a `WorkerHandle` whose event emitter replays the script on demand (test calls `provider.advance()` to drive the next state). This replaces the current `vi.fn()`-by-call-count approach and gives v8 visibility into the completion-tick branches currently hidden behind 50 ignores.

- [ ] **Step 2: Write the failing provider test**

Create `/repo/workers/orchestrator/src/__tests__/helpers/__tests__/ScriptableIsolationProvider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ScriptableIsolationProvider } from '../ScriptableIsolationProvider.js';

describe('ScriptableIsolationProvider', () => {
  it('replays events in order when advanced', async () => {
    const provider = new ScriptableIsolationProvider();
    provider.script([
      { kind: 'ready' },
      { kind: 'log', line: 'starting' },
      { kind: 'exit', code: 0 },
    ]);
    const handle = await provider.createWorker({ taskId: 't1' });
    const events: unknown[] = [];
    handle.on('event', (e) => events.push(e));
    await provider.advance(3);
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({ kind: 'exit', code: 0 });
  });

  it('exposes both exitCode === number and exitCode !== number via separate scripts', async () => {
    // This is the branch currently hidden by task-dispatcher.ts:1701
    const numeric = new ScriptableIsolationProvider();
    numeric.script([{ kind: 'exit', code: 1 }]);
    const numericHandle = await numeric.createWorker({ taskId: 't-num' });
    await numeric.advance(1);
    expect(numericHandle.lastExitCode).toBe(1);

    const crashing = new ScriptableIsolationProvider();
    crashing.script([{ kind: 'crash', error: new Error('boom') }]);
    const crashHandle = await crashing.createWorker({ taskId: 't-crash' });
    await crashing.advance(1);
    expect(crashHandle.lastExitCode).toBeUndefined();
  });
});
```

Run: `pnpm -F @intexuraos/orchestrator test -- ScriptableIsolationProvider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ScriptableIsolationProvider`**

Build the concrete class so it implements `IsolationProvider` (per `services/isolation/types.ts`). Use Node's `EventEmitter` for the handle's event stream. Apply memory [1] (mem_a047f467): optional methods on the provider interface must use `vi.mocked(fake.optionalMethod).mockResolvedValueOnce(...)` in tests that exercise them — not `fake.setOptionalMethod(...)` which doesn't exist.

- [ ] **Step 4: Verify provider tests pass**

Run: `pnpm -F @intexuraos/orchestrator test -- ScriptableIsolationProvider`
Expected: PASS, 100% coverage on the new file.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(orchestrator): ScriptableIsolationProvider state-machine fake (INT-1535)"
```

### Task 4.2: Add seams in `task-dispatcher.ts`

The goal: make the detached-promise cleanup paths (currently uncovered because the fake cannot drive them) reachable.

- [ ] **Step 1: Locate the first blocked branch**

Read `task-dispatcher.ts:1695-1710`. The `v8 ignore start` at line 1701 reads: `upstream: FakeIsolationProvider cannot produce both typeof exitCode === 'number' AND typeof exitCode !== 'number' within a single hard-error dispatcher test`.

The problem: the current fake has no way to script both arms in one test. `ScriptableIsolationProvider` solves this (see Task 4.1 Step 2's second test).

- [ ] **Step 2: Write the failing dispatcher test**

Append to `task-dispatcher.test.ts`:

```ts
it('handles hard-error dispatch regardless of whether exitCode is a number', async () => {
  const provider = new ScriptableIsolationProvider();
  provider.script([{ kind: 'ready' }, { kind: 'exit', code: 1 }]); // exitCode = number arm
  // ...invoke dispatcher, assert cleanup path hit both branches across two scripted runs
});
```

Run: expect fail — branch still reports uncovered because the seam isn't exposed.

- [ ] **Step 3: Expose the seam**

In `task-dispatcher.ts`, extract the cleanup handler into a named local function:

```ts
function handleHardErrorCleanup(dispatch: DispatchContext, exitCode: number | undefined): void {
  // was: inline arrow inside the hard-error callback
  if (typeof exitCode === 'number') {
    dispatch.logger.warn({ exitCode }, 'cleanup after hard error with numeric exit code');
  } else {
    dispatch.logger.warn('cleanup after hard error without exit code');
  }
}
```

Replace the existing inline callback with `handleHardErrorCleanup(dispatch, exitCode)`. The v8 ignore block at line 1701 becomes unnecessary because both arms are now reachable by two separate scripted runs — delete it.

- [ ] **Step 4: Repeat for the other 24 targeted ignore sites**

Walk the 50 sites in `task-dispatcher.ts`. For each: if `ScriptableIsolationProvider` can drive both arms, delete the ignore and add a test; if not, leave the ignore but tighten its explanation to name exactly what the scriptable fake still cannot produce (apply memory [3] mem_572f2361).

Target: remove ≥25 of the 50 ignores. Track the running count; stop when the remaining ignores have explanations that are specific, blocker-named, and pass the new gate.

- [ ] **Step 5: Run orchestrator tests**

Run: `pnpm -F @intexuraos/orchestrator test -- --coverage`
Expected: all green; orchestrator coverage ≥ 95%.

- [ ] **Step 6: Run full CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-4.2.txt`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor(orchestrator): scriptable fake + seams; -25 v8 ignores in task-dispatcher (INT-1535)"
```

### Task 4.3: Verify the remaining ignores are still justified

- [ ] **Step 1: Audit remaining ignores**

Run: `node scripts/verify-v8-ignore.mjs | grep task-dispatcher`
For each remaining ignore, re-read the surrounding code with memory [2] (mem_4344086c) in mind: is the ignore scoped as narrowly as possible? If the ignore covers a whole function but only one branch is untestable, split it into one `start/stop` block around just that branch.

- [ ] **Step 2: Commit if any tightening happened**

```bash
git commit -m "refactor(orchestrator): narrow remaining v8 ignores in task-dispatcher (INT-1535)"
```

---

## Task 5: Rewrite `log-forwarder.test.ts` with fake timers

**Files:**
- Modify: `workers/orchestrator/src/__tests__/log-forwarder.test.ts`

- [ ] **Step 1: Read the current file**

Read `workers/orchestrator/src/__tests__/log-forwarder.test.ts`. Note the 4× `await new Promise((resolve) => setTimeout(resolve, 7000))` calls (lines 262, 296, 336, 547). Each sleeps the test 7 real seconds.

- [ ] **Step 2: Replace with fake timers**

In each affected `describe` or `it`:

```ts
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
```

Replace each `await new Promise((resolve) => setTimeout(resolve, 7000))` with:

```ts
await vi.advanceTimersByTimeAsync(7000);
```

- [ ] **Step 3: Run**

Run: `pnpm -F @intexuraos/orchestrator test -- log-forwarder`
Expected: all tests pass and total duration drops by ~28s (4×7s).

- [ ] **Step 4: Verify CI**

Run: `pnpm run ci:tracked`
Expected: green. Record before/after CI duration for the PR body.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(orchestrator): fake-timer log-forwarder tests; reclaim ~28s (INT-1535)"
```

---

## Task 6: Handle `vi.mock('node:fs'|'node:child_process')` usage

**Decision point (record in PR body):**

- **Option A** — Document a `filesystem` / `node-mock` subcategory in the gate and leave the 15 existing `vi.mock('node:*')` callers untouched.
- **Option B** — Replace the top three offenders with `FakeFileSystem` (from Task 3.3) and keep `vi.mock` as a last-resort category for `node:child_process` only.

Option B is preferred because it preserves the "in-memory fakes only" guardrail that CLAUDE.md names as the testing discipline. Option A is a fallback if Option B exceeds plan budget.

### Task 6 (Option B — preferred)

- [ ] **Step 1: Identify top 3 `node:fs` consumers**

Run: `node scripts/verify-v8-ignore.mjs --help` (for discovery) then use Grep to list callers of `vi.mock('node:fs')`. The list is:

```
workers/orchestrator/src/__tests__/worktree-cleanup.test.ts
workers/orchestrator/src/__tests__/repo-manager.test.ts
workers/orchestrator/src/__tests__/state-persistence.test.ts
workers/orchestrator/src/__tests__/sensitive-file-guard.test.ts
workers/orchestrator/src/__tests__/start.test.ts
workers/orchestrator/src/services/worker-auth/__tests__/codex-auth-manager.test.ts
workers/orchestrator/src/services/isolation/__tests__/docker-volume.test.ts
```

Pick the three with the simplest seams (likely `sensitive-file-guard`, `state-persistence`, `codex-auth-manager`).

- [ ] **Step 2: Refactor each to inject `FakeFileSystem`**

For each target:
1. Introduce a `FileSystem` interface in the production module (mirroring `FakeFileSystem`'s shape).
2. Have production code use `readFile` from `node:fs/promises` by default, but accept a `fs: FileSystem = realFs` dependency.
3. In tests, inject `FakeFileSystem` from `@intexuraos/test-utils` and delete the `vi.mock('node:fs')` block.

- [ ] **Step 3: Run**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: green.

- [ ] **Step 4: Document the policy**

Update `.claude/reference/coverage-exemptions.md`:

```md
### `node-mock` category (restricted use)

`vi.mock('node:fs'|'node:child_process'|...)` is prohibited for any I/O primitive
that has an in-memory fake in `@intexuraos/test-utils`. The only remaining allowed
use is `vi.mock('node:child_process')` (process spawning has no fake yet —
tracked in a follow-up issue). Any new `vi.mock('node:*')` call requires a
`/* v8 ignore start -- node-mock: <specific reason no fake exists> @preserve */`
comment AND a link to the Linear issue requesting a fake.
```

Add `node-mock` to the `VALID_CATEGORIES` array in `scripts/verify-v8-ignore.mjs` and add a category detector.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(orchestrator): FakeFileSystem replaces vi.mock('node:fs') in 3 tests (INT-1535)"
```

### Task 6 (Option A — fallback)

If Option B exceeds budget, document the new `node-mock` category only (Step 4 above) and STOP.

---

## Task 7: Expand E2E suite + wire nightly CI

**Files:**
- Modify: `.github/workflows/e2e.yml` (already scheduled nightly at 6 AM UTC — confirm Step 1)
- Create: `e2e/tests/whatsapp-actions-todos.spec.ts`
- Create: `e2e/tests/research-notion.spec.ts`

- [ ] **Step 1: Verify existing nightly schedule**

Read `.github/workflows/e2e.yml`. If `schedule: cron: '0 6 * * *'` already exists, no new workflow is needed — just expand the test suite. If it does NOT run all E2E specs, update the `run: pnpm -F e2e test` step to include the new files.

- [ ] **Step 2: Write `whatsapp-actions-todos.spec.ts`**

Follow the pattern of the existing `e2e/tests/code-tasks.spec.ts`: create a test client, submit an incoming WhatsApp message that should produce an `action`, poll for the `todo` row to appear in Firestore, assert shape. Use the existing helpers in `e2e/helpers/`.

- [ ] **Step 3: Write `research-notion.spec.ts`**

Submit a research request, poll for the Notion-write completion webhook, assert a page was created in the `_research-e2e` Notion workspace.

- [ ] **Step 4: Run E2E locally**

Run: `pnpm -F e2e test`
Expected: all three specs pass within the workflow timeout (30 min).

- [ ] **Step 5: Add E2E to `ci:tracked`? NO.**

Do NOT add E2E to `ci:tracked` — the existing `exclude: ['e2e/**']` in root `vitest.config.ts` is intentional (E2E requires live infrastructure). Keep the nightly schedule as the sole trigger.

- [ ] **Step 6: Commit**

```bash
git commit -m "test(e2e): whatsapp→actions→todos and research→notion flows (INT-1535)"
```

---

## Task 8: Cleanup — delete stub, move fake, add ESLint rule

### Task 8.1: Delete `describe.skip('Mock Code Agent')`

- [ ] **Step 1: Read the file**

Read `workers/orchestrator/src/__tests__/mock-code-agent.test.ts` (14 lines, entirely `describe.skip`).

- [ ] **Step 2: Delete**

```bash
git rm workers/orchestrator/src/__tests__/mock-code-agent.test.ts
```

- [ ] **Step 3: Verify**

Run: `pnpm -F @intexuraos/orchestrator test`
Expected: green, one fewer test file.

### Task 8.2: Move `FakeImageGenerator` under `__tests__/`

- [ ] **Step 1: Relocate**

```bash
mkdir -p apps/image-service/src/__tests__/fakes
git mv apps/image-service/src/infra/image/FakeImageGenerator.ts \
       apps/image-service/src/__tests__/fakes/FakeImageGenerator.ts
```

- [ ] **Step 2: Update imports**

Grep for consumers (likely `apps/image-service/src/infra/image/index.ts` and one or two tests). Point them at the new path. Remove the fake from any production `index.ts` barrel export — it must not ship.

- [ ] **Step 3: Verify**

Run: `pnpm run verify:workspace:tracked -- image-service`
Expected: green. Production build of image-service must not include `FakeImageGenerator` (confirm via `pnpm -F @intexuraos/image-service build && grep -r Fake packages/image-service/dist/`).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(image-service): move FakeImageGenerator under __tests__ (INT-1535)"
```

### Task 8.3: ESLint rule — balance `setServices`/`resetServices`

- [ ] **Step 1: Decide placement**

The project uses ESLint 9 flat config (see `eslint.config.mjs` or similar at repo root). Add a custom rule as a local plugin under `eslint-rules/balance-set-services.mjs`.

- [ ] **Step 2: Write the rule**

```js
// eslint-rules/balance-set-services.mjs
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Every describe with setServices(...) must have a matching afterEach(resetServices)' },
  },
  create(context) {
    let hasSetServices = false;
    let hasResetServices = false;
    let describeDepth = 0;
    return {
      CallExpression(node) {
        const name = node.callee.name ?? node.callee.property?.name;
        if (name === 'describe') describeDepth++;
        if (name === 'setServices') hasSetServices = true;
        if (node.callee.name === 'afterEach' && /resetServices\b/.test(context.sourceCode.getText(node))) {
          hasResetServices = true;
        }
      },
      'CallExpression:exit'(node) {
        const name = node.callee.name ?? node.callee.property?.name;
        if (name === 'describe') {
          describeDepth--;
          if (describeDepth === 0 && hasSetServices && !hasResetServices) {
            context.report({ node, message: 'describe uses setServices but no afterEach(resetServices) found' });
          }
          if (describeDepth === 0) { hasSetServices = false; hasResetServices = false; }
        }
      },
    };
  },
};
```

- [ ] **Step 3: Register and test**

Add to the root ESLint flat config; write 2 fixture tests: one that passes (balanced), one that fails (missing `afterEach`). Run `pnpm run lint` against the repo.

If the rule surfaces any existing violations (the review says `setServices` is called ~3.3× more than `resetServices`), fix them by adding the missing `afterEach(resetServices)` — do not silence the rule.

- [ ] **Step 4: Commit**

```bash
git commit -m "lint: require afterEach(resetServices) when setServices used (INT-1535)"
```

---

## Task 9: Standardize workspace vitest configs

**Files:**
- Modify: `apps/chat-agent/vitest.config.ts`, `apps/cron-agent/vitest.config.ts`, `apps/hellscript-agent/vitest.config.ts`, `apps/web/vitest.config.ts`, `packages/infra-otel/vitest.config.ts`, `packages/internal-clients/vitest.config.ts`, `migrations/vitest.config.ts`, `e2e/vitest.config.ts`.

- [ ] **Step 1: Rewrite `apps/chat-agent/vitest.config.ts`**

```ts
import { mergeConfig, defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { sharedConfig } from '../../vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
      exclude: ['src/**/__tests__/**/*.fixture.ts', 'src/**/__tests__/testUtils.ts'],
      alias: {
        '@intexuraos/common-core': resolve(__dirname, '../../packages/common-core/src'),
        // ...keep the rest of the existing alias block
      },
      coverage: { include: ['src/**/*.ts'], exclude: ['src/**/__tests__/**/*.ts', 'src/domain/types.ts'] },
    },
  })
);
```

Key points:
- `setupFiles` is **inherited** — no workspace file may redefine it.
- The `coverage.thresholds` object is inherited from shared (95/95/95/95). Delete the local `thresholds:` block.
- Keep workspace-local `alias` entries for `@intexuraos/*` mappings.

- [ ] **Step 2: Repeat for `apps/cron-agent`, `apps/hellscript-agent`**

Same pattern.

- [ ] **Step 3: `apps/web/vitest.config.ts`**

Web is special — CLAUDE.md documents the coverage exception. In the shared merge, override `test.coverage.thresholds = {}` and keep the existing jsdom/React-specific options.

- [ ] **Step 4: `packages/infra-otel`, `packages/internal-clients`, `migrations`**

Same pattern as Step 1. These are the two packages flagged as having "no thresholds" — fixed by inheriting from shared.

- [ ] **Step 5: `e2e/vitest.config.ts`**

```ts
import { mergeConfig, defineConfig } from 'vitest/config';
import { sharedConfig } from '../vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      root: './e2e',
      testTimeout: 120_000,
      hookTimeout: 120_000,
      teardownTimeout: 60_000,
      globals: true,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      environment: 'node',
      setupFiles: [], // E2E intentionally opts out — document in the file header why
      include: ['tests/**/*.spec.ts'],
      coverage: {
        provider: 'v8',
        thresholds: {}, // E2E has no coverage targets
      },
    },
  })
);
```

Document the `setupFiles: []` override with a code comment naming the exception.

- [ ] **Step 6: Run full CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-9.txt`
Expected: green. Every workspace must inherit the Firebase/Notion/fetch mocks via the shared setup.

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor(vitest): every workspace inherits vitest.shared.ts (INT-1535)"
```

---

## Endpoint Changes

No HTTP endpoints are modified, created, removed, or left unchanged by this plan — it is test-infrastructure-only.

- **Modified:** none.
- **Created:** none.
- **Removed:** none.
- **Unchanged:** all.

---

## Acceptance Criteria

1. `pnpm run ci:tracked` passes from root on the final commit.
2. `node scripts/verify-v8-ignore.mjs` exits 0 with the new duplicate-explanation check active.
3. Total v8 ignores in `workers/orchestrator/src/services/task-dispatcher.ts` ≤ 25 (down from 50).
4. `workers/orchestrator/src/__tests__/log-forwarder.test.ts` total runtime drops by ≥20 seconds (measured via `vitest` `--reporter=verbose`).
5. `packages/test-utils` exists, builds, has ≥ 95% branch coverage, and is consumed by at least 2 pilot services.
6. All 8 workspace `vitest.config.ts` files inherit from `vitest.shared.ts` via `mergeConfig`. No workspace redefines `setupFiles` except `e2e/` (documented).
7. `vi.mock('node:fs')` callers drop from 7 → ≤ 4 (Option B target); remaining calls have `node-mock` category ignore comments pointing at follow-up issues.
8. ESLint rule `balance-set-services` is active and has zero violations in the repo.
9. `apps/image-service/src/infra/image/FakeImageGenerator.ts` no longer exists; the fake lives under `__tests__/fakes/`.
10. `workers/orchestrator/src/__tests__/mock-code-agent.test.ts` deleted.
11. `e2e/tests/` contains three spec files (existing `code-tasks.spec.ts` + two new ones), all passing on the nightly workflow.
12. Coverage threshold (95%) unchanged; no workspace newly drops below it.

---

## Test Plan

- Every task ends in a **local** `pnpm run ci:tracked` passing from repo root.
- Every new file in `packages/test-utils/src/` has a sibling `__tests__/*.test.ts` file with ≥ 95% branch coverage.
- Every modified file is covered by the existing workspace test suite — no existing test file is deleted without its replacement landing in the same commit.
- The orchestrator `task-dispatcher` refactor is validated by running `pnpm -F @intexuraos/orchestrator test -- --coverage` and confirming branch coverage does not regress.
- After Task 5 (fake timers), the total CI wall-clock time for the orchestrator workspace drops — record the delta in the PR body.
- After Task 9 (vitest shared), `rg "setupFiles:" <workspace>/vitest.config.ts` must return zero matches in every workspace except `e2e/`.

---

## Rollback

Each task is a standalone commit. If any task fails CI mid-plan, `git revert <sha>` the offending commit and continue with the next task — no task depends on rollbackable state from a prior task beyond the files it imports (and for those imports, `git revert` restores the older definition transparently).

If Task 3 (package creation) needs full rollback, also remove the `"@intexuraos/test-utils"` devDependency from the pilot services.

---

## Execution Handoff

Inline execution with `superpowers:executing-plans` is recommended — a single developer working sequentially through the 9 tasks on branch `plan/int-1535-testing-coverage` (or splitting Tasks 7 + 8 into a follow-up branch if scope grows). No subagents required; dependencies between workstreams (test-utils → adoption; gate tightening → sweep) make this plan fundamentally serial.
