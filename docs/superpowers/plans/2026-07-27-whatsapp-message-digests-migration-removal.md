# WhatsApp Message Digests — Migration, Legacy Removal, and Infrastructure Plan

> **For the primary agent:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute every
> task in order. Implementation subagents are forbidden; review subagents are read-only and may be
> used only after a bounded artifact is complete.

**Goal:** Move the Fishing Assistant and legacy fishing digest to the new service, remove every
digest responsibility from Mobile Notifications and duplicate Web surfaces, and prepare all tested
migration/infrastructure/documentation required for one later coordinated production cutover.

**Architecture:** The new service becomes the sole owner of new and archived digest records.
Fishing accesses an alias-restricted internal projection plus WhatsApp-owned source evidence.
Migration stages a complete invisible chain and activates it only through a fenced final transaction.
Infrastructure is committed ready but is not applied in this plan.

**Tech stack:** Existing TypeScript services and clients, Firestore, Node `.mjs` migration CLI,
Firebase migration tooling, Terraform for retained GCP/Hetzner, PM2, nginx, React redirects, Vitest.

**Authoritative input:**
`docs/superpowers/plans/2026-07-27-whatsapp-message-digests-execution-goal.md` and the three completed
implementation plans. The execution goal wins any conflict.

## Global execution constraints

- Continue sequentially on `codex/whatsapp-message-digests`; implementation remains entirely in the
  primary agent.
- Start only after the complete feature plan and its focused reviews are green.
- Use one focused RED → minimal GREEN → refactor cycle for every consumer, deletion, migration,
  index, wiring, and verification behavior.
- Do not add feature flags, dual-read/fallback paths, partial public rollout, Mobile source support,
  selectable recipients/models, or a second migration representation.
- Do not commit, open a PR, deploy, apply Terraform, apply migration 128, run the real fishing-data
  migration, or run `pnpm run ci:tracked` in this plan.
- Migration tests use synthetic users/chats/messages. Real production identifiers are injected only
  at cutover from protected environment values and never printed or written to tracked files.
- Existing immutable migrations `001..127` are never edited. Migration 128 is additive and its
  exact checksum is registered once. Obsolete legacy index retirement is deferred until a separate
  post-production soak change.
- Ordinary Mobile Notifications ingestion, signatures, filters, settings, list, and Web UI remain
  intact. Only digest behavior is removed.
- Legacy archives are erased only with their migrated digest definition. Platform-wide account
  erasure remains deferred.

## New internal Message Digest client contract

Create `packages/internal-clients/src/message-digest-service` with strict methods:

```ts
interface QueryLegacyDigestDefinitionsInput {
  userId: string;
  legacyGroupKey: string;
}

interface LegacyDigestDefinitionProjection {
  definitionId: string;
  legacyGroupKey: string;
  source: {
    sourceAccountId: string;
    generationId: string;
    chatId: string;
    chatType: 'group';
  };
  activeMigrationId: string;
}

interface QueryLegacyDigestRunsInput {
  userId: string;
  legacyGroupKey: string;
  fromDate?: string;
  toDate?: string;
  terms?: string[];
  limit: number;
  cursor?: string;
}
```

Only definitions carrying the exact persisted legacy alias are queryable. Direct/personal
definitions and hidden migration records always appear absent. Run projections return safe summary
and evidence refs needed by Fishing, not raw source text. Fishing uses the source fence from the
definition projection to call the typed WhatsApp source query for exact supporting messages.

The exact new-service paths are:

- `POST /internal/message-digests/definitions/query`;
- `POST /internal/message-digests/runs/query`;
- `GET /message-digests/legacy-runs/:groupKey/:date` for the owner-only public canonical resolver.

## Fishing migration contract

- Public legacy key remains `grupa-wedkarska-skool`; it is an alias, never a runtime source selector.
- Fishing digest list/view and retrieval route through `MessageDigestServiceClient`.
- Raw evidence comes from `WhatsAppServiceClient.queryPrivateDigestMessages` and only for the single
  alias-scoped group definition returned by the Message Digest service.
- Query pagination, date bounds, terms, owner, active migration ID, and source generation are all
  enforced. A generic group without the alias and every direct definition are absent.
- Fishing pages become canonical redirects; no duplicate digest rendering or Mobile API call stays.

