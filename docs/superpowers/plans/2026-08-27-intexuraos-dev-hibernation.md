# IntexuraOS DEV Hibernation, Production Cutover, and Reversible Resume Plan

## Status

**Proposed effective revision — execution remains paused until the user explicitly accepts the
goal referencing the exact SHA-256 of this resulting plan. The prior accepted run remains immutable
and this revision starts a new RUN_ID.**

This is an execution plan, not evidence that DEV has already been disabled. Every milestone below
is mandatory. The goal is complete only after both repositories' implementation PRs and the final
evidence PR are merged, the production release is verified, Home Dev is left in the hibernated
state, the observation window passes, and the resume drill has ended by returning Home Dev to the
hibernated state.

## Goal

Remove the redundant IntexuraOS DEV runtime overhead from `home-dev` without deleting the retained
data plane, credentials, checkout, configuration, or recovery path. Production must stop depending
on the DEV hostname, the Home Dev orchestrator must remain available for production code tasks,
the uncommitted `pbuchman-dev` work must be preserved and reconciled, and a tested runbook must be
able to restore DEV from an exact known-good revision.

## Meaning of “deployed to DEV, which does not exist”

After this plan, `dev` remains a repository/runtime configuration label and a retained recovery
profile, but it is no longer a running application environment. Deploying this change to DEV
means installing and attesting the **hibernated profile** on `home-dev` at the same reviewed
IntexuraOS revision that is deployed to production. It does not mean starting the DEV PM2 stack.

The final state is accepted only when all of the following are true:

- `https://dev.intexuraos.cloud/*` returns a deterministic, non-cacheable `503 Service
  Unavailable` response from Caddy and never proxies to an application process.
- `pm2-pbuchman.service`, `intexuraos-emulators.service`,
  `intexuraos-log-server.service`, `intexuraos-log-viewer.service`,
  `pm2-journal-bridge.service`, and `alloy.service` are disabled and inactive.
- DEV PM2 processes, the Pub/Sub emulator containers, the Pub/Sub UI container, and their ports
  are absent.
- Docker, `intexuraos-iptables.service`, `intexuraos-orchestrator@pbuchman.service`, Caddy,
  `cloudflared.service`, SentryBox, WhatsApp/Matrix, Fishing Knowledge Assistant,
  self-development intake, CI runner/health, and host monitoring remain healthy.
- The production Matrix outbound path uses a production-owned hostname and no production request
  depends on `dev.intexuraos.cloud`.
- The Home Dev orchestrator is enabled across reboot, uses production callback fallbacks with an
  explicitly reviewed observability identity, and a production-owned code-task canary completes
  all callbacks through the production API.
- The exact pre-cutover active, post-cutover active, draining, and hibernated profiles, last-good
  source revisions, required unit list, and external integration state are recorded in a tested
  resume runbook.
- A controlled resume-and-rehibernate drill succeeds and the final state is hibernated again.

## Scope and repositories

### IntexuraOS repository

- Path: `/Users/p.buchman/personal/intexuraos-2`
- Default merge target: `development`
- Planned implementation branch: `codex/intexuraos-dev-hibernation`
- Owns application configuration, production release, DEV edge generation, orchestrator runtime
  projection, agent instructions, evaluator behavior, and application documentation.

### Home Dev configuration repository

- Local authoritative checkout: `/Users/p.buchman/personal/pbuchman-dev`
- Deployed/dirty checkout: `/home/pbuchman/personal/pbuchman-dev` on `home-dev`
- Default merge target: `main`
- Planned reconciliation branch: `codex/reconcile-home-dev-dirty-20260827`
- Planned hibernation branch: `codex/home-dev-hibernation`
- Owns host service definitions, shared-host validation, hibernation/resume commands, and the
  recovery runbook.

### External systems

- `home-dev` through SSH for read-only inventory and controlled deployment.
- GitHub for PRs, checks, merges, and the production deployment workflow.
- Cloudflare for tunnel hostname and Access policy metadata.
- Retained GCP project `intexuraos-dev-pbuchman`, which serves both environment labels and must not
  be destroyed merely because its project name contains `dev`.
- External DEV-only webhook providers found during inventory, including Linear, mobile
  notifications, and SentryBox automation.

## Explicit non-goals

This plan does **not** authorize any of the following:

- deleting `terraform/environments/dev/`, the retained GCP project, Firestore data, buckets,
  Pub/Sub production resources, service accounts, Secret Manager containers or versions;
- deleting `/home/pbuchman/deploy/intexuraos`, `/var/www/intexuraos-dev`, PM2 logs, DEV secret
  projections, service-account keys, or the preserved dirty-worktree snapshot;
- stopping Docker, Caddy, Cloudflare Tunnel, Tailscale, the worker firewall, the orchestrator,
  SentryBox, WhatsApp/Matrix, FKA, self-development intake, CI runner, or Netdata;
- removing Auth0, Google, or GitHub OAuth callback allow-list entries for DEV; keeping them has no
  material runtime overhead and makes resume safer;
- renaming the retained GCP project or replacing legacy `-dev-` resource names;
- changing production API handler contracts beyond the endpoint ownership changes documented
  below;
- cleaning unrelated user changes in the current IntexuraOS working tree.

## Planning snapshot — observations to revalidate at execution time

The analysis on 2026-08-27 found the following. These values are evidence for planning only and
must be freshly captured in Milestone M0 before any mutation:

- Home Dev had 21 PM2 processes. Their RSS sum was approximately 1.48 GiB, while the
  `pm2-pbuchman.service` cgroup accounted for approximately 3.4 GiB.
- The Pub/Sub emulator sample used approximately 147 MiB and 5% CPU.
- The deployed IntexuraOS checkout used approximately 1.8 GiB, `.pm2` approximately 449 MiB, and
  the static DEV release approximately 17 MiB. These are retained for resume and are not immediate
  deletion targets.
- The last 24-hour DEV Caddy sample contained 12 requests: 11 to Matrix outbound and one static
  request. This makes the production Matrix dependency the mandatory first cutover.
- The orchestrator was active and ready with capacity 1 and zero running tasks, but its systemd
  unit was disabled. Its generated environment still identified as DEV and had DEV-oriented
  fallback URLs.
- The active shared service files and Caddy root configuration matched the clean local
  `pbuchman-dev` reference, despite the dirty deployed repository checkout.
- `/home/pbuchman/personal/pbuchman-dev` was at
  `eec3f05749783662dc23fa0e94b71240a458c51f` and contained 11 modified plus 6 untracked paths,
  including approximately 1,302 added lines in the WhatsApp/Matrix adapter work.
- The clean local `pbuchman-dev` checkout was at
  `5caeaedc2ec8b043126b277ffc0cde6b37bd1e02`, 19 commits ahead of the deployed checkout. The
  untracked media-backfill script was byte-identical to the clean local version, the nested Matrix
  test cases and nested `.gitignore` appeared already covered, and the 405-line FKA runbook had no
  local equivalent. These are preliminary classifications only; every path still requires
  content-level proof.
- The exact live hibernation candidates were enabled and active:
  `pm2-pbuchman`, `intexuraos-emulators`, `intexuraos-log-server`,
  `intexuraos-log-viewer`, `pm2-journal-bridge`, and `alloy`.
- `alloy` tailed only `/home/pbuchman/.pm2/logs/*.log`, and `pm2-journal-bridge` tailed only PM2
  logs. This ownership must still be rechecked before stopping them.
- Shared Docker workloads were SentryBox and WhatsApp/Matrix; only
  `docker-pubsub-emulator-1` and `docker-pubsub-ui-1` belonged to the DEV emulator unit.

## Evidence contract

Every execution creates a UTC run identifier `<RUN_ID>` in the form
`YYYYMMDDTHHMMSSZ-p<short-accepted-plan-sha>-b<short-base-sha>`. It is based on the accepted plan
and recorded base, because the final implementation merge SHA does not exist at M0.

A change to the accepted plan SHA always starts a new RUN_ID. Evidence from an earlier plan SHA
remains immutable; its supersession is recorded only outside that run, in the new bootstrap
manifest and private run registry. It cannot satisfy any amended gate.

The execution uses these locations:

- private evidence root on the operator machine:
  `${HOME}/.local/state/intexuraos/dev-hibernation/<RUN_ID>/`, mode `0700`;
- private preservation root on Home Dev:
  `/home/pbuchman/.local/state/intexuraos/dev-hibernation/<RUN_ID>/`, mode `0700`;
- private append-only evidence ledger populated during M0–M10:
  `${HOME}/.local/state/intexuraos/dev-hibernation/<RUN_ID>/evidence-ledger.jsonl`;
- final sanitized, tracked evidence index created after M10:
  `docs/operations/evidence/<RUN_ID>-dev-hibernation.md` in the IntexuraOS PR;
- final Home Dev state record:
  `/var/lib/intexuraos-dev/runtime-mode.env`, root-owned, mode `0644`, containing only mode,
  revision, timestamp, and evidence run ID.

Every row is validated before append against
`docs/operations/evidence/dev-hibernation-ledger.schema.json`. The tracked template is
`docs/operations/evidence/dev-hibernation-ledger.template.json`. Every row contains:

1. schema version, run ID, milestone and step ID;
2. observed-at and appended-at UTC timestamps plus actor alias;
3. target host/system;
4. `sourceRevisions`: an array of repository, ref, full 40-character commit SHA, and tree SHA;
5. `externalObjectIds`: an array of provider, object type, ID kind, and non-null ID;
6. private artifact relative path and SHA-256;
7. privacy classification;
8. PASS/FAIL and a short sanitized conclusion.

Both arrays are always present. An empty array requires a machine-validated not-applicable reason.
Abbreviated SHAs, null IDs, placeholders, or omitted keys are invalid.

Human email addresses are replaced by an actor alias or an irreversible run-keyed identifier.
User-home paths are normalized to `${OPERATOR_HOME}` and `${HOME_DEV_HOME}`. Service-account
principals may retain their technical email-shaped object IDs. The validator and the M11 privacy
scan reject human email addresses and raw `/Users/<name>` or `/home/<name>` paths in tracked
evidence.

Private command captures are mode `0600`. GUI screenshots remain private and must be cropped or
redacted so that tokens, cookies, QR codes, phone numbers, private Matrix rooms, webhook secrets,
and service-account key contents are absent. The tracked index contains only hashes, object IDs,
status, counts, timestamps, and non-secret URLs. M11 renders these rows into the tracked sanitized
index and merges that index through a separate final evidence PR. A failed check is still recorded
and blocks the milestone; evidence must never be rewritten to look successful.

