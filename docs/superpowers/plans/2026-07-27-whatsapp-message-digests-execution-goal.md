# WhatsApp Message Digests — MVP-to-Production Execution Goal

- **Date:** 2026-07-27
- **Status:** Active
- **Progress:** Steps 1–9 are complete and Step 10 is active. The complete local UI/backend
  acceptance, migration/removal checks, focused gates, and repeat independent code/test/UX/security
  reviews are green with no unresolved Critical or Important finding. In coordination through
  `/tmp/codex-sync`, Meta accepted exactly one submission of the frozen
  `intexuraos_message_digest_v1` contract and the exact verifier reports `APPROVED`; no unrelated
  template mutation occurred. Fresh group and direct approved-template runs each completed, were
  physically received exactly once, and opened their canonical CTA. All owned temporary records and
  local resources were then removed. The single full CI, implementation commit, PR, deployment,
  production migration, and production acceptance have not run.
- **Branch:** `codex/whatsapp-message-digests`
- **Base at goal creation:** `origin/development@42cfca136`
- **Latest verified branch sync:** `origin/development@1ed3ee8e179294adf522236777ec45d2dfb8abeb`
- **Execution method:** Sequential primary-agent TDD delivery from detailed implementation plans,
  focused verification after each increment, independent review-only subagents before the single
  full-CI gate, then one coordinated production cutover

## Execution Contract

This file is the authoritative execution instruction for the implementing agent. It is
self-contained; implementation must not stop to create another design or planning document.

1. Work only on `codex/whatsapp-message-digests`, rebased or merged with the latest
   `origin/development` before the final verification gate. Git worktrees are forbidden.
2. Deliver a working end-to-end MVP first, then extend it incrementally on the same branch.
   Reaching the MVP gate does not complete this goal.
3. The final change is atomic from the product's perspective: the new service, source API,
   scheduler, UI, Fishing Assistant migration, legacy-data migration, and removal from Mobile
   Notifications become visible together at one public traffic switch. Inert candidate artifacts,
   ready indexes, internal-only health, hidden `migrating` records, and scheduler/topic resources that
   have no active definition are permitted only inside that coordinated cutover; they are not a
   rollout and must expose no partial public/Fishing behavior.
4. Do not add feature flags, dual-read paths, shadow modes, staged rollouts, or partial
   deployments. Migration may use an explicit `silent` delivery mode; that is a safety property
   of migration runs, not a feature flag.
5. Use test-first development for every behavior change: observe a focused RED test, implement
   the smallest GREEN change, then refactor while the focused suite stays green.
6. Minimize full CI. Do not create intermediate commits. Use workspace-local and focused tests
   during steps 1–9, complete all reviews and fixes, then run `pnpm run ci:tracked` once in step
   10. Only the exact Git tree that passed that gate may be committed. Any subsequent code change
   invalidates the gate and requires another complete run.
7. Create one final implementation commit, one PR targeting `development`, and one coordinated
   production cutover. If a PR fix is required, amend or replace that sole commit after repeating the
   affected focused gates and full-CI gate; never stack a second implementation commit. GitHub-required
   CI and production deployment verification remain mandatory.
8. Production delivery is part of the goal. The goal is not complete at local success, a green PR,
   merge, or deployment alone.
9. Existing untracked user-owned documents under `docs/superpowers/specs/` must remain excluded
   from this change unless the user separately puts them in scope.
10. Tracked files, logs, screenshots, test fixtures, PR text, and final evidence must not contain
    phone numbers, Auth0 IDs, `sourceAccountId`, private `chatId`, Matrix identifiers, raw WhatsApp
    events, or private message text.
11. The primary agent performs all planning, RED/GREEN implementation, integration, debugging,
    browser operation, migration, Git, and production work sequentially. Subagents may be invoked
    only after a bounded artifact exists, for independent architecture, code, security/privacy,
    test-completeness, migration, or UX review. They never edit or implement shared work.
12. Before changing production code for an execution phase, write a detailed implementation plan in
    `docs/superpowers/plans/` with exact files, interfaces, RED/GREEN tests, commands, dependencies,
    and acceptance gates. Execute that phase only after its plan is complete and self-reviewed.
    Planning files are part of the one final change and do not receive intermediate commits.

The completed backend-gate remediation plan is
`docs/superpowers/plans/2026-07-28-whatsapp-message-digests-backend-gate-remediation.md`. The completed
MVP Web review remediation plan is
`docs/superpowers/plans/2026-07-28-whatsapp-message-digests-mvp-web-review-remediation.md`; it freezes
the resolutions for reload-safe manual run/deletion, immutable snapshots, truthful list projection,
lifecycle-safe actions, URL-restored filters, and complete dirty-navigation protection. It is now
complete with 0 Critical/Important findings in repeat review. Local Chrome/WhatsApp MVP verification
now follows Task 9 of `docs/superpowers/plans/2026-07-27-whatsapp-message-digests-mvp-web.md`; the
production verification plan remains a later final phase after feature completion and migration.

## Goal

Deliver production-ready **Message Digests** that summarize one Private WhatsApp conversation — a
group or a direct conversation — according to a user-defined cadence and instructions, store an
auditable history, and send each completed digest through `whatsapp-service` to the first WhatsApp
number mapped to the user. Replace the current fishing-group digest without losing continuity,
move every digest responsibility out of Mobile Notifications, provide an excellent authenticated
desktop and mobile UX, and prove the complete feature in production through the real UI and real
WhatsApp delivery.

## Fixed Product Decisions

These decisions are closed and must not be reopened during implementation:

1. **One definition, one conversation.** A digest definition binds exactly one active Private
   WhatsApp account generation and one stable `chatId`. The chat may be `group` or `direct`.
2. **The phone number is not the source identifier.** Direct chats are discovered by their contact
   presentation, but persisted by `chatId`; groups have no phone number. Display names are snapshots
   only and never drive runtime matching.
3. **Multiple definitions per chat are allowed.** Each definition has its own name, instructions,
   schedule, state, history, and delivery idempotency.
4. **Delivery is implicit.** The UI never asks for a recipient. `message-digest-service` publishes
   the existing `whatsapp.message.send` event with `userId`; `whatsapp-service` resolves the first
   connected number exactly as it does today. The message is `important: true` and uses a stable
   `idempotencyKey`.
5. **Missing delivery mapping is visible, not configurable.** The UI explains that digests go to
   the primary WhatsApp number and links to `/settings/whatsapp`. A missing mapping prevents
   activation and manual delivery without exposing or accepting a number in the digest form. Create
   remains available: the request explicitly asks for `paused`, and the server also downgrades any
   stale `active` request to `paused` with `activationAdjusted=delivery_setup_required`.
6. **Private WhatsApp Mirror is the only source.** Business API `whatsapp_messages` and Android
   `mobile_notifications` are not eligible digest sources.
7. **The first production source types are equal peers.** Both group and direct conversations work
   in MVP; direct-chat support is not a follow-up.
8. **Cadence is calendar-based.** Production supports `daily`, `weekdays`, and `weekly`, each with a
   local send time and IANA time zone. Arbitrary cron expressions and sub-daily schedules are out of
   scope.
9. **Windows never overlap or leave gaps.** A run covers `[definition checkpoint, scheduled or
   manual boundary)`. One Firestore transaction per definition may reserve exactly one pending
   window. A successful or `skipped_no_activity` completion advances the checkpoint to that reserved
   boundary and clears the reservation. A manual run closes the window at its invocation time; the
   next scheduled run continues from that exact boundary. A new definition initializes its
   checkpoint at the immediately preceding cadence boundary, so its first preview/manual/scheduled
   run contains the current open calendar window rather than starting empty at creation time.
   Simultaneous manual/tick attempts serialize: the winner owns the reservation; the same request is
   idempotently returned, a different manual request receives `409 run_in_progress` with the safe run
   ID, and the scheduler defers without creating or dropping another occurrence. Failed processing
   never advances the checkpoint or clears the reservation: retry resumes the same run/window; an
   unrecoverable failure pauses the definition until that exact window is retried or the definition
   is erased. A manual boundary supersedes cadence boundaries at or before it, and `nextRunAt` moves
   to the first cadence boundary strictly after the manual boundary.
10. **No activity means no message.** A zero-message window is persisted as
    `skipped_no_activity`, advances the checkpoint, invokes no summarization LLM, and emits no
    WhatsApp delivery.
11. **The user's prompt is an instruction, not a system prompt.** It controls subject, emphasis,
    tone, and output language inside a fixed platform safety and output-schema envelope.
12. **Edits are prospective.** Name, prompt, and schedule edits create a new definition revision and
    affect only future runs. Historical runs are immutable.
13. **Run history is durable.** Generated summaries, source metadata, prompt/model versions,
    delivery state, and migration provenance remain queryable until the user deletes the definition.
14. **Deletion is real erasure.** Pausing preserves history. Deleting requires confirmation and
    removes the definition, state, runs, derived output, and any owner-scoped legacy archive attached
    through its migration alias by an idempotent definition-erasure job. Starting deletion increments
    an erasure epoch and first quiesces leased workers and claimed dispatches; every worker commit and
    dispatch claim checks that epoch/status, so erased content cannot be recreated or newly sent.
    Migration activation records are deleted or irreversibly deidentified with the definition.
    Platform-wide account deletion is a separate lifecycle goal because this repository has no
    central account-erasure coordinator today.
15. **UI language follows the existing application.** Controls and system messages use concise
    English sentence-case copy. Digest content language is determined by the selected template or
    custom instructions; there is no separate output-language control in v1.

## Explicit Non-Goals

- Sources other than Private WhatsApp Mirror.
- A digest combining multiple chats.
- Recipient selection or storage inside a digest definition.
- A user-facing LLM model selector.
- Arbitrary cron, intervals shorter than one day, email, push, or SMS delivery.
- Restoring Android Mobile Notifications as a fallback digest source.
- Removing the unrelated Mobile Notifications ingestion, list, filters, or settings product.
- Feature flags, beta cohorts, shadow generation, or dual production implementations.
- Rewriting immutable historical Firestore migration files.

## Verified Baseline

The implementation starts from these repository and production facts, verified read-only on
2026-07-27 without reading message bodies or phone numbers:

- The current digest is wholly owned by `mobile-notifications-service`: hard-coded subscription,
  notification selection, LLM aggregation, state, locks, backfill, WhatsApp notification, public
  API, and internal Fishing Assistant API.
- The only configured group is `grupa-wedkarska-skool`; the current UI also hard-codes that key.
- The old source selects `com.whatsapp` Android notifications by title prefix, silently caps input at
  1,000 rows, lacks sender identity, and computes day ranges incorrectly across DST transitions.
- The current fixed prompt is fishing-specific. It returns a headline, 3–7 bullets, threads,
  moderator posts, open questions, activity outliers, an identity ledger, moderator events, and open
  threads.
- The existing notifier publishes to `whatsapp-service` using `userId`, and `whatsapp-service`
  resolves the first mapped number. This delivery-selection behavior remains unchanged.
- Private WhatsApp Mirror contains exactly one active group matching the fishing-group display name
  and continues to ingest new activity.
- The last legacy Mobile Notification and last non-empty legacy digest for that group are dated
  `2026-07-03`.
- The initially audited repair interval is exactly `2026-07-04..2026-07-26`: 18 dates have empty
  legacy digest documents and five dates (`2026-07-13..2026-07-17`) have no digest document. Private
  WhatsApp contains source activity in the affected interval. At execution time, replay continues
  through the last fully closed Warsaw day before cutover so a later implementation date cannot
  create a new gap.
- There are 139 legacy digest documents, of which 119 are non-empty. The migration preflight must
  re-read and revalidate these counts before any write; a changed or ambiguous baseline blocks the
  cutover.