## Production migration implementation contract

Create a content-safe CLI with mutually exclusive modes:

```text
node scripts/message-digests/migrate-fishing-group.mjs --dry-run --migration-id <safe-id>
node scripts/message-digests/migrate-fishing-group.mjs --apply --migration-id <same-safe-id>
node scripts/message-digests/migrate-fishing-group.mjs --verify --migration-id <same-safe-id>
node scripts/message-digests/migrate-fishing-group.mjs --activate --migration-id <same-safe-id> --cutover-deadline <rfc3339>
node scripts/message-digests/migrate-fishing-group.mjs --compensate --migration-id <same-safe-id>
```

Project ID, owner ID, source account generation, and chat ID come from protected environment
variables. CLI output contains safe dates/counts/hashes/status only.

The immutable baseline is:

- legacy key `grupa-wedkarska-skool`;
- last non-empty legacy digest/state checkpoint `2026-07-03`;
- initial repair `2026-07-04..2026-07-26`: 18 empty documents and five missing dates
  `2026-07-13..2026-07-17`;
- replay end at execution is dynamic: `cutoverDate - 1` in `Europe/Warsaw`;
- every replay uses the approved fishing instructions, sequential predecessor state, Private
  WhatsApp only, and `deliveryMode=silent` independently of generation number.

Dry-run validates one active owned group binding, generation, chat type, baseline hashes, no lock or
backfill, source safe counts/watermarks, and proposed date range without LLM/write/send. Apply creates
one hidden `migrating` definition, activation record, and staged canonical states/runs, while leaving
byte-original legacy artifacts only in their transferred legacy collections. Imported canonical
runs end at `2026-07-03`; Private WhatsApp replay owns every date from `2026-07-04` through cutover
minus one. Every staged run has `recordRole=canonical`; audit material is never returned by public or
Fishing queries. Verify proves exactly one canonical run per date, complete
chain/hash/count/idempotency, and zero outbound delta. Activate is one transaction and only after a
fresh ready delivery observation. Compensate is allowed only before public admission and only when
no post-activation reservation, outbox, or delivery exists. Definition erasure deletes or
irreversibly deidentifies its activation record in addition to canonical and legacy archive data.

## File inventory

### Create

- `packages/internal-clients/src/message-digest-service/types.ts`
- `packages/internal-clients/src/message-digest-service/client.ts`
- `packages/internal-clients/src/message-digest-service/index.ts`
- `packages/internal-clients/src/message-digest-service/__tests__/client.test.ts`
- `apps/message-digest-service/src/domain/ports/legacyDigestArchive.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreLegacyDigestArchive.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreLegacyDigestArchive.test.ts`
- `apps/message-digest-service/src/domain/usecases/queryLegacyMessageDigests.ts`
- `apps/message-digest-service/src/domain/usecases/queryLegacyMessageDigests.test.ts`
- `apps/message-digest-service/src/routes/internalLegacyDigestRoutes.ts`
- `apps/message-digest-service/src/__tests__/internalLegacyDigestRoutes.test.ts`
- `apps/message-digest-service/src/routes/legacyAliasRoutes.ts`
- `apps/message-digest-service/src/__tests__/legacyAliasRoutes.test.ts`
- `scripts/message-digests/fishing-group-migration.mjs`
- `scripts/message-digests/migrate-fishing-group.mjs`
- `scripts/__tests__/fishing-group-message-digest-migration.test.ts`
- `scripts/hetzner/cutover-message-digests.sh`
- `scripts/__tests__/message-digest-cutover.test.ts`
- `scripts/verify-mobile-digest-removal.mjs`
- `scripts/__tests__/verify-mobile-digest-removal.test.ts`
- `migrations/128_message-digest-service-indexes.mjs`
- `migrations/__tests__/128-message-digest-service-indexes.test.ts`
- `docs/services/message-digest-service/agent.md`
- `docs/services/message-digest-service/features.md`
- `docs/services/message-digest-service/technical.md`
- `docs/services/message-digest-service/tutorial.md`
- `docs/services/message-digest-service/technical-debt.md`
- `docs/runbooks/whatsapp-message-digests.md`

### Modify

