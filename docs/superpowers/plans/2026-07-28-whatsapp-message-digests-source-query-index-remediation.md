# WhatsApp Message Digests — Source Query Index Remediation

> Status: active — execute sequentially after legacy-source remediation and before resuming MVP E2E.

## Goal

Make the owned digest snapshot query use the canonical, already deployed Private WhatsApp tenancy
indexes while preserving fail-closed per-document ownership validation. Resume the unchanged preview
in the already running system Google Chrome without creating or deploying an ad-hoc index.

## Evidence and root cause

- After legacy chat/account compatibility was fixed, the source endpoint advanced from `409` to
  `500` in about 300 ms; Message Digest Service surfaced the dependency failure as `502`.
- The failing Firestore query adds `userId ==` to `sourceAccountId ==`, `chatId ==`, the timestamp
  range, and timestamp/document-ID ordering.
- Read-only Firestore Admin inspection confirms the dev project has READY ASC and DESC indexes for
  `sourceAccountId, chatId, eventTimestamp, __name__`, but no variant with `userId`.
- Migration 125 likewise provides the READY journal index
  `sourceAccountId, chatId, sequence, __name__`, without `userId`.
- The established Private WhatsApp repository first validates the owned chat, then queries messages
  and journal entries by the canonical `sourceAccountId + chatId` tenancy key. The digest transaction
  already validates the account and owned chat before either query.

## Safety invariants

- Account `userId`, source account, generation, active/erasure status, and chat ownership/type remain
  validated in the same transaction before message reads.
- Message and journal snapshots must still fail closed if their persisted ownership fields conflict
  with the validated binding; no foreign/corrupt document may be skipped or returned.
- Timestamp half-open windows, signed watermarks/cursors, deterministic ordering, and bounded journal
  checks remain unchanged.
- Use only indexes already declared by immutable migrations and observed READY; do not hand-edit or
  deploy Firestore indexes in this remediation.
- Do not log source IDs, names, prompts, or message content.

## Task 1: Add a RED corrupt-message ownership contract

**Modify:**

- `apps/whatsapp-service/src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts`

Seed a message with the validated source account and chat but a conflicting `userId`, positioned as
the high watermark. The query must return `SOURCE_CHANGED`. On the current implementation the extra
Firestore `userId` filter silently hides the corrupt row, so the test must be observed RED.

## Task 2: Use canonical indexed filters and validate returned snapshots

**Modify:**

- `apps/whatsapp-service/src/infra/firestore/privateWhatsAppDigestSourceRepository.ts`

1. Remove `userId` only from the message-window and context-journal Firestore query filters.
2. Keep `sourceAccountId`, `chatId`, timestamp/sequence bounds, order, and limits unchanged.
3. Validate every high-watermark and bounded page snapshot against `userId`, `sourceAccountId`, and
   `chatId` from the already validated route binding.
4. Return `source_changed` through the repository result union on any mismatch; do not throw it as a
   persistence error and do not silently filter it out.
5. Retain the existing journal-entry ownership validation, which already checks all three fields.

## Task 3: Close the focused automated gate

Run, in order:

```bash
pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm exec eslint apps/whatsapp-service/src/infra/firestore/privateWhatsAppDigestSourceRepository.ts apps/whatsapp-service/src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts --max-warnings 0
pnpm exec prettier --check apps/whatsapp-service/src/infra/firestore/privateWhatsAppDigestSourceRepository.ts apps/whatsapp-service/src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts docs/superpowers/plans/2026-07-28-whatsapp-message-digests-source-query-index-remediation.md
git diff --check
```

Do not run full CI or a workspace-wide test suite.

## Task 4: Verify with the unchanged live source

1. Let PM2 watch reload only WhatsApp Service; verify current worktree, real dev Firestore, and health.
2. Click `Try preview again` in the existing modal without changing the selected group or form.
3. Confirm the source request no longer returns the index-related `500` and advances to pagination or
   generation.
4. Classify preview as generated/no-activity without printing its private content. A distinct next
   failure requires another written plan before code changes.

## Completion gate

The RED ownership test must turn GREEN, focused checks must pass, the observed READY canonical index
shape must match the query, and the same Chrome preview must advance beyond the Firestore source read.
No commit, full CI, manual index deployment, or production mutation is allowed in this fragment.
