# WhatsApp Message Digests — Final Production Blockers Remediation

## Purpose

Close every validated P1/P2 finding from the final production-readiness reviews before branch
synchronization, final system-Chrome acceptance, and the single repository-wide CI run. This plan
remains inside the active Message Digests goal. It adds no feature flag, alternate product path, or
partial rollout.

## Fixed constraints

- The primary agent implements each task sequentially and test-first. Subagents remain review-only.
- Do not mutate production, Meta, Chrome, WhatsApp, Git history, or `origin/development` while this
  plan is executing.
- Do not run `pnpm run ci:tracked`; use only the focused gates below.
- Preserve all user-owned untracked files under `docs/superpowers/specs/`.
- The approved WhatsApp template, first-number delivery rule, source identity, migration identity,
  no-activity no-send behavior, and no-feature-flag decision remain frozen.
- Candidate checks may read protected binding values in memory but must never print, log, persist in
  reports, or pass them on a command line.

## Task 1 — Make every production data-plane query and lifecycle transition executable

### 1A. Definition list index

RED in `migrations/__tests__/128-message-digest-service-indexes.test.ts` and the Firestore store
tests:

- every public definition-list index contains `userId`, `status`, its optional `listStatus` and/or
  `source.chatType` filters, the requested sort, and `__name__` in the same direction;
- default, needs-attention, active, paused, conversation-type, and search query shapes all resolve
  to a declared index family;
- the generated `firestore.indexes.json`, migration manifest checksum, and migration 128 source stay
  identical.

GREEN:

- add `status` to every generated definition-list index in
  `migrations/128_message-digest-service-indexes.mjs`;
- regenerate the committed Firestore artifacts and manifest through the repository migration
  tooling; do not hand-edit an immutable earlier migration.

### 1B. Pause while a run owns the pending window

RED in:

- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`;
- `apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts`;
- `apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts`;
- the focused Web lifecycle page tests.

Prove an active definition with `state.pendingWindow != null` atomically rejects Pause with
`RUN_IN_PROGRESS`, leaves definition/state unchanged, and produces an actionable refresh-required
conflict in Web. Pausing with no pending window and completing an already claimed run remain green.

GREEN:

- extend `MessageDigestStore.updateDefinition` and `UpdateMessageDigestResult` with
  `RUN_IN_PROGRESS`;
- reject `active -> paused` inside the same Firestore transaction that reads the state;
- keep workers restricted to active definitions and keep the existing Resume guard, eliminating the
  deadlock without introducing quiescing semantics.

### Focused gate

```bash
pnpm exec vitest run migrations/__tests__/128-message-digest-service-indexes.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts
pnpm run verify:migrations
pnpm run verify:firestore-artifacts
pnpm --filter @intexuraos/message-digest-service typecheck
```

## Task 2 — Bind WhatsApp authorization to the exact frozen outbox bytes

### RED tests

Update:

- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`;
- `apps/whatsapp-service/src/infra/http/messageDigestDeliveryAuthorizationClient.test.ts`;
- `apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.test.ts`;
- `apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts`;
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`.

Prove:

1. WhatsApp hashes the exact decoded Pub/Sub JSON bytes for a Message Digest event.
2. Acquire/release requests carry one 64-hex `payloadDigest`; malformed or missing values fail
   closed.
3. The authorization transaction derives the original deterministic WhatsApp-delivery outbox ID,
   reads it with the definition/run, and authorizes only when owner, run, kind, idempotency key, and
   stored `payloadDigest` exactly match.
4. A structurally valid event changed and reserialized under the same run/idempotency key is denied
   before receipt reservation/provider send; the original frozen payload remains authorized.
5. Ordinary non-digest idempotent WhatsApp behavior is unchanged.

### GREEN implementation

- Move `getMessageDigestDeliveryOutboxId` into a small domain ID helper shared by processing and the
  Firestore adapter.
- Add `payloadDigest` to both authorization identity contracts, schemas, HTTP client, route, use
  case, and store port.
- Preserve the raw decoded JSON string in `pubsubRoutes.ts`; use its SHA-256 only for the digest lane
  and retain the existing canonical receipt digest for ordinary Matrix messages.
- Compare the supplied digest to the original `whatsapp_delivery` outbox inside the authorization
  transaction before granting or renewing a fence.

### Focused gate

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.test.ts apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/whatsapp-service/src/infra/http/messageDigestDeliveryAuthorizationClient.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/whatsapp-service typecheck
```

## Task 3 — Make migration discovery and cutover state safe across every crash boundary

### 3A. Exact Fishing binding

RED in a new `scripts/__tests__/resolve-fishing-migration-binding.test.ts`:

- accept exactly one NFKC/trim-normalized exact group name on the active source account;
- reject suffix/prefix lookalikes, zero or multiple exact matches, a foreign account, invalid active
  account, wrong source generation, unbounded snapshots, and empty legacy ownership.