- Existing legacy documents and states are retained as audit input. They are not destructively
  rewritten or deleted during migration.

## Architecture

### Service boundaries

| Component | Responsibility after completion |
| --- | --- |
| `message-digest-service` | Own definitions, schedule calculation, due-run dispatch, run leases, source pagination, LLM orchestration, continuity state, immutable run history, migration, erasure, public API, internal consumer API, and delivery reconciliation. |
| `whatsapp-service` | Own Private WhatsApp account/chat/message data, expose a narrow digest-safe source API, keep resolving the first mapped delivery number, send CTA messages, and expose privacy-safe idempotent delivery status. |
| `web` | Own the WhatsApp → Digests navigation, create/edit/detail/history UX, preview, lifecycle actions, legacy-route redirects, and complete state handling. |
| `fishing-assistant-service` | Read the migrated fishing digest through `message-digest-service` and raw supporting evidence through the new WhatsApp digest-source client. It must never call Mobile Notifications for digest data. |
| `mobile-notifications-service` | Continue unrelated notification ingestion and browsing only. Contain zero digest routes, domain code, repositories, LLM config, scheduler hooks, notifier code, or digest dependencies. |
| `@intexuraos/llm-prompts` | Own versioned generic digest aggregate/repair prompts and the two initial instruction templates. |
| Infrastructure and service catalog | Run `message-digest-service` on reserved port `8135`, route `/api/message-digests`, register health/OpenAPI, create one due-run topic/subscription and one scheduler tick, and assign Firestore ownership. |

No service may read another service's Firestore collections directly. In particular,
`message-digest-service` obtains source messages only through `WhatsAppServiceClient`.

### Runtime flow

1. The user creates a definition from an authenticated list of their mirrored chats.
2. `message-digest-service` validates `userId → active private account generation → chatId →
   chatType` and a versioned delivery-readiness observation through `whatsapp-service` before saving.
3. A single scheduler tick queries due definitions through a bounded cursor. A Firestore transaction reserves
   `[checkpointAt, due boundary)` only when no pending window exists, advances `nextRunAt`, creates
   one deterministic run, and stores one byte-stable publishable run request. Before a manual run,
   the public prepare endpoint returns a short-lived server-authenticated token containing the exact
   checkpoint/revision/window boundary displayed in the confirmation. Confirm uses that boundary in
   the same reservation transaction or returns `RUN_PREPARATION_STALE`; both scheduled and manual
   reservation move `nextRunAt` to the first cadence boundary strictly after the reserved boundary.
4. Pub/Sub delivers the run request at least once. A renewable lease and fencing token allow one
   worker to own the run; duplicate deliveries observe the durable state and exit safely. The worker
   revalidates source generation and delivery readiness before LLM work. A mapping change after the
   pre-reservation check fails the same run safely before provider publication and retains its retryable
   window; cross-service readiness is never falsely described as one Firestore transaction.
5. The worker freezes a source high-watermark, context-change journal sequence, and encrypted
   continuation token, then pages every effective message in the window through `whatsapp-service`.
   Each page is read with a consistent chat-head snapshot and validated against the existing
   write-side context journal through that head before being returned. Relevant changes at/below the
   watermark fail the snapshot; append-only changes after it do not. The worker normalizes
   direct/group authorship and never silently truncates at 1,000.
6. If no eligible messages exist, the run becomes `skipped_no_activity`, the state checkpoint
   advances, and processing ends without LLM or delivery.
7. Larger windows are summarized in deterministic chunks, then synthesized with the definition's
   instructions, bounded continuity memory, and the three preceding summaries. Source messages are
   delimited as untrusted data.
8. A transaction fences the definition/state revisions and pending-window reservation, stores
   immutable output plus the new checkpoint, and clears that reservation. Failures retain the same
   reservation and run identity. The service, not the LLM, assigns identity, window, dates, message
   count, timestamps, and source metadata.
9. The service publishes `whatsapp.message.send` with a stable run-derived `idempotencyKey`, a short
   WhatsApp-safe digest, `important: true`, and a CTA to the exact run detail.
10. `whatsapp-service` resolves the user's first mapped number. The digest service reconciles the
    durable outbound receipt into `pending`, `sent`, `ambiguous`, or `failed`; an ambiguous external
    effect is never retried blindly. `sent` means accepted by the existing WhatsApp transport, not a
    provider delivery/read callback; the UI uses exactly that truthful label. Missing mapping,
    preferences, and other definitive pre-provider exits persist terminal `failed` receipts.

### Firestore ownership and records

`message-digest-service` owns these new collections:

#### `message_digest_definitions`

- document ID: opaque `md_*` identifier;
- `userId`, `name`, service-derived normalized `nameSortKey`, persisted
  `status: migrating|active|paused|deleting`, `revision`, and monotonic `erasureEpoch`; `migrating` is
  internal-only and all public/Fishing reads treat it as absent;
- a separate persisted `listStatus: active|paused|needs_attention` projection and safe
  `attentionCode`, refreshed by create/resume/list-page/source/run/scheduler readiness observations;
  it supports bounded filtering but never replaces the lifecycle status or authorizes work;
- `source`: `type=private_whatsapp`, private-account generation fence, `chatId`, `chatType`, and
  display-name snapshot;
- `instructions`: `templateId: fishing_group|direct_sentiment|custom`, exact text, and revision;
- `schedule`: `kind: daily|weekdays|weekly`, local time, optional weekday, IANA time zone;
- fixed `delivery.type=whatsapp_primary` with no stored recipient number;
- `checkpointAt`, `nextRunAt`, `lastRunAt`, creation/update timestamps;
- optional migration alias containing only the public legacy `groupKey`, plus an
  `activeMigrationId` set only by the final activation transaction.

#### `message_digest_runs`

- deterministic scheduled-run ID and idempotent manual/migration request ID;
- `userId`, `definitionId`, definition/instruction revisions, trigger, generation status, independent
  `processingStage`, lease/fence, attempts, and `recordRole: canonical|audit`;
- half-open source window, scheduled boundary, frozen source watermark/hash, effective message count;
- `headline`, sanitized `summaryMarkdown`, validated `evidenceMessageRefs`, and bounded
  `continuityMemoryMarkdown`;
- prompt/model versions and privacy-safe LLM usage/cost metadata;
- delivery mode/status/idempotency key and terminal timestamps;
- migration source/revision metadata, optional `visibilityMigrationId`, and safe failure code;
- no raw source messages, phone numbers, Matrix IDs, or model reasoning.

#### `message_digest_states`

- document ID equal to definition ID;
- monotonic revision, checkpoint, bounded continuity memory, preceding run ID/hash, update time;
- optional single `pendingWindow` containing run ID, trigger, half-open boundary, definition/state
  revision fences, and reservation time;
- transactionally reserved at run creation and cleared only with the run that advances the
  checkpoint.

#### `message_digest_dispatch_outbox`

- one deterministic dispatch intent per run stage, typed `run_request|whatsapp_delivery`; the manual
  or scheduled reservation creates the run-request intent and successful generation creates at most
  one WhatsApp-delivery intent for that same run;
- `pending|published|terminal` state, exact serialized payload digest/bytes, attempt metadata, expiry;
- publish timeout or unknown acknowledgement remains `pending` and republishes identical bytes until
  acknowledged; deterministic run handling absorbs duplicates;
- safe replay after a crash between Firestore commit and Pub/Sub publish. Only the downstream
  WhatsApp external effect may become terminal `ambiguous`.

#### `message_digest_erasure_requests`

- document ID equal to the caller-supplied idempotency key;
- definition owner/ID, stage, bounded cursor/counts, safe failure code, and terminal timestamp;
- identical request ID and definition resumes bounded deletion; request/definition mismatch returns
  conflict;
- completed request tombstones contain no digest/source content and expire by TTL after 30 days.

#### `message_digest_migration_activations`

- deterministic migration ID, owner/definition,
  `preparing|staging|active|rollback_pending|failed`, durable deployment lease/step/deadline,
  baseline/replay hashes and safe counts only;
- staged runs reference that ID but every public/internal query excludes them until the definition's
  `activeMigrationId` equals it and the activation record is `active`;
- one final transaction changes the activation to `active`, changes the definition from `migrating`
  to `active`, installs the verified state/checkpoint/next run, and makes the entire history visible.

Legacy `notification_daily_digests`, `notification_group_states`, digest locks, and backfill-run
collections move in `firestore-collections.json` from Mobile Notifications ownership to
`message-digest-service` as read-only migration archives. New runtime code never writes them except
to erase records belonging to a deleted migrated definition.

## Digest Instructions and Output Contract

The platform system prompt always:

- declares source messages untrusted and forbids following instructions found inside them;
- permits facts only from the current source window plus explicitly labelled historical context;
- forbids invented events, intent, diagnoses, and certainty unsupported by messages;
- requires the configured content language;
- returns strict JSON
  `{ headline, summaryMarkdown, evidenceMessageRefs, continuityMemoryMarkdown }`;
- enforces `headline <= 200`, `summaryMarkdown <= 12000`, and bounded continuity memory;
- requires names to remain as presented by the source and prohibits phone/Matrix identifiers;
- requires every `evidenceMessageRefs` entry to be an opaque reference supplied in the current
  source window; the application rejects unknown/fabricated references;
- produces an empty-fact result only for a non-empty source window that genuinely lacks textual
  information; the service handles a zero-message window without LLM invocation.

The user instruction is separately delimited and cannot override these rules.

### Fishing-group template

The migrated definition preserves the functional instructions of prompt version `4.0.0`:

```text
Write the digest in Polish. Create one concrete headline and 3–7 concise, high-signal facts from
this window. Track active topics and participants, decisions and outcomes, moderator posts, open
questions, unusual activity, participant identity/context, moderator events, and open threads.
Carry forward only information needed for continuity, keep stable topic identifiers, and remove an
open thread only when messages clearly close it. Historical state and the previous three summaries
are context only: do not present an old fact as if it happened in this window. Preserve names as
written and never invent information.
```

### Direct-sentiment template

```text
Write the digest in Polish. Summarize the other participant's expressed sentiment and how it
changed during this window. Identify concrete positive, neutral, negative, uncertain, or mixed
signals; important concerns, commitments, unresolved tension, and notable shifts. Use my messages
only as conversational context. Distinguish observation from inference, state uncertainty, and do
not diagnose mental state, personality, health, or hidden intent. Include the most important factual
conversation outcomes alongside the sentiment summary. Never invent information.
```

Custom instructions accept 20–4,000 trimmed characters. Template selection copies editable text
into the definition, so subsequent package-template changes never silently alter an existing
definition.

## Endpoint Changes

All authenticated routes are owner-only. A foreign identifier and a missing identifier return the
same `404` shape. Mutations require an idempotency key where noted and use revision-based conflict
handling.

### New `message-digest-service` public API

Paths in this table are relative to the single `/api/message-digests` public mount.