## Authorization and interaction rules

- No implementation step begins until the user accepts the goal referencing this exact file.
- When any sign-in or browser-only action is needed, use Computer Use with the user's existing
  Google account and the existing signed-in Chrome session. Do not substitute a new browser
  profile, CLI login, password reset, or a different identity.
- Persistent Cloudflare configuration is managed through its authoritative infrastructure-as-code
  owner. The Cloudflare UI is used through Computer Use for authentication, read-only inventory,
  object-ID verification, and any OAuth/API-token authorization needed by that IaC workflow. Do
  not create an untracked route or Access policy directly in the dashboard.
- Immediately before a security- or access-sensitive external mutation, pause for explicit
  confirmation. This includes creating/rotating a Cloudflare credential, applying a new tunnel
  hostname or Access policy, changing webhook delivery, and sending a real Matrix canary. Group
  closely related reviewed changes into one confirmation when possible.
- Prefer an existing least-privilege Cloudflare provider credential and existing production
  service token. A new credential is allowed only when the evidence proves reuse is impossible;
  it must be scoped narrowly, stored outside Git and Terraform state, and separately confirmed.
- Terraform plans are reviewed before apply. Persistent infrastructure is never created with an
  ad-hoc CLI or an untracked dashboard save.
- Never print secret values. Equality checks use length and SHA-256/HMAC comparisons performed
  locally; evidence records only `match=true/false` and secret version/object identifiers.
- No active code task, evaluation, deploy, Matrix sync transaction, or external callback may be
  interrupted. A non-zero or unknown drain count blocks the cutover rather than forcing it.

## Milestone map

| Milestone | Outcome | Mandatory acceptance artifact |
| --- | --- | --- |
| M0 | Fresh baseline and dependency freeze | `m0-baseline/baseline-summary.json` |
| M1 | Dirty `pbuchman-dev` work preserved and reconciled | preservation commit, reconciliation matrix, clean deployed checkout |
| M2 | Four immutable reversible edge profiles implemented | two-repository PRs, profile fixtures, resume runbook |
| M3 | Cloudflare Matrix IaC is imported and ready | no-op import proof and saved reviewed change plan |
| M4 | Production no longer depends on DEV | dependency scan and exact production configuration tests |
| M5 | Agent instructions, docs, evals, and external integrations align | instruction/doc tests and paused-integration inventory |
| M6 | Both implementation PRs are merged and exact release is staged | merge SHAs and green required checks |
| M7 | Matrix, production, and Home Dev orchestrator cut over safely | edge apply, production deployment, and canaries |
| M8 | DEV is drained and hibernated | mode record, unit/container/port report, public 503 proof |
| M9 | Observation window passes with reclaimed overhead | immediate and 24-hour acceptance reports |
| M10 | Resume path is proven and final state is hibernated | resume/rehybernate drill report with measured RTO |
| M11 | Closeout and evidence PR prove every plan item is complete | merged signed evidence index and rollback readiness record |

## Milestone M0 — Fresh baseline, ownership, and freeze

### M0.1 Create the run and freeze revisions

1. Create both private evidence roots with the required modes. Capture bootstrap observations
   outside the ledger with `observedAt`, source, relative path, and SHA-256; do not initialize the
   ledger yet.
2. Record HEAD, upstream, branch, worktree status, submodules, remotes, and tree SHA for all four
   checkouts without changing branches or files.
3. Fetch without merging. For every checkout record a complete ref matrix for `origin/main` and
   `origin/development`: full SHA when present, or `present=false` with the verified reason when the
   ref does not exist.
4. Record the SHA-256 of this plan. If it changes after acceptance, show the diff, obtain renewed
   acceptance, leave the prior run byte-for-byte unchanged, record its supersession externally,
   and start a new RUN_ID.
5. Record `linearLinkStatus=pending_auto`. Do not create or update a Linear issue manually.
6. Only after steps 2–5 and the M0.1 working-tree-safety predicate pass, create the descriptive
   planned IntexuraOS branch from the frozen base without an `INT-XXX`. Add tests first, then the
   accepted plan, ledger schema, template, and validator; run the required validation and Commit
   Gate, commit and push them, obtain read-only review, and record the full commit, tree, and schema
   hashes.
7. Open the non-draft IntexuraOS implementation PR against `development` with the exact
   `$commit-push` Linear omission note. This PR is the sole automatic issue-creation trigger. Poll
   read-only for at most ten minutes. PASS requires exactly one automation-created Linear issue, or
   an idempotent relink whose provenance proves it is the same issue previously created by
   automation for this PR, and exact agreement among: the `INT-XXX` PR-title prefix, the Linear bot
   linkback, and the read-only Linear object. Capture its provider-native Linear UUID, identifier,
   team, title, and URL. Missing evidence, disagreement, or automation failure blocks M0. Never
   create or update Linear manually and never use an empty/no-op retry; only a natural
   implementation commit may trigger `synchronize`.
8. No implementation beyond the accepted plan and ledger bootstrap may proceed until step 7
   passes. Then initialize the ledger from that exact committed schema hash. The run continues to
   validate against that frozen schema; changing it for this run requires a new schema version and
   new run. Append the bootstrap observations in original `observedAt` order while recording their
   later `appendedAt` timestamps. Validate every append.

**Artifacts:** `m0-baseline/bootstrap-manifest.json`, `m0-baseline/repositories.json`, the complete
ref matrix, `m0-baseline/plan.sha256`,
`docs/operations/evidence/dev-hibernation-ledger.schema.json`,
`docs/operations/evidence/dev-hibernation-ledger.template.json`, validator test log,
`m0-baseline/ledger-validation.json`, private ledger creation record, and
`m0-baseline/linear-link.json` containing the PR number/URL/head SHA, webhook delivery metadata,
matched provider-native Linear UUID/identifier/link/title/team, and the read-only validation
result.

**Gate:** PASS only when all four working-tree states are known and no user-owned IntexuraOS
change would be overwritten by the planned branch/worktree strategy, the ref matrix is complete,
the ledger validates against the exact committed schema, and automation has created or linked and
the read-only checks have verified one genuine Linear ID before any further implementation.

### M0.2 Capture Home Dev runtime and resource ownership

1. Capture systemd `LoadState`, `UnitFileState`, `ActiveState`, `SubState`, fragment path,
   dependencies, cgroup memory, restart count, and main PID for every candidate and retained unit.
   Every named systemd property must be present in the JSON. Zero is a value, not an omission. When
   a property is genuinely inapplicable to a verified unit type, record `value=null`,
   `applicability=notApplicable`, the unit type, and a concrete reason. `unavailable` or an omitted
   field blocks M0.
2. Capture PM2 names/status/restarts/RSS without environment values; Docker names/images/ports and
   Compose project labels; listening TCP ports; and process ownership. Record the sampling method,
   duration, and tool versions so M9 uses the same method.
3. Capture filesystem usage for the checkout, static release, PM2 home, emulator data, Caddy logs,
   and private preservation location without reading secret content.
4. Hash and compare the live unit files and Caddy fragments against their repository sources.
5. Produce a structured private projection for Alloy and `pm2-journal-bridge` containing every
   live source/config fragment and hash, include chain, input selector/glob, resolved input paths,
   output destination, buffer/flush owner, and shared-input result. Preserve privacy-safe private
   copies of exact live fragments only after secret-scanning them. For a secret-bearing file,
   preserve only its normalized path, owner/mode, exact SHA-256, allow-listed field names, and a
   structured redacted projection; never duplicate its values into evidence. The ownership proof
   must remain reproducible from hashes, selectors, resolved inputs, and outputs. Narrative or a
   top-level file hash alone is insufficient.

**Artifacts:** `m0-baseline/home-dev-units.json`, `home-dev-processes.json`,
`home-dev-containers.json`, `home-dev-ports.json`, `home-dev-storage.json`, and
`live-config-hashes.json`, plus `resource-measurement-method.json` and
`m0-baseline/log-consumer-ownership.json`.

**Gate:** PASS only when every stopped and retained component has one unambiguous owner and the
stop set contains no shared workload.

### M0.3 Capture route traffic and production dependencies

1. Aggregate 7 days of Caddy access logs by host, route class, status, caller class, and hour.
   Hash identifiers; do not retain query strings, request bodies, authorization headers, IPs, or
   Matrix room/message content.
2. Probe the public and origin paths for production, DEV, Matrix outbound, `cc-home`, CI health,
   SentryBox, FKA, self-development intake, and the orchestrator.
3. Search a recorded source universe: both frozen clean repository revisions, every modified,
   staged, and untracked path in the dirty Home Dev checkout, both deployed checkouts, and every
   exact live generated Caddy/systemd/runtime projection that can contain routing or callback
   configuration. Record a source/tree/file hash for every scanned source. Every inventory row
   must end in a final disposition; `inspect-and-classify`, unknown, or an omitted dirty path blocks
   M0.
4. Inventory Cloudflare; Linear webhooks; Tasker/mobile producers; Sentry/SentryBox automation;
   Google and GitHub OAuth; Auth0/Firebase; Meta/WhatsApp; GitHub hooks, workflows and runners; and
   GCP triggers, schedulers, subscriptions, Eventarc and Cloud Tasks. Record owner, enabled state,
   callback target, authorization boundary, and a non-null stable ID using read-only access and
   Computer Use where required.

A provider-native ID is mandatory whenever the provider exposes one. For an allow-listed provider
that demonstrably has no native object ID, currently Tasker only, use `idKind=derived-canonical`
and SHA-256 of the whitespace-free UTF-8 JSON encoding of
`["tasker", accountScopeSha256, deviceScopeSha256, NFC(profileName)]`, preserving the profile name's
exact case. Record the exported configuration SHA separately and retain private evidence proving
that no native ID exists. Only the digest enters tracked evidence; raw account, device, and profile
identifiers remain private. Null, placeholder, generic name-only, or an unproved derived ID blocks
M0.

**Artifacts:** `m0-baseline/caddy-traffic-7d.json`, `route-probes.json`,
`dev-reference-inventory.csv`, `m0-baseline/dev-reference-scan-sources.json`,
`external-object-inventory.json`, and `baseline-summary.json`.

**Gate:** PASS only when Matrix is the sole accepted production runtime dependency on the DEV
host, the recorded source universe is complete, every match has a final disposition, and every
required external object has a stable non-null ID. Any additional production dependency creates a
new prerequisite cutover step and blocks M3.