GREEN in `scripts/message-digests/resolve-fishing-migration-binding.mjs`: remove prefix matching and
compare normalized names for equality only. Preserve the actual presentation name in the protected
binding.

### 3B. Compensated retry and irreversible admission intent

RED in `scripts/__tests__/message-digest-cutover.test.ts` and
`scripts/__tests__/hetzner-runtime.test.ts`:

- the deploy wrapper accepts `compensated`, restores its exact `previousReleaseDir`, and invokes the
  retryable cutover; `compensating` remains fail-closed;
- a new atomic `beginPublicAdmission` operation is legal only after the first 14 checkpoints, marks
  state `admitting`, records time, and permanently forbids compensation before any external switch;
- rerunning the same deployment while `admitting` repeats only the idempotent forward admission and
  then checkpoints `public-admission`; another deployment cannot take it over;
- `complete` is impossible from `admitting`, and all compensation APIs reject it.

GREEN:

- add `admitting` and `admittingAt` to the cutover state module/CLI/declarations;
- invoke `begin-admission` before publishing Web, changing the release symlink, or opening nginx;
- teach `github-actions-deploy.sh` to route `compensated` and `admitting` correctly while preserving
  the immutable-release checks.

### 3C. Full affected-ingress hold and exact rollback proof

RED static/shell tests prove:

- candidate staging hides only the not-yet-public `/api/message-digests` route;
- the short activation hold returns 503 for new Message Digests, legacy Mobile digest routes,
  Fishing digest routes, and the legacy internal scheduler route, while unrelated Mobile/Fishing
  routes remain available;
- the old public Web build is untouched through runtime switch and migration activation;
- after durable `admitting`, the already-built candidate Web is copied, the symlink/nginx switch is
  repeated idempotently, and admission is checkpointed;
- rollback waits for previous Mobile health and requires exactly 401 from the unauthenticated legacy
  endpoint, not merely any non-404 response.

GREEN:

- split nginx candidate-unavailable and full-cutover-hold snippets;
- remove Web publication from `switch_runtime_under_hold` and publish the verified candidate Web
  only inside forward-only admission;
- add exact hold probes and exact rollback health/auth probes.

### Focused gate

```bash
pnpm exec vitest run scripts/__tests__/resolve-fishing-migration-binding.test.ts scripts/__tests__/message-digest-cutover.test.ts scripts/__tests__/hetzner-runtime.test.ts
bash -n scripts/hetzner/cutover-message-digests.sh scripts/hetzner/github-actions-deploy.sh scripts/hetzner/deploy-nginx.sh
shellcheck scripts/hetzner/cutover-message-digests.sh scripts/hetzner/github-actions-deploy.sh scripts/hetzner/deploy-nginx.sh
```

## Task 4 — Execute the complete live candidate contract before activation and admission

### RED tests

Add:

- `scripts/__tests__/message-digest-candidate.test.ts`;
- candidate-check cases in Message Digest internal-route and Fishing digest-route suites;
- cutover shell contract assertions.

The tests must prove the candidate verifier fails closed on every missing/malformed response and,
without printing identities or response bodies, checks:

1. all four candidate services on the supplied loopback ports report health;
2. a protected internal Message Digest cutover endpoint executes the real default public list query
   for the owner and a synthetic foreign owner, returning safe counts only (staged `0/0`, active
   `1/0`);
3. a protected Fishing cutover endpoint traverses the real Message Digest internal client and
   returns only exact definition/run counts for the replay range;
4. an ordinary Mobile internal query succeeds for a synthetic user;
5. an authenticated scheduler tick reports zero recovered dispatches, reconciliations, reservations,
   and deferrals;
6. authenticated malformed Message Digest Pub/Sub work is rejected and no outbound count changes;
7. candidate `index.html` and every referenced local asset are actually served from the isolated Web
   root;
8. migration reports remain zero-send and staged/active visibility agrees with live services.

### GREEN implementation

- Add internal-auth plus caller-role-bound cutover check endpoints to Message Digest and Fishing.
  They accept body preview length zero, expose counts only, and reuse the real query/client paths.
- Add `scripts/hetzner/verify-message-digest-candidate.mjs` (and declaration) with bounded HTTP/body,
  strict envelope parsing, a temporary loopback static server, and no sensitive output.
- Invoke the verifier against `18113/18114/18119/18135` after staged apply/verify, then against
  `8113/8114/8119/8135` immediately after activation and its fresh active verification, before
  `begin-admission`.
- Keep all scheduler/outbound assertions at exactly zero and abort under the full ingress hold on any
  active-phase failure.

### Focused gate