| Method and path | Contract |
| --- | --- |
| `GET /` | Cursor-paginated definitions; search, `chatType`, and status filters; bounded sortable fields. |
| `GET /delivery-readiness` | Read-only form metadata derived from the WhatsApp owner contract: `ready|mapping_missing|disconnected|delivery_disabled`, masked primary number when ready, opaque observation version, and observation time. Never returns or accepts a recipient number. |
| `POST /schedule-preview` | Validate an unsaved daily/weekdays/weekly schedule and return server `evaluatedAt`, preceding boundary, exact next boundary, and time zone using the same domain calculator as persistence. Saves and sends nothing. |
| `POST /` | Validate source, instructions, schedule, and requested `active|paused` status. Client request ID is idempotent. Missing primary mapping deterministically stores `paused` and returns `activationAdjusted=delivery_setup_required`; it never rejects or silently leaves an active schedule. |
| `GET /:definitionId` | Definition, source presentation, schedule, latest run, and safe delivery readiness. |
| `PATCH /:definitionId` | CAS update of name, instructions, schedule, or `active|paused`; before the first persisted run it may also replace `source.chatId`. Source replacement revalidates ownership/type/generation and atomically reinitializes the unopened checkpoint. Once any run exists, source replacement returns a conflict. Other edits apply prospectively. |
| `DELETE /:definitionId` | CAS/idempotent erasure request; returns terminal or trackable erasure state. |
| `GET /erasures/:erasureRequestId` | Owner-only privacy-safe deletion progress for UI recovery after reload; terminal completion contains counts only. |
| `POST /preview` | Validate unsaved form data and generate a non-persistent, non-delivered preview from the preceding cadence-sized window. |
| `POST /:definitionId/run/prepare` | Read-only preparation for the confirmation dialog. Return the exact checkpoint/window/time zone/readiness plus a short-lived authenticated token bound to definition/state revision; saves, reserves, and sends nothing. |
| `POST /:definitionId/run` | Consume the preparation token and client request ID, idempotently reserve that exact window, save the run, and deliver it. A changed checkpoint/revision returns `RUN_PREPARATION_STALE`; an empty/open duplicate request is rejected safely. |
| `POST /:definitionId/runs/:runId/retry` | Resume the same failed reserved run/window from its durable stage using its original definition/instruction snapshot; never creates a new run or advances the boundary. Client request ID is idempotent. |
| `GET /:definitionId/runs` | Cursor-paginated immutable history with status/date filters. |
| `GET /:definitionId/runs/:runId` | Full sanitized output, source metadata, model/prompt revision, and truthful delivery state. |
| `GET /legacy-runs/:groupKey/:date` | Resolve an owner-only legacy alias for old UI links and return the canonical definition/run IDs. |

Nginx and Vite expose these as `/api/message-digests/...` without routing any digest request through
Mobile Notifications.

Definition-list query names are `cursor`, `limit` (1–50, default 25), `query` (NFKC/case-folded name
prefix), `chatType=group|direct`, `status=active|paused|needs_attention`,
`sort=name|updatedAt|nextRunAt`, and `direction=asc|desc`. With no query the default is
`updatedAt desc`. A non-empty prefix query requires `sort=name` (default `name asc`), may still
combine with both filters, and rejects another sort rather than pretending to sort a Firestore range
globally. Clearing query restores the user's prior sort in Web. The stable tie-breaker is
`definitionId` in the same direction. History query names are `cursor`, `limit` (1–50,
default 25), inclusive `fromDate`/`toDate` local `YYYY-MM-DD` interpreted in the persisted definition
time zone, `generationStatus=queued|processing|completed|failed|skipped_no_activity`,
`deliveryStatus=not_sent|pending|sent|ambiguous|failed`, `sort=windowStart`, and
`direction=asc|desc`; default is `windowStart desc`, with `runId` tie-breaker in the same direction.
Every cursor is bound to the exact owner and normalized query fingerprint; changing any filter/sort
resets it and reusing it with different parameters is invalid.

### New `message-digest-service` internal API

| Method and path | Contract |
| --- | --- |
| `POST /internal/message-digests/scheduler/tick` | Reconcile pending outbox records and create deterministic runs for all due definitions. Scheduler-authenticated and idempotent. |
| `POST /internal/message-digests/pubsub/run` | Pub/Sub push handler for a run request; validates type/payload and uses a fenced renewable lease. |
| `POST /internal/message-digests/definitions/query` | Bounded definition projection for Fishing Assistant; legacy fishing aliases only. |
| `POST /internal/message-digests/runs/query` | Bounded digest evidence query by user, definition/legacy key, date range, terms, cursor. |
Public `DELETE` calls the durable definition-erasure orchestrator. Each invocation deletes a bounded
batch and persists its cursor before returning `202`; the UI repeats `DELETE` with the same request
ID until `completed`. `GET /erasures/:id` is status/reload recovery only: when it reports
`nextAction=resume_delete`, the UI resumes the same `DELETE`, rather than polling a non-progressing
GET. The first delete transaction sets `deleting`, increments `erasureEpoch`, and enters quiescing.
Erasure waits for claimed worker/dispatch leases to finish, expire, or reconcile before removing
content; lease commits and new dispatch claims reject the changed epoch. It also removes matching
owner-scoped legacy archives and the activation record (or replaces it with an unlinkable aggregate
tombstone) when a migration alias exists, and never touches source WhatsApp chats.

### New or changed `whatsapp-service` internal API

| Method and path | Contract |
| --- | --- |
| `POST /internal/whatsapp/private/digest-source/validate` | Resolve active account by user, verify optional expected generation fence plus chat ownership and `group|direct`, and return the persisted source fence, chat type, safe display snapshot, and current opaque `sourceRevision`. |
| `POST /internal/whatsapp/private/digest-source/messages/query` | First page accepts source fence, chat/type, half-open range, and limit and returns safe effective messages plus authenticated-encrypted `sourceRevision`, inclusive `highWatermark`, and cursor tokens. Tokens bind owner/generation/chat/window, initial context-journal sequence, page position, validated-through sequence, issue/expiry, and version. Every page uses one consistent Firestore transaction snapshot for chat head plus effective messages, validates the existing write-side context journal through that head, and returns no data on a relevant mutation. Append-only arrivals strictly after the watermark are ignored; a late insertion or edit/redaction/reaction/transcription affecting membership/projection at or below it returns `409 SOURCE_CHANGED`. Final page performs the same validation. Tokens use versioned AES-256-GCM with an HKDF-separated key derived from internal auth; rotation/expiry safely restarts the read. |
| `POST /internal/whatsapp/delivery-readiness/get` | Resolve the user's existing first-number mapping without accepting a number and return only `ready|mapping_missing|disconnected|delivery_disabled`, display-safe masked primary number when ready, and opaque mapping/preferences observation version/time. Create, resume, and both run triggers precheck it; the worker revalidates after reservation. A non-ready precheck prevents reservation, while a mapping change in the unavoidable cross-service gap becomes a safe terminal pre-provider run failure with no LLM/send. |
| `POST /internal/whatsapp/outbound-deliveries/get` | Resolve a digest-owned idempotency key to privacy-safe `pending|sent|ambiguous|failed|missing` metadata. The send consumer persists terminal `failed` for missing mapping, preferences, and every definitive pre-provider rejection; `missing` is allowed only before consumer reservation and times out as a digest publish/reconciliation failure. |

`packages/internal-clients/src/whatsapp-service` receives exact typed methods for all four contracts.
It normalizes legacy mirror values (`inbound|outbound`, Firestore Timestamp, and system/media
records) at the owner boundary.

### New internal client and Fishing Assistant changes

- Add `packages/internal-clients/src/message-digest-service` for definition and run queries.
- Replace `MobileNotificationsServiceClient` in Fishing Assistant routes and retrieval.
- Query digest summaries through `MessageDigestServiceClient`.
- Query supporting source messages through `WhatsAppServiceClient`, restricted to the migrated
  legacy fishing definition. Generic personal/direct definitions never become Fishing Assistant
  evidence automatically.
- Redirect the duplicate Fishing `Current Digests` UI to the canonical migrated definition history;
  keep Knowledge Base and Chat unchanged.

### Removed Mobile Notifications API

Delete these routes and their schemas/tests/clients:

- `POST /internal/notifications/digest/run`
- `POST /internal/notifications/digest/run-yesterday`
- `GET /digests`
- `GET /digests/:groupKey/:date`
- `GET /digests/:groupKey/:date/state`
- `POST /digests/run`
- `POST /digests/backfill`
- `GET /digests/backfill/:runId`
- `POST /internal/notifications/digest-subscriptions/list`
- `POST /internal/notifications/digests/query`
- `POST /internal/notifications/digests/get`
- `POST /internal/notifications/digest-state/get`
- `POST /internal/notifications/group-messages/query`

Delete the corresponding `packages/internal-clients/src/mobile-notifications-service` package
surface once all consumers are moved. Keep unrelated `/notifications` APIs intact.

## Web Product and UX

### Information architecture

Add `Message Digests` to the existing WhatsApp sidebar section, alongside Private and Conversation
Assistant. Remove `Digests` from the Mobile section.

Canonical authenticated routes:

- `/whatsapp/message-digests`
- `/whatsapp/message-digests/new`
- `/whatsapp/message-digests/:definitionId`
- `/whatsapp/message-digests/:definitionId/edit`
- `/whatsapp/message-digests/:definitionId/history`
- `/whatsapp/message-digests/:definitionId/history/:runId`

Old hash routes under `/notifications/digests` remain only as lightweight Web redirects. The list
redirects to the canonical list; an old `groupKey/date` detail resolves through the owner-only legacy
alias endpoint and redirects to the canonical run. No request is sent to Mobile Notifications.

### Visual direction

The feature must look native to IntexuraOS, not like a separate template:

- existing slate surfaces, blue primary actions, emerald success, amber setup/warning, and red
  terminal failure tokens in light and dark modes;
- existing typography, `Button`, `Card`, `Input`, `Modal`, `ErrorBanner`, sidebar, spacing, radius,
  focus, and responsive conventions;
- Lucide `MessageSquareText`, `UsersRound`, `UserRound`, `Clock`, `History`, and `Send` icons;
- full-width list, `max-w-4xl` create/edit form, and a detail layout that becomes a single column on
  narrow viewports;
- one purposeful signature element: a compact **delivery path** that explains source, cadence, and
  implicit delivery without creating a recipient control:

```text
[Fishing group · Group] → [Daily · 07:30 · Europe/Warsaw] → [Primary WhatsApp]
        Source                         Digest                    Delivery
```

Animation is limited to existing spinners, status transitions, and menu/dialog motion, with reduced
motion respected. Decorative gradients, custom typography, and unrelated dashboard metrics are out
of scope.

### List page

Header copy:

- title: `Message Digests`;
- description: `Create scheduled summaries from your private WhatsApp conversations.`;
- primary action: `New digest`;
- secondary action: `Refresh` / `Refreshing…`.

Toolbar:

- search field `Search digests`;
- status chips `All`, `Active`, `Paused`, `Needs attention`;
- conversation filter `All conversations`, `Groups`, `Direct`;
- `Clear filters`, rendered only when at least one filter is active.

Desktop table:

| Column | Required content and behavior |
| --- | --- |
| Name | Definition-name link to detail; secondary instruction-template label. |
| Conversation | Group/direct icon, display-name snapshot, explicit type. |
| Schedule | Human cadence and local time; IANA zone beneath. |
| Status | Text-and-icon badge, never color alone. |
| Last run | Local time plus generation status, or an explained em dash. |
| Next run | Exact local time, or `Paused` / `Needs WhatsApp setup` / `Source unavailable`. |
| Actions | Separate 44×44 kebab button; never nested inside the row link. |

The action menu contains `View details`, `Edit`, `Run now`, `Pause` or `Resume`, and `Delete
digest`. On mobile, the table becomes semantic cards rather than horizontal scrolling. Each card
retains every field and the independent 44×44 action menu.

List states are distinct and truthful:

- initial loading keeps the page header and renders five labelled skeleton rows;
- background refresh keeps existing data and marks the table region `aria-busy=true`;
- first use shows `No message digests yet` and `Create your first digest`;
- no Private Mirror shows `Enable Private WhatsApp Mirror` linking to WhatsApp settings;
- no primary delivery mapping keeps readable definitions but shows `WhatsApp delivery needs setup`
  and `Manage WhatsApp connection`;