### M0.4 Freeze active work and establish topology ownership

1. Use the approved Firestore investigator to count non-terminal code tasks by callback owner,
   worker location, and status, and active evaluation/session/lease state by its authoritative
   status and expiry fields. Do not read prompts, patches, messages, or user content.
2. Capture orchestrator health, capacity, running tasks, preserved containers, current
   log-forwarder activity signals, and every missing drain-observability capability.
3. Use only ListTopics/ListSubscriptions and existing bridge/runtime metadata for emulator
   inventory. Record emulator version, complete topic/subscription topology and hash, subscription
   owner/classification, live bridge image digest, reviewed-source hash if known, listener activity
   signals, and the verified absence of a native non-mutating backlog-count method.
4. The evidence collector must not invoke Pull, an additional StreamingPull probe, Ack, Nack,
   ModifyAckDeadline, Seek, snapshot mutation, emulator restart, or payload inspection. Existing
   reviewed subscriber delivery is observed, not used as a probe.
5. Freeze all new DEV-owned work, producers targeting the DEV application runtime or emulator,
   evaluations, and unplanned DEV deployments. The exact reviewed M7.0 telemetry activation is the
   sole planned DEV deployment during the cutover window. The required M7.1 production-owned
   Matrix canary and M7.3 production-owned orchestrator canary are the only new-work exceptions
   after M7.0; run them one at a time under their existing separate authorization gates. Both and
   every compliance/log tail must be terminal before the final M8 anchor. Retained production
   traffic that does not target the DEV runtime remains allowed. From the final M8 anchor through
   read 2, no work, deployment, restart, counter reset, topology mutation, producer targeting the
   DEV runtime or emulator, or evaluation is permitted.

Artifacts are the existing M0.4 artifacts plus the topology hash, bridge source/image identity,
active-state definitions, and capability-gap/remediation mapping.

**Gate:** This is an inventory and ownership gate, not the final zero-work gate. PASS requires
authoritative task/evaluation ownership counts, complete topic/subscription topology, current host
activity signals, and every measurement limitation recorded with an owner and mandatory
pre-cutover remediation milestone. Unknown ownership or topology blocks implementation. A proven
absence of a non-mutating native backlog counter is a known capability gap, not an unknown queue;
it blocks M6 and every live cutover step until M2.4 is merged, staged, and verified.

The Firestore investigator uses one frozen observation timestamp and projection-only queries. It
counts:

- `code_tasks` in `queued`, `dispatched`, or `running`, classifying callback ownership from both
  callback URLs and requiring agreement with stored `callbackState.owner`; missing callback state,
  malformed URL, base/webhook disagreement, stored/derived disagreement, or unclassified custom
  ownership is UNKNOWN, and `workerLocation` is never used to infer callback ownership;
- sessions in `active`, `waiting_for_user`, or `executing_tool`;
- test runs in lifecycle `preflight`, `running`, or `finalizing`, plus terminal runs whose
  `artifactDelivery.status` is `pending` or `staged`; malformed or any unrecognized state is
  UNKNOWN;
- all run contexts with status `active`, classifying current and expired/invalidated variants as
  specified below;
- leases in `provisioning`, `active`, `quiescing`, `release_pending`, or `abandon_pending`;
- durable Matrix-corpus ingest and terminal-control outboxes, including orphaned or recovery-needed
  records that may exist independently of a current lease.

Raw legacy `code_tasks.status=completed` is a recognized terminal compatibility state; every
current serializer mapping from it is terminal, so `agentType` is not needed for drain
classification. Any other missing, malformed, or unrecognized raw task status is UNKNOWN.

For terminal test runs, `pending` or `staged` is known NONZERO work. `ready`, `unknown`, and `failed`
are terminal-safe for Firestore drain under the frozen reviewed revision because no repository
scheduler, retry, or outbox targets `unknown` or `failed`; the separate host/process gate must
still prove no evaluator or artifact operation is in flight. Missing, malformed, or unrecognized
lifecycle/status/failure-code combinations are UNKNOWN.

For leases, every recognized non-terminal phase is known NONZERO work. If expired, classify it as
`recoveryRequired`, still NONZERO, until authoritative abandonment/cleanup reaches `abandoned`;
never relabel a known expired record UNKNOWN. `released` and `abandoned` are terminal-safe. Missing,
malformed, or unrecognized phase/expiry is UNKNOWN.

For run contexts, `active` plus unexpired plus `invalidatedAt=null` is NONZERO. `active` plus expired
or invalidated is `recoveryRequired`, still NONZERO, until authoritative finalization/cleanup.
`finalized` is terminal-safe and, per its recognized schema variant, has no `expiresAt` or
`invalidatedAt`. For an active variant, missing/malformed expiry or invalidation is UNKNOWN; any
malformed/unrecognized status or variant is UNKNOWN. Strictly validate each expiry required by a
recognized lease/context variant as RFC3339, parse it to an instant, and compare epoch time with the
frozen observation instant; lexical string comparison is forbidden and parse failure is UNKNOWN.

For sessions, `active`, `waiting_for_user`, and `executing_tool` are NONZERO. `completed`,
`unsupported`, `expired`, `cancelled`, and `superseded` are terminal-safe. Missing, malformed, or
unrecognized status is UNKNOWN.

For `matrix_corpus_ingest_outbox`, `pending` or `claimed` is NONZERO; an expired claim is
`recoveryRequired`; `published` without a terminal marker is NONZERO/recoveryRequired; valid
`published` with a terminal marker and valid `closed` are terminal-safe. For
`matrix_corpus_terminal_control_outbox`, `pending` or `claimed` is NONZERO; an expired claim is
`recoveryRequired`; valid acknowledged `published` and valid `closed` are terminal-safe. Missing,
malformed, or unrecognized combinations are UNKNOWN. Claim expiry uses the same strict RFC3339
instant comparison. These outboxes are durable scheduled work even when no matching lease remains.

The collector's field masks are normative:

- code tasks: `status`, `workerLocation`, `callbackState.owner`,
  `callbackState.callbackBaseUrl`, and `callbackState.webhookUrl`;
- sessions: `status`, `channel`, `matrixCorpusProfile.version`, `matrixCorpusProfile.kind`,
  `matrixCorpusProfile.runtimeAudience`, and `matrixCorpusProfile.executionMode`;
- test runs: `lifecycle`, `runtimeAudience`, `artifactDelivery.status`, and
  `artifactDelivery.failureCode`;
- run contexts: `status`, `runtimeAudience`, `expiresAt`, and `invalidatedAt`;
- leases: `phase`, `runtimeAudience`, and `expiresAt`.
- ingest outbox: `status`, `claim.purpose`, `claim.expiresAt`, `terminalMarker.kind`, `publishedAt`,
  `closedReason`, and `closedAt`;
- terminal-control outbox: `status`, `claim.expiresAt`, `acknowledgedAt`, `kind`, `closedReason`, and
  `closedAt`.

Callback URLs are read transiently only to normalize owner and are never emitted. Non-allow-listed
worker-location strings are replaced by a run-keyed HMAC bucket. For the small session, test-run,
context, lease, and outbox collections, use an all-document safe projection; for `code_tasks`,
project all statuses or reconcile server-side total counts against every recognized status before
querying active callback fields. Any unclassified remainder is UNKNOWN. A filtered query alone may
not be used to claim malformed/unrecognized records are absent.

It emits aggregates and unknown counts only—never document IDs, user IDs, URLs, prompts, messages,
or encrypted context. A non-zero active evaluation state cannot be attributed to DEV from the
current schema and therefore remains blocking UNKNOWN unless separate authoritative host evidence
resolves ownership. Global zero is sufficient.

## Milestone M1 — Preserve and reconcile the dirty `pbuchman-dev` checkout

No `reset --hard`, `clean`, broad checkout restore, recursive deletion, or overwrite of the
deployed dirty checkout is permitted.

### M1.1 Preserve byte-for-byte recoverability

1. Recheck the deployed checkout status and ensure it still descends from the recorded
   `eec3f057...` baseline or explain the new delta.
2. Capture `git status --porcelain=v2 -z`, all refs, the relation to `origin/main`, runtime
   references to this checkout, and a names-only inventory of ignored files. Define `<N>` as the
   complete current set of modified, staged, and untracked paths; the planning-time 11+6 count is
   not an execution assumption.
3. Create a full Git bundle of existing commits/refs, a private binary diff for tracked worktree
   changes, a separate binary index diff, a manifest of untracked paths with modes and SHA-256
   values, and an archive containing only the explicit untracked paths returned by Git. A Git
   bundle alone is never considered a backup of working-tree or untracked content.
4. Copy the preservation package to the operator evidence root and verify hashes on both hosts.
5. Restore the bundle, both diffs, and untracked archive in an isolated disposable checkout; prove
   that all `<N>` path hashes and modes match the original.
6. Run a secret-pattern scan whose report contains path and rule ID only. Do not upload the
   preservation package or its content.
7. Create a local-only recovery branch in the deployed repository,
   `codex/preserve-home-dev-<RUN_ID>`, and commit only the subset proven free of credentials and
   private data. Any flagged path remains recoverable only in the private mode-`0600` artifacts and
   must not enter a Git object. Do not push the raw preservation commit unless a second review proves
   the entire commit is publishable. Add the resulting safe recovery ref to a second bundle and
   copy/verify it off-host. If the safe subset is empty, do not create an artificial commit; record
   `safe-subset=empty` and rely on the two verified private copies.

**Artifacts:** `m1-pbuchman-preservation/status.porcelain-v2`, `repository.bundle`,
`tracked.binary.patch`, `index.binary.patch`, `untracked-manifest.json`, `untracked.tar`,
`ignored-files.names-only`, `runtime-references.txt`, `SHA256SUMS`,
`restore-rehearsal/result.json`, `secret-scan.json`, `recovery.bundle`, and the local recovery
commit SHA.

**Gate:** PASS only when the bundle/diffs/archive restore into a disposable worktree with identical
hashes for all `<N>` paths; any safe recovery commit is independently reachable; and every path
excluded from Git has two verified private copies.

### M1.2 Classify every dirty path against current `origin/main`

For each of the `<N>` freshly inventoried paths, compare:

- the deployed baseline at `eec3f057...`;
- the deployed dirty version;
- the clean local `origin/main` version;
- relevant intervening commits and tests.

Assign exactly one disposition:

- **already integrated** — content or behavior exists on `origin/main`, with commit/test proof;
- **unique and retained** — copy to a clean implementation branch and add/update tests;
- **superseded but preserved** — not merged because a newer implementation replaces it, with a
  documented semantic comparison and recovery artifact;
- **requires user decision** — conflict changes behavior or contains private material; block M1.

The classification must explicitly cover both README files, shared Caddy configuration, the two
Matrix test locations, Compose/Docker/package files, adapter server and tests, Phase 3, Phase 8,
Matrix env/gitignore/README, media backfill script, and the FKA runbook.

**Artifact:** `m1-pbuchman-preservation/reconciliation-matrix.md`, linked from the Home Dev PR.

**Gate:** PASS only when every path has content-level proof; matching names or later timestamps are
not sufficient.

### M1.3 Integrate retained work on a clean branch

1. Create `codex/reconcile-home-dev-dirty-20260827` from current `origin/main` in the clean local
   repository.
2. Bring over only the paths classified as unique and retained, preserving authorship in the PR
   notes.
3. Keep this reconciliation PR independent of the hibernation implementation and keep the raw
   preservation commit separate and local.
4. Run all repository tests plus focused WhatsApp/Matrix, Caddy, service, and setup verification
   tests. Run a secret scan of the proposed Git diff.
5. Obtain read-only review of behavior parity and data preservation before opening the PR.

**Artifacts:** focused test logs, full test log, secret-scan result, review response, branch SHA,
and Home Dev PR URL.

**Gate:** The PR contains all retained unique behavior and no raw preservation archive, secret,
generated runtime state, or private Matrix content.

### M1.4 Leave the deployed configuration checkout clean and recoverable

After the Home Dev PR is merged:

1. Verify the merged `origin/main` tree contains every `unique and retained` result.
2. Present all `<N>` tracked/staged/untracked paths, their preservation hashes, safe recovery
   commit or private-only classification, restore-rehearsal result, and merged destinations;
   obtain confirmation immediately before replacing the dirty working-tree representation.
3. In the deployed repository, keep the local preservation branch and the two-host preservation
   package. Move each private-only or untracked artifact by explicit path into a dated mode-`0700`
   quarantine with a verified manifest; never delete it. For a flagged tracked path, copy its exact
   working file and binary diff to quarantine, then restore only that explicitly named path from
   the recorded baseline after the confirmation in step 2. Then switch the working tree to `main`
   and update it by fast-forward only. Do not use `reset` or `clean`; if Git cannot switch cleanly,
   stop and reconcile the exact blocking path.
4. Require empty `git status --porcelain=v2 --untracked-files=all`, `HEAD == origin/main`, and a
   successful Home Dev repository test run.
5. Retain the recovery branch and preservation package through M11. Their eventual deletion is a
   separate user decision and is not part of this plan.

**Artifacts:** `m1-pbuchman-preservation/final-deployed-repo.json`, merged PR URL/SHA, and recovery
branch/SHA/hash inventory.

**Gate:** The deployed `pbuchman-dev` checkout is clean without losing any pre-existing byte or
behavior.

## Milestone M2 — Implement reversible Home Dev profiles

### M2.1 Add explicit edge profiles in IntexuraOS

1. Extend `scripts/generate-dev-caddy.mjs` and its manifest contract to generate four explicit,
   immutable profiles from tracked input: `active-pre-cutover`, `active-post-cutover`, `draining`,
   and `hibernated`.
2. Make `active-pre-cutover` preserve the current active behavior, including the old Matrix route,
   solely for the bounded cutover/rollback window. Make `active-post-cutover` preserve normal DEV
   behavior but replace the old Matrix prefix with an explicit earlier handler returning
   non-cacheable plain-text `410 Gone`. It must not fall through to the SPA, return HTML, or reach
   any upstream. `active-post-cutover` is the only active profile allowed by the long-term resume
   runbook.
3. Make the draining profile block static/browser routes and every new-work producer while keeping
   only the exact existing code-task callback paths for logs, lifecycle events, turn metrics,
   compliance, status, and completion. It must contain no broad `/api/code/*` route.
4. Make the hibernated profile own `dev.intexuraos.cloud:80`, emit a minimal `503`, add
   `Cache-Control: no-store` and a bounded `Retry-After`, retain access logging, and contain zero
   `reverse_proxy`, `root`, `file_server`, or DEV service ports.
5. Generate a separate production-owned Matrix fragment for
   `matrix-outbound.intexuraos.cloud:80` that exposes only the exact Matrix outbound prefix to
   `127.0.0.1:8099`; no catch-all application route is allowed.
6. Generate every profile in M2 from the same implementation tree; after merge, live operations
   may only select a pre-generated profile and may not edit or regenerate tracked route semantics.

**Files expected:** `config/edge/dev-access.json`, a new tracked hibernation/Matrix edge manifest,
`scripts/generate-dev-caddy.mjs`, and `scripts/__tests__/dev-edge-manifest.test.ts` or narrowly
split successor files.

**Artifacts:** both active, draining, hibernated, and Matrix generated fixtures; focused tests;
assertions that pre-cutover alone proxies the old Matrix route, post-cutover returns non-HTML
`410` before the SPA fallback with no upstream, draining exposes only callback-safe routes, and
hibernated contains no upstreams.

**Gate:** All four profiles pass deterministic snapshot/contract tests and `caddy validate` in an
isolated test directory.

### M2.2 Add a host-side mode controller and state record

In `pbuchman-dev`:

1. Add a root-owned, narrowly scoped `intexuraos-dev-mode` helper with `status`, `drain`,
   `hibernate`, and `resume` subcommands plus an operator-only bounded cutover selector. Normal
   `resume` selects only `active-post-cutover`. The helper accepts only explicit profile paths and
   exact 40-character revisions.
2. Install generated profiles under an immutable revision directory in
   `/var/lib/intexuraos-dev/profiles/<SHA>/` and atomically switch only
   `/etc/caddy/Caddyfile.d/intexuraos-dev.caddy` after `caddy validate` succeeds.
3. Write `/var/lib/intexuraos-dev/runtime-mode.env` atomically only after Caddy reload and unit
   verification succeed. A partial failure restores the previous symlink and state record.
4. Encode the exact hibernated unit set and retained unit assertions. Reject unknown, shared, or
   newly dependent units rather than stopping them.
5. Add dry-run output that lists all intended file, unit, container, port, and Caddy changes.

**Artifacts:** helper tests, dry-run fixture, rollback test, state-file schema test, and Home Dev PR
diff.

**Gate:** A disposable Linux/systemd test fixture proves atomic switch and rollback without
touching the live host.

### M2.3 Write the operator runbook

Add a tracked runbook in both repositories, cross-linked rather than duplicated:

- IntexuraOS: `docs/operations/dev-hibernation.md` owns application dependency, release, evidence,
  and production cutover rules.
- `pbuchman-dev`: `machine-setup/dev-hibernation.md` owns host installation, unit order, health
  checks, hibernate, resume, and recovery from partial failure.

The runbook must include prerequisites, active and hibernated state tables, exact command order,
no-active-work gates, confirmation points, last-good SHA selection, service start/stop order,
profile switching, external integration pause/resume, rollback triggers, and troubleshooting.

**Artifacts:** documentation link checks, command-snippet tests where feasible, and review signoff.

**Gate:** A reviewer unfamiliar with the change can identify the exact source revision, preview a
dry run, hibernate, resume, and return to hibernation without relying on chat history.

### M2.4 Add privacy-safe, non-mutating drain observability

1. Extend Pub/Sub UI `GET /health` with `drainContractVersion=1` and a `drain` aggregate containing
   `counterEpochId`, `processStartedAt`, `expectedTopologyHash`, `observedTopologyHash`,
   `topologyObservedAt`, `topologyMatch`, `activeListenerTopologyHash`, subscription and
   classification counts, per-subscription listener multiplicity, `activeListeners`,
   `setupErrors`, `inFlightHandlers`, monotonic `receivedTotal`, `ackedTotal`, `nackedTotal`,
   `forwardFailuresTotal`, and `subscriberErrorsTotal`, plus `lastActivityAt` and `lastErrorAt`.
   `counterEpochId` is immutable for one process lifetime. `lastActivityAt` advances on receive,
   forwarding outcome, ack/nack handoff, and subscriber error. Expose no payload, message ID, ack
   ID, attribute, callback, or secret.
2. Require every observed live subscription to be explicitly classified and listened to. Missing,
   unexpected, orphaned, unclassified, or listener-less subscriptions make status UNKNOWN. Do not
   auto-delete, seek, pull-probe, or silently ignore a subscription. Ack may increment only after
   successful forwarding; forwarding failure increments failure and nack telemetry. Every health
   snapshot refreshes topology through non-mutating ListTopics/ListSubscriptions. Topology hashes
   are SHA-256 of the same sorted, whitespace-free canonical JSON array of
   project/topic/subscription tuples. Equal listener and subscription counts alone are never proof
   of coverage.
3. Extend orchestrator `GET /health`, set `healthContractVersion=2`, and add
   `logForwarderDrain` with `counterEpochId`, `processStartedAt`, `activeForwarders`,
   `bufferedBytes`, `partialLineBytes`, `queuedChunks`, `inFlightBatches`, `inFlightChunks`,
   `activeFlushOperations`, and process-lifetime monotonic `droppedChunksTotal` and
   `forwarderActivityTotal` that survive individual forwarder close, plus `lastActivityAt`.
   Increment `forwarderActivityTotal` and advance `lastActivityAt` for enqueue, flush start and
   result, retry, and forwarder close. Expose no task ID, callback URL, log content, or secret;
   update every typed consumer and contract test.
   For both Pub/Sub UI and orchestrator, each process start generates a new non-reused 128-bit
   random `counterEpochId`; it is never persisted or reused across restarts and remains immutable
   only within that process lifetime.
4. Account for chunks from enqueue until upload success/failure. Clearing `pendingChunks` before
   awaiting `sendBatch` must leave the corresponding in-flight counts non-zero, including retries
   and concurrent flushes. `inFlightHandlers` remains non-zero until forwarding outcome, ack/nack
   handoff, its monotonic counter, and `lastActivityAt` update complete as one observable state
   transition. No health snapshot may observe handler zero before ack/nack accounting is visible.