```bash
pnpm exec vitest run scripts/__tests__/message-digest-candidate.test.ts apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts apps/fishing-assistant-service/src/__tests__/digestsRoutes.test.ts scripts/__tests__/message-digest-cutover.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/fishing-assistant-service typecheck
pnpm exec eslint scripts/__tests__/message-digest-candidate.test.ts apps/message-digest-service/src/routes/internalMessageDigestRoutes.ts apps/fishing-assistant-service/src/routes/digestsRoutes.ts
```

## Task 5 — Make the final Web contracts truthful and accessible

### Task 4 addendum — distinguish canonical replay runs from Fishing-visible replay runs

The live Fishing facade intentionally excludes `skipped_no_activity` runs, while the migration's
`replayRuns` count includes every canonical replay day. Comparing those values would reject a valid
cutover (and the current fishing migration fixture already contains such a day).

Before completing Task 4:

- add RED migration/verifier assertions for a separate, safe `visibleReplayRuns` count;
- derive it from completed replay artifacts only and require the dry-run, apply, and verify reports
  to agree;
- keep `canonicalRuns`/`replayRuns` unchanged for chain integrity;
- compare the live Fishing cutover endpoint's replay-range count with `visibleReplayRuns`, never with
  the total canonical replay count.

No message content, source identity, or summary text may enter the report.

### 5A. Creation adjustment wire contract

RED in editor/detail/hook/API tests proves the backend value
`'delivery_setup_required' | null` survives service parsing and navigation, displays the paused-delivery
banner only for the exact reason, and rejects obsolete booleans.

GREEN:

- change `CreateMessageDigestResponse.activationAdjusted` to the exact union;
- preserve the exact value in New-page navigation and `readDetailIntent`.

### 5B. List lifecycle refresh truthfulness

RED in hook/list-page tests proves a failed PATCH plus successful refresh says the latest state is
loaded, while failed/stale refresh preserves the row and instructs the user to retry refresh. It must
never claim reload before confirmation.

GREEN:

- make list execution return success/failure internally and expose `refreshWithResult()` alongside
  the existing `refresh()`;
- after a null/thrown lifecycle update, await that result, choose truthful copy, and avoid a duplicate
  refresh before unlocking the row.

### 5C. Valid history date ranges

RED in `MessageDigestHistoryFilters.test.tsx` and history-page tests proves a From date after To:

- remains visible as a local draft with inline associated error, `aria-invalid`, and no URL/API
  transition;
- has reciprocal `min`/`max` constraints;
- commits both values once corrected, and Clear/Back/Forward resynchronize drafts.

GREEN: keep date drafts inside the filter component, synchronize them from canonical URL state, and
call `onChange` only for an empty/partial/ordered range.

### Focused gate

```bash
pnpm exec vitest run src/pages/__tests__/MessageDigestEditorPages.test.tsx src/pages/__tests__/MessageDigestDetailPage.test.tsx src/hooks/__tests__/useMessageDigests.test.ts src/pages/__tests__/MessageDigestsPages.test.tsx src/components/message-digests/__tests__/MessageDigestHistoryFilters.test.tsx src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx
pnpm --filter @intexuraos/web typecheck
pnpm --filter @intexuraos/web lint
```

Run the Vitest command above from `apps/web` with `src/...` paths.

## Task 6 — Make ownership verification and current documentation truthful

### RED tests

Extend `scripts/__tests__/verify-firestore-ownership.test.ts` to prove:

- `.js`, `.mjs`, `.cjs`, and `.ts` production files under declared scan paths are scanned;
- registry-known collection literals inside multiline/object maps count as references;
- a cross-owner known literal in an MJS migration port is a blocking violation;
- test/dist/node_modules files remain excluded.

### GREEN implementation

- teach `verify-firestore-ownership.mjs` to scan supported production JS/TS extensions and match
  registry-known quoted literals across the complete file while retaining the existing direct-call
  unknown-collection checks;
- add `scripts/message-digests` to the Message Digest archive rows' owner scan paths;
- make all four archive references and migration activation visible to the verifier so the warnings
  disappear without deleting the intentional read-only archive registry entries;
- update `docs/overview.md` and `README.md`: Mobile Notifications is Android notification capture
  only; add/link Message Digest Service as the WhatsApp group/direct summarization owner.

### Task 6 addendum — remove migration reads of WhatsApp-owned collections

The strengthened verifier correctly exposed three pre-existing migration reads that bypassed the
WhatsApp Service owner boundary: binding discovery read Private WhatsApp account/chat collections,
and the production migration port read outbound-delivery receipts. The earlier verifier could not
see these `.mjs` paths. Closing the warning by weakening the verifier or declaring shared ownership
would violate the repository's single-owner rule.

Before Task 6 can be green:

- add a cutover-role-only WhatsApp internal endpoint that resolves exactly one active group by
  owner ID and NFKC/trim-normalized exact display name, with bounded chat pagination and a response
  containing only the protected binding fields already persisted by the resolver;
- make the binding resolver read only the Message Digest-owned legacy archive in Firestore and use
  that WhatsApp endpoint for account/generation/chat discovery;