- no filter match shows `No digests match these filters` and `Clear filters`;
- an initial load failure shows an error and `Retry`, never a false empty state;
- a refresh or load-more failure preserves existing rows and provides an inline `Retry`;
- cursor pagination uses `Load more` / `Loading…`, with duplicate clicks suppressed;
- stale source and missing mapping produce explicit `Source unavailable` and `Needs attention`
  states, with unsafe actions disabled and a visible reason.

### Create and edit page

Use a full page with four concise sections rather than a multi-step wizard; this is faster to scan,
keeps all consequences visible, and follows existing IntexuraOS create-page patterns.

1. **Digest details**
   - required `Digest name`, 1–80 trimmed characters, prefilled from the selected conversation and
     still editable;
   - inline character count and validation.
2. **Source conversation**
   - `Choose conversation` opens the picker;
   - the selected card shows group/direct icon, display name, safe message/participant counts, and
     last activity;
   - `Change conversation` remains available only until the first persisted run. Afterwards the UI
     says `Conversation is locked after the first run. Create a new digest to use another
     conversation.`
3. **Digest instructions**
   - required 20–4,000 character textarea with count and plain-language help;
   - `Fishing group summary`, `Sentiment and tone`, and `Custom` template actions;
   - applying a template to a non-empty prompt requires `Replace current instructions?` with `Keep
     current` and `Replace instructions`;
   - `Preview digest` runs a non-persistent and non-delivered preview, with its exact window shown.
4. **Schedule and delivery**
   - cadence `Daily`, `Weekdays`, or `Weekly`;
   - weekly day when applicable, local time, and IANA time zone;
   - computed `Next delivery` preview using the exact backend schedule calculation;
   - read-only `Primary WhatsApp` readiness card and `Manage WhatsApp connection` link;
   - no number selector, text input, or hidden digest-specific recipient setting.

Conversation picker dialog:

- labelled search `Search conversations`;
- tabs `All`, `Groups`, `Direct`;
- cursor-paginated rows with type icon, name, safe counts, and last activity;
- `unknown` type disabled with `Conversation type unavailable`;
- `Load more conversations`, `Cancel`, and `Use conversation`; the final action is disabled until a
  row is selected;
- selection, focus, scroll, and filter state survive a page fetch failure;
- an empty search result is not confused with a source-loading error.

Form actions:

- `Back to message digests`;
- `Cancel`;
- `Create digest` / `Creating…`;
- `Save changes` / `Saving…`;
- `Choose conversation` / `Change conversation`;
- the three instruction-template actions;
- `Preview digest` / `Generating preview…`, `Close preview`, and `Retry preview`;
- `Manage WhatsApp connection`.

Save is disabled for an empty/invalid name, source, instructions, schedule, time zone, or pending
request. A missing delivery mapping permits saving a paused `Needs attention` definition but cannot
activate it. Failed validation renders inline messages, a `Fix N fields before saving` alert, and
moves focus to the first invalid field. Leaving a dirty form requires `Discard unsaved changes?`
with `Keep editing` and `Discard changes`.

### Definition detail

The header contains `Back to message digests`, the name, status, conversation badge, `Edit`, `Run
now`, and an overflow menu with `Pause`/`Resume` and `Delete digest`.

The page contains:

- the delivery path;
- schedule and next-run card;
- instructions card with `Copy instructions`;
- Primary WhatsApp readiness card and settings link;
- latest-run card with independent generation and delivery states;
- five recent runs and `View full history`.

`Run now` first calls the read-only prepare endpoint. The confirmation contains its exact half-open
window, time zone, current readiness, implicit primary delivery, and the statement that the action
generates, saves, and sends the digest. Buttons are `Cancel` and `Run and send` / `Starting…`.
Confirmation submits the short-lived preparation token plus a client request ID. A stale token
refreshes the dialog instead of silently changing the shown window; idempotency ensures reload or
double-click cannot create a second logical run or delivery.

After start, the latest run polls through `Queued`, `Reading messages`, `Generating`, and delivery
states without blanking the page. `Skipped — no new messages` is a successful terminal state with
no WhatsApp send. A failed run that still owns the pending window exposes `Retry run`; it resumes the
same run, window, and snapshots. A definitive pre-send delivery failure may expose `Retry delivery`
using the same payload and idempotency key. An `ambiguous` external effect displays `Send status needs
review` and never offers blind retry.

Public definition status is `active|paused|deleting`, with `needs_attention` as a separate effective
presentation state derived from source/readiness and represented by the latest `listStatus`
projection. Public detail and each visible list page revalidate it; reservations always use a fresh
readiness check, never the projection. Run DTOs expose independent coarse
`generationStatus`, exact `processingStage=queued|reading_messages|aggregating|repairing|completed|
failed|skipped_no_activity`, and delivery status. Erasure status remains a separate reloadable DTO;
the UI never infers deletion progress from a missing definition.

Delete requires a focus-trapped confirmation explaining that derived digest history is removed but
the original WhatsApp conversation is untouched. Buttons are `Cancel` and `Delete digest` /
`Deleting…`. Successful deletion returns focus to the list heading; interrupted erasure resumes
idempotently rather than resurrecting the schedule.

### History and run detail

History filters include date range, generation status, delivery status, `Clear filters`, `Refresh`,
and `Load more`.

Desktop history table:

| Column | Required value |
| --- | --- |
| Started | Local `<time dateTime>` in the persisted zone. |
| Message window | Exact start and end. |
| Messages | Effective source count. |
| Generation | Queued, Reading, Generating, Completed, Failed, or Skipped. |
| WhatsApp | Not sent, Pending, Sent, Ambiguous, or Failed. |
| Duration | Terminal duration or em dash. |
| Action | `View result`. |

Generation and delivery are separate dimensions: generated content with failed delivery must never
look like generation failure. Mobile uses equivalent semantic cards. Active rows update in place via
polite live regions; pagination and refresh never reorder or duplicate immutable runs.

Run detail contains `Back to history`, digest name, source window, both status badges, sanitized
Markdown output, `Copy digest`, safe source counts, the definition/instruction snapshot, model and
prompt version, and a delivery timeline (`Generated → Queued for WhatsApp → Sent/Failed`). A
collapsed `Technical details` area contains only safe run/correlation identifiers.

### Complete interaction verification matrix

Every row below requires an automated component/hook/API assertion and a live Chrome check where the
surface is reachable in the production account.

| ID | Control or surface | Required proof |
| --- | --- | --- |
| NAV-01 | WhatsApp section toggle | Opens/closes by mouse and keyboard; nested route keeps it expanded. |
| NAV-02 | `Message Digests` link | Active state is correct on every nested digest route. |
| NAV-03 | Removed Mobile `Digests` link | Is absent; unrelated Mobile links and saved filters still work. |
| LIST-01 | `New digest` | Opens the canonical create route once. |
| LIST-02 | `Refresh` | Preserves rows, exposes busy state, rejects stale response regression. |
| LIST-03 | Search | Debounced/local contract is deterministic and clearable. |
| LIST-04 | Status chips | Exactly one selected state; URL/back navigation restores it. |
| LIST-05 | Conversation filter | All/group/direct results and empty states are correct. |
| LIST-06 | Sortable headers | Keyboard and pointer sorting match API order; direction is announced. |
| LIST-07 | Definition-name link | Opens the owned detail without triggering the row menu. |
| LIST-08 | Kebab menu | Focusable 44×44 target; Escape/outside click closes and returns focus. |
| LIST-09 | View/Edit/Run/Pause/Resume/Delete | Each action invokes only its declared mutation and disables while pending. |
| LIST-10 | `Clear filters` | Restores the unfiltered first page and disappears. |
| LIST-11 | `Load more` | Appends one cursor page, suppresses duplicate clicks, preserves prior rows on error. |
| LIST-12 | Empty/setup/error CTAs | Each links to the correct route or retries the correct request. |
| FORM-01 | Back/Cancel | Clean form leaves immediately; dirty form opens discard confirmation. |
| FORM-02 | Name input | Trim, bounds, count, inline error, and first-error focus work. |
| FORM-03 | Choose/change conversation | Opens the picker; locked source cannot be changed after first run. |
| PICK-01 | Search and All/Groups/Direct | Results, keyboard navigation, and empty/error distinctions are correct. |
| PICK-02 | Conversation row | Selection is unique; unknown/unowned rows cannot be selected. |
| PICK-03 | Load more | Appends without duplicate chats or lost selection. |
| PICK-04 | Cancel/Use conversation | Cancel preserves prior source; Use is disabled until selection and returns focus. |
| PROMPT-01 | Fishing template | Inserts exact approved text; non-empty prompt requires replacement confirmation. |
| PROMPT-02 | Sentiment template | Inserts exact approved text and retains safety language. |
| PROMPT-03 | Custom editor | Multiline Enter never submits; count and 20–4,000 bounds are accessible. |
| PROMPT-04 | Preview | Shows exact source window; saves and sends nothing; retry is idempotent. |
| PROMPT-05 | `Custom` template action | Keeps the editor user-controlled, never inserts hidden instructions, and preserves focus/current text. |
| PROMPT-06 | `Close preview` / `Retry preview` | Close returns focus to the opener; retry preserves form state and cannot persist or deliver. |
| SCHED-01 | Cadence | Daily/weekdays/weekly reveal only applicable controls. |
| SCHED-02 | Weekday/time/time zone | Backend and UI next-run previews match, including DST boundaries. |
| SCHED-03 | Primary WhatsApp card | Shows ready, missing, and retryable-readiness states without a recipient control. |
| SCHED-04 | Settings link | Opens `/settings/whatsapp` in the same SPA. |
| FORM-04 | Create/Save | One mutation, stable request ID, disabled pending state, conflict recovery, correct redirect. |
| FORM-05 | Discard dialog | Keep editing and discard have exact focus and state behavior. |
| DETAIL-01 | Edit | Loads the exact revision; a stale save returns a visible conflict and reload action. |
| DETAIL-02 | Run now | Confirmation shows window/delivery; double click/reload yields one run. |
| DETAIL-03 | Pause/Resume | Updates next run and status atomically; invalid readiness blocks Resume visibly. |
| DETAIL-04 | Delete | Confirmation, pending lockout, erasure, original-chat preservation, focus return. |
| DETAIL-05 | Copy instructions | Copies only visible instructions and announces success/failure. |
| DETAIL-06 | Latest-run polling | Stops only at terminal generation and delivery state; stale responses never regress. |
| DETAIL-07 | `View full history` | Opens the exact definition history, preserves owner/auth routing, and returns focus correctly on back navigation. |
| HIST-01 | Date/status filters | API request, URL restoration, clear behavior, and no-match state are exact. |
| HIST-02 | Refresh/load more | No duplicate/reordered runs; prior data survives partial failure. |
| HIST-03 | View result | Opens the exact owned run and rejects foreign/missing IDs identically. |
| RUN-01 | Copy digest | Copies rendered text, not hidden technical/source data. |
| RUN-02 | Retry delivery | Present only for definitive safe failures; same immutable payload/idempotency key. |
| RUN-03 | Technical details | Closed by default; contains no source/private identifiers. |
| RUN-04 | Retry failed run | Present only while that failed run owns the pending window; resumes the same run/window/snapshots and never creates another run. |
| LEGACY-01 | Old list/detail links | Redirect to canonical definition/run; no Mobile Notifications API call. |
| CTA-01 | WhatsApp CTA | Opens the exact production run detail and survives authentication redirect. |

### Responsive and accessibility floor

- Verify desktop at 1280×800 and 1440×900, mobile at 390×844, 200% zoom, light/dark mode,
  keyboard-only operation, and reduced motion.