5. Add a pure tested verifier that derives `pendingStatus=zero|nonzero|unknown` only from the
   required snapshots, per-surface freeze-boundary witnesses, counter epochs, process identities,
   fresh topology, monotonic deltas, and required quiet interval. Neither endpoint invents a
   numeric backlog; only this verifier may emit `zero`.
6. Write failing tests first for empty, buffered, queued, upload-in-flight, retrying, failed,
   concurrent-flush and counter-reset states; and for incomplete topology, listener startup
   failure, message in flight, successful ack, nack, forward failure, subscriber error, and stable
   quiescence. Include process restart, forwarder close, transient forwarder activity completed
   between snapshots, same-tick activity, clock skew, stale topology, duplicate listener,
   counter-epoch mismatch, and witness-to-anchor-to-read delta cases.

**Artifacts:** RED/GREEN logs, endpoint schemas, source/image build identity, and privacy-contract
tests.

**Gate:** Isolated tests prove pending work can never report zero while any buffer, partial line,
queued chunk, upload, handler, retry, topology gap, listener failure, or unreported error exists.

## Milestone M3 — Codify Cloudflare Matrix infrastructure without cutting traffic

### M3.1 Establish the authoritative Cloudflare owner

1. Through Computer Use and the existing Google-authenticated Chrome session, inspect the existing
   Home Dev tunnel, `dev.intexuraos.cloud` public hostname, Access application/policies, and the
   service-token policy used by production. Record only names, IDs, non-secret hostnames, policy
   decisions, and modification timestamps.
2. The read-only repository audit found no current Cloudflare Terraform owner. Establish the
   authoritative shared-host owner at
   `/Users/p.buchman/personal/pbuchman-dev/terraform/cloudflare-home-dev/` on
   `codex/home-dev-hibernation`, with isolated state, pinned providers, least-privilege inputs, and
   CI validation. It must declare all shared tunnel ingress entries needed to avoid deleting or
   reordering SentryBox, FKA, CI, `cc-home`, and other retained routes. Do not create a third repo.
   If the dashboard proves another existing IaC owner exists, stop, update this plan with that
   repository/branch/PR flow, and obtain renewed acceptance before continuing.
3. After explicit confirmation for the state operation, import the existing relevant tunnel,
   ingress/DNS, and Access objects. Prove that the post-import Terraform plan is no-op and resolve
   drift before declaring a new host.
4. Select an existing least-privilege provider credential. If none exists, pause immediately before
   creating a narrowly scoped credential through the Google-authenticated UI; never record its
   value in screenshots, logs, Git, shell history, or Terraform state.

**Artifacts:** `m3-matrix/cloudflare-inventory.json`, IaC owner path, import commands with secrets
removed, no-op plan, provider principal metadata, and private redacted screenshots/hashes.

**Gate:** No new persistent Cloudflare object may be created until Terraform can reproduce the
existing relevant state.

### M3.2 Declare, but do not yet apply, the parallel Matrix hostname and policy

1. In the Home Dev Terraform stack, declare `matrix-outbound.intexuraos.cloud` on the existing Home
   Dev tunnel, pointing to the Caddy origin, and declare an Access application/policy that permits
   only the existing production service identity.
2. Keep the adapter's existing bearer-token validation as the second authorization layer.
3. Model the new Matrix hostname, DNS/ingress, Access application, and policy behind an explicit
   `matrix_outbound_enabled` switch. `false` must preserve the imported shared baseline and `true`
   must add exactly the new Matrix objects. This switch exists only for reviewed cutover/rollback;
   normal desired state after M7 is `true`.
4. Review a non-applied `true` Terraform plan for exact resource IDs, hostname, origin, retained
   shared routes, policy, and absence of secret payloads. Also prove the `false` configuration is a
   no-op against the imported baseline. Add policy/plan tests in the Home Dev PR.
5. Do not apply the new route and do not install any live Caddy fragment in M3. The only permitted
   live state mutation here is the separately confirmed import/no-op reconciliation from M3.1.
   New route application waits for the exact merged Home Dev SHA in M7.1.

**Artifacts:** imported-state object IDs, no-op import plan, proposed enabled-plan hash,
disabled-baseline no-op plan, Terraform tests/validation, branch SHA, and private UI inventory
screenshot hashes.

**Gate:** The reviewed, un-applied plan adds only the new Matrix hostname/policy, preserves every
retained shared route, and belongs to the Home Dev implementation PR.

### M3.3 Prove the route contract in isolation

1. Validate the generated Matrix Caddy fragment from the IntexuraOS branch against a local stub
   adapter. The exact public health path is
   `/api/matrix-outbound/health`, which strips to adapter `/health`.
2. Add tests for the exact hostname/path prefix, no catch-all route, prefix stripping, expected
   health schema, and no modification of the live DEV fragment.
3. Add Cloudflare policy assertions for unauthenticated denial and authorization of only the
   existing production service identity. Real public 403/200 and send canaries remain in M7.1.

**Artifacts:** `m3-matrix/isolated-route-contract.json`, generated fragment hash, Caddy validation,
stub request transcript, and policy tests.

**Gate:** The merged candidates can expose only the intended protected Matrix contract, with no
live routing mutation before review/merge.

## Milestone M4 — Remove production runtime dependence on DEV

### M4.1 Change production Matrix configuration

1. Change `config/environments/prod.json` so
   `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` points to
   `https://matrix-outbound.intexuraos.cloud/api/matrix-outbound`.
2. Update runtime-config tests, production ecosystem tests, secret-package integration tests, and
   documentation that asserts the old URL.
3. Keep the Matrix bearer and Cloudflare service credentials versioned through the existing PROD
   package. Reuse them if compatible; if rotation is unavoidable, make it a separately confirmed,
   version-pinned secret-package operation with rollback to the previous numeric version.

**Artifacts:** focused RED/GREEN test logs, production config diff, secret-package version metadata
without values, and rollback version ID.

**Gate:** A repository scan finds no production runtime value pointing to the DEV Matrix path.

### M4.2 Make the Home Dev orchestrator production-owned

1. Update `scripts/generate-orchestrator-env.mjs` so Home Dev cannot fall back to a stopped local
   Code Agent. Pin the exact production endpoints:
   `INTEXURAOS_CODE_AGENT_URL=https://intexuraos.cloud/api/code` and
   `INTEXURAOS_USAGE_WEBHOOK_URL=https://intexuraos.cloud/api/code/internal/webhooks/usage-events`.
2. Audit every consumer of `INTEXURAOS_ENVIRONMENT` and `INTEXURAOS_RUNTIME`. These values currently
   act as host/observability tags and are intentionally fixed to `dev`; they are not callback
   owners. Produce an explicit decision record before changing them. Change either to `prod` only
   if tests prove the new value correctly describes observability ownership without influencing
   credential mode, data routing, or worker semantics. Otherwise retain the legacy host tag and
   document why it does not mean a live DEV environment.
3. Preserve task-provided callback ownership as authoritative. Add tests proving a task-provided
   production URL controls logs, lifecycle, metrics, compliance, status, and completion callbacks,
   while the production fallback is used only when the task contract permits it.
4. Keep the legacy-named retained GCP project and the least-privilege
   `home-orchestrator-sa-key.json`; its name is not an environment-routing signal.
5. Compare required HMAC/internal-auth values against PROD through non-printing equality checks.
   Rotate only if equality cannot be established and only through a separately confirmed package
   publication.
6. Update orchestrator README/service docs and Home Dev runbook.

**Artifacts:** generator RED/GREEN tests, callback-routing tests, allowlisted env-name/value-class
report, `orchestrator-identity-decision.md`, credential-principal metadata, and
`secret-match=true` attestations.

**Gate:** The generated environment contains no DEV callback URL; environment/runtime tags have an
audited meaning and cannot route work; and the credential remains least privilege with no Secret
Manager access.

### M4.3 Add a dependency regression gate

Add a repository test that fails when a production-owned runtime value, workflow deployment input,
or orchestrator fallback points to `dev.intexuraos.cloud`. Maintain an explicit allow-list for
historical docs, hibernation profile, retained OAuth callbacks, and tests that intentionally model
legacy DEV input.

**Artifacts:** test source, intentional allow-list with owner/reason, expected failing fixture, and
passing focused test log.

**Gate:** A newly introduced production-to-DEV dependency cannot pass CI silently.

## Milestone M5 — Align instructions, evaluation paths, and external integrations

### M5.1 Update agent and environment instructions

Update the authoritative `.claude` rule structure and mirrored operational skills, including at
least:

- `.claude/CLAUDE.md` references where routing text changes;
- `.claude/reference/environments.md`;
- `.claude/reference/infrastructure.md`;
- `.claude/reference/architecture.md` if its environment diagram assumes a live DEV runtime;
- `.claude/skills/debug-code-task/SKILL.md` and `.codex/skills/debug-code-task/SKILL.md`;
- `.claude/skills/debug-intex-session/SKILL.md` and
  `.codex/skills/debug-intex-session/SKILL.md`;
- orchestrator and code-task documentation linked from those sources.

Instructions must say that Home Dev is a worker/host, not a live DEV application runtime; old DEV
URLs are historical investigation inputs; production owns new work; and `workerLocation` still
does not determine callback ownership.

**Artifacts:** instruction diff, cross-link verification, mirrored-skill comparison, and
instruction review checklist.

**Gate:** No current instruction tells an agent that pushes auto-deploy a live DEV PM2 stack or
that production callbacks may rely on DEV.

### M5.2 Retire or redirect live-DEV test paths

1. Make `scripts/run-intex-agent-evals-home-dev.sh` fail fast with a stable
   `DEV_RUNTIME_HIBERNATED` result while the mode record is hibernated; keep a documented explicit
   resume prerequisite rather than silently targeting production.
2. Keep `scripts/run-intex-agent-evals-prod.sh` and the production Matrix corpus as the supported
   live acceptance path.
3. Update `.github/workflows/e2e.yml`, `docs/testing/intex-agent-evals.md`, evaluator docs/tests,
   and any hard-coded DEV web URL to either production, local, retained history, or the explicit
   hibernation allow-list.
4. Preserve local-stack tests and DEV configuration tests needed for resume.

**Artifacts:** wrapper RED/GREEN tests, E2E workflow diff, evaluator documentation test, and a
hibernated-mode CLI transcript.

**Gate:** CI and operator commands cannot report a false success against a nonexistent DEV
runtime.

### M5.3 Inventory and pause DEV-only external producers

1. Identify each configured external producer targeting a DEV machine route: Linear webhook,
   mobile-notification webhook, Sentry code-task automation, and any additional producer found in
   M0.
