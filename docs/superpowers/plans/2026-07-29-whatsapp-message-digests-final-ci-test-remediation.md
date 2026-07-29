# WhatsApp Message Digests — Final CI Test Remediation Plan

> Status: focused remediation verified; final full CI pending
> Scope: remediate the exact test-phase failures from full repository CI run 36 without changing the accepted Message Digests product behavior or touching a shared environment.

## Evidence and constraints

- Full CI run 36 passed `Type & Lint` and `Static Validation` in full.
- The `Tests` phase failed after all three coverage shards wrote reports.
- The saved Vitest output names five failure classes:
  1. the Message Digest interaction coverage contract derives the repository root from the caller's current working directory;
  2. two generic Hetzner deployment assertions parse the new activation-mode branches as one flat flow;
  3. migration 127's test assumes that migration 127 is permanently the final manifest entry;
  4. lifecycle journal tests acquire locks at a fixed time but later call apply/rollback with the real wall clock;
  5. one intentionally large Matrix corpus cleanup test exceeded its 30-second test timeout while two full CI runs competed for the same machine.
- No commit, push, PR, merge, deployment, production mutation, or shared-environment lease is permitted during this remediation.
- User-owned `docs/superpowers/specs/*` files remain untouched and must never be staged.
- Primary execution remains sequential. A subagent may be used only for read-only review after focused verification.

## Task 1 — Reproduce and classify every failing class

**Files inspected:**

- `scripts/test-results/test-output.txt`
- `apps/web/src/pages/__tests__/MessageDigestInteractionCoverage.test.ts`
- `scripts/__tests__/hetzner-runtime.test.ts`
- `migrations/__tests__/127-intex-agent-matrix-corpus-indexes.test.ts`
- `apps/code-agent/src/__tests__/scripts/codeTaskLifecycleOperations.test.ts`
- `apps/whatsapp-service/src/__tests__/domain/matrixCorpus/controlPlane.test.ts`

1. Run each named failing test file independently from the repository root.
2. Confirm that the first four classes reproduce deterministically.
3. Run the single Matrix R21 test independently and record its duration and semantic result.
4. Treat a focused green R21 run as evidence that the algorithm is correct but the 30-second budget is unsafe under supported sharded CI load; do not modify production Matrix code.

## Task 2 — Make the Message Digest interaction contract independent of caller CWD

**File:** `apps/web/src/pages/__tests__/MessageDigestInteractionCoverage.test.ts`

1. Resolve the repository root by walking upward from `process.cwd()` to the checked-in
   `pnpm-workspace.yaml` marker. Do not use `import.meta.url`: the Web Vitest transform can expose a
   non-file URL even though the same test is a Node test.
2. Keep the exact 50 interaction IDs, controlled-state map, and named assertion checks unchanged.
3. Run the test once from the repository root and once through the web workspace command so both invocation modes are covered.

### Verification addendum discovered after the first fix attempt

- A package-level Web invocation transformed `import.meta.url` to a non-file URL, proving that a
  file-URL-derived root does not satisfy both supported invocation modes.
- The same accidentally broad invocation ran all 1,659 Web tests and exposed three stale
  `MessageDigestList` assertions. The production callback intentionally receives both the digest
  definition and the activation source (`pointer` or `keyboard`) so focus recovery can distinguish
  mouse/touch from keyboard activation.
- Update only the three pointer-click assertions in
  `apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx` to require the
  existing second argument `pointer`; do not change component behavior or weaken the first-argument
  assertions.
- Re-run the interaction contract from both working directories, the complete MessageDigestList
  test file, and then the complete Web test suite once before the final repository gate.

## Task 3 — Make migration 127's checksum assertion append-safe

**File:** `migrations/__tests__/127-intex-agent-matrix-corpus-indexes.test.ts`

1. Select the manifest entry with ID `127` instead of asserting that it is the final entry.
2. Preserve the exact name and source checksum assertion.
3. Keep migration 128 and its independent tests unchanged.
4. Run migration 127 and migration 128 tests together.