- All touch actions are at least 44×44 CSS pixels.
- Desktop tables use semantic caption/header cells and explicit sort state; mobile uses semantic
  lists/cards rather than a squeezed or horizontally scrolling table.
- Long names, prompts, time zones, summary Markdown, and translated status copy wrap without page
  overflow (`min-w-0`, `break-words`, bounded code/link rendering).
- Every input has a visible label and help/error association; status is text plus icon, never color
  alone.
- Errors use `role=alert`; saves/runs/delivery transitions use polite status regions.
- Dialogs trap focus, support Escape when safe, return focus to the opener, and never close while a
  destructive mutation has an ambiguous result.
- Disabled reasons are visible text, never tooltip-only.
- Sanitized Markdown forbids raw HTML, scriptable links, layout-breaking images, and unsafe target
  behavior.

## Browser and Account Acceptance Contract

All browser verification — local, PR/pre-production inspection, production UI, CTA, and WhatsApp
Web — uses **only the system Google Chrome instance that is already running with the user's existing
profile**.

Hard rules:

1. Use `chrome:control-chrome` and its existing Chrome-extension binding. Do not use the in-app
   browser, standalone Playwright, another automation server, Computer Use as a substitute browser,
   Safari, Firefox, Chromium, headless Chrome, incognito, a new Chrome profile, or a newly launched
   Chrome process.
2. Reuse an existing tab or open a new tab inside that same running Chrome instance. Never inspect
   cookies, local storage, saved passwords, profile files, or session databases.
3. Authenticate the IntexuraOS UI through **Continue with Google** using the explicitly authorized
   account `kontakt@pbuchman.com`. Use the existing profile/session and normal Google account chooser;
   never read, copy, print, or store the password or authentication tokens.
4. Local login navigation uses `http://localhost:3000/#/login`, never `127.0.0.1`.
5. If Google or WhatsApp Web requires user interaction that the existing Chrome session cannot
   safely complete, stop and ask the user to finish that sign-in in the same Chrome. Do not switch
   browser surfaces or profiles.
6. WhatsApp receipt verification uses WhatsApp Web in the same running system Chrome. If an existing
   authenticated WhatsApp tab is present, reuse it; otherwise navigate a tab in the same Chrome and
   respect the sign-in rule above.
7. Chrome acceptance records only privacy-safe evidence: route, viewport, state labels, safe run ID,
   timestamps, console/network status, overflow/focus result, deployed SHA, and message count. It
   never captures full phone numbers, contact/group identifiers, private source text, passwords, or
   auth material in tracked artifacts or final chat output.

## Reliability, Security, and Privacy Requirements

- All public ownership derives from JWT. Never accept `userId` from a public body/query.
- Every definition/run read and mutation checks ownership. Foreign and missing opaque IDs are
  indistinguishable.
- Definitions in `migrating` state and runs whose `visibilityMigrationId` is not the definition's
  active migration ID are absent from every public and Fishing query; only the migration CLI's direct
  repository path may inspect staging data.
- Source validation fences the active Private WhatsApp account generation. A reconnect or changed
  generation pauses affected definitions as `source_unavailable`; display-name matching never
  silently rebinds them.
- Source queries page a frozen, current-visible projection. Edits, redactions, reactions, system
  records, media, and completed transcriptions have one documented effective-message semantic.
- The first source page freezes authenticated-encrypted owner/generation/chat/window tokens containing
  the inclusive high-watermark and current `whatsapp_private_context_changes` sequence. Each page
  reads chat head plus effective messages in one consistent Firestore transaction, then completely
  validates journal entries from the token's prior sequence through that head before returning data.
  An append-only event strictly after the watermark is ignored. A late insertion, edit, redaction,
  transcription, reaction, or other change affecting membership/projection at or below it returns
  `SOURCE_CHANGED` without data. Cursors carry encrypted page/validated-through state, version, and
  expiry; they are not reversible bare base64 identifiers. The orchestrator discards all pages and
  restarts once; repeated relevant change fails explicitly rather than mixing revisions.
- Complete source pagination or explicit `source_too_large` is required. No silent row, character,
  or token truncation is allowed.
- Calendar boundaries use an IANA-zone library, not fixed millisecond addition. Tests include normal
  winter/summer time and 23-/25-hour Warsaw days.
- Scheduled/manual occurrence creation, the single pending-window reservation, checkpoint advance,
  and state update use Firestore transactions and revision/fence checks. Expired workers cannot
  commit, and no second window can be reserved until the first completes or is erased.
- Delivery readiness is a versioned remote observation, not part of the local Firestore transaction.
  Create/resume/reservation perform a fresh precheck and persist its opaque version; the worker checks
  again before LLM/provider work. Tests cover mapping changes before reservation and in the
  cross-service gap; both result in no provider publication.
- Pub/Sub and scheduler delivery are at-least-once. Deterministic run IDs, outbox payload hashes,
  leases, and WhatsApp idempotency prove one logical run and at most one external send.
- Persist the exact internal run-request and external outbound payload/hash before publication. An
  unacknowledged internal Pub/Sub publish stays pending and retries identical bytes; deterministic
  consumption makes duplicate publication safe. An external retry may only republish the same bytes
  for the same idempotency key, payload mismatch is terminal, and only an uncertain WhatsApp effect
  becomes `ambiguous` with no blind retry.
- Custom instructions and source text are never logged. Errors expose allowlisted codes and safe
  counts only.
- LLM output is strict, bounded, repaired at most once, sanitized before persistence/display, and
  never allowed to set application metadata.
- Usage is attributed to the owning user and component `message-digest`; model/prompt version and
  safe usage/cost are persisted on the run.
- Definition deletion is idempotent, resumable, bounded, and covers its definition, state, runs,
  dispatch records, erasure-job content, derived output, owner-scoped legacy archives, and linked
  migration activation record without deleting the WhatsApp source conversation. Its monotonic epoch
  fences worker commits/retries/dispatch; quiescing waits out already claimed uncertain effects before
  content removal. Partial failure resumes from the persisted stage/cursor with the same request ID.
- Logs, metrics, OpenAPI examples, tests, migration output, Sentry, and final evidence pass explicit
  privacy scans.

## Legacy Fishing-Group Migration

Implement one idempotent CLI owned by `message-digest-service` with `--dry-run`, `--apply`, and
privacy-safe `--verify`. It discovers the legacy owner from the unique public group key, resolves the
active Private WhatsApp account and exactly one exact-name group without logging private IDs, and
aborts on zero/multiple matches or account-generation change.

### Dry-run gate

Before any write, the report must confirm only safe metadata:

- the originally audited 139 legacy digest documents and 119 non-empty outputs remain hash-consistent;
  any later documents are counted and reported separately as post-audit additions;
- last meaningful legacy date `2026-07-03`;
- the initial 23 repair dates `2026-07-04..2026-07-26`, consisting of 18 empty documents and five
  missing dates, plus every later fully closed Warsaw date through cutover minus one day;
- no active legacy backfill and no conflicting unexpired legacy lock;
- one active account-generation match and one matching group of type `group`;
- current delivery readiness is `ready` for the owner's first mapped WhatsApp number;
- a complete digest-safe source count/watermark hash for each repair date, with no message body or
  sender emitted;
- no pre-existing conflicting migrated definition/run IDs.

### Apply semantics

1. Create the fishing definition in internal-only `migrating` state with a deterministic migration
   activation record in `staging`, the approved Polish template, schedule
   `daily at 03:00 Europe/Warsaw`, stable private account-generation/chat binding, and public legacy
   alias `grupa-wedkarska-skool`. This preserves the audited summer delivery hour while making the
   future local send time stable across DST. Until activation, public APIs and Fishing Assistant must
   return no definition/run/state from this migration.
2. Keep every byte-original legacy document only in the four transferred legacy collections. For
   each legacy calendar date at or before `2026-07-03` with a meaningful output, deterministically
   select the latest meaningful artifact and import exactly one new canonical run. Preserve date,
   generation, generated time, model, and content; mark provenance `legacy_mobile_notification`,
   `recordRole=canonical`, and leave unavailable source hashes explicit. Public/Fishing APIs never
   return an audit artifact.
3. Convert the last meaningful `2026-07-03` state and the preceding three summaries into bounded
   continuity Markdown without an LLM call. Its canonical window is
   `[2026-07-03T00:00 Europe/Warsaw, 2026-07-04T00:00 Europe/Warsaw)` and leaves the initial replay
   checkpoint at the latter instant.
4. Let `cutoverDate` be the Warsaw local calendar date containing the activation transaction and let
   `replayEndExclusive` be `cutoverDateT00:00 Europe/Warsaw`. Recompute each local date `D`
   sequentially from `2026-07-04` through `cutoverDate - 1`, using the half-open source window
   `[D at 00:00 Europe/Warsaw, D + 1 day at 00:00 Europe/Warsaw)`. The legacy date label is always
   `D`, including 23- and 25-hour DST days. The first 23 days retain the audited repair
   classification; later days close the implementation-time gap. Every migration run has
   `deliveryMode=silent`; this is enforced independently of generation number.
5. Retain each empty/missing/original artifact only in its legacy collection as owner-scoped audit.
   Every imported/replayed new-service run carries `recordRole=canonical` and the staging migration
   ID; exactly one becomes visible for a date only after activation.
6. Advance state only in chronological order and require every run's predecessor hash to equal the
   prior canonical run/state. A partial replay never activates a mixed chain.
7. After verification and a fresh delivery-readiness=`ready` recheck, one final Firestore transaction
   sets the activation record `active`, stores its
   verified chain hash, sets the definition's matching `activeMigrationId` and status `active`,
   installs the staged state with `checkpointAt=replayEndExclusive`, clears any pending window, and
   sets `nextRunAt` to the first `03:00 Europe/Warsaw` cadence boundary strictly after both the
   activation instant and the cutover's persisted `cutoverDeadline`. The first operational
   scheduled/manual run therefore starts exactly at
   `replayEndExclusive`; it cannot gap or overlap the replay even when activation occurs before or
   after 03:00. A crash before this transaction leaves all staged data invisible; a retry either
   performs this exact transaction or proves it already applied.
8. The complete replay must create zero WhatsApp send events, delivery intents, or receipts.
9. Re-running `--apply` must produce the same IDs/hashes, no duplicate canonical runs, and zero sends.
10. Keep legacy collections as read-only archive records owned by the new service during migration
    and normal operation. The definition-erasure orchestrator must delete the owner-scoped archive
    records when that migrated definition is erased. Platform-wide owner/account erasure remains the
    explicitly deferred central-lifecycle goal below.

### Migration verification

- the initial 23/23 repair dates and every post-audit closed date through cutover have canonical
  Private WhatsApp runs and one continuous predecessor chain;
- before activation, public and Fishing queries expose none of the staged definition/history; after
  activation, one read observes the complete verified chain and never a partial prefix;
- exactly one canonical run exists per imported/replayed date and every replayed run's
  application-owned message count equals the safe eligible-source count;
- all old digest artifacts remain hash-verifiable only in the owner-scoped legacy collections;
- old web links resolve to the canonical new history;
- Fishing Assistant sees the same public group alias, migrated summaries, and WhatsApp-backed raw
  evidence;
- Mobile Notifications receives zero digest calls and reads zero digest source rows;
- replay outbound delta is exactly zero;
- the first post-checkpoint scheduled run creates at most one delivery intent and external send.

## Implementation Inventory

The detailed plans may split files further, but they must preserve these responsibilities.

### Create

