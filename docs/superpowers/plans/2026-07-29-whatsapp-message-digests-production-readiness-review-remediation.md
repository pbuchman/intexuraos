# WhatsApp Message Digests Production-Readiness Review Remediation Plan

## Purpose

Close every validated architecture, migration, privacy, and UX finding from the final focused
review before synchronizing with `origin/development` and entering the one repository-wide CI gate.
This remediation remains inside the active WhatsApp Message Digests goal. It adds no feature flag,
deployment phase, fallback delivery path, or second implementation.

## Fixed execution constraints

- The primary agent implements these tasks sequentially and test-first. Review-only subagents may be
  used only after the bounded implementation is green.
- Preserve the user-owned untracked files under `docs/superpowers/specs/`.
- Do not run `pnpm run ci:tracked` during this plan. Use only the focused commands listed below.
- Do not mutate production, Meta templates, Git history, or the already-running Chrome/WhatsApp
  sessions while implementing this plan.
- Do not change the approved WhatsApp template name, language, body parameters, URL suffix, first
  mapped-number resolution, or the `skipped_no_activity` no-send contract.

## Task 1 — Make the production cutover compensatable and retryable

### RED tests

Extend `scripts/__tests__/message-digest-cutover.test.ts` before changing implementation to prove:

1. A pre-admission failure transitions the durable state through `compensating` to `compensated`;
   an incomplete compensation remains `compensating` and cannot resume forward steps.
2. A compensated attempt may be reacquired by a different `deploymentId` only when its migration,
   merge SHA, tested tree, immutable release directory, and previous release directory are identical.
   Reacquisition creates a new numbered attempt with a fresh window and empty checkpoints while
   preserving an audit summary of the compensated attempt.
3. `in_progress`, `compensating`, `admitted`, and `complete` states remain lease-protected from a
   different deployment; compensation remains forbidden after admission.
4. The migration status gate accepts exactly two safe states: only migration 128 is pending, or all
   migrations through the exact named migration 128 are applied. It rejects any earlier pending or
   failed migration, a failed/pending later migration, and a missing/renamed 128 row.
5. Forward Terraform plans still require the exact reviewed resource/action set. Inverse plans may
   contain any safe subset, including zero changes, but reject an unknown address, a wrong action,
   replacement actions, or duplicates.
6. The candidate Pub/Sub canary contains `publishTime`; public admission is checkpointed only after
   the symlink/nginx operation returns successfully.
7. Attempt-local reports, web snapshots, runtime markers, Terraform data/plans, and forward-started
   markers cannot be reused by a later attempt.

### GREEN implementation

Update these files:

- `scripts/hetzner/message-digest-cutover-state.mjs`
- `scripts/hetzner/message-digest-cutover-state.d.mts`
- `scripts/hetzner/message-digest-cutover-support.mjs`
- `scripts/hetzner/message-digest-cutover-support.d.mts`
- `scripts/hetzner/cutover-message-digests.sh`
- `scripts/__tests__/message-digest-cutover.test.ts`

Implement the following contracts:

- Add durable attempt identity and the statuses `compensating` and `compensated`. Expose atomic
  `beginCutoverCompensation` and `markCutoverCompensated` operations through both the module and CLI.
  Checkpoints are legal only during the matching forward attempt.
- When a compensated state is reacquired with identical immutable release identity, increment the
  attempt, archive the prior attempt's deployment/window/checkpoints/compensation timestamp, reset
  forward checkpoints and admission fields, and bind the new lease/deadline. Do not permit takeover
  of an unfinished or admitted attempt.
- Derive an `attempts/<number>/` directory immediately after lease acquisition. Put every mutable
  report, candidate build, previous-web snapshot, runtime marker, Terraform working directory/plan,
  and forward-start marker below it. Keep only `state.json` and the immutable protected Fishing
  binding at the cutover root.
- On `ERR`, mark compensation as started before restoration. Mark it compensated only after ingress
  hold, previous-release restore, Fishing compensation when applicable, and both applicable inverse
  Terraform operations all succeed. A failed rollback remains explicitly recoverable and never
  resumes forward execution.
- Replace `assertOnlyPendingMigration128` with a parser returning `pending` or `already_applied` for
  the two safe status tables. Continue invoking the normal migration runner at step 128 so its
  existing checksum validation proves an already-applied migration and turns the step into a safe
  no-op.
- Keep exact validation for `dev`/`prod` forward plans; validate `dev-inverse`/`prod-inverse` as a
  whitelist subset so no-op and partial-apply compensation are safe.
- Add a valid ISO `publishTime` to the candidate Pub/Sub envelope.
- Execute `public_admission` first and persist the irreversible `public-admission` checkpoint only
  after the symlink and nginx switch succeed. A partial switch therefore remains pre-admission and
  is restored by compensation.

### Focused gate