- `packages/internal-clients/src/index.ts`
- `apps/fishing-assistant-service/src/config.ts`
- `apps/fishing-assistant-service/src/index.ts`
- `apps/fishing-assistant-service/src/services.ts`
- `apps/fishing-assistant-service/src/routes/digestsRoutes.ts`
- `apps/fishing-assistant-service/src/domain/retrieval/retrieveEvidence.ts`
- `apps/fishing-assistant-service/src/domain/usecases/sendChatMessage.ts`
- corresponding Fishing config/DI/routes/retrieval/chat tests
- Message Digest store/domain/routes/services/server and tests for migration activation/archive/query
- `apps/web/src/App.tsx`
- Fishing dashboard/navigation components/tests that link to duplicate digest pages
- `apps/web/src/pages/MessageDigestLegacyRedirectPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx`
- `apps/mobile-notifications-service/package.json`
- `apps/mobile-notifications-service/src/index.ts`
- `apps/mobile-notifications-service/src/server.ts`
- `apps/mobile-notifications-service/src/services.ts`
- `apps/mobile-notifications-service/src/routes/routes.ts`
- Mobile server/service/config/ordinary-regression tests
- `packages/llm-prompts/src/index.ts`
- `firestore-collections.json`
- `firestore.indexes.json` only through repository migration generation
- `migrations/manifest.json`
- `apps/web/service-manifest.json` and generated `apps/web/src/config.generated.ts`
- `apps/web/src/config.ts`, `apps/web/src/types/index.ts`, `apps/web/vitest.config.ts`
- `scripts/build-all-services.mjs`
- `scripts/dev-setup.mjs`
- `scripts/log-viewer.mjs`
- `scripts/verify-route-resource-names.mjs`
- `packages/service-catalog/src/internalServiceCatalog.ts`
- `ecosystem.config.cjs`
- `ecosystem.config.prod.cjs`
- `ecosystem.generated.cjs`
- `scripts/__tests__/ecosystem.config.test.ts`
- `scripts/__tests__/ecosystem.prod.config.test.ts`
- `scripts/__tests__/hetzner-runtime.test.ts`
- `scripts/__tests__/verify-web-service-manifest.test.ts`
- `scripts/hetzner/nginx/intexuraos.conf`
- `.github/workflows/deploy.yml`
- `scripts/hetzner/github-actions-deploy.sh`
- `scripts/hetzner/reload-pm2.sh`
- `scripts/hetzner/deploy-web.sh`
- `scripts/hetzner/deploy-nginx.sh`
- `tools/pubsub-ui/server.mjs`
- `tools/pubsub-ui/index.html`
- `tools/pubsub-ui/README.md`
- `scripts/pubsub-publish-test.mjs`
- `terraform/environments/dev/main.tf`
- `terraform/environments/dev/service-urls.auto.tfvars.json`
- `terraform/modules/iam/main.tf`
- `terraform/hetzner-prod/main.tf`
- `terraform/hetzner-prod/pubsub.tf`
- `terraform/hetzner-prod/scheduler.tf`
- `terraform/hetzner-prod/retained-gcp.tf` and outputs only as required by the reviewed resource graph
- infrastructure verification tests/fixtures that enumerate services/routes/topics/schedulers
- `docs/services/index.md`
- `docs/site-index.json`
- `docs/architecture/api-overview.md`
- `docs/architecture/service-communication.md`
- active Mobile Notifications, WhatsApp, Fishing Assistant, and Web service documentation
- `pnpm-lock.yaml`

### Delete

- `packages/internal-clients/src/mobile-notifications-service/**`
- `packages/llm-prompts/src/digest/**`
- every file returned by
  `rg --files apps/mobile-notifications-service/src | rg -i 'digest|backfill|group'`, after verifying
  each match is digest-only;
- `apps/web/src/components/notification-digests/**`
- `apps/web/src/hooks/useDigestList.ts`
- `apps/web/src/hooks/useDigestView.ts`
- `apps/web/src/hooks/__tests__/useDigestList.test.ts`
- `apps/web/src/hooks/__tests__/useDigestView.test.ts`
- `apps/web/src/services/notificationDigestsApi.ts`
- `apps/web/src/services/__tests__/notificationDigestsApi.test.ts`
- `apps/web/src/types/notificationDigests.ts`
- `apps/web/src/pages/NotificationDigestsPage.tsx`
- `apps/web/src/pages/NotificationDigestViewPage.tsx`
- `apps/web/src/pages/NotificationDigestBackfillPage.tsx`
- `apps/web/src/components/fishing/FishingDigestList.tsx`
- `apps/web/src/pages/fishing/FishingDigestsPage.tsx`
- `apps/web/src/pages/fishing/FishingDigestViewPage.tsx`