- `apps/message-digest-service/`
  - package/config/server/routes and OpenAPI;
  - focused domain modules for definitions, schedule calculation, preview, run orchestration,
    source collection, aggregation, delivery, erasure, and legacy migration;
  - repository/service ports and Firestore/Pub/Sub/LLM/WhatsApp adapters;
  - unit, route, repository, orchestration, migration, privacy, and composition tests;
  - dry-run/apply/verify migration CLI.
- `packages/internal-clients/src/message-digest-service/` with typed client, tests, and exports.
- `packages/llm-prompts/src/message-digest/` with aggregate/repair prompts, templates, schemas, and
  tests.
- `apps/web/src/components/message-digests/`, pages, hooks, service client, presentation helpers,
  types, and focused tests.
- `migrations/128_message-digest-service-indexes.mjs` for additive new-collection indexes only;
  immutable migrations 095, 096, and 107 remain untouched and legacy index retirement is deferred
  until a separate post-production soak change.
- `docs/services/message-digest-service/` using the repository service-documentation templates.
- Five detailed executable plans:
  - `2026-07-27-whatsapp-message-digests-mvp-backend.md`;
  - `2026-07-27-whatsapp-message-digests-mvp-web.md`;
  - `2026-07-27-whatsapp-message-digests-feature-completion.md`;
  - `2026-07-27-whatsapp-message-digests-migration-removal.md`;
  - `2026-07-27-whatsapp-message-digests-verification-production.md`.

### Modify

- `whatsapp-service`: digest-safe source and outbound-status routes, projections, ports, services,
  OpenAPI, and tests without weakening Conversation Assistant's direct-only contracts.
- `packages/internal-clients/src/whatsapp-service`: source validation/query and delivery-status
  methods plus tests.
- `fishing-assistant-service`: config, DI, routes, retrieval, evidence identities, tests, and docs.
- `web`: lazy routes, sidebar navigation, manifest/proxy wiring, old-route redirects, and navigation
  tests.
- root workspace/service wiring, generated service URLs, PM2 development and production ecosystems,
  API docs hub, nginx, deployment health checks, package-lock data, and verification tests.
- all four local Pub/Sub registries/forwarders:
  `tools/pubsub-ui/server.mjs`, `tools/pubsub-ui/index.html`, `tools/pubsub-ui/README.md`, and
  `scripts/pubsub-publish-test.mjs`.
- `firestore-collections.json`, Firestore index migration registry, retained-GCP/Hetzner Pub/Sub and
  scheduler resources, environment templates, secrets validation, and runbooks.
- `whatsapp-pubsub-client` only where required to make the existing idempotency parameter and receipt
  semantics fully typed; recipient resolution remains unchanged.

### Delete or remove from active wiring

- every digest domain, schema, use case, repository, Firestore adapter, notifier, route, helper,
  config field, dependency, and test under `mobile-notifications-service`;
- `packages/internal-clients/src/mobile-notifications-service` after its last digest consumer moves;
- the old fixed digest prompt directory after the migration template has a verified equivalent;
- old Web digest pages, hooks, services, types, hard-coded group key, backfill UI, Mobile sidebar link,
  and tests, moving only genuinely reusable generic controls to the new feature namespace;
- the old Mobile Notifications digest scheduler resource and its route ownership;
- duplicate Fishing `Current Digests` implementation after canonical redirect coverage exists.

The removal audit must prove that `apps/mobile-notifications-service` contains no digest
implementation/import/env/dependency while ordinary mobile notification ingestion, list, filters,
signatures, settings, and tests remain green.

## Verification Strategy

### Focused automated matrix

| Layer | Mandatory cases before the final CI gate |
| --- | --- |
| Schedule domain | Daily/weekdays/weekly, first run, manual boundary, pause/resume, missed tick recovery, Warsaw winter/summer, spring-forward 23-hour day, fall-back 25-hour day, invalid IANA zone. |
| Definition domain | Group/direct ownership, multiple definitions per chat, source lock after first run, revision conflicts, prospective edits, missing mapping, source-generation mismatch, pause, resume, delete/erasure. |
| WhatsApp source | Safe chat validation, group/direct message projection, complete cursor paging, effective edit/redaction/reaction/media/transcription semantics, timestamp normalization, source revision change, unowned/unknown rejection, no private fields. |
| Aggregation | Empty skip, small input, deterministic chunking, prior-three-summary ordering, custom instruction bounds, prompt injection in messages, malformed output, one repair, invented reference/name rejection, application-owned metadata. |
| Run lifecycle | Deterministic scheduled/manual/migration IDs, bounded due-definition cursor, one pending-window reservation, simultaneous manual/tick winner and loser behavior, run-prepare token/stale conflict, duplicate manual requests, manual and scheduled next-boundary advancement, failed-window retry, catch-up after recovery, lease acquire/renew/fence/expiry, readiness change before generation, delete-vs-process/retry/publish epoch fencing, crash boundaries, duplicate Pub/Sub, checkpoint transaction, failed LLM, source-too-large, immutable historical revisions. |
| Delivery | First-number delegation by `userId`, `important=true`, exact CTA, immutable payload/hash, stable idempotency, duplicate publish, missing mapping, definitive failure retry, ambiguous no-retry, receipt reconciliation. |
| Public routes | Auth, static foreign/missing 404, exact list/history search/filter/sort/cursor fingerprints, delivery readiness, schedule preview, create/content-preview/read/update/delete/run-prepare/run idempotency, history/detail, validation, conflicts, repeated-delete erasure and GET-only recovery. |
| Internal routes/clients | Internal auth, bounded scheduler cursor and Pub/Sub envelopes, local emulator topic/forwarder, identical-byte publish retry after unknown acknowledgement, WhatsApp journal-backed encrypted source cursor/readiness/status clients, Fishing query clients, timeouts, malformed downstream response, safe error mapping. |
| Migration | Frozen baseline, exact unique binding, dynamic replay end date, original legacy-only audit, unique canonical run/date, sequential state chain, silent missing-day generation, idempotent re-run, partial failure, readiness-gated activation transaction, activation-record erasure, zero outbound delta, safe output. |
| Fishing Assistant | New digest client, WhatsApp raw evidence, legacy alias only, pagination, term/date retrieval, no generic personal digest leakage, no Mobile client calls. |
| Mobile removal | Every old endpoint 404, no digest registration/dependency/env/code, ordinary webhook/list/filter/settings regression. |
| Web API/hooks | Exact routes/bodies, cursor handling, stable request IDs, stale response cancellation, optimistic rollback, polling terminal rules, error preservation, auth/user switch. |
| Web components/pages | Every interaction ID in the UX matrix, every loading/empty/error/setup state, group/direct picker, templates, preview, tables/mobile cards, dialogs, focus, keyboard, 44px targets, dark mode, 200% zoom, no overflow. |
| Wiring/infra/docs | Service port 8135, generated env URLs, PM2 order/health, nginx path, OpenAPI hub, topic/subscription/scheduler target, Firestore ownership/indexes, package exports, deployment manifest, docs and runbooks. |
| Privacy/security | Log/Sentry/OpenAPI/example/screenshot scans, no raw prompt/source/model output, no phones/private IDs, owner-only access, sanitization, definition erasure including legacy archives. |

### Focused command budget

Use the narrowest command that proves each RED/GREEN increment. The detailed plans must name exact
test files, but the expected workspace gates are:

```bash
pnpm --filter @intexuraos/message-digest-service test:coverage
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/internal-clients test
pnpm --filter @intexuraos/internal-clients typecheck
cd apps/whatsapp-service && pnpm exec vitest run src/__tests__/privateDigestSourceRoutes.test.ts src/__tests__/pubsubRoutes.test.ts
cd apps/whatsapp-service && pnpm typecheck
pnpm --filter @intexuraos/fishing-assistant-service test:coverage
pnpm --filter @intexuraos/fishing-assistant-service typecheck
pnpm --filter @intexuraos/web test -- src/pages/__tests__/MessageDigestsPages.test.tsx src/hooks/__tests__/useMessageDigests.test.ts
pnpm --filter @intexuraos/web typecheck
pnpm run verify:workspace:tracked -- message-digest-service
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- fishing-assistant-service
pnpm run verify:workspace:tracked -- web
pnpm run verify:package-exports
pnpm exec vitest run scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts
git diff --check
```

The detailed plans may add narrower explicit test paths as files are decomposed. Do not run a full
workspace suite merely to discover a focused failure.

### Single full-CI gate

After all implementation, focused tests, local Chrome/WhatsApp acceptance, and independent reviews
are complete and every accepted finding is fixed:

```bash
branch_slug="$(git branch --show-current | sed 's#/#-#g')"
pnpm run ci:tracked 2>&1 | tee "/tmp/ci-output-${branch_slug}-$(date +%Y%m%d-%H%M%S).txt"
```

This is the one planned local full-CI execution. If it fails, analyze the complete captured output,
fix every failure, rerun the focused tests for each fix, and then rerun the complete gate. No commit
is allowed until it passes. After it passes, do not format, regenerate, or edit the tree before the
single commit.

## Chrome and Real WhatsApp Acceptance

### Local MVP acceptance

Using only the already-running system Chrome and the authorized Google account:

Local Message Digest records/outboxes use an isolated Firestore/Pub/Sub emulator namespace until
migration 128 is applied at coordinated cutover. The separately running WhatsApp owner boundary uses
the already-authorized account for real source/delivery verification. This exercises real WhatsApp
without depending on unapplied production indexes or writing definition data to production.

1. Start the required local services and open `http://localhost:3000/#/login` in that Chrome.
2. Sign in through Google as `kontakt@pbuchman.com` if the existing session is not already active.
3. At desktop 1280×800, enter WhatsApp → Message Digests, create a temporary group definition with
   the fishing template, and create a temporary direct definition with the sentiment template.
4. Exercise create, edit-before-first-run, preview, active daily schedule, list, detail, basic history,
   and exact run detail. Verify zero console errors, failed network requests, accidental duplicate
   calls, or unsafe visible identifiers.
5. Use `Run and send` for both temporary definitions. Observe queued/generating/delivery recovery in
   Web, including one page reload during an active run.
6. In WhatsApp Web in the same Chrome, verify exactly one new group digest and one new direct
   sentiment digest arrived through IntexuraOS after their recorded start times. Open each CTA and
   confirm the exact local canonical run route and content correspondence.
7. Double-click the same confirmation and reload the in-flight manual request; verify no duplicate
   logical run or WhatsApp message appears. Exact client-request replay and duplicate scheduler tick
   are verified by authenticated automated integration tests, never by calling internal routes from
   Chrome.
8. At mobile 390×844, repeat the MVP list/detail/history/CTA path and verify keyboard reachability,
   visible focus, 44px targets, and no horizontal overflow.
9. Delete both temporary definitions through the MVP UI, wait for terminal erasure, and verify their
   definitions, runs, state, dispatch, and erasure content disappear while source chats remain
   untouched. Do not run the real legacy migration apply locally.
10. Record privacy-safe evidence only. Cleanup is mandatory even for emulated digest records because
    real delivery receipts may exist in the authorized WhatsApp data plane.

### Final local acceptance before CI

After feature completion and before the full-CI gate, still using only that same Chrome/profile:

1. Create fresh non-delivered temporary group and direct definitions and exercise weekdays/weekly
   cadence, prospective edit, source lock, pause/resume, filters, sorting, pagination, delete
   confirmation, complete history/run-detail states, and legacy redirect handling.
2. Exercise all loading, empty, setup, validation, conflict, stale, missing mapping, source-unavailable,
   source-too-large, failed, ambiguous-delivery, and erasure-progress states through safe local
   fixtures or controlled responses rendered in the real application shell.
3. Run every interaction ID not covered by the MVP gate at desktop 1280×800 and mobile 390×844;
   verify keyboard order, focus restoration, dialogs, dark mode, reduced motion, 200% zoom, long text,
   desktop table, mobile cards, and no horizontal overflow.
