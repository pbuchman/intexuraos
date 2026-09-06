# WhatsApp Message Digest Hydrated Template Length Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that every Message Digest template body remains within Meta's 1,024-code-point
hydrated-body limit before publishing or calling the provider.

**Architecture:** Keep the frozen approved template unchanged. Reserve 68 code points for its fixed
copy and 80 for the maximum digest name, leaving a conservative cross-service excerpt limit of 876.
Enforce the same number in the publisher, formatter, and WhatsApp consumer so oversized events fail
before Meta, while new runs truncate only the WhatsApp excerpt and retain their complete saved
summary behind the `View digest` CTA.

**Tech Stack:** TypeScript, Vitest, workspace package contracts, Pub/Sub event validation, WhatsApp
Cloud API v22.0, system Google Chrome, local Firestore/Pub/Sub emulators.

## Global Constraints

- Execute sequentially in the primary session; subagents are review-only.
- Do not edit or replace the already-approved Meta template.
- Do not mutate production, run `pnpm run ci:tracked`, commit, push, or deploy in this plan.
- Preserve saved summary content; truncate only `presentation.digestExcerpt` by Unicode code point
  and append one ellipsis within the 876-code-point budget.
- Keep maximum digest-name length at 80, frozen-template fixed copy at exactly 68 code points, and
  total hydrated body at or below 1,024.
- Never repair the immutable failed run/outbox payload in place. Delete its temporary definition
  through the UI after evidence is captured and create one fresh replacement definition/run.
- Make no further retry of failed run
  `mdr_805cfb877bcb8608512d6d2d6df852c22678543e67150901`.
- Coordinate shared Chrome through `/tmp/codex-sync`; preserve all SentryBox/Cloudflare tabs and use
  only the pre-existing Message Digests tab when permission is idle.
- No interim commit because the parent goal requires one final implementation commit after its
  single full-CI gate.

---

### Task 1: RED contract for the 1,024-code-point hydrated body

**Files:**
- Modify: `packages/whatsapp-pubsub-client/src/types.ts`
- Modify: `packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts`
- Modify: `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/routes/pubsubRoutes.ts`

**Interfaces:**
- Consumes: `WhatsAppMessageDigestPresentation.digestName` and `.digestExcerpt`.
- Produces: exported numeric constants
  `MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS = 1_024`,
  `MESSAGE_DIGEST_TEMPLATE_FIXED_BODY_CODE_POINTS = 68`, and
  `MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS = 876`.

- [x] **Step 1: Add failing formatter boundary assertions**

  In `formatWhatsAppDigest.test.ts`, construct a completed run with
  `definitionNameSnapshot: 'n'.repeat(80)` and a long summary. Assert:

  ```ts
  const presentation = result.ok ? result.value.event.presentation : undefined;
  expect(presentation?.kind).toBe('message_digest_v1');
  if (presentation?.kind !== 'message_digest_v1') throw new Error('Expected digest presentation');
  expect(Array.from(presentation.digestExcerpt)).toHaveLength(876);
  expect(presentation.digestExcerpt.endsWith('…')).toBe(true);
  expect(
    68 +
      Array.from(presentation.digestName).length +
      Array.from(presentation.digestExcerpt).length
  ).toBe(1_024);
  ```

  Update both existing 1,024-excerpt boundary assertions to expect 876. Run only this file and
  expect RED because the formatter currently emits up to 1,024 excerpt code points.

- [x] **Step 2: Add failing publisher and consumer boundary assertions**

  In `whatsappSendPublisher.test.ts`, make 876 excerpt code points valid and 877 invalid. In
  `pubsubRoutes.test.ts`, make the structurally invalid Message Digest fixture use 877 rather than
  1,025, keep its run URL aligned with the fixture authorization so the excerpt is the only invalid
  field, and retain the assertion that the sender is never called. Run the two files and expect RED
  because both validators currently allow 1,024.

- [x] **Step 3: Capture the RED commands**

  Run:

  ```bash
  pnpm --filter @intexuraos/message-digest-service exec vitest run src/infra/notification/formatWhatsAppDigest.test.ts
  pnpm --filter @intexuraos/whatsapp-pubsub-client exec vitest run src/__tests__/whatsappSendPublisher.test.ts
  pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/pubsubRoutes.test.ts -t "rejects a malformed digest presentation"
  ```

  Expected: each changed upper-bound assertion fails for the old 1,024 excerpt contract.

### Task 2: GREEN conservative excerpt budget