Deletion is performed with `apply_patch`, never recursive shell deletion. Historical docs/plans and
immutable migrations may retain factual legacy references; active code/config/docs may not.

## Sequential TDD tasks

### Task 1: Add the alias-restricted internal client and new service routes

1. Add strict client tests for definition/run query request bodies, cursor/date/term bounds, internal
   auth, timeout, malformed envelope, foreign/missing alias, hidden migration, and direct-definition
   exclusion. Observe RED.
2. Implement client types/methods and root exports with strict Zod response parsing.
3. Add new-service use-case/store/route tests proving only one active migrated alias projection is
   returned, staged runs stay hidden, active migration IDs match, cursors are bounded, and generic
   direct/group definitions are absent. Observe RED.
4. Implement internal query routes and public legacy alias resolver. The resolver returns canonical
   IDs only; it never serves legacy content directly.
5. Re-run client/service route tests and typechecks; expect GREEN.

Focused command:

```bash
pnpm exec vitest run packages/internal-clients/src/message-digest-service/__tests__/client.test.ts apps/message-digest-service/src/domain/usecases/queryLegacyMessageDigests.test.ts apps/message-digest-service/src/__tests__/internalLegacyDigestRoutes.test.ts apps/message-digest-service/src/__tests__/legacyAliasRoutes.test.ts
pnpm --filter @intexuraos/internal-clients typecheck
pnpm --filter @intexuraos/message-digest-service typecheck
```

### Task 2: Move Fishing Assistant to Message Digest and WhatsApp clients

1. Change Fishing config tests first to require Message Digest and WhatsApp URLs and reject the old
   Mobile-only configuration. Observe RED.
2. Update config/index/DI to construct `MessageDigestServiceClient` and `WhatsAppServiceClient`;
   remove `MobileNotificationsServiceClient` from the container.
3. Rewrite digest-route tests for canonical alias data, list/detail/date bounds, pagination, hidden
   migration, and missing alias. Observe RED, then implement routes.
4. Rewrite retrieval/chat tests for summary evidence via Message Digest and raw source evidence via
   WhatsApp using the exact alias source fence. Test terms, page continuation, generation conflict,
   no personal/direct leakage, and safe downstream failure. Implement one failing behavior at a time.
5. Run Fishing package coverage/typecheck. Add focused tests for uncovered business branches; do not
   reduce thresholds.

Focused commands:

```bash
pnpm --filter @intexuraos/fishing-assistant-service test -- src/__tests__/config.test.ts src/__tests__/digestsRoutes.test.ts src/__tests__/retrieval.test.ts src/__tests__/sendChatMessage.test.ts src/__tests__/chatRoutes.test.ts
pnpm --filter @intexuraos/fishing-assistant-service test:coverage
pnpm --filter @intexuraos/fishing-assistant-service typecheck
```

### Task 3: Canonicalize Fishing/legacy Web routes and delete old Web implementation

1. Add route tests for `/fishing/digests`, Fishing date/detail paths, and all old Notification digest
   paths. Assert canonical redirect/alias resolution and zero Mobile API call. Observe RED.
2. Update App/Fishing links and legacy redirect page. Ensure auth round trip preserves canonical
   target and missing aliases land on the list with an accessible notice.
3. Add a static import/navigation test that fails while any active old digest component/hook/service/
   type/page is imported. Observe RED.
4. Delete the exact old files listed above with `apply_patch`, remove their exports/imports, and keep
   genuinely generic controls only if moved into `message-digests` with new tests.
