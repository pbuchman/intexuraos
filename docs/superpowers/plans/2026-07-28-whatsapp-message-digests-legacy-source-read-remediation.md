# WhatsApp Message Digests — Legacy Source Read Remediation

> Status: active — execute sequentially before resuming the existing group preview in Chrome.

## Goal

Make the digest source reader accept the same owned historical WhatsApp chat documents that the
conversation validator already accepts, without weakening account ownership, chat-type, generation,
cursor, or context-journal fences. Then resume the exact preview that exposed the mismatch in the
already running system Google Chrome.

## Evidence and root cause

- The selected historical group passes conversation validation and mirror-readiness checks.
- The first digest message query immediately returns `409 SOURCE_CHANGED`; no LLM call, save, or
  WhatsApp delivery occurs.
- On its first page, the digest repository reads the raw chat document and requires the stored `id`
  field to equal the requested chat ID.
- The established WhatsApp repository normalizes chats with the Firestore document ID as the
  authoritative ID. Its validator therefore accepts legacy documents whose payload predates the
  duplicated `id` field.
- Current writes include `id`, so this is a backward-compatibility read issue rather than a new-write
  issue.

## Safety invariants

- The Firestore document path remains bound to the requested chat ID.
- `userId`, `sourceAccountId`, account `generationId`, active/erasure state, and `chatType` checks
  remain unchanged and fail closed.
- Cursor authentication and context-journal snapshot validation remain unchanged.
- A conflicting or malformed ownership/type field must not be repaired or inferred.
- Do not expose conversation names, IDs, prompts, or message contents in logs or test output.
- Do not run repository-wide CI in this remediation.

## Task 1: Add the RED legacy-document contract

**Modify:**

- `apps/whatsapp-service/src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts`

Add a focused test that seeds an owned chat at document `chat-1` without a payload `id`, seeds one
owned message, and expects the first digest page to succeed. The test must keep the existing owner,
source-account, generation, and group type fields so it isolates only the legacy duplicated-ID
assumption.

Run only this test file and capture the expected `NOT_FOUND` failure before implementation.

## Task 2: Use the authoritative Firestore document ID

**Modify:**

- `apps/whatsapp-service/src/infra/firestore/privateWhatsAppDigestSourceRepository.ts`

Remove the payload `chat.id` equality requirement. The repository already fetches exactly
`doc(input.chatId)`, so bind identity using `chatSnapshot.id`. Continue reading and checking all
ownership and chat-type fields from the payload. Make no schema migration and no unrelated source
reader changes.

## Task 3: Close the focused service gate

Run, in order:

```bash
pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm exec eslint apps/whatsapp-service/src/infra/firestore/privateWhatsAppDigestSourceRepository.ts apps/whatsapp-service/src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts --max-warnings 0
pnpm exec prettier --check apps/whatsapp-service/src/infra/firestore/privateWhatsAppDigestSourceRepository.ts apps/whatsapp-service/src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts docs/superpowers/plans/2026-07-28-whatsapp-message-digests-legacy-source-read-remediation.md
git diff --check
```

Do not run the whole workspace suite or full CI.

## Task 4: Resume the same live-browser checkpoint

1. Restart only WhatsApp Service from this worktree while preserving its real dev Firestore binding.
2. In the already open preview modal, click `Try preview again` without changing the source.
3. Confirm the source query no longer returns the legacy-ID `409` and classify the preview as
   generated/no-activity without printing private content.
4. If a different error remains, stop and write the next narrow remediation plan before changing
   code. If successful, continue the remaining group/direct MVP browser scenario.

## Task 5: Align the legacy context-journal baseline

> Added after Task 4 isolated a second first-page `SOURCE_CHANGED` condition. Task 1's legacy-ID
> regression is green, but the same query still returns `409` before pagination or LLM generation.

### Evidence

- Account generation cannot be the mismatch: validation reads the current generation and passes it
  directly to the immediately following query.
- Ownership and chat type use the same persisted fields in validation and query, and both validation
  checks have succeeded.
- There is no cursor on a first preview page.
- The remaining divergent boundary is the chat context-journal head: the established repository
  normalizer treats absent or legacy `null` sequence state as baseline `0`, while the digest reader
  accepts `undefined` as `0` but rejects `null`.
- Ingestion already advances `(existingSequence ?? 0) + 1` and writes the first journal entry, so a
  legacy null head is safely equivalent to the pre-journal baseline. Negative, fractional, string,
  and other malformed values must continue to fail closed.

### Task 5a: Add RED baseline and fail-closed contracts

Extend the same repository test file with:

1. an owned legacy chat whose raw `contextChangeSequence` is `null`; its first digest page must
   succeed with baseline sequence `0`, and
2. a compact malformed-value table proving negative, fractional, and string values still return
   `SOURCE_CHANGED`.

Run only the repository test file and observe the null case fail before implementation.

### Task 5b: Normalize only the legacy null sentinel

Change the local `contextSequence` parser to accept `unknown`, map only `undefined` and `null` to
baseline `0`, and retain the existing non-negative-integer check for every other value. Do not alter
cursor or journal validation.

### Task 5c: Repeat the focused gate and browser checkpoint

Repeat the Task 3 commands, allow PM2 watch to reload only WhatsApp Service, verify its real Firestore
binding and health, then click `Try preview again` in the same open modal. Any subsequent failure
gets its own evidence and plan; success resumes the group/direct MVP scenario.

## Task 6: Align the legacy account generation fallback

> Added after Task 5 remained `409` rather than `404`. The account therefore passes raw owner,
> source-account, active-status, and erasure checks. With chat identity/type/context now aligned and no
> first-page cursor, account generation is the remaining source-changed fence.

### Evidence

- The established account projector treats a missing or empty historical `generationId` as the
  already persisted `sourceAccountId`.
- Validation uses that projected generation and returns it to Message Digest Service.
- The digest transaction instead compares the raw missing field with the projected generation and
  returns `SOURCE_CHANGED`.
- This fallback does not permit a stale generation: any non-empty persisted generation remains
  authoritative and must exactly match the input.

### Task 6a: Add the RED legacy-generation contract

Seed an otherwise owned/active account without a payload `generationId`, query using its persisted
`sourceAccountId` as generation, and expect the page to succeed. Keep the existing stale-generation
test as the fail-closed contract. Run only the repository test file and observe RED.

### Task 6b: Apply the established fallback locally

Resolve current generation as the non-empty persisted `generationId`, falling back only to the
already ownership-checked persisted `sourceAccountId`. Compare that resolved value with the query.
Do not infer from request data and do not alter account ownership/status/erasure checks.

### Task 6c: Repeat the focused gate and browser checkpoint

Repeat Task 3, verify the watched service is healthy on real dev Firestore, and retry the unchanged
preview. A successful source query should now proceed to pagination and generation; a new failure is
handled only after another written plan.

## Completion gate

This remediation is complete only when all three compatibility regressions are observed RED then
GREEN, the malformed/stale-value fences stay green, the focused WhatsApp checks pass, and the same
Chrome preview advances beyond the source query. No commit, full CI, or production mutation is part
of this fragment.