- reuse WhatsApp's existing owner-scoped outbound-delivery state endpoint for every canonical
  migration run instead of reading receipt documents from the migration port;
- carry the resulting zero-receipt preflight proof into compensated restaging while the migrated
  definition remains paused/migrating and has no outbox, retaining the no-send fence without a
  cross-owner transaction;
- require the candidate WhatsApp URL and internal token for every migration mode, including
  compensation, and keep the token/body out of command lines, logs, and reports.

Add RED route/use-case, binding-resolver, production-port, CLI, migration, and cutover tests before
changing these paths. Rerun the Task 6 focused gate after the ownership verifier reports no
cross-service violations.

### Focused gate

```bash
pnpm exec vitest run scripts/__tests__/verify-firestore-ownership.test.ts scripts/__tests__/message-digest-docs.test.ts
pnpm run verify:firestore
pnpm run verify:mobile-digest-removal
pnpm run verify:dead-code
```

## Task 7 — Integrated focused verification and repeat review

1. Rerun all Task 1–6 focused suites on the final tree.
2. Rerun typecheck/lint/prettier for Message Digest, WhatsApp, Fishing, Web, and changed scripts.
3. Rerun migration/artifact, service wiring, endpoint, Pub/Sub, logging, hash-routing, Terraform,
   shell syntax/ShellCheck, and `git diff --check` gates; still do not run full CI.
4. Use review-only subagents for one bounded data/security/cutover review and one bounded UX/ops
   review. Validate every new finding locally; write another addendum before any further behavior
   change.
5. Update the active execution GOAL with actual evidence. Only then fetch/synchronize the latest
   `origin/development` and proceed to final system-Chrome acceptance.

### Task 7 addendum — close the final cutover and accessibility review findings

The repeat review found two real cutover gaps and two Web failure-state gaps. It also reported a
checkpoint-count failure that does not reproduce: `message-digest-cutover-state.mjs read` already
serializes `completedSteps` as the array length. The boundary is nevertheless ambiguous and lacks
an executable cross-process regression, so it must be made explicit rather than dismissed.

#### 7A. Make the durable checkpoint count explicit and executable

RED:

- execute the state helper as a child process after checkpoint 1, checkpoint 2, and a same-release
  resume; assert an exact integer `completedStepCount` of `1`, `2`, and `2`;
- prove malformed/tampered state cannot produce a shell arithmetic value.

GREEN:

- rename the CLI summary field from the misleading numeric `completedSteps` to
  `completedStepCount`;
- make `state_completed_count` accept only `0..MESSAGE_DIGEST_CUTOVER_STEPS.length` decimal output
  before Bash arithmetic.

#### 7B. Hold the real legacy Mobile ingress

RED: the nginx/cutover tests must require the exact externally exposed legacy locations under
`/internal/notifications/` and reject the ineffective `/api/notifications/internal/...` aliases.

GREEN: return `503` with `Retry-After` for the exact legacy digest runner, yesterday runner,
subscription, query, get, and state endpoints during the full hold, without blocking ordinary
Mobile notification APIs.

#### 7C. Admit a complete Web release atomically

RED: runtime tests must prove nginx serves one stable `web/current` root, the candidate is copied
only into an inactive release directory, and the active Web pointer changes through a same-parent
temporary symlink plus atomic rename before nginx public admission. No copy may target the active
root.

GREEN:

- stage the verified candidate under `/var/www/intexuraos/web/releases/<merge-sha>` and verify an
  existing retry target is byte-equivalent;
- atomically replace `/var/www/intexuraos/web/current` only after the complete release exists;
- point every nginx SPA/deployment root and deployment-attestation writer at `web/current`;
- make ordinary Web deployments use the same inactive-release plus atomic-pointer contract while
  preserving `--web-root` as a non-activating candidate build.

#### 7D. Bind candidate owner/foreign evidence to one opaque definition

Obtaining a second live end-user Auth0 token inside an unattended production cutover would require
creating or storing a privileged test identity, which is outside this release and would mutate an
external identity system. The safe gate will therefore combine the real public-route denial
boundary with an exact-ID owner projection through the caller-role-bound internal verifier.

RED:

- the candidate verifier must derive the deterministic migrated `definitionId`, send that same ID
  for owner and synthetic foreign checks, and fail if active owner visibility is not exactly true or
  foreign visibility is not exactly false;
- a direct request to the real public `GET /:definitionId` route with a malformed bearer must be
  rejected with `401` in both staged and active stacks;
- route tests must prove the protected verifier calls `getOwnedDefinition` for both identities and
  returns only booleans, never an ID, identity, or document.

GREEN: replace whole-list count comparison with the exact public-read use case for the same opaque
ID, retain strict caller-role/internal authentication, and add the direct public JWT-rejection
probe. Existing public-route tests remain the proof that a valid JWT subject is the sole source of
the owner ID.

