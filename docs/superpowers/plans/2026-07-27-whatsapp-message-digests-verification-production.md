# WhatsApp Message Digests — Verification and Production Delivery Plan

> **For the primary agent:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute every
> task in order. Before claiming completion, also use `superpowers:verification-before-completion`.
> Implementation subagents are forbidden; review subagents are read-only and may be used only after
> a bounded artifact is complete.

**Goal:** Turn the completed uncommitted candidate into one fully verified revision, merge it safely,
execute the single coordinated production cutover, and prove real group/direct delivery and the
complete UI in the user's existing Chrome profile.

**Architecture:** All implementation is complete before this plan. Integrate the latest
`origin/development` without an intermediate commit, rerun focused evidence, run one planned local
full CI, freeze one Git tree/commit, and merge only when the automatic production workflow can begin
immediately after the legacy cron window. The workflow performs hidden preparation/migration and one
public activation; acceptance checks the exact merged tree.

**Tech stack:** Git/pnpm/Vitest/CI, GitHub protected PR and Actions, existing Hetzner deployment and
cutover scripts, Terraform/Firebase CLIs, production APIs, system Google Chrome and WhatsApp Web.

**Authoritative input:**
`docs/superpowers/plans/2026-07-27-whatsapp-message-digests-execution-goal.md` and all four completed
implementation plans. No implementation scope may be invented here.

## Global execution constraints

- Continue sequentially on `codex/whatsapp-message-digests`; only the primary agent mutates files,
  GitHub, infrastructure, migration state, browser state, and production.
- Start only after every focused gate and review in the prior plans is green.
- Do not add features during verification. An observed defect gets one focused RED test, minimal
  GREEN fix, affected focused gates, and then restarts later invalidated gates as specified.
- Run `pnpm run ci:tracked` exactly once on the normal path. A rerun is allowed only after an actual
  failure or a post-gate code change; explain and capture that reason.
- Create exactly one implementation commit named `feat: add WhatsApp message digests`. PR fixes amend
  that commit and push with lease; never add another implementation commit.
- No production mutation occurs before protected merge. The merge itself triggers the coordinated
  production workflow and is timed just after the existing `01:00 UTC` digest cron.
- Never bypass branch protection, required checks, migration fences, cutover preflight, index
  readiness, ingress hold, or direct-origin verification.
- Use only the already-running system Google Chrome/profile for local and production browser work.
  Do not launch another browser, Chrome process/profile, Playwright, headless browser, or Computer
  Use substitute. Authenticate only through Google account `kontakt@pbuchman.com` in that Chrome.
- Do not inspect browser storage/cookies/profile files or print credentials, tokens, full phones,
  chat/group/contact names, source IDs, source text, prompts, or private summaries.
- Every temporary production direct definition is deleted through UI after acceptance. The migrated
  fishing definition and source conversations remain.

## Evidence locations

Before full CI, all tracked planning/checkpoint text is final. After full CI, write evidence only to
privacy-safe `/tmp` files and PR/deployment metadata so the tested Git tree never changes:

- `/tmp/whatsapp-message-digests-focused-evidence.txt`
- `/tmp/whatsapp-message-digests-ci-output.txt`
- `/tmp/whatsapp-message-digests-release-evidence.txt`

These contain command/status/tree/SHA/run references and safe counts/timestamps only. They are not
committed. Do not write placeholders into the active GOAL.

## Sequential verification and delivery tasks

### Task 1: Integrate the latest `origin/development` without an intermediate commit

1. Record `git status --short`, current HEAD, `origin/development`, and the exact five excluded
   untracked user-owned spec paths. Confirm no unexpected user file overlaps implementation.
2. Run `git fetch origin development` read-only. If the branch base is still current, continue.
3. If `origin/development` advanced, create one reversible named stash including tracked and
   untracked work, record its stash commit, fast-forward the still-uncommitted feature branch with
   `git merge --ff-only origin/development`, and apply the recorded stash without dropping it.
   Confirm all excluded user specs reappear unchanged. Never use reset/checkout or overwrite a
   conflict.
4. Resolve any stash conflicts manually with `apply_patch`, preserving both current development and
   intended feature behavior. Run focused tests for every overlapped area. Keep the stash as backup
   until the candidate passes review; do not expose its contents.
5. Re-run branch/base/divergence/status checks. Update the active GOAL's pre-CI progress and any safe
   checkpoint data now, before the final CI gate.

Gate: feature HEAD is the latest development commit with only uncommitted intended changes plus the
explicitly excluded user specs.

### Task 2: Re-run the complete focused automated matrix