5. Run focused Web route/page/navigation tests and typecheck; expect GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/pages/__tests__/MessageDigestsPages.test.tsx src/__tests__/navigationStructure.test.ts
pnpm --filter @intexuraos/web typecheck
```

### Task 4: Remove all digest behavior from Mobile Notifications

1. Add/adjust server route tests asserting every former public/internal digest and backfill endpoint
   returns 404: `POST /internal/notifications/digest/run`,
   `POST /internal/notifications/digest/run-yesterday`, `GET /digests`,
   `GET /digests/:groupKey/:date`, `GET /digests/:groupKey/:date/state`, `POST /digests/run`,
   `POST /digests/backfill`, `GET /digests/backfill/:runId`,
   `POST /internal/notifications/digest-subscriptions/list`,
   `POST /internal/notifications/digests/query`, `POST /internal/notifications/digests/get`,
   `POST /internal/notifications/digest-state/get`, and
   `POST /internal/notifications/group-messages/query`. Webhook, notification list, filters,
   signatures, connect/status/settings remain registered. Observe RED while digest routes remain.
2. Remove digest route registration, services/repositories/notifier/subscriptions, digest env
   requirements, and digest-only package dependencies. Delete the exact digest/backfill/group files
   after confirming they are not shared notification logic.
3. Delete the old internal Mobile client after `rg` proves Fishing was its final consumer. Delete the
   old fixed prompt package and root exports after the generic prompt equivalence tests stay green.
4. Add a static audit script/test asserting no active Mobile source contains explicit feature
   identifiers such as `messageDigest`, `dailyDigest`, `digestRoutes`, `backfill`, the four legacy
   collection names, the legacy group key, `DIGEST_LLM`, or the digest Pub/Sub dependency. Do not
   scan for bare `digest`: allow only enumerated cryptographic calls such as `.digest('hex')` in
   explicitly named hashing files, and fail any other residual match. Immutable/history allowlists
   remain outside `apps/mobile-notifications-service`.
5. Run ordinary Mobile focused regression, typecheck, workspace boundaries/exports, and package
   lock update; expect GREEN and old endpoint 404.

Focused commands:

```bash
pnpm exec vitest run apps/mobile-notifications-service/src/__tests__/server.test.ts apps/mobile-notifications-service/src/__tests__/routes/webhookRoutes.test.ts apps/mobile-notifications-service/src/__tests__/routes/notificationRoutes.test.ts apps/mobile-notifications-service/src/__tests__/routes/filterRoutes.test.ts apps/mobile-notifications-service/src/__tests__/routes/connectRoutes.test.ts apps/mobile-notifications-service/src/__tests__/routes/statusRoutes.test.ts
pnpm --filter @intexuraos/mobile-notifications-service typecheck
pnpm --filter @intexuraos/llm-prompts typecheck
pnpm run verify:package-exports
```

### Task 5: Implement the hidden, silent, atomic fishing migration

1. Add pure migration tests for argument validation, protected binding inputs, exact baseline,
   Europe/Warsaw date math, 18-empty/five-missing classification, dynamic replay end, 23/25-hour
   days, sequential predecessor hashes, and privacy-safe reporting. Observe RED.
2. Implement pure planning/hash/date helpers in `fishing-group-migration.mjs` without Firestore/LLM
   side effects.
3. Add dry-run tests with synthetic repositories: unique active group, zero/multiple binding failure,
   generation mismatch, changed legacy hash, active lock/backfill/run, safe source counts, no writes,
   no LLM, no Pub/Sub. Implement dry-run.
4. Add apply tests for hidden `migrating` definition, deterministic migration/run IDs, original
   legacy documents retained only in legacy collections, exactly one `recordRole=canonical` imported
   run per eligible date through `2026-07-03`, and Private WhatsApp canonical replay for every date
   from `2026-07-04` through cutover minus one. Cover sequential replay, exact eligible count,
   continuity, `deliveryMode=silent`, no audit run leakage, no outbox/receipt, partial failure
   invisibility, and same-ID idempotent resume. Implement apply against injected ports; do not run it
   on real data.
5. Add verify tests for unique canonical run/date, complete/prefix/mixed/broken chain, candidate
   hash/count mismatch, stale generation, outbound delta, rerun equality, and public/Fishing
   canonical-only visibility. Implement verify.
6. Add activation/compensation store/CLI tests: a fresh readiness observation must be `ready`; one
   final transaction sets activation/definition/
   state/activeMigrationId, `nextRunAt` strictly after persisted cutover deadline, all history visible
   at once; crash retry is idempotent; compensation requires zero reservation/outbox/delivery and
   re-hides everything. Add erasure coverage proving the activation record is deleted or
   irreversibly deidentified with the definition. Implement.
7. Prove CLI logs/errors contain no synthetic raw message, source IDs, chat IDs, phones, prompts, or
   user IDs. Re-run the migration suite; expect GREEN.

Focused command:

```bash
pnpm exec vitest run scripts/__tests__/fishing-group-message-digest-migration.test.ts apps/message-digest-service/src/infra/firestore/firestoreLegacyDigestArchive.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/__tests__/legacyAliasRoutes.test.ts
```

### Task 6: Register Firestore ownership, indexes, and immutable migration 128

1. Add migration tests for these exact required field-sequence families, always including the opaque
   document-ID tie-breaker in the requested sort direction:
   - definitions updated/name/next sorting: `userId ASC`, optional `listStatus ASC` and/or
     `source.chatType ASC` for all four filter combinations, then respectively `updatedAt`,
     `nameSortKey`, or `nextRunAt`; generate both ASC and DESC variants;
   - non-empty prefix search uses only the `nameSortKey` family above and is therefore compatible
     with either/both equality filters; another sort with `query` is rejected by the route;
   - scheduler: lifecycle `status ASC, nextRunAt ASC, documentId ASC`;
   - runs: `userId ASC, definitionId ASC`, optional `generationStatus ASC` and/or
     `deliveryStatus ASC` for all four filter combinations, then `windowStart`; generate both ASC and
     DESC variants with matching document-ID direction;
   - outbox recovery: `status ASC, nextAttemptAt ASC, documentId ASC`;
   - delivery reconciliation: `recordRole ASC, visibilityMigrationId ASC, generationStatus ASC,
     delivery.status ASC, delivery.nextCheckAt ASC, documentId ASC`;
   - erasure quiescence for workers: `userId ASC, definitionId ASC, lease.expiresAt ASC`;
   - erasure quiescence for dispatches: `userId ASC, definitionId ASC, claim.expiresAt ASC`;
   - activation: `status ASC, createdAt ASC`;
   - a TTL field override on `message_digest_erasure_requests.expiresAt` and no TTL on nonterminal
     definition/run/state/outbox records.
   Observe RED before adding migration 128.
2. Add the strictly additive `128_message-digest-service-indexes.mjs`; never edit earlier migrations
   and do not delete/retire a legacy index in this release. Run its focused test.
3. Change ownership of the four legacy digest collections from Mobile to Message Digest and register
   all six new collections in `firestore-collections.json` with accurate retention/privacy text.
4. Generate `firestore.indexes.json` only through:
   `INTEXURAOS_GCP_PROJECT_ID=local-artifact pnpm run migrate -- --write-artifacts-only`.
5. Compute the full SHA-256 of migration 128, update `lastReservedId` to `128`, and append exactly one
   manifest row using `apply_patch`. Add the deployment preflight that aborts unless the pending
   migration list is exactly `[128]`; the durable deployment lease prevents a concurrent migrator.
   Run migration/artifact/ownership verification.

Focused commands:

```bash
pnpm exec vitest run migrations/__tests__/128-message-digest-service-indexes.test.ts
INTEXURAOS_GCP_PROJECT_ID=local-artifact pnpm run migrate -- --write-artifacts-only
pnpm run verify:migrations
pnpm run verify:firestore-artifacts
pnpm run verify:firestore
```

### Task 7: Complete local/production service wiring and infrastructure code

1. Extend service wiring/ecosystem/runtime tests first for port `8135`, package build, health/OpenAPI,
   internal URLs, Web `/api/message-digests`, API docs catalog, PM2 local/production order, and
   required secrets. Observe RED.
2. Update manifests/generated config, root build/dev/log scripts, service catalog, ecosystems, route
   verifier, and lockfile. Remove digest-only env from Mobile/Fishing; retain Mobile service URL for
   ordinary Mobile UI/API.
3. Register the run topic and local forwarder consistently in `tools/pubsub-ui/server.mjs`, its UI,
   README, and `scripts/pubsub-publish-test.mjs`. Add tests that fail if any of the four registries
   diverges. Add nginx tests/config for public `/api/message-digests`, internal scheduler/PubSub
   routes, and the cutover-scoped internal-only preparation include. Public candidate ingress must
   not be enabled by preparation.
4. Extend Terraform tests/plan fixtures for the real two-root dependency order. First,
   `terraform/environments/dev` creates the dedicated Message Digest identity, run-request topic, and
   IAM. Then `terraform/hetzner-prod` creates the push subscription/DLQ and five-minute scheduler and
   removes only the legacy digest scheduler. Observe RED for wrong root ownership or ordering.
5. Implement that resource graph without applying it. The runbook generates/reviews each forward
   plan against current state. Only after both forward applies may it generate inverse plans from the
   previous immutable release's Terraform configuration against the now-forward-applied state;
   rollback applies the production root first and the dev root second. Never rely on a stale
   precomputed binary inverse plan.
6. Add cutover-orchestrator RED tests for an immutable tested-tree attestation before any mutation.
   The sole commit body carries `Tested-Tree: <tree-hash>`; the workflow resolves the associated
   merged PR head and rejects a merge/release whose head tree, trailer, or deployed merge tree does
   not match. Derive `migrationId` deterministically from the merge SHA. Compute replay/index
   duration estimates before mutation, start the cutover deadline from the actual workflow/cutover
   start, reserve at least 180 minutes of workflow timeout with rollback margin, and abort if the
   estimate does not fit.
7. Add durable orchestration tests for one deployment lease plus monotonic step checkpoints stored
   outside the ephemeral runner. They survive SSH/runner loss, block later push deploys, and let a
   rerun of the same workflow attempt/migration ID resume the exact incomplete step. Prove the exact
   pending migration list is `[128]` before mutation.
8. Add candidate-stack tests requiring Message Digest, WhatsApp, Fishing, and Mobile services to run
   together on alternate loopback ports with candidate internal URLs, plus the candidate Web static
   build. Direct-origin tests cover their health/contracts, old Mobile ordinary routes, hidden
   migration, Fishing queries, public Web assets, scheduler no-op, Pub/Sub rejection, and zero
   outbound effects before any public switch.
9. Add rollback/admission tests. Preserve the prior immutable release. Before public admission, any
   abort first restores its release symlink/PM2/nginx, proves the old Mobile legacy endpoint works by
   direct origin, and only then applies inverse Terraform in production-root/dev-root order to
   restore the old scheduler. After public admission, compensation or history rewrite is forbidden:
   hold affected ingress fail-closed and ship a forward fix through a new reviewed commit/PR/full-CI
   cycle. Observe RED.
10. Implement `cutover-message-digests.sh` as the idempotent first-activation path invoked by
    `github-actions-deploy.sh`, including the full candidate stack, readiness recheck, durable lease,
    checkpoints/resume, release restoration, and admission boundary above. The automatic push
    deployment performs the coordinated cutover instead of first publishing a partial release.
    Later deployments use the ordinary atomic path based only on durable activation state, never a
    feature flag or caller toggle.
11. Update workflow/deploy helpers so the exact GitHub SHA is staged in an immutable release
    directory, the prior immutable release remains available, affected ingress hold is bounded, and
    deployment attestation is published only after activation/public admission. Preserve normal
    behavior for unrelated future releases.
12. Run generation, focused script tests, nginx syntax/static test, Terraform format, init with
    backend disabled, validate, and reviewed plan generation against non-production fixtures. Every
    Terraform command clears `STORAGE_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, and
    `PUBSUB_EMULATOR_HOST`; local commands set
    `GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json`, while production remote
    commands use `/home/deploy/provisioner-sa-key.json`.