4. Verify zero unexpected console errors, failed network requests, accidental duplicate calls, unsafe
   identifiers, or retained temporary definition data; real source chats remain untouched.

### Production acceptance on the deployed revision

After the single coordinated cutover:

1. Public `/deployment.json` and direct-origin health must report the exact merged SHA whose Git tree
   equals the locally tested/committed tree; required GitHub checks must pass on the protected merge
   result.
2. The new service health/OpenAPI, nginx route, scheduler, Pub/Sub topic/subscription, Firestore
   indexes, and PM2 process must all be ready on that merged revision.
3. Review the cutover's legacy migration dry-run/apply/verify evidence and re-run the read-only
   `--verify` if needed. Confirm continuous replay through the last closed Warsaw day, zero replay
   sends, and the active canonical fishing definition; never repeat `--apply` with a new request ID.
4. In the already-running system Chrome, sign into `https://intexuraos.cloud` through Google account
   `kontakt@pbuchman.com` if needed. Repeat the critical desktop and mobile UX matrix without using
   any other browser/profile.
5. Open the migrated fishing definition, inspect legacy and repaired history, manually close and send
   the first post-migration source window, and verify one delivery in WhatsApp Web plus the exact CTA
   round trip. Double-click/reload the same UI confirmation must not produce a second message;
   internal tick replay remains an automated authenticated gate.
6. Through production UI, create a temporary direct digest with the sentiment template, run and send
   it, verify exactly one corresponding WhatsApp message/CTA, then delete the temporary definition.
7. Verify cadence edit, pause/resume, missing/no-activity presentation where safely reproducible,
   history pagination, reload recovery, keyboard focus, dark mode, 200% zoom, and mobile no-overflow.
8. Verify Fishing Assistant reads migrated summaries and WhatsApp-backed raw evidence without
   exposing generic direct digests. Retained verification evidence contains only safe counts, hashes,
   and opaque references, never source content.
9. Verify every removed digest endpoint returns 404 and ordinary Mobile Notifications ingestion/list
   remains healthy. Repository and production logs show zero digest reads from `mobile_notifications`.
10. Verify the migrated scheduled definition has the correct next run, one terminal delivery record,
    and no ambiguous/duplicate receipt. Capture safe run IDs, counts, states, timestamps, and SHA only.

## Sequential Execution Steps

Every step is a hard gate. Implementation is performed by the primary agent only; subagents are
review-only and appear exclusively where a completed artifact is named.

### 1. Freeze detailed executable plans

**Deliverable:** Five self-contained implementation plans listed in the Implementation Inventory.

**Complete when:**

- every plan begins with the required agentic-worker header, exact goal/architecture/tech stack, and
  global constraints copied from this goal;
- tasks identify exact create/modify/delete/test files, interfaces produced/consumed, dependencies,
  one-action RED/GREEN steps, focused commands, and expected failures/passes;
- MVP backend and MVP Web plans terminate in the local MVP gate before extension work begins;
- the feature-completion plan owns all step-6 cadence/lifecycle/reliability/full-UX work; the
  migration/removal and verification/production plans cover every later requirement and interaction
  ID without placeholders;
- plans explicitly prohibit implementation subagents, intermediate commits, extra full CI, feature
  flags, staged rollout, and alternate browsers;
- self-review proves coverage, type-name consistency, no `TODO`/`TBD`, and no contradiction with this
  goal;
- frozen-plan read-only reviews for backend, frontend/UX, and WhatsApp migration/cutover each report
  `READY` with no unresolved Critical or Important finding;
- documentation formatting and `git diff --check` pass.

### 2. Implement the Private WhatsApp digest-source boundary

**Deliverable:** Safe group/direct source validation and complete message paging in
`whatsapp-service`, exposed through typed internal clients.

**Complete when:**

- owner/generation/chat/type validation and the safe message projection are implemented without
  changing Conversation Assistant's direct-only behavior;
- current-visible edit/redaction/reaction/media/transcription semantics are explicit;
- paging, source fences, legacy value normalization, privacy, invalid ownership, and DST-window tests
  pass from observed RED to GREEN;
- no new service reads WhatsApp Firestore directly;
- focused WhatsApp/internal-client tests, typechecks, lint, workspace validation, and review pass.

### 3. Implement the minimal Message Digest backend

**Deliverable:** A locally runnable `message-digest-service` with definition create/read/delete,
daily schedule, preview, manual/scheduled run, immutable result/state, bounded erasure, and primary
WhatsApp delivery.

**Complete when:**

- scaffold, config, DI, health/OpenAPI, domain contracts, Firestore repositories, LLM prompts, and
  typed public/internal routes exist;
- group and direct definitions validate and persist; multiple definitions per chat work;
- daily window/checkpoint, empty skip, chunked aggregation, one repair, prompt safety, and
  application-owned metadata work;
- manual and scheduled requests share one transactional pending-window reservation, use
  leases/outbox/idempotency and truthful delivery reconciliation, and definition deletion completes
  bounded cleanup needed by MVP acceptance;
- focused domain/route/repository/composition/coverage/typecheck/lint/workspace tests pass;
- an independent backend/security review has no unresolved Critical or Important finding.

### 4. Implement the minimal Message Digests Web experience

**Deliverable:** WhatsApp navigation, list, create, source picker, instructions, daily schedule,
definition detail, run-now flow, latest result, basic history, and confirmed deletion for group and
direct sources.

**Complete when:**

- canonical routes, lazy loading, API/types/hooks, delivery path, core pages, delete/progress cleanup,
  and Mobile-nav removal exist;
- both templates and custom instructions work; recipient is read-only and first-number based;
- primary loading/empty/error/setup/erasure states and responsive desktop/mobile presentation are
  covered;
- MVP interaction rows NAV-01..03, LIST-01..08, LIST-10..12, FORM-01..04, PICK-01..04,
  PROMPT-01..04, the daily portions of SCHED-01..02, SCHED-03..04, DETAIL-01..02, DETAIL-06,
  HIST-02..03, RUN-01, and CTA-01 pass focused tests; LIST-09 covers View/Edit/Run/Delete at this gate;
- focused Web test/typecheck/lint/workspace gates and an independent UX/accessibility review pass.

### 5. Pass the end-to-end MVP gate

**Deliverable:** The fastest complete vertical slice proven locally before extension work.

**Complete when:**

- one group and one direct definition can be created from real owned Private WhatsApp chats;
- preview invokes no persistence/delivery; run now persists one summary and advances checkpoint;
- empty source invokes no LLM/send;
- the existing Pub/Sub route delegates to the first mapped number with one idempotent send;
- list/detail/history reload from persistence and CTA resolves the exact run;
- focused integration tests pass with fakes and no external dependency;
- local acceptance uses only the already-running system Chrome, Google account
  `kontakt@pbuchman.com`, and WhatsApp Web in that Chrome;
- exactly one group and one direct test digest arrive, CTA round trips pass, and temporary data is
  erased through the UI;
- MVP checkpoint evidence is recorded without a commit or full CI run.

#### Step 5 checkpoint — 2026-07-28

- The branch was fetched and fast-forwarded before acceptance; `HEAD`, merge-base, and
  `origin/development` all matched `1ed3ee8e179294adf522236777ec45d2dfb8abeb` with zero divergence.
- The already-running system Chrome and its existing Google profile were used throughout. Group and
  direct definitions both completed one canonical manual run with persisted `Completed` generation
  and truthful `Sent` transport acceptance; history contained one row per definition and no duplicate
  logical request.
- Local Pub/Sub forwarding was corrected test-first so the isolated Message Digest emulator project
  owns run processing while WhatsApp send forwarding listens in both the shared and isolated local
  projects. The focused routing contracts pass and the normal group flow then completed without
  manual recovery.
- At 390×844 the list used cards rather than the desktop table; list, create, picker, detail,
  confirmation, history, and run routes had no document-level horizontal overflow. All feature-owned
  interactive targets were at least 44px, long text wrapped, dialogs remained inside the viewport,
  and the action menu restored focus after Escape. A live focus-return defect in the Run confirmation
  dialog was reproduced in Chrome, covered by a RED test, fixed, and reverified in Chrome.
- Exactly one fresh group digest and one fresh direct digest became visible in WhatsApp after one
  neutral owner-authored message opened the business conversation window. Persisted delivery outboxes
  contained two distinct `View digest` CTA URLs matching their immutable canonical run routes; the
  group CTA was opened from WhatsApp and displayed that exact run in the same Chrome.
- All five temporary definitions created across the initial and conversation-window receipt checks
  reached terminal erasure through the UI. A final list check found none of their safe test names,
  while the original group and direct source chats were still present in the read-only picker.
- Fresh post-remediation verification: 18 focused Web tests pass, Web typecheck passes, targeted
  ESLint passes, and the earlier backend/Web tracked workspace gates remain green. No implementation
  commit or full CI run has occurred.

### 6. Extend cadence, lifecycle, reliability, and complete UX

**Deliverable:** Full production behavior beyond MVP without replacing the working vertical slice.

**Executable plan:**
`docs/superpowers/plans/2026-07-27-whatsapp-message-digests-feature-completion.md`.

**Complete when:**

- weekdays/weekly cadence, DST, missed ticks, lease renewal/recovery, source-change retry,
  source-too-large, delivery retry/ambiguity, and legacy-archive definition erasure are complete;
- prospective edit, source lock, pause/resume, delete, preview, filtering/sorting/pagination,
  complete history/run detail, legacy redirect, and every remaining interaction ID pass;
- all loading/empty/error/stale/setup states, keyboard, focus, dark mode, reduced motion, 200% zoom,
  desktop tables, mobile cards, and overflow requirements pass focused tests;
- focused coverage/typecheck/lint/workspace gates pass;
- independent code, security/privacy, test-completeness, and UX reviews return no unresolved
  Critical or Important finding.

#### Step 6 checkpoint

- Complete package gates remain green: Message Digest Service 523/523 tests with 95.04% branch
  coverage, WhatsApp Service 2564/2564 tests with 98.94% branch coverage, and Web 179 files / 1642
  tests. The boundary-package gate is 128/128; package exports, Firestore ownership, service wiring,
  and repository diff checks are green.
- The final backend remediation gate is 341/341 focused tests. It proves erasure-aware delivery
  authorization, renewable lease/fencing behavior through the full provider timeout, terminal
  revoked and retryable unavailable outcomes, response-body timeout coverage, and zero provider
  calls after authorization loss.
- The final Web remediation gate is 177/177 focused tests across command recovery, list/menu,
  list-page handlers, direct/routed detail, and responsive contracts. One persisted recovery
  envelope now globally fences every other run; only recovery of its own definition may reach the
  API, its token cannot be overwritten by a fresh preview, and deletion cannot orphan the envelope.
- Web, Message Digest Service, and WhatsApp Service typechecks plus scoped lint are green. Repeat
  read-only backend, test-completeness, and UX reviews report no unresolved Critical or Important
  finding.
- Still deliberately unclaimed: Fishing migration, removal of Mobile digest code and duplicate Web
  surfaces, real-data migration CLI execution, migration 128 finalization/application, Meta template
  creation/approval, the single full-CI gate, commit, PR, merge, deployment, and production
  Chrome/WhatsApp acceptance.

### 7. Migrate Fishing Assistant and remove digests from Mobile Notifications

**Deliverable:** All consumers use the new boundaries; Mobile Notifications has zero digest
responsibility.

**Complete when:**

- Fishing routes/retrieval/DI/config/tests use Message Digest and WhatsApp clients with legacy alias
  scoping and no personal-direct leakage;