## Task 4 — Parse Hetzner activation modes as separate flows

**File:** `scripts/__tests__/hetzner-runtime.test.ts`

1. Keep the production deployment script unchanged unless a semantic ordering defect is proven.
2. Extract the first-activation and ordinary branches explicitly in the test instead of comparing the first occurrence of a function name across mutually exclusive branches.
3. Preserve the safety contracts:
   - commit metadata is resolved before SSH setup and activation resolution;
   - a newly synchronized release is verified after synchronization;
   - ordinary deployment performs backend deploy, backend readiness, then web/edge publication;
   - first activation continues through the dedicated cutover path.
4. Run the complete Hetzner runtime test file plus Message Digest cutover tests.

## Task 5 — Freeze lifecycle journal fixture time

**File:** `apps/code-agent/src/__tests__/scripts/codeTaskLifecycleOperations.test.ts`

1. Add an explicit fixed `now` callback to apply/rollback calls that operate on the fixed-time lock fixtures in the failing journal CAS section.
2. Do not extend the production lease and do not change production lock validation.
3. Preserve the explicit lease-expiry test at `12:31:00Z` and all expected error precedence assertions.
4. Run the complete lifecycle operations test file.

## Task 6 — Stabilize the bounded Matrix stress test only if evidence supports it

**File:** `apps/whatsapp-service/src/__tests__/domain/matrixCorpus/controlPlane.test.ts`

1. If the focused R21 test passes semantically but approaches/exceeds 30 seconds under machine load, raise only that test's timeout to a documented bounded value of 60 seconds.
2. Do not reduce the 6,143-record fixture, the 64 bounded cleanup revisions, mutation counts, replay checks, or idempotency assertions.
3. Re-run R21 twice, then run the complete Matrix control-plane test file once.

## Task 7 — Focused verification and formatting gate

1. Run all six affected test files in focused Vitest invocations.
2. Run production typecheck and test typecheck.
3. Run scoped lint and Prettier checks for every edited file.
4. Run `git diff --check`.
5. Confirm the five user-owned spec files remain unmodified and untracked.

## Task 8 — Read-only review checkpoint

1. Ask one subagent to review only the final remediation diff and focused evidence.
2. Resolve every Critical or Important finding locally and repeat only the affected focused checks.
3. Require an explicit `Ready` verdict with zero Critical/Important findings.

### Execution checkpoint

- Deterministic RED reproduced 10 failures across the four original contract/fixture classes.
- The heavy Matrix R21 case passed independently before remediation, proving semantic correctness;
  after the bounded timeout change it passed twice at 10.24 s and 10.76 s, and the complete Matrix
  control-plane file passed 351/351.
- The interaction contract passes from repository-root and Web-workspace invocation modes.
- The complete Web suite passes 173/173 files and 1661/1661 tests.
- The combined root affected-file run passes 7/7 files and 491/491 tests.
- Full production typecheck and full test typecheck pass.
- Scoped ESLint, Prettier, and `git diff --check` pass.
- The five user-owned untracked specification files remain untouched.
- Read-only review reports zero Critical/Important findings and verdict `Ready`; its sole Minor
  documentation count finding is resolved above.

## Task 9 — One final full repository gate

1. Wait until competing full CI processes have released machine capacity.
2. Run `pnpm run ci:tracked` exactly once.
3. If it passes, make no further repository file changes before staging.
4. If it fails, stop publication and create a new evidence-specific remediation addendum before any code change.

## Completion evidence

- All five formerly failing test classes pass in focused verification.
- Typecheck, test typecheck, scoped lint, Prettier, and diff checks pass.
- Read-only review verdict is `Ready` with zero Critical/Important findings.
- A fresh full `pnpm run ci:tracked` completes successfully.
- The repository remains unpublished and no environment is held until the separate commit/PR/production coordination gate begins.