#### 7E. Preserve focus and truthful lifecycle state on refresh failure

RED:

- after create navigation with a delayed detail GET, focus reaches the loaded `<h1>` exactly after
  loading resolves;
- after a successful Pause/Resume PATCH followed by failed list GET, the old row cannot expose any
  action, feedback says the mutation succeeded but refresh failed, and a successful manual refresh
  clears the lock;
- failed PATCH behavior continues to say the mutation was not applied.

GREEN:

- rerun the detail focus effect when the requested definition becomes available;
- distinguish unchanged mutation errors from changed-but-refresh-required feedback;
- keep the stale row action menu non-busy but disabled until a confirmed list refresh, avoiding a
  second mutation with the old revision.

### Task 7 addendum focused gate

```bash
pnpm exec vitest run scripts/__tests__/message-digest-cutover.test.ts scripts/__tests__/message-digest-candidate.test.ts scripts/__tests__/hetzner-runtime.test.ts apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts
pnpm exec vitest run src/pages/__tests__/MessageDigestDetailPage.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx src/components/message-digests/__tests__/MessageDigestList.test.tsx src/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx
bash -n scripts/hetzner/cutover-message-digests.sh scripts/hetzner/deploy-web.sh scripts/hetzner/github-actions-deploy.sh scripts/hetzner/deploy-nginx.sh
shellcheck scripts/hetzner/cutover-message-digests.sh scripts/hetzner/deploy-web.sh scripts/hetzner/github-actions-deploy.sh scripts/hetzner/deploy-nginx.sh
```

Run the second Vitest command from `apps/web`.

#### 7F. Query the portaled action menu at its real DOM boundary

The expanded responsive gate exposed a test-only error: `MessageDigestActionsMenu` intentionally
renders its menu into `document.body` through a portal, while the responsive assertion searched
inside the originating card. The trigger correctly expanded (`aria-expanded="true"`), but a
portaled menu cannot be a descendant of that card.

RED: the existing responsive test expands the mobile action menu and fails to find its menu items
inside the card despite the menu being present at the document boundary.

GREEN: keep the card-scoped trigger and nested-control assertions, then query the single open menu
from the screen/document boundary and assert every menu item retains the 44 px minimum target.
This is a test-boundary correction only; production behavior does not change.

#### 7G. Keep interaction evidence bound to the renamed refresh assertion

The tracked Web gate showed that the LIST-02 interaction map still referenced the former test name
after the refresh contract was strengthened to return an explicit success result. The named test is
present and proves the required row-preservation, busy-state, failure, and recovery behavior; only
the literal evidence pointer is stale.

RED: `MessageDigestInteractionCoverage.test.ts` cannot resolve LIST-02 because it searches for the
old assertion name.

GREEN: point LIST-02 at the current exact test name, without changing the execution GOAL or product
behavior, then rerun the interaction-map test rather than the complete Web workspace gate.

#### 7H. Document the atomic Web release layout as the production truth

The final path audit found that the live architecture and operations guides still describe
`/var/www/intexuraos/web/dist` as nginx's served root. That directory remains a deliberate legacy
bootstrap source for the first cutover, but the active runtime contract is now the atomic
`web/current` symlink targeting an immutable `web/releases/<commit-sha>` directory.

RED: the runtime documentation assertion rejects active guides that still claim nginx serves the
legacy `web/dist` directory.

GREEN: update the Web hosting guide and Hetzner production runbook to distinguish immutable
releases, the active pointer, and the retained legacy bootstrap directory. Leave the historical
migration plan and bootstrap/provision defaults unchanged.

### Task 8 addendum — make the first cutover, recovery, and final UX actually resumable

The final bounded read-only reviews found four release-path failures and three Web interaction
failures. All reproduce from the current control flow and block production acceptance. No browser
acceptance, full CI, commit, or deployment may continue until this addendum is complete.

#### 8A. Read the currently served legacy deployment before `web/current` exists

RED:

- prove the first activation can read an exact legacy SHA when
  `/var/www/intexuraos/web/current/deployment.json` is absent but
  `/var/www/intexuraos/web/dist/deployment.json` is valid;
- prove an existing atomic `web/current` attestation always wins and an invalid selected
  attestation fails closed rather than silently choosing another release.

GREEN:

- keep `DEPLOYMENT_JSON_PATH` as the active post-cutover attestation path;
- add a distinct legacy bootstrap attestation path used only by `snapshot_legacy_release` when the
  active path does not yet exist;
- select the path remotely before parsing the exact 40-character SHA, without creating the active
  symlink ahead of the coordinated cutover.

#### 8B. Restore the old runtime first, then compensate through a restarted candidate adapter

The previous runtime must still be restored first under the full ingress hold, as required by the
execution GOAL. Its WhatsApp Service does not implement the new delivery-readiness boundary, so the
compensation cannot use port 8113 after that restore.

RED:

- for a failure at or after `migration-apply` but before admission, assert this exact order:
  full hold → previous runtime health → candidate compensation stack on 18113/18114/18119/18135 →
  compensation explicitly bound to WhatsApp port 18113 → candidate stack removal → prod inverse →
  dev inverse → legacy ingress proof;
- reject the existing implicit `migration_whatsapp_service_url` selection for compensation after
  the runtime-switch marker exists.

GREEN:

- restart only the four alternate-port candidate processes from the persisted candidate ecosystem
  after the old PM2 ecosystem is healthy;
- split the migration runner so compensation receives an explicit WhatsApp base URL while normal
  stages retain checkpoint-derived selection;
- always remove the temporary candidate processes after the compensation attempt, preserve the old
  saved PM2 ecosystem, and keep the durable state `compensating` on any failure.

#### 8C. Re-admit public ingress when resuming the durable `admitted` state

RED: with 15 completed steps and durable status `admitted`, prove retry idempotently stages/verifies
the same Web release, re-points `web/current`, reinstalls active Message Digest ingress, and only then
retries `post-admission-verify`. It must not rerun migration activation or write another checkpoint.

GREEN: add a separate `completed == 15 && CUTOVER_STATUS == admitted` recovery branch that invokes
the idempotent public-admission operation before the existing post-admission step. Preserve the
forward-only full hold on every repeated failure.

#### 8D. Resume wrapper attestation after the cutover state is already `complete`

RED:

- when the durable `complete.mergeSha` equals the workflow SHA, resolve a `cutover_complete` mode
  using the persisted previous release; do not reject the active release as its own predecessor;
- when a later workflow SHA differs from the completed cutover SHA, retain ordinary deployment
  behavior with the currently active immutable release as predecessor;
- in `cutover_complete` mode, verify the release/runtime, publish `deployment.json`, and verify both
  direct-origin and public attestations without rerunning PM2, Web activation, migration, or
  Terraform.

GREEN: distinguish same-release cutover finalization from later ordinary releases in
`resolve_activation_context`, and give the main deploy flow an explicit verification-and-attestation
resume branch.

Security re-review refinement: the `cutover_complete` branch must occur before every remote release
mutation shared by ordinary deployments. Its executable trace may prepare local verification data
and SSH, but on the host it may only hash/verify the already-existing immutable release, run backend
and public readiness checks, publish the final `deployment.json`, and verify that attestation. It
must not call release `rsync`, retired-path cleanup, secret reload, dependency installation, PM2,
Web activation, migration, Terraform, or current-release repointing. Add a sourced-shell `main`
trace test so assertions cover the common prelude, not merely the visible conditional block.

#### 8E. Focus a routed detail heading exactly once per navigation entry

RED: after a delayed detail load focuses the `<h1>`, focus an action and adopt/refetch a newer
definition; the action must retain focus. A new route entry requesting heading focus must still
focus the newly loaded heading.

GREEN: guard heading focus by the router location key (and loaded definition), not by the mutable
definition object. Do not clear or reinterpret arbitrary navigation state.

Implementation refinement from the final local review: on an in-place route change from definition
A to definition B, the detail hook can retain A for the render before its effect resets and loads B.
Do not mark B's location key handled until the loaded definition ID exactly equals the route
definition ID. Prove the stale A heading does not receive focus and the loaded B heading receives it
once.

#### 8F. Clear lifecycle locks after any confirmed current-query reload

RED:

- after successful PATCH plus failed refresh, keep the row locked;
- change query/filter and prove the lock remains while the new request is pending or failed;
- after the hook confirms a successful response for the current auth subject and exact request
  options, clear the stale-row lock/error and expose actions for the newly confirmed row.

GREEN: make `useMessageDigestList` expose whether its returned rows are confirmed for the current
auth subject and normalized request options. The list page clears lifecycle locks only on the
false→true transition for that current query; manual successful Refresh keeps its existing explicit
clear path.

Implementation refinement after the RED test: a boolean false→true edge can be skipped when React
batches a fast query transition and its successful response into one committed render. In addition
to the truth-value contract, expose an opaque monotonically increasing confirmation revision. It
increments only when a different exact auth-subject/request-options fingerprint succeeds and is
`null` while the current fingerprint is unconfirmed. The page baselines the first revision and
clears stale lifecycle state only when a later confirmed revision differs. This preserves the same
UX contract without relying on observing an intermediate render; manual refresh of the same query
continues to use its explicit clear path.

#### 8G. Keep every portaled action reachable in a short or zoomed viewport

RED: at 200% root zoom and a short mobile viewport, the open menu is capped to viewport width and
height, scrolls vertically, hides horizontal overflow, and retains 44 px menu items plus keyboard
navigation to the final action.

GREEN: add dynamic-viewport max width/height, vertical scrolling, horizontal clipping, and
overscroll containment to the fixed portal without changing collision positioning or focus return.