Focused commands:

```bash
pnpm run generate:service-wiring
pnpm exec vitest run scripts/__tests__/verify-web-service-manifest.test.ts scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts scripts/__tests__/message-digest-cutover.test.ts
pnpm run verify:service-wiring
pnpm run verify:route-resource-names
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev fmt -check
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev init -backend=false
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev validate
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/hetzner-prod fmt -check
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/hetzner-prod init -backend=false
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/hetzner-prod validate
```

### Task 8: Update active documentation and runbooks

1. Add a docs-index test/check that expects the new service and current links. Observe RED.
2. Create the five service documents from repository templates: user features, API/data/reliability
   technical detail, local tutorial, agent ownership, and honest deferred debt.
3. Update Fishing docs to new clients/source scoping, Mobile docs to notification-only ownership,
   WhatsApp docs to the source/readiness/receipt contracts, Web/service/API architecture indexes, and
   service communication diagram.
4. Write the operational runbook around verifiable commands/evidence, including dry-run/apply/verify/
   activate/pre-admission compensate, index readiness, two-root scheduler restoration, previous
   release restoration, ingress hold, direct-origin proof, readiness, zero-send proof, and privacy
   boundaries. Production Fishing evidence verification retains only counts, hashes, and opaque
   evidence-reference metadata—never source message content. It must not contain values for
   protected identifiers.