1. Execute all focused commands from the backend MVP, Web MVP, feature completion, and
   migration/removal plans with fresh output. Group commands by service to avoid repeated startup and
   do not substitute a workspace-wide test suite.
2. Run package coverage for Message Digest and Fishing, plus the focused ordinary Mobile regression.
   Inspect reports; do not weaken thresholds/ignores.
3. Run all touched package typechecks and targeted lint, then package exports, workspace ownership,
   boundaries, Firestore ownership/artifacts/migrations, service wiring, endpoint/hash-route/resource
   verifiers, deployment-script tests, Terraform fmt/validate, docs formatting, and `git diff --check`.
4. Run removal/privacy searches and inspect every residual match. Verify no tracked diff or fixture
   contains protected identifiers/content.
5. Capture only command name, exit status, safe test counts, and timestamp in the focused evidence
   file. Any failure gets a focused RED diagnosis/fix and reruns only its affected group before this
   task can pass.

Minimum command groups:

```bash
pnpm --filter @intexuraos/message-digest-service test:coverage
cd apps/whatsapp-service && pnpm exec vitest run src/__tests__/domain/whatsapp/privateWhatsAppDigestSource.test.ts src/__tests__/infra/privateDigestSourceToken.test.ts src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts src/__tests__/privateDigestSourceRoutes.test.ts src/__tests__/outboundDeliveryRoutes.test.ts src/__tests__/pubsubRoutes.test.ts
pnpm exec vitest run packages/internal-clients/src/whatsapp-service/__tests__/client.test.ts packages/internal-clients/src/message-digest-service/__tests__/client.test.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts
pnpm --filter @intexuraos/fishing-assistant-service test:coverage
pnpm exec vitest run apps/mobile-notifications-service/src/__tests__
pnpm --filter @intexuraos/web test -- src/services/__tests__/messageDigestsApi.test.ts src/hooks/__tests__/useMessageDigests.test.ts src/components/message-digests/__tests__ src/pages/__tests__/MessageDigestsPages.test.tsx src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx src/__tests__/navigationStructure.test.ts src/__tests__/App.lazyRoutes.test.tsx src/components/__tests__/Sidebar.test.tsx
pnpm exec vitest run scripts/__tests__/fishing-group-message-digest-migration.test.ts migrations/__tests__/128-message-digest-service-indexes.test.ts scripts/__tests__/verify-mobile-digest-removal.test.ts scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts scripts/__tests__/message-digest-cutover.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm --filter @intexuraos/fishing-assistant-service typecheck
pnpm --filter @intexuraos/mobile-notifications-service typecheck
pnpm --filter @intexuraos/internal-clients typecheck
pnpm --filter @intexuraos/llm-prompts typecheck
pnpm --filter @intexuraos/web typecheck
pnpm run verify:package-exports
pnpm run verify:boundaries
pnpm run verify:firestore
pnpm run verify:migrations
pnpm run verify:firestore-artifacts
pnpm run verify:service-wiring
pnpm run verify:route-resource-names
pnpm run verify:hash-routing
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev fmt -check
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev init -backend=false
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev validate
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/hetzner-prod fmt -check
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/hetzner-prod init -backend=false
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/hetzner-prod validate
git diff --check
```

### Task 3: Run final local acceptance only in the existing Chrome

1. Start/reload local services through the repository PM2 workflow and verify health for Web,
   Message Digest, WhatsApp, Fishing, and Mobile. Do not launch a browser.
2. Attach to the existing system Chrome, reuse/open `http://localhost:3000/#/login`, and verify the
   signed-in Google account is `kontakt@pbuchman.com`; ask the user to finish same-profile sign-in if
   blocked.
3. At 1280×800 and 1440×900 exercise every interaction ID: `NAV-01`, `NAV-02`, `NAV-03`,
   `LIST-01`, `LIST-02`, `LIST-03`, `LIST-04`, `LIST-05`, `LIST-06`, `LIST-07`, `LIST-08`,
   `LIST-09`, `LIST-10`, `LIST-11`, `LIST-12`, `FORM-01`, `FORM-02`, `FORM-03`, `FORM-04`,
   `FORM-05`, `PICK-01`, `PICK-02`, `PICK-03`, `PICK-04`, `PROMPT-01`, `PROMPT-02`,
   `PROMPT-03`, `PROMPT-04`, `PROMPT-05`, `PROMPT-06`, `SCHED-01`, `SCHED-02`, `SCHED-03`,
   `SCHED-04`, `DETAIL-01`, `DETAIL-02`, `DETAIL-03`, `DETAIL-04`, `DETAIL-05`, `DETAIL-06`,
   `DETAIL-07`, `HIST-01`, `HIST-02`,
   `HIST-03`, `RUN-01`, `RUN-02`, `RUN-03`, `RUN-04`, `LEGACY-01`, and `CTA-01`, including complete
   daily/weekdays/weekly forms, DST next-run examples, source lock, filters/sorts/back navigation,
   pause/resume, conflict recovery, failed-run/delivery retry fixtures, ambiguous state, interrupted
   deletion, old-link redirects, and Fishing canonical redirect.