2. Prefer a reversible disabled/paused state. Record exact object ID, old enabled state, callback
   URL, signing-secret version ID, and re-enable steps without secret values.
3. Use Computer Use and the existing Google identity for any required sign-in. Pause immediately
   before saving the reviewed batch of external changes.
4. Do not remove OAuth callback allow-lists, signing secrets, provider apps, or historical event
   data.
5. Observe the old endpoints for at least one provider retry interval and prove no accepted new
   DEV delivery before M8.

**Artifacts:** `m5-integrations/dev-producers.json`, private redacted UI evidence, paused-state
object IDs, provider delivery-state reports, and resume checklist.

**Gate:** No external system is expected to create new work that only a DEV PM2 process can
consume.

### M5.4 Prove no automation can resurrect DEV

1. Inventory systemd reverse dependencies, timers, cron entries, GitHub workflows, deployment
   scripts, PM2 dump/resurrection, and any webhook/auto-deploy handler on Home Dev.
2. Prove the retired IntexuraOS `webhook-handler.service` is masked and no IntexuraOS handler
   process/path can restart PM2. Do not confuse the retained FKA or SentryBox deploy handlers with
   IntexuraOS.
3. Make every remaining IntexuraOS deployment path read the mode record and refuse PM2/emulator
   start or active-profile selection while `MODE=draining|hibernated`. It may still update the
   checkout/build and restart the retained orchestrator when its zero-work gate passes.
4. Add tests for merge, reboot, daemon reload, and PM2 resurrection attempts under hibernated mode.

**Artifacts:** `m5-integrations/resurrection-inventory.json`, live masked-unit/process proof,
focused prevention tests, and reboot/dependency dry-run report.

**Gate:** A merge, reboot, timer, or operator's normal deployment command cannot silently recreate
the DEV runtime.

## Milestone M6 — Review, merge, and stage exact revisions

M6 cannot PASS until M2.4 is merged in the exact candidate revisions, all focused
drain-observability tests pass, and the staged Pub/Sub UI image and orchestrator artifact are tied
to their reviewed source/tree hashes.

### M6.1 Complete code review and tests

1. Run focused tests after each RED/GREEN implementation group.
2. Run relevant package tests, typecheck, lint, coverage where required, generated-config tests,
   hibernation/resume tests, and both repositories' full validation suites.
3. Request independent read-only review focused on data preservation, production dependency
   removal, edge authorization, systemd ordering, rollback, and accidental stopping of shared
   services. Resolve every valid finding and rerun affected tests.
4. Run the single final IntexuraOS `pnpm run ci:tracked` gate after the diff is final.

**Artifacts:** complete test matrix with command, revision, exit status, log hash; reviewer result;
and final CI log.

**Gate:** All required tests and review findings are green/closed on the exact proposed trees.

### M6.2 Merge all implementation PRs without mixing unrelated work

1. Confirm each branch descends from the current target and stage only planned files.
2. Confirm the earlier reconciliation PR is merged, then open the Home Dev hibernation PR to
   `main` and complete the already-open IntexuraOS implementation PR to `development`,
   cross-linking all three PRs and this plan. Do not create a duplicate IntexuraOS PR.
3. Wait for required checks and review; merge without bypassing protections.
4. Record merge commit SHAs and immutable tree hashes. Re-run the dependency regression scan on the
   merged IntexuraOS SHA.

**Artifacts:** all three PR URLs, check-rollup JSON, merge SHAs/tree hashes, and merged dependency
scan.

**Gate:** All merged revisions are immutable inputs to deployment; any post-merge fix returns to
M6.1.

### M6.3 Stage Home Dev without starting DEV

1. Update `/home/pbuchman/deploy/intexuraos` to the exact reviewed IntexuraOS merge SHA using the
   documented manual deployment path; the retired webhook handler must remain absent.
2. Install dependencies/build artifacts required for the orchestrator and profile generation, but
   do not reload/start the PM2 DEV stack.
3. Generate and stage all four immutable Caddy profiles plus the Matrix fragment under the exact
   merged revision directory. Leave `active-pre-cutover` selected and do not link/reload the new
   Matrix fragment into live Caddy until M7.1.
4. Update the deployed `pbuchman-dev` checkout to its exact merge SHA and install the mode helper
   after dry-run validation.
5. Build and stage the exact reviewed Pub/Sub UI image and orchestrator artifact. Record OCI/image
   digest, source/tree hash, expected topology hash, and an explicit classification for every live
   subscription. Do not activate the new bridge image yet.

**Artifacts:** deployed checkout SHA/tree, build log, profile hashes, helper install hash, and
`status`/dry-run output.

**Gate:** Home Dev is ready for one-command hibernation/rollback while current traffic remains
unchanged. A stale or untraceable bridge image, source/image drift, an unclassified live
subscription, or a missing drain schema blocks staging and M7.

## Milestone M7 — Production and orchestrator cutover

### M7.0 Activate the exact reviewed drain telemetry

1. Start the M7.0 telemetry-activation freeze: no new DEV-owned work, producer targeting the DEV
   application runtime or emulator, evaluation, or unplanned DEV deployment may begin. This exact
   reviewed telemetry activation is the sole deployment exception before the final M8 freeze
   anchor. After M7.0 PASS, only the exact reviewed and separately authorized M7.1 Matrix and M7.3
   orchestrator canaries may start, one at a time; retained production traffic that does not target
   the DEV runtime remains allowed.
2. Before restarting the orchestrator, require zero authoritative non-terminal tasks, zero
   dispatcher/persisted running or queued work, zero worker containers, zero pending terminal
   callbacks, no active outbound log-upload connection, zero forwarder state, and zero detached
   upload/retry promise. Do not infer a finite upload bound from retry delays: the deployed revision
   has no request timeout, so elapsed quiet time alone is insufficient. Run an exact-revision
   offline lifecycle/concurrency test and collect runtime evidence proving terminal zero-task state
   closes every forwarder and leaves no detached promise. Use graceful SIGTERM and require a clean
   drained shutdown; UNKNOWN blocks activation and requires a separately reviewed bootstrap
   amendment rather than a restart. Then activate the exact M6 orchestrator artifact without
   changing callback ownership.
3. Before replacing the bridge, use available runtime and network signals over the full
   pre-activation quiet interval to prove no receive/forward activity, no handler in progress,
   stable fresh ListTopics/ListSubscriptions topology, and no subscriber error. UNKNOWN blocks
   replacement. Replace only the Pub/Sub UI/bridge container with the exact M6 image without
   restarting or recreating the emulator. Prove the emulator container ID and start time are
   unchanged, Compose did not recreate it, and any configured volume IDs, if present, are
   unchanged. Telemetry activation must not create, update, or delete emulator topics or
   subscriptions; any topology reconciliation is a separate reviewed mutation completed before
   the freeze. M7.0 may not restart or recreate the emulator. Normal reviewed subscription
   delivery before the final M8 anchor is allowed and must appear in telemetry; any such activity
   postpones the anchor.
4. Verify exact source revision/image digest, both counter epochs/process starts, fresh topology
   hash, health schema versions, complete subscription classification, exactly one active listener
   per classified subscription, `activeListenerTopologyHash=observedTopologyHash`, and
   `setupErrors=0`.
5. No M7 canary and no M8 drain may start before this gate passes.

**Artifacts:** before/after container identities, source/image attestation,
topology/classification report, and both health responses.

**Gate:** Live source/image drift is eliminated and both non-mutating drain surfaces are exact,
complete, and healthy.

### M7.1 Apply the merged Matrix edge and prove the parallel route

1. Verify the deployed `pbuchman-dev` and IntexuraOS checkouts exactly equal their M6 merge SHAs and
   both are clean. Regenerate the Cloudflare plan from the exact merged Home Dev Terraform tree;
   compare its semantic output and hash to the M3 reviewed candidate.
2. Pause for explicit confirmation, then apply the reviewed plan that adds
   `matrix-outbound.intexuraos.cloud` and its Access policy while preserving every shared route.
3. Immediately after apply and before linking Caddy, canary, or production cutover, generate a
   state-compatible saved Terraform rollback plan from the exact same merged tree with
   `matrix_outbound_enabled=false`. Review that it removes only the newly added Matrix
   DNS/ingress/Access objects and preserves every imported shared object; save and hash it. If the
   rollback plan contains any unrelated change, revert the apply manually only through a newly
   reviewed plan and stop M7.
4. Atomically link the already staged exact-SHA Matrix Caddy fragment into
   `/etc/caddy/Caddyfile.d/`, validate all Caddy configuration, reload, and verify its hash matches
   M6 evidence. Do not edit or regenerate it on the host.
5. Through Computer Use, verify Cloudflare object IDs/policy against IaC state. Prove public
   `403` without Access credentials, adapter denial with valid Access but invalid bearer, and
   `200` at `/api/matrix-outbound/health` only with both valid layers. Never print headers.
6. Pause before sending one real uniquely identified Matrix canary to an operator-owned target;
   prove exactly one event and no retry/duplicate using hashed IDs.

**Artifacts:** exact merged SHAs, saved apply-plan hash, apply result, Cloudflare object IDs,
state-compatible disabled rollback-plan hash and semantic review, Terraform no-drift plan, live
Caddy fragment hash/validation/reload, `403`/adapter-denial/`200` route contract, and privacy-safe
Matrix canary report.

**Rollback:** unlink the new Matrix fragment and apply the previously saved Terraform rollback plan
only after confirming no caller has cut over. Verify the post-rollback plan is no-op.
`active-pre-cutover` and the old Matrix route remain unchanged.

**Gate:** The new host works independently from the exact merged artifacts while the old DEV route
remains live for rollback.

### M7.2 Deploy the exact IntexuraOS revision to production

The workflow has no arbitrary SHA input; it deploys the SHA of the ref used for
`workflow_dispatch`.

1. Immediately before dispatch, fetch without merging and prove remote `development` equals the
   exact M6 IntexuraOS merge SHA. Freeze dispatch metadata. If `development` has advanced, do not
   deploy: return to M6.1, review/test the new exact tree, and establish a new reviewed deployment
   SHA.
2. Dispatch `.github/workflows/deploy.yml` with `ref=development`, target `hetzner-prod`, and the
   explicitly pinned numeric PROD secret-package version already configured for the workflow.
3. Verify the resulting workflow `GITHUB_SHA` equals the frozen reviewed SHA before allowing its
   deploy step to count. Wait for all workflow and deployment health gates.
