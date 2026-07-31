# WhatsApp Message Digests Eval Fixture Contract Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the repository typecheck by making the isolated Matrix Corpus composition harness
explicitly reject the five Message Digest methods newly required by `WhatsAppServiceClient`.

**Architecture:** Keep the production client contract unchanged. The Matrix Corpus harness continues
to implement the complete shared interface, but its unrelated Message Digest methods become
fail-fast test boundaries, matching the existing `getPrivateMatrixDeliveryStatus` pattern and making
any accidental cross-feature call visible immediately.

**Tech Stack:** TypeScript, Vitest, pnpm workspace typecheck, ESLint, Prettier.

## Global Constraints

- Work sequentially in the primary session; subagents are review-only.
- Do not weaken `WhatsAppServiceClient`, cast the harness through `unknown`, or make the five methods
  optional.
- Do not change production behavior, network access, Matrix Corpus state, or Message Digest runtime
  behavior.
- Do not run another full `pnpm run ci:tracked` until focused RED/GREEN, lint, formatting, diff, and
  read-only review are complete.
- Preserve the five user-owned untracked files under `docs/superpowers/specs/`.

---

### Task 1: Restore the complete test boundary

**Files:**
- Modify: `tools/intex-agent-evals/src/__tests__/fixtures/matrixCorpusCompositionHarness.ts`
- Verify: `tools/intex-agent-evals/src/__tests__/matrixCorpusComposition.test.ts`
- Verify: `packages/internal-clients/src/whatsapp-service/types.ts`

**Interfaces:**
- Consumes: the required `WhatsAppServiceClient` methods
  `validatePrivateDigestSource`, `queryPrivateDigestMessages`,
  `getWhatsAppDeliveryReadiness`, `getOutboundDeliveryState`, and
  `authorizeOutboundDeliveryRetry`.
- Produces: a structurally complete `WhatsAppServiceClient` fixture whose five unrelated methods
  return `Promise<never>` by throwing a method-specific unexpected-call error.

- [x] **Step 1: Confirm the root cause and working pattern**

  Inspect the complete shared interface and `createWhatsAppBoundary`. Confirm the harness owns a
  literal full-interface implementation, the five required methods were added by Message Digests,
  no composition path consumes them, and the existing unrelated
  `getPrivateMatrixDeliveryStatus()` boundary throws on unexpected use.

- [x] **Step 2: Capture the focused RED typecheck**

  Run:

  ```bash
  pnpm --filter @intexuraos/intex-agent-evals typecheck
  ```

  Expected: `TS2739` at `matrixCorpusCompositionHarness.ts:302`, naming exactly the five missing
  Message Digest methods.

- [x] **Step 3: Add the minimal fail-fast methods**

  At the start of the object returned by `createWhatsAppBoundary`, add:

  ```ts
  async validatePrivateDigestSource() {
    throw new Error('unexpected private digest source validation call');
  },
  async queryPrivateDigestMessages() {
    throw new Error('unexpected private digest message query call');
  },
  async getWhatsAppDeliveryReadiness() {
    throw new Error('unexpected WhatsApp delivery readiness call');
  },
  async getOutboundDeliveryState() {
    throw new Error('unexpected outbound delivery state call');
  },
  async authorizeOutboundDeliveryRetry() {
    throw new Error('unexpected outbound delivery retry authorization call');
  },
  ```

  Do not add mock success values: these methods are outside the harness contract and must expose any
  accidental invocation.

- [x] **Step 4: Run focused GREEN verification**

  Run:

  ```bash
  pnpm --filter @intexuraos/intex-agent-evals typecheck
  pnpm exec vitest run tools/intex-agent-evals/src/__tests__/matrixCorpusComposition.test.ts
  pnpm exec eslint tools/intex-agent-evals/src/__tests__/fixtures/matrixCorpusCompositionHarness.ts
  pnpm exec prettier --check tools/intex-agent-evals/src/__tests__/fixtures/matrixCorpusCompositionHarness.ts docs/superpowers/plans/2026-07-29-whatsapp-message-digests-eval-fixture-contract-remediation.md
  git diff --check
  ```

  Expected: all commands pass; the first full CI attempt remains the only full run so far.

- [ ] **Step 5: Review and rerun the final full gate once**

  Ask one review-only subagent to confirm the five fail-fast methods exactly restore structural
  parity without masking a composition dependency. Fix any accepted Critical or Important finding
  with a new focused RED/GREEN cycle. Then fetch `origin/development` again, prove the branch base is
  unchanged/up to date, and run `pnpm run ci:tracked` one second and final time.

## Self-Review

- Spec coverage: the plan addresses the exact `TS2739` failure without weakening production types or
  introducing unrelated behavior.
- Placeholder scan: every file, method, failure, implementation, and verification command is
  explicit; no deferred marker remains.
- Type consistency: zero-argument async throwing methods infer `Promise<never>`, which is assignable
  to each required method while remaining fail-fast if an unrelated path calls it.

## Execution Choice

The user selected inline, sequential execution with review-only subagents. Continue in the current
session with `superpowers:executing-plans`; do not ask to switch execution modes.