#### 8H. Fence lifecycle completion to the latest filter query

The final UX re-review found that an action started under query A retains A's
`refreshWithResult` closure while its PATCH is pending. If the user changes to query B, that stale
refresh can start later, abort B, and render A rows under B's URL. A late A failure can also create a
lock after B's confirmation revision already cleared prior locks.

RED:

- save query A's refresh callback, confirm B, invoke the saved callback, and prove it returns false
  before allocating a request ID, aborting B, calling the API, or dispatching A rows;
- start Pause under A, move through B while PATCH is pending, and prove completion invokes the
  latest B refresh rather than A's callback;
- move again to C while B's post-PATCH refresh is pending, fail B's refresh, and prove no B error or
  refresh-required lock is attached to C.

GREEN:

- expose an opaque current-query revision that increments synchronously with each exact normalized
  auth-subject/request-options fingerprint; the confirmed revision equals it only after that query
  succeeds;
- reject a stale `execute` closure before it increments the request sequence or aborts any request;
- keep refs to the latest page query revision and refresh callback, capture the revision of the
  post-PATCH refresh, and apply lifecycle errors/locks only if that same query is still current when
  the refresh settles.

Implementation refinement after the combined RED/GREEN race test: a page-owned revision ref is not
the authoritative observer of an async request's final disposition. Keep the public boolean refresh
helper for manual Refresh, but add a lifecycle refresh helper whose hook-owned result is exactly
`succeeded`, `failed`, or `stale`. The hook returns `stale` for an obsolete closure, abort, or request
sequence loss. The lifecycle handler must silently stop on `stale`, use `failed` for the existing
refresh-required UX, and use `succeeded` for the existing latest-state UX. This makes B→C fencing
independent of page effect timing while preserving the current-query revision contract.

#### 8I. Restore keyboard focus after Pause or Resume settles

RED: activate Pause/Resume with Enter, prove the menu closes and the trigger is disabled while the
operation is pending, then prove focus returns to that row's enabled actions trigger when the
operation settles. If a refresh-required lock keeps the trigger disabled, defer the return until the
lock clears. Pointer activation must not gain a delayed focus steal.

GREEN: remember keyboard/synthetic lifecycle activation, observe the pending lifecycle transition,
and focus the trigger only after both pending and refresh-required are clear. Cancel the pending
focus timer on unmount and preserve the existing Escape/outside-click behavior.

UX re-review refinement: the row trigger cannot be the only return target because an authoritative
`Active` → Pause or `Paused` → Resume refresh can remove that row from the selected filter and
unmount the menu. Propagate keyboard versus pointer activation to the page. After a successful
mutation and successful current-query refresh, if the keyboard-activated row is absent once list
refreshing has settled, issue a one-shot focus request to the stable Message Digests heading. If the
row remains, retain the menu's trigger return. Do not focus the heading for pointer activation,
failed/stale refresh, or an unrelated filter transition. Prove Active→Pause removes the row and
focuses the heading instead of `body`.

#### 8J. Focused proof before returning to Chrome

Run only the affected tests first, then the existing consolidated 99-test cutover/backend gate and
the Message Digest Web detail/list/menu/responsive/interaction suites. Re-run Message Digest Service
and Web typecheck/lint, shell syntax/ShellCheck, changed-file Prettier, and `git diff --check`.
Perform one final read-only review of these exact remediations. Only with zero unresolved P0/P1/P2
may local acceptance resume in the already-running system Chrome on `kontakt@pbuchman.com`.

## Acceptance criteria

- Default and filtered definition lists have applicable migration-128 indexes.
- Pause cannot strand a pending run.
- Only the exact frozen outbox bytes can receive a WhatsApp delivery authorization.
- Exact Fishing group discovery cannot select a lookalike.
- A compensated cutover can retry; once admission intent is durable, rollback is impossible and
  recovery is forward-only under a full affected-ingress hold.
- Live candidate services, Web assets, scheduler no-op, Pub/Sub rejection, Mobile regression,
  owner/foreign visibility, and Fishing continuity are all probed twice before admission.
- Creation/lifecycle/date-filter UI copy and behavior are truthful and accessible.
- Firestore ownership verification sees the real archive accesses, and current docs assign digest
  ownership only to Message Digest Service.
- No unresolved P0/P1/P2 finding remains, no full CI has run, and no external system has been
  mutated.

### Task 9 addendum — fail closed before cutover when the provider template is unavailable

The final local system-Chrome acceptance reached the real WhatsApp provider through the complete
Pub/Sub and delivery-authorization path. Generation completed, but the provider returned a
definitive not-found response before any outbound effect. A separate read-only Meta Graph query
against the configured WABA returned a successful response with no exact
`intexuraos_message_digest_v1` template. The existing first-number delivery-readiness boundary only
proves account mapping, connection, and user delivery preference; it does not prove that the fixed
provider template exists and is approved. The production cutover must not begin durable mutation
under that missing prerequisite.