4. Verify `/deployment.json`, PM2 rendered release, static web release, and service health all
   report the exact intended revision.
5. Verify production Matrix traffic uses the new host and succeeds. Keep `active-pre-cutover` and
   the old DEV Matrix path during the observation window.

**Artifacts:** pre-dispatch ref/SHA freeze, workflow run URL/ID and `GITHUB_SHA`, deployed SHA,
numeric package version, `/deployment.json` response hash, production health matrix, and Matrix
route traffic aggregate.

**Rollback:** redeploy the preceding exact production SHA and numeric package version, ensure
`active-pre-cutover` remains selected, and keep the old Matrix route. Do not proceed to M7.3 while
production is degraded.

**Gate:** Production is healthy at the exact reviewed SHA and sends Matrix traffic successfully
through the new host.

### M7.3 Reproject and enable the production-owned orchestrator

1. Require zero running tasks, zero preserved task containers needing callbacks, and an empty or
   fully acknowledged log spool.
2. Generate the new mode-`0600` orchestrator environment atomically and record only allowed
   non-secret URL/runtime fields plus hashes for secret equality.
3. Enable `intexuraos-orchestrator@pbuchman.service` so it survives reboot, restart it, and verify
   `enabled`, `active`, ready state, expected capacity, no restart loop, and the observability
   identity selected by the M4.2 decision record.
4. Submit one production-owned no-op/code-task canary. Prove task-provided production callbacks
   receive logs, events, metrics, status, compliance where applicable, and one terminal completion.
5. Verify the task's `workerLocation=home-dev` does not alter its production owner.

During the production-owned canary, prove `logForwarderDrain` changes from zero to at least one
non-zero active/buffered/queued/in-flight field, then returns to all-zero with no dropped-chunk
delta after terminal completion and after any compliance/log tail has closed, but before M8 starts.
On the same counter epoch, prove `forwarderActivityTotal` increases and `lastActivityAt` advances
during the canary, then both remain unchanged through a second post-terminal health read.

**Artifacts:** pre-restart drain report, generated-env metadata, systemd report, health response,
canary task ID, callback-state report, and privacy-safe logs.

**Rollback:** restore the prior generated env and restart the orchestrator only after the canary
has reached a safe terminal state. This rollback blocks DEV hibernation until the dependency is
redesigned.

**Gate:** A production code task completes end to end through Home Dev with no DEV callback.

### M7.4 Retire the old Matrix route by profile selection

1. Prove from production configuration and 24-hour route logs that no successful production
   Matrix call uses `dev.intexuraos.cloud/api/matrix-outbound`.
2. Atomically select the exact merged `active-post-cutover` profile. Do not modify a manifest,
   generated fragment, or repository after the M6 CI/merge gate.
3. Keep the new Matrix hostname, tunnel route, Access application/policy, adapter container, and
   bearer credential active.
4. Verify the old path returns plain-text, non-cacheable `410 Gone`, never HTML/SPA content, and
   produces no adapter upstream request even before full host hibernation.

**Artifacts:** old-route traffic report, selected profile/revision/hash, validation/reload result,
old/new route probe comparison, old-route `410` response headers/body hash, and adapter no-request
proof.

**Gate:** Production Matrix is wholly independent of the DEV host and rollback uses the prior
reviewed `active-pre-cutover` profile rather than an undocumented live edit.

## Milestone M8 — Drain and hibernate DEV

### M8.1 Final zero-work gate

Immediately before any stop action:

1. Select the reviewed draining profile. It closes new static/browser/new-work traffic but
   preserves the exact task callback paths.
2. After M7.0 is active, all M7 canaries and compliance/log tails are terminal, the draining profile
   is selected, and every producer targeting the DEV application runtime or emulator is paused,
   capture a signed freeze-boundary witness from each drain surface. Each per-surface logical
   boundary is the completion of that witness observation, not a comparison between host clocks.
   Record both `counterEpochId` values, process start times, expected/observed/active-listener
   topology hashes, fresh topology observation time, per-subscription listener multiplicity, all
   monotonic counters, and every drain gauge.
3. Immediately capture a signed freeze-anchor snapshot from both surfaces. The same processes and
   counter epochs must span witness and anchor; every monotonic delta from its corresponding
   witness must be zero, every drain gauge must be zero, topology must remain fresh and unchanged,
   and neither `lastActivityAt` may advance. Any activity, counter decrease/reset, process restart,
   epoch change, topology change, or UNKNOWN fails the sequence; after resolving the cause, record
   new witnesses and restart the proof from the beginning.
4. Repeat the authoritative ownership checks and both exact drain-health reads twice. The same
   bridge container/process, orchestrator process, and counter epochs must span the witnesses,
   freeze anchor, read 1, and read 2. The interval from anchor to read 1 and from read 1 to read 2 is
   each at least the maximum of 600 seconds and every longer producer, poll, retry, callback, or
   subscription-redelivery interval established by inventory.

The witnesses, anchor, two reads, and all three interval deltas must additionally prove:

- each snapshot refreshes topology with non-mutating ListTopics/ListSubscriptions and has a fresh
  `topologyObservedAt`, unchanged observed topology hash, `topologyMatch=true`, no unclassified
  subscriptions, exactly one active listener per classified subscription,
  `activeListenerTopologyHash=observedTopologyHash`, `setupErrors=0`, and `inFlightHandlers=0`;
- received, acked, nacked, forward-failed, subscriber-error, dropped-chunk, and
  forwarder-activity deltas are zero from each witness to its anchor, from freeze anchor to read 1,
  and from read 1 to read 2;
- Pub/Sub and orchestrator `lastActivityAt` values do not advance anywhere in the
  witness-to-anchor-to-read-1-to-read-2 sequence; timestamps are corroborating telemetry, never the
  sole continuity proof;
- orchestrator `activeForwarders=0`, `bufferedBytes=0`, `partialLineBytes=0`,
  `queuedChunks=0`, `inFlightBatches=0`, `inFlightChunks=0`, and
  `activeFlushOperations=0`;
- the authoritative M0.4 classifier reports zero NONZERO and zero UNKNOWN across code tasks,
  sessions, test runs, run contexts, leases, Matrix-corpus ingest outbox, and terminal-control
  outbox;
- orchestrator health reports zero running tasks, worker containers, pending terminal callbacks,
  open outbound log-upload connections, and detached upload/retry promises;
- every DEV application/emulator producer remains paused, the old Matrix route has no successful
  request in either completed interval, and production plus every retained Home Dev service is
  healthy.

The verifier may emit `pendingStatus=zero` only when every topology, listener, in-flight, error,
instance-stability, and quiet-period predicate passes. UNKNOWN remains failure. Evidence collection
must not invoke Pull or an additional StreamingPull probe, Ack, Nack, ModifyAckDeadline, Seek,
snapshot mutation, or emulator restart.

**Artifact:** `m8-hibernate/final-zero-work-gate.json` signed with timestamp and source revisions.

A non-zero or UNKNOWN result stops M8. A separately confirmed destructive disposition is a
distinct mutation, never a measurement technique; after it, reverify the exact telemetry
deployment, record new freeze-boundary witnesses and anchor, and repeat witness → anchor → read
1 → read 2 from the beginning.

This replaces a nonexistent direct native backlog counter with a conservative derived result. It
is less direct as a single measurement, but the cutover gate is stronger: complete freshly listed
topology, one listener per subscription, in-flight counts, monotonic error/activity deltas,
freeze-witness/anchor continuity, immutable process counter epochs, UNKNOWN-fail behavior, and two
full quiet intervals of at least ten minutes are all mandatory.

**Gate:** Every count must be exactly zero. Unknown is failure. No force-stop path exists.

### M8.2 Capture the last-good active state

1. Record exact IntexuraOS and `pbuchman-dev` revisions, the selected
   `active-post-cutover` profile hash, static release target, pinned DEV secret-package version,
   secret projection IDs, service-account principal metadata, PM2 ecosystem hash, image digests,
   enabled unit set, external integration states, and active health matrix.
2. Validate that every referenced checkout/file/version still exists and is readable without
   printing secrets.
3. Run the mode helper's `resume --dry-run` against this last-good manifest.

**Artifacts:** `m8-hibernate/last-good-active-state.json`, dry-run output, and referenced-object
existence report.

**Gate:** Resume inputs are complete before the first service is stopped.

### M8.3 Atomically close ingress and stop only DEV-owned runtime

Perform the reviewed hibernation helper sequence:

1. Validate the hibernated Caddy profile, atomically replace the draining profile, reload Caddy,
   and prove the public DEV host returns the expected `503` before stopping applications.
2. Stop and disable `pm2-pbuchman.service`; verify PM2 has no running process.
3. Stop and disable `intexuraos-emulators.service` after the queue gate; verify only the two
   emulator Compose containers disappear and no shared Docker workload changes.
4. Keep observability running long enough to capture PM2/emulator shutdown, then stop and disable
   `pm2-journal-bridge.service`, `intexuraos-log-server.service`, and
   `intexuraos-log-viewer.service` after their final log flush.
5. Stop and disable `alloy.service` last, only after confirming its PM2-only ownership and buffered
   upload completion.
6. Reverify every retained unit/container, reverse dependency, timer, and resurrection path, then
   write the hibernated mode record atomically.

**Artifacts:** helper transcript, before/after unit JSON, PM2 report, Docker label/digest report,
port report, Caddy validation/reload output, mode record, and retained-health matrix.

**Rollback triggers:** unexpected retained service change, production error-rate increase,
orchestrator callback failure, Caddy validation/reload failure, shared container change, or any
non-zero active DEV work. The helper keeps hibernated ingress closed, re-enables/starts internal
units in the tested resume order, verifies internal health, and selects the recorded
`active-post-cutover` profile only as the final rollback step. The failure is recorded and M8
remains incomplete.

**Gate:** DEV-owned units are disabled/inactive, retained services are unchanged/healthy, and the
public response is deterministic `503`.

## Milestone M9 — Immediate and 24-hour acceptance

### M9.1 Immediate technical acceptance

Verify and record:

- production web/API health and exact deployment SHA;
- one production WhatsApp/Matrix flow through the new Matrix host;
- Home Dev orchestrator ready state and production callback canary;
- `dev.intexuraos.cloud` public and origin `503` behavior for `/`, a browser API, every former
  machine webhook class, and former Matrix outbound;