4. At 390×844 plus logical 200% zoom exercise list/create/edit/detail/history/run/dialog/menu flows.
   Verify semantic mobile cards, no horizontal overflow, 44px targets, keyboard-only order, visible
   focus, Escape/return focus, dark mode, reduced motion, long text, labels, alerts, and polite status.
5. Render controlled safe fixtures for missing mapping, readiness failure, source unavailable/change/
   too-large, empty/no-match, initial/refresh/load-more errors, generation failure, delivery failed/
   ambiguous, and erasure progress. Confirm no false empty/success/delivery copy.
6. Create fresh temporary group and direct definitions against owned real chats. Use preview without
   delivery, then send exactly one real group and one real direct digest. Double-click confirmation
   and reload during one in-flight run; verify one run/send each plus exact CTA round trips in
   WhatsApp Web in the same Chrome. Exact request replay and duplicate scheduler tick remain an
   automated authenticated integration gate; Chrome never calls internal scheduler routes.
7. Delete both temporary definitions and verify terminal cleanup/source preservation. Inspect browser
   console/network for unexpected errors, failed requests, private identifiers, or duplicate calls.
8. Record only route classes, viewport, interaction IDs, state labels, safe counts/timestamps, and
   cleanup result in `/tmp`; never screenshots/private text unless fully privacy-safe and necessary.

Gate: every local interaction and exactly-once group/direct delivery passes with zero retained
temporary definition data.

### Task 4: Perform final primary-agent and read-only reviews

1. Inspect the complete diff and untracked inventory for scope, accidental user files, generated
   drift, dead code, duplicate paths, endpoint/schema consistency, package ownership, migration
   immutability, security/privacy, docs truth, and production rollback behavior.
2. Request bounded read-only reviews of the final candidate covering:
   - architecture/code and concurrency;
   - security/privacy/migration/cutover;
   - test matrix/removal completeness;
   - UX/accessibility/responsive consistency.
3. Review agents never edit. Reproduce each accepted Critical/Important issue, add a focused RED test,
   implement minimal GREEN, and rerun the affected focused group plus any impacted local Chrome row.
4. Repeat review only for changed findings until all reviewers report no unresolved Critical or
   Important issue.
5. Run final `git diff --check`, status, excluded-file, credential/private-data, and intended-file
   inventory checks. Finalize tracked GOAL progress now; after this point any edit invalidates later
   CI.

Gate: complete candidate has fresh focused/local evidence and no known important defect.

### Task 5: Run the one planned full-CI gate and freeze the Git tree

1. Confirm no full CI has run for this implementation, all prior gates are fresh, no process will
   rewrite generated files, and the only excluded untracked files are the user's five specs.
2. Run exactly:

```bash
branch_slug="$(git branch --show-current | sed 's#/#-#g')"
pnpm run ci:tracked 2>&1 | tee "/tmp/ci-output-${branch_slug}-$(date +%Y%m%d-%H%M%S).txt"
```

3. Inspect the complete captured output, not only exit code. If it fails, diagnose every failure,
   add/fix focused tests, rerun affected focused/local gates, then rerun full CI and record why the
   exceptional rerun was required.
4. After success, do not format, generate, update GOAL, or edit any tracked file. Confirm
   `git diff --check`, then stage only the intended implementation/planning files using explicit
   paths. Verify the five user specs are unstaged.
5. Compute `git write-tree` and record it as the tested tree hash. Verify staged diff statistics and
   privacy one final time. The staged tree must match the post-CI working tree exactly for intended
   files.

Gate: one immutable tested tree is staged and all full CI output is green.

### Task 6: Create the sole commit, push, and open the protected PR

1. Read and follow the repository `commit-push` skill before any commit/push/PR action. Use the
   repository's GitHub integration/CLI as directed by that skill.
2. Create exactly one commit:

```bash
git commit -m "feat: add WhatsApp message digests" -m "Tested-Tree: <recorded-tested-tree-hash>"
```

3. Verify the commit tree equals the recorded tested tree, the body trailer parses to that same full
   hash, and the branch contains exactly one commit over the synchronized development base.