The same acceptance also exposed an internal response-envelope leak: Message Digest Service
returned the domain result's `ok` discriminator inside otherwise valid acquire/release response
data. WhatsApp's strict client rejected that extra field, so a successful first authorization left
later Pub/Sub redeliveries behind the active lease. This was reproduced with an exact-envelope RED
route test and fixed by explicitly projecting only the public acquire/release fields. The focused
route, forwarding, authorization-client, typecheck, lint, and formatting gates are green.

#### 9A. Verify the frozen Meta template without exposing provider data

RED in a new `scripts/__tests__/verify-whatsapp-message-digest-template.test.ts`:

- query the configured WABA by exact template name with bounded timeout/body handling and bearer
  authentication;
- report ready only when exactly one `en_US` variant is `APPROVED`, categorized `UTILITY`, has one
  body component with the exact fixed copy
  `Your WhatsApp digest is ready: {{1}}\n\n{{2}}\n\nOpen the full digest for details.`, and
  has one dynamic URL button at index zero named `View digest` with base
  `https://intexuraos.cloud/{{1}}`;
- fail closed for missing, duplicate, pending/rejected, wrong-language/category/component/button/URL,
  malformed, oversized, timeout, network, and non-2xx responses;
- return or print only a fixed safe readiness result. Never include the access token, WABA ID,
  provider response body, template body copy, or account metadata in errors or logs.

GREEN in `scripts/hetzner/verify-whatsapp-message-digest-template.mjs` and its declaration:

- keep the frozen template constants local and accept credentials only from the inherited runtime
  environment in CLI mode;
- export an injected-fetch verifier for deterministic tests;
- reject redirects, bound the decoded response stream incrementally, cancel it immediately above
  128 KiB, and use one abort controller across both fetch and body consumption;
- use one generic operational failure code and a content-free success payload.

#### 9B. Run provider readiness before every production mutation

RED in `scripts/__tests__/message-digest-cutover.test.ts` and the runbook contract test:

- the cutover loads the protected environment, checks the provider template, and only then acquires
  or resumes its durable deployment lease;
- every fresh or resumed cutover rechecks current approval because Meta template state is external
  and can change independently of the release;
- failure cannot create/update cutover state, start candidate services, run a migration, apply
  Terraform, switch runtime, or send WhatsApp work;
- the production runbook names approved-template readiness as an explicit precondition and records
  only a safe pass/fail result.

GREEN:

- invoke the verifier immediately after protected environment loading and before
  `acquire_durable_lease` in `cutover-message-digests.sh`;
- invoke it again immediately before `--activate`, with a test proving failure enters the existing
  pre-admission rollback path before the activation command can run;
- require the verifier artifact during cutover input validation;
- keep template creation/approval as a separately coordinated Meta mutation through
  `/tmp/codex-sync`; do not add a free-form fallback, feature flag, alternate template, or deployment
  step.

#### 9C. Create the absent template once, under the shared Meta lease

- Acquire `/tmp/codex-sync.lock`, re-read the coordination file, and register one ACTIVE lease for
  the configured Meta WABA template catalog before any POST.
- Run the new verifier once more. If the exact template already exists and is approved, perform no
  mutation. If the name exists with any incompatible or rejected contract, stop without deleting or
  replacing it.
- Only when the exact name is absent, submit one `en_US` `UTILITY` template using the exact fixed
  body copy from 9A, safe examples for the two body parameters, and one `View digest` dynamic URL
  button at `https://intexuraos.cloud/{{1}}` with a safe canonical hash-route suffix example.
- Accept only a content-free `PENDING` or `APPROVED` creation result; never print the template ID,
  WABA ID, access token, response body, examples, or account metadata. Do not retry a non-2xx or
  ambiguous request automatically.
- Poll approval read-only with bounded intervals. Release the Meta lease as soon as the exact
  verifier passes, or release it with a safe blocked result if approval is rejected or cannot be
  observed in the current session.

#### Task 9 focused gate

```bash
pnpm exec vitest run scripts/__tests__/verify-whatsapp-message-digest-template.test.ts scripts/__tests__/message-digest-cutover.test.ts scripts/__tests__/message-digest-docs.test.ts
bash -n scripts/hetzner/cutover-message-digests.sh
shellcheck scripts/hetzner/cutover-message-digests.sh
pnpm exec eslint scripts/__tests__/verify-whatsapp-message-digest-template.test.ts
pnpm exec prettier --check scripts/__tests__/verify-whatsapp-message-digest-template.test.ts scripts/hetzner/verify-whatsapp-message-digest-template.mjs scripts/hetzner/verify-whatsapp-message-digest-template.d.mts docs/runbooks/whatsapp-message-digests.md docs/superpowers/plans/2026-07-29-whatsapp-message-digests-final-production-blockers-remediation.md
git diff --check
```
