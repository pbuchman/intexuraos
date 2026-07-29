# WhatsApp Message Digests — Repository Branch Coverage Remediation Plan

> Status: active
> Trigger: full repository CI run 37 passed Type & Lint, Static Validation, and 7606 tests, then failed only `v8-ignore:coverage` with 274 uncovered branches.

## Non-negotiable guardrails

- Add executable tests for every reported branch. Do not lower thresholds, edit coverage exclusions,
  alter Vitest coverage configuration, or add `v8 ignore` comments.
- Preserve accepted Message Digest production behavior, provider payloads, persistence contracts,
  privacy boundaries, and cutover ordering.
- A production-code change is allowed only if a new test proves an actual defect, or when a branch
  is structurally impossible after an already-validated runtime bound and can be removed with a
  behavior-preserving TypeScript narrowing/non-null assertion. Do not retain or exempt impossible
  guards merely to satisfy the type checker.
- Use in-memory fakes and `app.inject()`; no shared environment, provider, browser, or production
  mutation is part of coverage remediation.
- Execute batches sequentially. Subagents are permitted only for the final read-only review.
- Keep the five user-owned `docs/superpowers/specs/*` files untouched and untracked.

## Baseline evidence

The authoritative merged `coverage/coverage-final.json` from CI run 37 reports exactly 274 uncovered
branches in 36 files. The grouped inventory is:

| Batch | Scope | Uncovered branches |
| --- | --- | ---: |
| A | Message Digest Firestore/document persistence | 73 |
| B | Private WhatsApp digest source/readiness | 71 |
| C | WhatsApp outbound delivery and Pub/Sub | 51 |
| D | Message Digest domain, routes, scheduler, LLM, formatting, config | 56 |
| E | Fishing projection and shared client/prompt integrations | 23 |
| **Total** |  | **274** |

## Task 1 — Capture an exact, repeatable RED inventory

1. Preserve CI run 37's merged coverage artifact until every reported line has been classified.
2. Generate the complete `--all` list and group it by file and source line.
3. For each batch, run focused Vitest coverage into a temporary reports directory so iteration does
   not overwrite the authoritative merged repository artifact.
4. Count only executable uncovered branches; keep tests semantic and avoid line-only assertions.

## Task 2 — Batch A: persistence and document codecs (73 branches)

**Production files:**

- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts` — 64
- `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.ts` — 7
- `apps/message-digest-service/src/infra/firestore/firestoreLegacyDigestArchive.ts` — 2

**Test files:**

- `firestoreMessageDigestStore.test.ts`
- `messageDigestDocuments.test.ts`
- `firestoreLegacyDigestArchive.test.ts`

1. Add table-driven fake-Firestore cases for absent documents, malformed timestamps/projections,
   conflicts, idempotent replay, paging boundaries, nullable fields, and transaction failures.
2. Assert stable domain errors and unchanged storage state on every rejection path.
3. Run the three test files with focused coverage for only the three production files.
4. Do not proceed until their uncovered-branch count is zero.

## Task 3 — Batch B: Private WhatsApp source and readiness (71 branches)

**Production files:**

- `privateWhatsAppDigestSource.ts` — 27
- `privateWhatsAppDigestSourceRepository.ts` — 25
- `privateDigestSourceRoutes.ts` — 11
- `privateDigestSourceToken.ts` — 3
- `whatsappDeliveryReadiness.ts` — 3
- `readPrivateWhatsAppDigestSource.ts` — 2

**Test files:** the matching domain, repository, token, route, and readiness tests under
`apps/whatsapp-service/src/__tests__/`.

1. Cover every invalid token/cursor, source mismatch, group/direct discriminator, pagination edge,
   repository failure, mapping state, and route error envelope.
2. Assert logs and responses never expose message text, phone numbers, raw tokens, or chat IDs.
3. Run focused coverage for the six production files and require zero missing branches.

## Task 4 — Batch C: outbound delivery and Pub/Sub (51 branches)

**Production files:**

- `apps/whatsapp-service/src/routes/pubsubRoutes.ts` — 27
- `apps/whatsapp-service/src/infra/firestore/outboundMessageRepository.ts` — 14
- `apps/whatsapp-service/src/infra/whatsapp/sender.ts` — 5
- `apps/whatsapp-service/src/routes/outboundDeliveryRoutes.ts` — 2
- `apps/whatsapp-service/src/infra/http/messageDigestDeliveryAuthorizationClient.ts` — 2
- `packages/whatsapp-pubsub-client/src/whatsappSendPublisher.ts` — 1

1. Add table-driven cases for malformed envelopes, duplicate/in-flight leases, terminal versus
   ambiguous provider results, authorization acquire/release failures, persisted receipt replay,
   timeout/abort handling, and publisher input boundaries.
2. Preserve exactly-once/idempotency expectations and content-free diagnostics.
3. Run the matching six test files with focused coverage and require zero missing branches.

## Task 5 — Batch D: Message Digest domain and HTTP surface (56 branches)

**Production groups:**

- schedules (13), public routes (12), processing (10), legacy query (4);
- internal routes (3), aggregator (3), update (3), scheduler tick (2);
- config, internal legacy route, preparation token, formatter, delivery reconciliation, and outbox
  dispatch (1 each).

**Test files:** matching tests under `apps/message-digest-service/src/**`.

1. Cover DST overlap/gap candidates, cadence discriminators, cursor/limit validation, stale revision,
   source window changes, aggregation repair/failure, run state transitions, scheduler pagination,
   token rejection, formatter bounds, and downstream error mapping.
2. Keep all error assertions stable and verify no side effect occurs before validation succeeds.
3. Run the affected Message Digest tests with focused coverage and require zero missing branches.

## Task 6 — Batch E: supporting integrations (23 branches)

**Production files:**

- Fishing digest routes (9) and evidence retrieval (3);
- WhatsApp internal client (5) and Message Digest internal client (2);
- OpenRouter client (3);
- Message Digest prompt builder (1).

1. Cover legacy projection absence/error mapping, evidence selection boundaries, HTTP decode/error
   paths, OpenRouter structured-output options, and the remaining prompt conditional.
2. Run the matching test files in their owning packages with focused coverage and require zero
   missing branches.

## Task 7 — Consolidated focused gate

1. Run every changed test file together by owning package.
2. Run full production typecheck and full test typecheck.
3. Run scoped ESLint and Prettier for every changed file, then `git diff --check`.
4. Confirm no production file, threshold, coverage config, or user-owned spec was changed.

## Task 8 — One merged coverage proof

1. With no competing sharded runner, execute `node scripts/run-sharded-coverage.mjs --shards=3` once.
2. Run `node scripts/verify-v8-ignore.mjs --all` against the newly merged artifact.
3. Require zero uncovered branches without exemptions and zero exempted branches.
4. If any line remains, return only to its owning focused test batch; do not run full CI yet.

## Task 9 — Read-only review and final CI

1. Ask one subagent to review only the coverage test diff and evidence; require zero
   Critical/Important findings and an explicit `Ready` verdict.
2. Fetch `origin/development` again and require branch divergence `0/0`; integrate first if it moved.
3. Run `pnpm run ci:tracked` once more.
4. If green, make no further repository changes before staging the tested tree.

## Acceptance

- All 274 branches from CI run 37 have semantic test coverage.
- Merged repository coverage verifier reports zero missing/exempted branches.
- Typecheck, test typecheck, lint, formatting, diff, and read-only review pass.
- Fresh full CI passes on a branch exactly current with `origin/development`.
- No shared environment is held and no publication/deployment occurs during remediation.