**Files:**
- Modify: `packages/whatsapp-pubsub-client/src/types.ts`
- Modify: `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- Verify: all Task 1 test files

**Interfaces:**
- Consumes: frozen template body
  `Your WhatsApp digest is ready: {{1}}\n\n{{2}}\n\nOpen the full digest for details.`
  whose non-variable copy is 68 code points.
- Produces: producer and consumer validation that cannot hydrate above 1,024 even when the digest
  name uses all 80 allowed code points.

- [x] **Step 1: Define the shared producer-side arithmetic**

  Replace the publisher contract constants with:

  ```ts
  export const MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS = 1_024;
  export const MESSAGE_DIGEST_TEMPLATE_FIXED_BODY_CODE_POINTS = 68;
  export const MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS = 80;
  export const MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS =
    MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS -
    MESSAGE_DIGEST_TEMPLATE_FIXED_BODY_CODE_POINTS -
    MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS;
  ```

  Add a comment tying 68 to the exact frozen template verified by the cutover preflight.

- [x] **Step 2: Mirror the consumer-side arithmetic**

  In `whatsapp-service/src/routes/pubsubRoutes.ts`, replace the local 1,024 excerpt constant with the
  same named body/fixed/name arithmetic. Do not add a new package dependency to WhatsApp Service.

- [x] **Step 3: Run focused GREEN gates**

  Run:

  ```bash
  pnpm --filter @intexuraos/message-digest-service exec vitest run src/infra/notification/formatWhatsAppDigest.test.ts
  pnpm --filter @intexuraos/whatsapp-pubsub-client exec vitest run src/__tests__/whatsappSendPublisher.test.ts
  pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/pubsubRoutes.test.ts src/__tests__/infra/sender.test.ts
  pnpm --filter @intexuraos/message-digest-service typecheck
  pnpm --filter @intexuraos/whatsapp-pubsub-client typecheck
  pnpm --filter @intexuraos/whatsapp-service typecheck
  pnpm exec eslint packages/whatsapp-pubsub-client/src/types.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts apps/whatsapp-service/src/routes/pubsubRoutes.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts apps/whatsapp-service/src/infra/whatsapp/sender.ts apps/whatsapp-service/src/__tests__/infra/sender.test.ts
  pnpm exec prettier --check packages/whatsapp-pubsub-client/src/types.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts apps/whatsapp-service/src/routes/pubsubRoutes.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts docs/superpowers/plans/2026-07-29-whatsapp-message-digests-hydrated-template-length-remediation.md
  git diff --check
  ```

  Expected: all pass; the repository-wide CI remains unrun.

### Task 3: Fresh local delivery proof and cleanup

**Files:**
- Runtime only: existing local services and emulator data
- UI only: pre-existing Message Digests system-Chrome tab
- Coordination only: `/tmp/codex-sync`

**Interfaces:**
- Consumes: the fixed producer/consumer bound, approved exact Meta template, existing first-number
  mapping, and read-only WhatsApp group/direct sources.
- Produces: exactly one received group digest and one received direct digest with canonical CTAs,
  followed by zero temporary definitions/runs/outboxes and unchanged source chats.

- [x] **Step 1: Restart the three local services and recheck exact readiness**

  Restart Message Digest, WhatsApp, and Fishing Assistant through their existing PM2 entries. Prove
  all three health endpoints plus Web return 200, and rerun the exact template preflight. Before
  touching Chrome, update `/tmp/codex-sync` under its lock and obtain an idle-Chrome scope that
  preserves the other agent's tabs.

- [x] **Step 2: Erase the failed temporary group definition through the UI**

  Navigate to its detail page, choose `Delete`, enter the required confirmation name, and wait for
  terminal removal. Confirm the Message Digests list no longer contains it and the fishing source
  remains visible in the read-only picker. Do not retry its immutable failed run again.

- [x] **Step 3: Create and deliver one replacement group digest**

  Create a new active daily digest for the same fishing group using the `Fishing group` instructions,
  preview it, and run it once. Require `Generation: Completed`, `WhatsApp: Sent`, an excerpt of at
  most 876 code points in the persisted outbox, and a hydrated body at most 1,024. Verify exactly one
  received WhatsApp message and that `View digest` opens the exact canonical run route.

- [x] **Step 4: Create and deliver one direct sentiment digest**

  Create a paused daily digest for a recent direct conversation using `Sentiment and outcomes`,
  preview it, resume only if required to enable the one manual run, and run/send once. Require the
  same completed/sent/CTA evidence without exposing conversation content.

- [x] **Step 5: Delete both temporary definitions and release local resources**

  Delete both definitions through the UI, wait for terminal erasure, and verify exact emulator counts
  for owned temporary definitions/runs/outboxes are zero while both source chats remain selectable.
  Stop the owned Vite session, three PM2 services, and three emulator containers; verify ports 3000,
  8101, 8102, 8105, 8113, 8119, and 8135 are free. Release the local lease and Chrome scope in
  `/tmp/codex-sync` with the safe result.

- [x] **Step 6: Review the narrow remediation**

  Ask one review-only subagent to inspect the bound arithmetic, producer/consumer parity, privacy
  logging, old-run immutability, and focused evidence. Fix any accepted Critical or Important finding
  test-first before returning to the parent goal.

  Review found one Important privacy issue: provider-rejection metadata retained a phone-derived
  recipient hint. A focused RED test proved the leak, the field was removed from that diagnostic,
  and the GREEN sender plus Pub/Sub suite passed 217/217 with typecheck, scoped lint, formatting, and
  diff checks. Repeat review reported no remaining Critical or Important finding and verdict Ready.

## Self-Review

- Spec coverage: the exact observed 1,046/1,024 mismatch is prevented at formatter, publisher, and
  consumer boundaries; immutable failed data is erased rather than rewritten; group/direct UI and
  physical receipt are re-proved.
- Placeholder scan: all constants, files, commands, UI actions, and outcome branches are explicit.
- Type consistency: all producer imports continue using the existing exported excerpt constant;
  WhatsApp Service mirrors the same formula locally without a new runtime dependency.

## Execution Choice

The user already selected inline, sequential execution with review-only subagents. Continue in the
current session with `superpowers:executing-plans` and keep the parent goal active.