5. Run docs formatting/link/site-index verification. Remove stale active docs claims without editing
   historical plans/reviews.

Focused commands:

```bash
pnpm exec prettier --check docs/services/message-digest-service docs/services/mobile-notifications-service docs/services/fishing-assistant-service docs/services/whatsapp-service docs/runbooks/whatsapp-message-digests.md docs/services/index.md docs/site-index.json docs/architecture/api-overview.md docs/architecture/service-communication.md
pnpm run verify:workspace:tracked -- message-digest-service
```

### Task 9: Close removal/migration/infrastructure gates and reviews

1. Run the exact removal scans below. Inspect every residual match; only immutable historical
   migration/plan evidence may remain outside active service/code/docs.
2. Run focused Message Digest/Fishing/Mobile/Web/client/migration/wiring coverage and typechecks, then
   targeted lint, migration/Firestore/package/boundary/service verifiers, Terraform validation,
   Prettier for touched docs, and `git diff --check`.
3. Self-review migration atomicity, zero-send safety, ownership transfer, old endpoint absence,
   first-number delegation, source privacy, infrastructure dependency order, and docs truthfulness.
4. Give bounded diffs/artifacts to read-only reviewers for migration/rollback, architecture/security,
   and legacy-removal completeness. Reviewers do not edit. Resolve every accepted Critical/Important
   finding with a focused RED test and repeat affected gates.