- disabled/inactive state of the six DEV units;
- absence of PM2 processes, emulator containers, and DEV listener ports;
- health of Caddy, Cloudflare Tunnel, Docker, worker firewall, SentryBox, WhatsApp/Matrix, FKA,
  self-development intake, CI health/runner, Tailscale, and host monitoring;
- no new error/restart spike in production or retained Home Dev services;
- before/after memory, CPU, process, container, port, and background-log-ingest delta.

**Artifact:** `m9-acceptance/immediate-acceptance.json` plus sanitized resource-delta table.

**Gate:** Every expected state matches; savings are measured rather than assumed.

### M9.2 Observe for 24 hours

1. Keep the final state hibernated and monitor production health, Matrix delivery, code tasks,
   Cloudflare/Caddy statuses, retained service restarts, and unexpected DEV requests.
2. Classify every DEV request by route/caller without payload or personal data. A retry from a
   supposedly paused producer reopens M5.3.
3. Confirm no automatic mechanism re-enabled a DEV unit after a reboot/reload boundary. If no
   natural reboot occurs, verify `is-enabled=disabled` plus dependency graph; the reactivation
   drill covers start behavior.
4. Capture the 24-hour resource delta and retained-service health.

**Artifacts:** `m9-acceptance/24h-acceptance.json`, `unexpected-dev-requests.json`, resource delta,
and retained-health report.

**Gate:** Zero production dependency failures, zero unexpected unit resurrection, and no
unresolved DEV producer.

## Milestone M10 — Prove resume, then return to hibernation

The final desired state remains hibernated. The drill temporarily restores DEV under a change
window, verifies it, and immediately hibernates it again.

### M10.1 Dry-run and internal resume

1. Start from the recorded M8 last-good state and verify prerequisites/checksums.
2. Keep external DEV producers paused. Run `resume --dry-run` and compare its intended changes to
   the last-good manifest.
3. Restore the exact last-good `UnitFileState` before starting dependencies: enable the DEV units
   recorded as enabled in M8 and verify each `is-enabled` result. Then start in tested order:
   emulator, DEV log/observability services, and PM2 applications. Start Alloy only after log
   source ownership is confirmed and before PM2 so it can capture startup. Start PM2 last among
   internal services.
4. Keep the public host on the hibernated profile while verifying local service health, emulator
   aliases, PM2 process set, expected ports, and static release.
5. Validate `active-post-cutover` without selecting it.

**Artifacts:** `m10-resume/dry-run.txt`, prerequisite report, internal-health matrix, unit/PM2/
container/port reports, and elapsed time.

**Gate:** The exact last-good internal runtime is healthy without opening public ingress.

If any resume step fails, the helper must stop only the components it started, restore the
hibernated Caddy profile and mode record, and emit a failed drill artifact. It must not leave a
partially active DEV runtime.

### M10.2 Brief public resume acceptance

1. Confirm again that external DEV producers remain paused and no test can affect production data
   unexpectedly; remember Firestore/Storage/Auth0 are shared.
2. Atomically select the exact `active-post-cutover` profile and use the authenticated browser
   identity to verify DEV login, one read-only page, one representative API health request, and
   route authorization.
3. Do not send production-facing messages or mutate shared data solely for the drill.
4. Record observed recovery time. Target RTO is at most 30 minutes from command start to verified
   public health; a miss requires runbook remediation and another drill.

**Artifacts:** `m10-resume/public-health.json`, private redacted browser evidence hashes, and
`rto.json`.

**Gate:** Public DEV can be restored from tracked state without ad-hoc repair.

### M10.3 Rehibernate and reverify final state

1. Repeat the M8 zero-work gate for drill-created work.
2. Run the hibernation helper, confirm the six units are again both disabled and inactive, and
   confirm shared services remain healthy.
3. Re-run immediate acceptance and a shorter one-hour stability check.
4. Keep external DEV producers paused; the full resume runbook documents their separately
   confirmed re-enable sequence.

**Artifacts:** `m10-resume/rehybernation.json`, final mode record hash, one-hour stability report,
and final retained-health matrix.

**Gate:** The machine ends in the same hibernated state as M9, with a measured and tested recovery
path.

## Milestone M11 — Closeout and completion proof

### M11.1 Final consistency review

1. Re-run the production-to-DEV dependency scan, instruction cross-link checks, both repository
   statuses, Cloudflare Terraform drift check, and Home Dev mode status.
2. Verify exact relationships among IntexuraOS merge SHA, production deployed SHA, Home Dev
   checkout SHA, generated profile SHA, `pbuchman-dev` merge SHA, and evidence run ID.
3. Confirm both deployed checkouts are clean and all preservation artifacts/recovery refs remain
   readable with matching hashes.
4. Ask an independent reviewer to audit every milestone gate against its artifact, not merely the
   written checklist.

Validate every ledger row through M11.1 before rendering and freeze that snapshot hash. Run a
privacy scan that rejects human email addresses and raw user-home paths in tracked evidence.

**Artifacts:** `m11-closeout/revision-map.json`, no-drift plans, clean-status reports, reviewer
attestation, and completed milestone matrix.

**Gate:** Every M0–M10 artifact exists at its recorded hash, the reviewer finds no unclosed gate,
Cloudflare and both repositories have no unexplained drift, and Home Dev is still hibernated.

### M11.2 Publish the sanitized final evidence index

Render the append-only private ledger frozen through M11.1 into
`docs/operations/evidence/<RUN_ID>-dev-hibernation.md` with:

- final PASS/FAIL for every step through M11.1;
- PRs, workflow run, merge/deploy SHAs, and external non-secret object IDs;
- artifact hashes and private retention locations;
- resource savings;
- measured resume RTO;
- open follow-ups that do not weaken acceptance;
- explicit statement that Home Dev ends in `MODE=hibernated`;
- M11.2 marked `pending_external_closeout`.

Publish two distinct top-level attestations inside the index: one for the exact production
deployment and one for the exact Home Dev hibernated-profile deployment. Neither substitutes for
the other.

Then:

1. Create `codex/dev-hibernation-evidence-<RUN_ID>` from the then-current `origin/development` and
   add only the sanitized evidence index plus any strictly required index link. This is the fourth
   PR in the plan and is intentionally created after operational evidence exists.
2. Run a privacy/secret scan, link/hash validation, documentation tests, Commit Gate, and the
   required final repository validation for this evidence-only tree.
3. Open the evidence PR with the genuine M0 Linear ID in its title and `Fixes INT-XXX` in its body;
   obtain independent review of every milestone-to-artifact mapping and merge through normal
   protections.
4. Record the evidence PR URL, checks, merge SHA, and final clean local/deployed repository states
   in the private closeout ledger. The evidence file itself must not contain its own mutable merge
   SHA; GitHub PR metadata is the authoritative link.

After the M11.2 evidence-PR closeout rows are appended, validate the entire final ledger again.
M11.2 PASS is established only by this final schema/privacy validation together with authoritative
GitHub metadata, never by the tracked index itself. Either schema or privacy validation failure
blocks completion.

**Artifacts:** sanitized index, privacy scan, validation logs, fourth PR URL/check rollup/merge
SHA, and final clean-status reports.

**Gate:** The goal may be marked complete only when every M0–M11 gate is PASS, production is on
the reviewed SHA, Home Dev is hibernated, the 24-hour and post-drill stability windows have passed,
the final evidence PR is merged, and no required deployment/review remains. Near-completion,
elapsed time, or partial deployment is not sufficient.

## Endpoint Changes

### Created

- `https://matrix-outbound.intexuraos.cloud/api/matrix-outbound/*` — production-owned,
  machine-to-machine route to the retained Home Dev Matrix adapter, protected by Cloudflare Access
  service identity and the existing adapter bearer layer. Its health probe is exactly
  `GET /api/matrix-outbound/health`, stripped to adapter `GET /health`.

### Modified

- `https://dev.intexuraos.cloud/*` — changes from static/browser/API/machine routing to a
  deterministic, non-cacheable `503 Service Unavailable` hibernation response with no application
  upstream.
- Production `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` — changes from the DEV hostname to the new
  production-owned Matrix hostname.
- Home Dev orchestrator fallback callbacks — change from local/DEV to production; task-provided
  callback URLs remain authoritative. Environment/runtime observability tags change only if the
  audited identity decision requires it.
- Home Dev Pub/Sub UI `GET /health` retains existing fields and adds the privacy-safe versioned
  `drain` aggregate.
- Home Dev orchestrator `GET /health` bumps the health contract version and adds the privacy-safe
  `logForwarderDrain` aggregate; every typed consumer is updated.

### Removed

- `/api/matrix-outbound/*` routing from `dev.intexuraos.cloud`; the post-cutover active profile
  returns non-cacheable plain-text `410 Gone` for this prefix, while the final hibernated profile
  returns the host-wide `503`.
- Live browser API, static application, and external machine-webhook proxying from the hibernated
  DEV host. Their tracked active-profile contracts remain available for resume.

### Unchanged

- Existing `https://intexuraos.cloud` public application and API handler contracts.
- `cc-home.intexuraos.cloud`, CI health, SentryBox, FKA, self-development intake, private
  WhatsApp/Matrix, and their shared Home Dev tunnel/runtime routes.
- Production WhatsApp ingest, Matrix adapter business payload, bearer validation, and target
  mapping semantics.
- Retained GCP resource endpoints, Firestore collections, Auth0 tenant/client, OAuth callback
  allow-lists, secret container names, and service-account identities.
- Task-provided code-task callback URL contract and `workerLocation` semantics.

## Rollback strategy summary

Rollback is restoration, not reconstruction:

1. stop accepting new DEV work and verify no active task would be interrupted;
2. keep hibernated ingress selected while restoring the recorded last-good unit enablement;
3. start the emulator, observability, and PM2 in the tested resume order;
4. verify local health and the exact source/profile hashes before public ingress;
5. select `active-post-cutover` as the final runtime step, then re-enable external DEV producers
   only after separate confirmation;
6. if the cause is production Matrix or orchestrator cutover, restore the preceding exact
   production SHA/PROD package version and its reviewed Cloudflare/edge state; when that production
   revision still targets the old DEV Matrix path, select the immutable `active-pre-cutover`
   profile for the bounded rollback instead of `active-post-cutover`;
7. record the rollback as a failed milestone and keep the goal active until the plan is corrected,
   redeployed, observed, and completed.

No rollback step requires deleting production data, recreating the GCP project, recovering a
secret from Git, or reconstructing the dirty Home Dev changes from memory.