4. Push the branch and open one ready PR targeting `development`. The PR body includes Endpoint
   Changes, data/index migration, zero-send staging, Mobile removal, privacy, focused/full test
   evidence, Chrome/WhatsApp evidence, rollback gates, and the requirement to merge immediately after
   the `01:00 UTC` legacy cron. Include only safe metadata.
5. Monitor all required GitHub checks. If any code fix is necessary, add focused RED/GREEN proof,
   repeat affected local acceptance and full CI, amend the sole commit, and `push --force-with-lease`.
   A docs-only PR-body correction does not change the tree.
6. Keep the PR unmerged until checks pass and the cutover window is ready.

Gate: one reviewed PR revision passes all required checks and still has the recorded tested tree.

### Task 7: Revalidate merge/tree/cutover preconditions at the production window

1. Shortly before the next legacy `01:00 UTC` occurrence, verify PR checks, source branch SHA/tree,
   current `development`, deploy-workflow availability, production health, and no unrelated pending
   production/Terraform drift. If development advanced, rebase the sole feature commit onto the new
   `origin/development` without creating a merge/second implementation commit, resolve conflicts
   without discarding either side, repeat affected focused/full gates, amend the sole commit if its
   tree changed, push with lease, and wait for checks again.
2. Do not merge before the legacy cron. Immediately after it completes, run only read-only metadata
   preflight: no backfill/lock/run, stable account generation/baseline hashes, exact unique group
   binding, zero staged activation conflict, pending migrations exactly `[128]`, next legacy
   occurrence outside the bounded window, index/replay duration estimates, Terraform plans matching
   reviewed artifacts, and merge-tree candidate equality. If estimated preparation plus rollback
   margin does not fit the available window, do not merge.
3. Do not precompute the authoritative deadline in the client session. The deployment workflow must
   persist `cutoverStart` from its actual start and
   `cutoverDeadline = min(cutoverStart + 2h, next legacy 01:00 UTC - 30m)`, while its Actions timeout
   is at least 180 minutes to retain rollback margin. Any failed preflight blocks merge and leaves
   production unchanged.
4. Merge through protected GitHub controls without bypass. Immediately resolve the merge SHA and
   require `git rev-parse <merge-sha>^{tree}` to equal the tested tree hash. A mismatch blocks the
   deployment/cutover; do not accept a merely similar diff.
5. The push-triggered production workflow must start for that merge SHA. Before any mutation it must
   resolve the associated merged PR head and prove the head tree, commit `Tested-Tree` trailer, merge
   tree, and staged release tree are identical. It derives the migration ID deterministically from
   the merge SHA, acquires the durable deployment lease, and owns resumable step checkpoints. Do not
   start a second manual deployment; if the runner/SSH session dies, rerun the same workflow attempt
   so it resumes the same migration ID.

Gate: protected merge tree equals the locally tested tree and one automatic cutover workflow owns
production mutation.

### Task 8: Monitor the coordinated hidden preparation and atomic activation

1. Monitor the single GitHub deployment run and privacy-safe production state; never print protected
   binding/source content.
2. Require the workflow to stage both current and previous immutable releases without changing public
   routes. Start the candidate Message Digest, WhatsApp, Fishing, and Mobile services together on
   alternate loopback ports with candidate internal URLs, and serve the candidate Web static build
   off-path. Assert the durable lease/checkpoint, deterministic migration ID, actual start/deadline,
   time estimate, and exact pending migration list `[128]` before mutation. Apply only migration 128
   and poll every declared index until `READY`.
3. Require direct-origin candidate proof for all four services and Web assets: health,
   authenticated owner/foreign schemas, hidden migration behavior, Fishing contract, ordinary Mobile
   routes, scheduler no-op, Pub/Sub rejection, and zero outbound effects before Terraform.
4. On the production host, clear all emulator variables and use
   `/home/deploy/provisioner-sa-key.json`. Apply the reviewed forward plan for
   `terraform/environments/dev` first (topic/identity/IAM), then `terraform/hetzner-prod`
   (subscription/DLQ/scheduler and removal of only the old digest scheduler). After forward state
   exists, generate and review inverse plans from the previous immutable release configuration
   against that current state; do not reuse a stale precomputed inverse plan.
5. Require migration `--dry-run`, `--apply`, and `--verify` under that single deterministic migration
   ID. Verify imported canonical history through `2026-07-03`, exactly one Private WhatsApp canonical
   run per date from `2026-07-04` through the last closed Warsaw day, original repair
   classifications retained only as legacy audit, continuous predecessor hash, exact safe counts,
   source generation, canonical-only hidden visibility, idempotent rerun, and zero
   outbox/WhatsApp-receipt delta.