5. Update active GOAL progress with safe command outcomes/counts only. Do not run real dry-run against
   production yet, full CI, commit, PR, or deployment.

Commands:

```bash
node scripts/verify-mobile-digest-removal.mjs
pnpm exec vitest run scripts/__tests__/verify-mobile-digest-removal.test.ts
rg -n 'notificationDigestsApi|useDigestList|useDigestView|NotificationDigest|notification-digests|FishingDigestList|FishingDigestsPage|FishingDigestViewPage' apps/web/src || true
rg -n 'MobileNotificationsServiceClient|mobileNotificationsClient' apps/fishing-assistant-service packages/internal-clients/src || true
pnpm --filter @intexuraos/message-digest-service test:coverage
pnpm --filter @intexuraos/fishing-assistant-service test:coverage
pnpm exec vitest run apps/mobile-notifications-service/src/__tests__ packages/internal-clients/src/message-digest-service/__tests__/client.test.ts scripts/__tests__/fishing-group-message-digest-migration.test.ts migrations/__tests__/128-message-digest-service-indexes.test.ts scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts scripts/__tests__/message-digest-cutover.test.ts
pnpm --filter @intexuraos/web test -- src/pages/__tests__/MessageDigestsPages.test.tsx src/__tests__/navigationStructure.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/fishing-assistant-service typecheck
pnpm --filter @intexuraos/mobile-notifications-service typecheck
pnpm --filter @intexuraos/internal-clients typecheck
pnpm --filter @intexuraos/web typecheck
pnpm run verify:workspace:tracked -- message-digest-service
pnpm run verify:workspace:tracked -- fishing-assistant-service
pnpm run verify:workspace:tracked -- mobile-notifications-service
pnpm run verify:workspace:tracked -- web
pnpm run verify:package-exports
pnpm run verify:boundaries
pnpm run verify:firestore
pnpm run verify:migrations
pnpm run verify:firestore-artifacts
pnpm run verify:service-wiring
pnpm run verify:route-resource-names
git diff --check
```

## Plan completion gate

This plan is complete only when Fishing uses the new clients, Mobile owns no digest code, duplicate
Web surfaces are gone, migration/activation/compensation are proven synthetically, infrastructure is
ready but unapplied, docs are current, and no Critical/Important review finding remains. Continue to
`2026-07-27-whatsapp-message-digests-verification-production.md`; do not commit or mutate production.