- duplicate Fishing digest UI redirects to canonical history;
- every old public/internal Mobile digest route, dependency, config, source selector, repository,
  notifier, backfill, scheduler hook, prompt import, and test is removed;
- old Web notification-digest pages/hooks/types/services/components are deleted or correctly moved;
- old endpoints are 404 while ordinary Mobile Notification regression tests pass;
- repository audit finds no active Mobile digest implementation or consumer;
- focused Fishing/Mobile/Web/internal-client tests and review pass.

### 8. Implement and prove migration, wiring, infrastructure, and documentation

**Deliverable:** Production-cutover code and configuration, with no deployment yet.

**Complete when:**

- migration dry-run/apply/verify and all failure/idempotency/zero-send tests pass;
- dynamic replay through cutover-minus-one-day and continuous predecessor hashes are proven on
  synthetic data; real production use remains gated to step 11;
- Firestore registry/index migration 128, service catalog, generated URLs, port 8135, API docs, PM2,
  nginx/Vite proxy, Pub/Sub, five-minute scheduler, environment validation, deploy health, service
  docs, and runbook changes are complete;
- unrelated Mobile Notification infrastructure stays intact;
- Terraform formatting/validation and all focused wiring/script tests pass using the repository's
  required emulator-cleared environment;
- independent migration/architecture/privacy reviews have no unresolved Critical or Important
  finding.

### 9. Complete local acceptance and pre-CI review

**Deliverable:** Final candidate tree with complete focused evidence and no known important defect.

**Complete when:**

- every focused automated matrix row passes with fresh output;
- both local Chrome acceptance sections and real WhatsApp MVP delivery pass in the already-running
  system Chrome only;
- no production migration command, infrastructure mutation, or deployment has run;
- primary agent reviews the complete diff for scope, dead code, accidental user files, secrets,
  privacy, endpoint consistency, and documentation;
- review-only subagents independently cover architecture/code, security/privacy/migration,
  test-completeness, and UX; every accepted finding is fixed and reverified with focused tests;
- `git diff --check`, package exports, workspace ownership/boundary checks, and repository status are
  clean except explicitly excluded user-owned untracked files;
- no commit and no full CI have occurred.

#### Step 9 checkpoint — 2026-07-29

- The exact Meta template preflight reports `APPROVED`. Fresh group and direct definitions were
  created through the system-Chrome UI, previewed, run once, and each reached completed/sent.
- Both messages were physically received exactly once in the desktop WhatsApp application and both
  `View digest` actions resolved to their exact canonical run routes. Persisted excerpts were 876
  code points; the hydrated bodies were 981 and 983, both below Meta's 1,024 limit.
- The earlier definitively failed definition was erased without another retry. Both fresh definitions
  were then erased through the UI; exact owned definition/state/run/outbox counts are zero while the
  group and direct source chats remain selectable.
- The owned Vite process, three PM2 services, and three emulator containers are stopped; ports 3000,
  8101, 8102, 8105, 8113, 8119, and 8135 are free. `/tmp/codex-sync` records the released lease and
  idle shared Chrome.
- A review-only security pass found one phone-derived hint in provider-rejection diagnostics. A
  focused RED test reproduced it, the field was removed, and GREEN verification passed 217/217
  WhatsApp tests plus typecheck, scoped lint, formatting, and diff checks. Repeat review returned
  Ready with zero remaining Critical or Important findings.
- No production mutation, implementation commit, or repository-wide CI run occurred.

### 10. Run the single full-CI gate and create the final revision

**Deliverable:** One immutable implementation revision ready for GitHub.

**Complete when:**

- `pnpm run ci:tracked` passes completely with captured, freshly inspected output;
- no tracked file changes after the pass;
- the tested Git tree hash and safe verification summary are recorded;
- exactly the intended files are staged; protected user-owned untracked files remain excluded;
- one commit `feat: add WhatsApp message digests` is created with body trailer
  `Tested-Tree: <full-tested-tree-hash>`;
- the branch is pushed and one ready PR targets `development` with Endpoint Changes, migration,
  privacy, focused/full test evidence, Chrome/WhatsApp evidence, removal scope, and coordinated
  cutover instructions;
- all required GitHub checks pass for the sole PR revision and protected test-merge result. Any fix
  restarts the relevant focused gates and the complete CI gate, then amends/replaces the sole commit
  and force-pushes with lease; it never adds an implementation commit.

### 11. Perform one coordinated production cutover and acceptance

**Deliverable:** The protected merged revision, with the exact locally tested Git tree, running in
production with migrated continuity and verified real UI/WhatsApp behavior.

**Complete when:**

- the ready PR is merged to `development` without bypassing protected checks; the merge/squash SHA may
  differ, but `git rev-parse <merge-sha>^{tree}` must equal the recorded tested tree hash. A mismatch
  blocks deployment and requires integration on the branch plus a fresh focused/full-CI gate;
- start the coordinated cutover immediately after the existing `01:00 UTC` legacy digest cron window.
  The workflow timeout is at least 180 minutes. Before mutation it verifies that the merged PR-head
  tree, sole-commit `Tested-Tree` trailer, merge tree, and staged release tree are identical; derives
  one migration ID deterministically from the merge SHA; acquires a durable deployment lease; and
  persists monotonic step checkpoints that survive runner/SSH failure and block later push deploys.
  A rerun of the same workflow attempt resumes the same migration ID. It records actual
  `cutoverStart` and `cutoverDeadline = min(cutoverStart + 2h, next legacy occurrence - 30m)`. A
  read-only preflight must prove pending migrations are exactly `[128]`, estimate index/replay time
  plus rollback margin before mutation, verify no legacy backfill/lock/run, stable generation/audit
  hashes, matching candidate tree, and no unrelated Terraform/deployment drift. Any failed fit or
  preflight aborts before mutation;
- prepare the exact merge revision without switching public traffic: preserve the previous immutable
  release, stage the candidate release, start candidate Message Digest, WhatsApp, Fishing, and Mobile
  services together on alternate loopback ports with candidate internal URLs, and serve the
  candidate Web static build off-path. Apply only Firestore migration 128 and poll every declared
  index until GCP reports `READY`. Prove the full candidate stack directly over loopback: health,
  authenticated owner/foreign contracts, hidden migration, Fishing, ordinary Mobile routes, Web
  assets, scheduler no-op, Pub/Sub rejection, and zero outbound side effects. Public Message Digest,
  legacy, and Fishing ingress still serves the previous release;
- clear all emulator environment variables on the production host and authenticate Terraform with
  `/home/deploy/provisioner-sa-key.json`. Apply `terraform/environments/dev` first to create the
  topic/identity/IAM, then `terraform/hetzner-prod` to create subscription/DLQ/five-minute scheduler
  and remove only the legacy scheduler. Once forward state exists, generate/review inverse plans from
  the previous immutable release's Terraform configuration against current state; never rely on a
  stale precomputed inverse binary. Before activation, no active digest definition exists and all
  candidate ticks are no-ops;
- run migration `--dry-run`, `--apply`, and `--verify` against hidden `migrating` records. Re-run the
  source-generation, legacy-hash, no-lock, zero-outbound, full-candidate, index-readiness, and
  delivery-readiness=`ready` checks immediately before activation. The workflow must finish before
  `cutoverDeadline`;
- perform one public traffic activation while a bounded maintenance hold blocks only the affected
  Message Digest, legacy digest, and Fishing digest ingress. Re-prove candidate direct-origin first,
  then execute the migration activation transaction. That transaction persists the same
  `cutoverDeadline` and guarantees `nextRunAt` is later than it, so no scheduler can reserve or send a
  run while traffic is held. Atomically switch the release symlink to that exact merge revision,
  reload PM2 and nginx, and verify direct-origin health plus owner/Fishing reads before admitting
  public traffic. Public APIs and Fishing therefore change from the complete legacy release to the
  complete activated release, never to a partial chain. For any failure before public admission,
  keep ingress held, first restore the previous release symlink/PM2/nginx and prove the old Mobile
  legacy endpoint by direct origin. If activation already occurred, compensate only after proving no
  reservation/outbox/delivery and re-hide the migration. Then apply inverse Terraform in
  `hetzner-prod` followed by `environments/dev` order, prove the legacy scheduler restored and the
  candidate scheduler absent, and only then admit the old release. Once public traffic has been
  admitted to the new release, compensation/history rewrite is forbidden: keep affected ingress
  fail-closed and deliver a forward fix through a new reviewed commit/PR/focused tests/full CI;
- direct-origin health and public `/deployment.json` prove the merge SHA and recorded tree hash;
  service, nginx, Pub/Sub, scheduler, indexes, and PM2 are ready;
- migration verification proves all repair dates through the last closed Warsaw day are canonical and
  continuous, legacy audit is preserved until the migrated definition is erased, and replay sends
  remain zero;
- only the already-running system Chrome is used, with Google account `kontakt@pbuchman.com`, for the
  complete production desktop/mobile acceptance and WhatsApp Web verification;
- one migrated group digest and one temporary direct sentiment digest each arrive exactly once at
  the user's first mapped number, and both CTAs open the exact production run;
- the temporary direct definition is deleted, the fishing definition remains active with a correct
  next run, and no source WhatsApp conversation is modified;
- Fishing Assistant works through the new clients; all old digest endpoints are absent; ordinary
  Mobile Notifications remain healthy; production logs show no legacy source read or privacy leak;
- final evidence contains only deployed SHA, PR/check/deploy references, safe run IDs, dates, counts,
  states, timestamps, CI results, migration hashes, Chrome matrix, and delivery receipt status.

## Goal Success Criterion

This goal is complete only when all 11 steps finish in order: the MVP worked before extension work,
every final feature and interaction is covered, digest responsibilities are absent from Mobile
Notifications, Fishing Assistant uses the new contracts, the legacy group is continuously migrated
from `2026-07-03` through cutover with zero replay deliveries, one final full CI gate and all GitHub
checks pass, the deployed protected merge SHA has the exact locally tested Git tree, and the
already-running system Google Chrome profile proves desktop/mobile UI plus exactly-once real group and
direct WhatsApp delivery to the user's first mapped number.

Completion is not inferred from generated content quality alone. It requires application metadata,
source hashes/counts, durable run/delivery states, production SHA, Chrome behavior, and actual
WhatsApp receipt to agree without exposing private source data.

## Final Evidence Handoff

The final report to the user must include:

- branch, final commit, PR, merge, and deployed SHA;
- production health/deployment verification;
- focused test totals, the final full-CI result, and GitHub check result;
- migration baseline/replay date/count/hash continuity and zero-send result;
- system-Chrome desktop/mobile/accessibility matrix result;
- safe group/direct run IDs and exactly-once WhatsApp/CTA result;
- Mobile removal and Fishing Assistant verification;
- any genuinely deferred non-blocking follow-up.

It must not include passwords, tokens, full email-session details beyond the explicitly authorized
account name, phone numbers, private chat/contact/group identifiers, `sourceAccountId`, `chatId`,
Matrix identifiers, source-message text, raw prompts, model reasoning, or screenshots containing
private content.

## Deferred Follow-Up Goals

The following are separate goals and do not block this delivery:

1. digest sources other than Private WhatsApp;
2. multi-chat or cross-source digests;
3. arbitrary cron or sub-daily schedules;
4. user-selectable delivery number/channel;
5. user-selectable LLM model;
6. proactive push/email delivery in addition to WhatsApp;
7. platform-wide account erasure once a central account-lifecycle coordinator exists; this goal fully
   erases every artifact owned by a deleted digest definition, including its legacy archive;
8. a standalone automated browser harness — this goal deliberately uses the user's already-running
   system Chrome as required.