6. Immediately before activation require fresh source/baseline/no-lock/zero-send/candidate/index and
   delivery-readiness=`ready` checks. If a pre-admission step fails or the deadline cannot be met,
   first restore the previous release symlink/PM2/nginx, verify the old Mobile legacy endpoint by
   direct origin, then apply inverse Terraform in `hetzner-prod` then `environments/dev` order,
   proving the old scheduler is restored and the new one absent. Keep staging hidden and fail without
   a public switch.
7. During the affected-route ingress hold, require full candidate direct-origin proof again, one
   activation transaction with `nextRunAt > cutoverDeadline`, atomic release/PM2/nginx switch,
   direct-origin owner/Fishing/Mobile/Web proof, then public admission and deployment attestation.
8. Once public traffic is admitted, compensation and history rewrite are forbidden. If a later proof
   fails, keep affected ingress fail-closed, preserve the active data, and deliver a forward fix via
   a new reviewed commit/PR/focused tests/full CI. Never expose a failed candidate or silently restore
   an old scheduler behind admitted new data.

Gate: one complete public product appears atomically and `/deployment.json` reports the exact merge
SHA/workflow/time.

### Task 9: Run production UI and real WhatsApp acceptance in the existing Chrome

1. Attach only to the already-running system Chrome and open `https://intexuraos.cloud`. Sign in
   through Google as `kontakt@pbuchman.com` in that same profile if required.
2. Verify deployment SHA, WhatsApp navigation, Message Digest list, migrated fishing definition,
   repaired/continuous history, definition schedule/next run, and old Notification/Fishing redirects
   at desktop 1280×800.
3. Manually run the migrated fishing definition once to close the first live post-migration window.
   Record safe start/run metadata, follow queued/reading_messages/aggregating/repairing-as-applicable
   and transport states, reload once,
   verify truthful `Sent`, and double-click/reload the same UI confirmation to prove no duplicate.
   Internal tick/request replay remains covered by authenticated automated integration tests.
4. In WhatsApp Web in the same Chrome, verify exactly one corresponding IntexuraOS group digest after
   the recorded start and open its CTA to the exact production run.
5. Create one timestamp-named temporary direct sentiment definition through UI, verify implicit masked
   primary delivery and no recipient input, preview, run/send once, reload/replay, and verify exactly
   one WhatsApp message plus exact CTA. Delete the definition and wait for terminal erasure.
6. Exercise cadence edit, pause/resume, filters/sort/pagination, complete history/run details, keyboard
   focus, dark mode, reduced motion, 200% zoom, and 390×844 mobile no-overflow. Cover safely reachable
   setup/error states without altering the user's WhatsApp mapping.
7. Verify Fishing Assistant reads migrated summaries and alias-scoped WhatsApp evidence; generic
   direct digest never appears. Retain only safe evidence counts, hashes, and opaque reference
   metadata—never source content. Verify all removed old endpoints return 404 and ordinary Mobile
   notification ingestion/list/filter/settings health remains good.
8. Inspect safe production logs/receipts for one terminal delivery per live run, no ambiguous or
   duplicate effect, no legacy Mobile source read, and no private data in logs. Confirm the fishing
   definition remains active with the correct next run and source chats are unchanged.

Gate: production group/direct behavior, complete critical UX, continuity, legacy removal, and exact
CTA delivery all pass on the deployed merge SHA.

### Task 10: Close evidence and the active goal

1. Assemble privacy-safe final evidence: branch, sole commit, PR, checks, merge/deployed SHA, tested
   and merged tree hash equality, deployment workflow, migration ID/hashes/date counts, zero replay
   sends, index/scheduler/topic/PM2 health, Chrome matrix, two safe live run references, terminal
   receipt states, cleanup, and old-endpoint/Mobile/Fishing results.
2. Confirm no temporary definition/schedule remains except the intended migrated fishing definition,
   no maintenance ingress hold remains, and no rollback action is pending.
3. Run read-only final health/deployment/migration verify checks. Do not edit the tested repository
   tree or create another commit.
4. Invoke the active-goal status update only now, with `complete`. Do not mark complete for a green
   PR, deployment alone, generated summary quality alone, or partial browser evidence.
5. Report the outcome to the user in Polish with concise links/SHAs and no private source content.

## Plan completion gate

This plan and the parent goal are complete only when the exact locally tested tree is the protected
deployed production tree, migration continuity and zero replay delivery are proven, Mobile contains
no digest behavior, Fishing uses new boundaries, and the existing system Chrome proves exactly one
real group and one real direct delivery with canonical CTA round trips.