```bash
pnpm exec vitest run scripts/__tests__/message-digest-cutover.test.ts
bash -n scripts/hetzner/cutover-message-digests.sh scripts/hetzner/github-actions-deploy.sh scripts/hetzner/deploy-nginx.sh
shellcheck scripts/hetzner/cutover-message-digests.sh scripts/hetzner/github-actions-deploy.sh scripts/hetzner/deploy-nginx.sh
pnpm exec eslint scripts/__tests__/message-digest-cutover.test.ts
pnpm exec prettier --check scripts/hetzner/message-digest-cutover-state.mjs scripts/hetzner/message-digest-cutover-state.d.mts scripts/hetzner/message-digest-cutover-support.mjs scripts/hetzner/message-digest-cutover-support.d.mts scripts/__tests__/message-digest-cutover.test.ts
```

## Task 2 — Allow the same Fishing migration identity to complete after compensation

### RED tests

Extend both migration suites first:

- `scripts/__tests__/fishing-group-message-digest-migration.test.ts`
- `scripts/__tests__/fishing-group-message-digest-production-ports.test.ts`

Prove the complete same-ID lifecycle:

`apply -> verify -> activate -> compensate -> apply -> verify -> activate`.

The second apply must reuse the hidden canonical chain without generating a duplicate run or an
outbound effect. Also prove the restage transaction rejects a changed baseline/source identity,
visible or unsafe run, pending window, outbox record, wrong replay hash, wrong owner, and a candidate
that is not exactly `rollback_pending/compensated`.

### GREEN implementation

Update:

- `scripts/message-digests/fishing-group-migration.mjs`
- `scripts/message-digests/fishing-group-production-ports.mjs`
- the two focused suites above

Add `migration.restageCompensatedCandidate(...)` as one Firestore transaction. It must re-read the
definition, state, activation, all candidate runs, and outbox; validate the immutable shell identity,
baseline, hidden terminal chain, replay hash, no pending window, and zero outbound work; then change
only the activation from `rollback_pending/compensated` to `staging/restaged`, clear stale activation
verification/lease data, and set `replayHash` to `null` so a later retry may safely append newly closed
source windows before `markStaged` seals the new final chain.

In `runFishingMigrationApply`, call this operation only after dry-run and shell compatibility checks
identify an exact compensated candidate, then re-inspect the candidate before reusing/appending runs.
Fresh, staging, and already-active behavior must remain unchanged and idempotent.

### Focused gate

```bash
pnpm exec vitest run scripts/__tests__/fishing-group-message-digest-migration.test.ts scripts/__tests__/fishing-group-message-digest-production-ports.test.ts scripts/__tests__/fishing-group-message-digest-cli.test.ts
pnpm exec eslint scripts/message-digests/fishing-group-migration.mjs scripts/message-digests/fishing-group-production-ports.mjs scripts/__tests__/fishing-group-message-digest-migration.test.ts scripts/__tests__/fishing-group-message-digest-production-ports.test.ts
pnpm exec prettier --check scripts/message-digests/fishing-group-migration.mjs scripts/message-digests/fishing-group-production-ports.mjs scripts/__tests__/fishing-group-message-digest-migration.test.ts scripts/__tests__/fishing-group-message-digest-production-ports.test.ts
```

## Task 3 — Remove the full private summary from the delivery event

### RED tests

Update the formatter, publisher-contract, and WhatsApp Pub/Sub route tests first to prove that:

- a long unique private marker present after the 1,024-code-point template excerpt never appears in
  `event.message`, `payloadJson`, or the idempotent outbound reservation input;
- Message Digest events use one neutral fixed `message` value while retaining the bounded template
  excerpt required by the approved provider template;
- both the publisher builder and the WhatsApp consumer reject a Message Digest presentation paired
  with any non-neutral message, preventing a later producer from reintroducing the leak;
- ordinary non-template WhatsApp events continue to allow their actual message body.

### GREEN implementation

Update:

- `packages/whatsapp-pubsub-client/src/types.ts`
- `packages/whatsapp-pubsub-client/src/whatsappSendPublisher.ts`
- `packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts`
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`

Export and use one frozen neutral producer constant such as `Message Digest delivery`. Enforce the
same literal in the consumer's presentation parser. Remove the obsolete 3,500-code-point full-summary
message construction and truncation notice. Continue sending only `digestName`, the sanitized
1,024-code-point `digestExcerpt`, and the exact run URL suffix to the approved template; retain
`retainMessageText: false`.

### Focused gate

```bash
pnpm --filter @intexuraos/whatsapp-pubsub-client test
pnpm --filter @intexuraos/message-digest-service test -- --run src/infra/notification/formatWhatsAppDigest.test.ts
pnpm --filter @intexuraos/whatsapp-service test -- --run src/__tests__/pubsubRoutes.test.ts
pnpm --filter @intexuraos/whatsapp-pubsub-client typecheck
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/whatsapp-service typecheck
```

## Task 4 — Close the lifecycle, editor, list, menu, and run-detail UX gaps

### RED tests

Add focused tests before implementation in:

- `apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`

The tests must prove:

1. A lifecycle `REVISION_CONFLICT` reloads and displays the latest definition, then a second click
   sends the newly loaded revision and succeeds; a failed reload preserves the current safe view and
   gives an actionable error.
2. Switching an unlocked source group -> direct and direct -> group replaces an untouched
   auto-applied template with the matching default. Any edited template text or explicitly custom
   instructions survive a source change byte-for-byte.
3. Clicking a status or conversation-type filter during the 300 ms search debounce commits the
   pending normalized query in the same URL transition; the timer cannot later erase or overwrite it.
   Back/Forward still cancels genuinely stale local typing.
4. The actions menu is portaled outside the horizontally scrolling table/card container, repositions
   on viewport scroll/resize, chooses above/below placement based on available space, clamps
   horizontally, preserves keyboard navigation/focus return, and closes on true outside interaction.
5. A `skipped_no_activity` run renders a completed timeline step named
   `No activity — generation not needed`, and states that WhatsApp delivery was not needed rather
   than waiting for generation or a provider receipt.
6. Create/Save remains actionable whenever no mutation is pending. Clicking it on an invalid form
   runs the existing validation, exposes the error summary, and focuses the first invalid field;
   valid submission and mutation locking remain unchanged.

### GREEN implementation

Update:

- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestsPage.tsx`
- `apps/web/src/components/message-digests/MessageDigestActionsMenu.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestRunPage.tsx`
- the five focused suites above

Implement these minimal behaviors:

- On a null lifecycle update, call `digest.refreshWithResult()` before unlocking the action. On
  success explain that the latest state is loaded; on failure explain how to retry refresh. A later
  action reads the re-rendered authoritative revision.
- Treat instructions as auto-replaceable only when `templateId` is non-custom and text exactly equals
  that template (or text is blank). A source-type change then selects its default; edited/custom text
  is never overwritten.
- Flush pending raw search into every discrete filter/sort URL mutation, applying the existing
  search sort transition exactly once and clearing the debounce timer.
- Render the existing menu with `createPortal(document.body)`, fixed coordinates derived from the
  trigger and measured menu, an 8 px viewport collision margin, above/below fallback, and scroll/
  resize recomputation. Outside-click/focus logic must recognize both the trigger and portal.
- Give skipped runs an explicit terminal generation/no-delivery timeline.
- Disable Create/Save only while `isSubmitting`; keep validation in the submit handler as the single
  source of focus and error behavior.

### Focused gate

```bash
pnpm --filter @intexuraos/web test -- --run src/pages/__tests__/MessageDigestDetailPage.test.tsx src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx src/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx
pnpm --filter @intexuraos/web typecheck
pnpm --filter @intexuraos/web lint
pnpm exec prettier --check apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx apps/web/src/pages/WhatsAppMessageDigestsPage.tsx apps/web/src/components/message-digests/MessageDigestActionsMenu.tsx apps/web/src/pages/WhatsAppMessageDigestRunPage.tsx
```

## Task 5 — Integrated focused verification and review handoff

1. Run the focused gates from Tasks 1–4 once more on the final remediation tree.
2. Run the existing lightweight repository verifiers that cover cutover, service wiring, API routes,
   logging, Pub/Sub, Terraform secrets, hash routing, Firestore artifacts, and dead code. Do not run
   `pnpm run ci:tracked`.
3. Run `terraform fmt -check -recursive terraform`, isolated `terraform init -backend=false` plus
   `terraform validate` for `terraform/environments/dev` and `terraform/hetzner-prod`, and shell
   syntax/ShellCheck again because the cutover is production-critical.
4. Use review-only agents for one bounded architecture/migration/security review and one bounded UX/
   accessibility review. Validate every finding locally; if another behavior change is needed, write
   a new remediation addendum before editing.
5. Update the active execution GOAL with the actual green evidence and leave the next phase as:
   synchronize with latest `origin/development`, resolve focused conflicts, run final acceptance in
   the already-running system Chrome, then execute the one full-CI gate.

## Acceptance criteria

- Every validated review finding is covered by a failing-before/passing-after focused test.
- A pre-admission cutover may be fully compensated and a later workflow may safely retry the exact
  release/migration identity without stale checkpoints or artifacts.
- The Fishing definition can complete the same-ID full lifecycle after compensation with zero
  duplicate runs and zero outbound effects.
- No full generated digest survives in the Pub/Sub/outbox event; only the provider-required bounded
  excerpt remains.
- Lifecycle conflict recovery, source-template switching, debounced filtering, action-menu placement,
  no-activity timeline, and invalid-form accessibility all have deterministic UX tests.
- All focused gates and repeat review are green, with no full CI invocation and no external mutation.
