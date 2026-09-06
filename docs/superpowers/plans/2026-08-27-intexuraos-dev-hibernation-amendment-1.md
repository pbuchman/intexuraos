# Amendment 1 — DEV Hibernation Evidence and Drain Safety

## Status

**Proposed.** This amendment changes the accepted plan SHA and therefore requires explicit renewed
user acceptance before it is applied or any implementation resumes.

The accepted plan remains:

- `docs/superpowers/plans/2026-08-27-intexuraos-dev-hibernation.md`
- SHA-256 `a8e84e2e9e30d8178ca892608f24ff4bc5d77b960936bb58ae30cb18f2912659`

The existing evidence run
`20260827T131144Z-pa8e84e2e9e30-b265702826912` remains byte-for-byte unchanged. After acceptance
and exact application of this amendment, its supersession is recorded only in the new run's
bootstrap manifest and an external private run registry; no prior artifact or ledger row is edited,
deleted, or appended. It cannot satisfy an amended gate. A new RUN_ID is created from the resulting
plan SHA and the revalidated base SHA.

## Reason for the amendment

Independent review found two classes of issue:

1. M0 evidence was incomplete: the dirty Home Dev checkout and some provider IDs were absent,
   several systemd fields were omitted, Alloy/bridge ownership proof was not independently
   reproducible, the repository ref matrix was incomplete, and the ledger lacked a tracked
   machine-validated schema.
2. The Pub/Sub emulator and the in-memory log forwarder do not expose a safe non-mutating backlog
   count. Using Pull as a probe would change delivery state, while the current log-forwarder queue
   can transiently report zero during an upload. Live Pub/Sub bridge source/image drift also means
   the running bridge cannot be used as reviewed drain evidence.

The amendment strengthens the final cutover gates. It allows M0 to classify a proven native
measurement gap, but M6 and every live cutover remain blocked until exact reviewed telemetry is
merged, staged, activated, and proven quiet.

## Exact plan changes

### A1. Evidence contract and run identity

Add after the RUN_ID definition:

> A change to the accepted plan SHA always starts a new RUN_ID. Evidence from an earlier plan SHA
> remains immutable; its supersession is recorded only outside that run, in the new bootstrap
> manifest and private run registry. It cannot satisfy any amended gate.

Replace the ledger row contract with:

> Every row is validated before append against
> `docs/operations/evidence/dev-hibernation-ledger.schema.json`. The tracked template is
> `docs/operations/evidence/dev-hibernation-ledger.template.json`. Every row contains:
>
> 1. schema version, run ID, milestone and step ID;
> 2. observed-at and appended-at UTC timestamps plus actor alias;
> 3. target host/system;
> 4. `sourceRevisions`: an array of repository, ref, full 40-character commit SHA, and tree SHA;
> 5. `externalObjectIds`: an array of provider, object type, ID kind, and non-null ID;
> 6. private artifact relative path and SHA-256;
> 7. privacy classification;
> 8. PASS/FAIL and a short sanitized conclusion.
>
> Both arrays are always present. An empty array requires a machine-validated not-applicable
> reason. Abbreviated SHAs, null IDs, placeholders, or omitted keys are invalid.
>
> Human email addresses are replaced by an actor alias or an irreversible run-keyed identifier.
> User-home paths are normalized to `${OPERATOR_HOME}` and `${HOME_DEV_HOME}`. Service-account
> principals may retain their technical email-shaped object IDs. The validator and the M11 privacy
> scan reject human email addresses and raw `/Users/<name>` or `/home/<name>` paths in tracked
> evidence.

This strengthens evidence integrity and removes abbreviated or ambiguous source identity.

### A2. Replace M0.1 steps

Replace M0.1 steps 1–5 with:

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
5. Resolve a genuine Linear `INT-XXX`. No implementation branch or PR may be created before it
   exists.
6. Only after steps 2–5 and the M0.1 working-tree-safety predicate pass, create the planned
   IntexuraOS branch from the frozen base. Add tests first, then the ledger schema, template, and
   validator; run the required validation and Commit Gate, commit them, obtain read-only review,
   and record the full commit, tree, and schema hashes.
7. Initialize the ledger from that exact committed schema hash. The run continues to validate
   against that frozen schema; changing it for this run requires a new schema version and new run.
   Append the bootstrap observations in original `observedAt` order while recording their later
   `appendedAt` timestamps. Validate every append.

Extend M0.1 artifacts with:

- `m0-baseline/bootstrap-manifest.json`;
- the complete ref matrix;
- `docs/operations/evidence/dev-hibernation-ledger.schema.json`;
- `docs/operations/evidence/dev-hibernation-ledger.template.json`;
- validator test log;
- `m0-baseline/ledger-validation.json`.

Extend the M0.1 gate to require a complete ref matrix and a schema-valid ledger. This ordering
removes the cycle between needing a tracked schema and being forbidden to create a branch before a
genuine Linear issue exists.

### A3. Strengthen M0.2 systemd and log-consumer ownership evidence

Add to M0.2 step 1:

> Every named systemd property must be present in the JSON. Zero is a value, not an omission. When
> a property is genuinely inapplicable to a verified unit type, record `value=null`,
> `applicability=notApplicable`, the unit type, and a concrete reason. `unavailable` or an omitted
> field blocks M0.

Replace M0.2 step 5 with:

> Produce a structured private projection for Alloy and `pm2-journal-bridge` containing every
> live source/config fragment and hash, include chain, input selector/glob, resolved input paths,
> output destination, buffer/flush owner, and shared-input result. Preserve privacy-safe private
> copies of exact live fragments only after secret-scanning them. For a secret-bearing file,
> preserve only its normalized path, owner/mode, exact SHA-256, allow-listed field names, and a
> structured redacted projection; never duplicate its values into evidence. The ownership proof
> must remain reproducible from hashes, selectors, resolved inputs, and outputs. Narrative or a
> top-level file hash alone is insufficient.

Add artifact `m0-baseline/log-consumer-ownership.json`.

### A4. Replace M0.3 source-universe and external-object steps

Replace M0.3 steps 3–4 with:

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

Add the following ID rule:

> A provider-native ID is mandatory whenever the provider exposes one. For an allow-listed
> provider that demonstrably has no native object ID, currently Tasker only, use
> `idKind=derived-canonical` and SHA-256 of the whitespace-free UTF-8 JSON encoding of
> `["tasker", accountScopeSha256, deviceScopeSha256, NFC(profileName)]`, preserving the profile
> name's exact case. Record the exported configuration SHA separately and retain private evidence
> proving that no native ID exists. Only the digest enters tracked evidence; raw account, device,
> and profile identifiers remain private. Null, placeholder, generic name-only, or an unproved
> derived ID blocks M0.

Add artifact `m0-baseline/dev-reference-scan-sources.json`. Extend the M0.3 gate to require scan
completeness, final disposition for every match, and every required stable ID.

### A5. Replace M0.4 with an ownership and topology gate

Replace the complete M0.4 section with:

#### M0.4 Freeze active work and establish topology ownership

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

### A6. Add M2.4 privacy-safe non-mutating drain observability

Insert after M2.3:

#### M2.4 Add privacy-safe, non-mutating drain observability

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
   `activeFlushOperations`, and process-lifetime monotonic `droppedChunksTotal` that survives
   individual forwarder close. Expose no task ID, callback URL, log content, or secret; update every
   typed consumer and contract test.
   For both Pub/Sub UI and orchestrator, each process start generates a new non-reused 128-bit
   random `counterEpochId`; it is never persisted or reused across restarts and remains immutable
   only within that process lifetime.
4. Account for chunks from enqueue until upload success/failure. Clearing `pendingChunks` before
   awaiting `sendBatch` must leave the corresponding in-flight counts non-zero, including retries
   and concurrent flushes. `inFlightHandlers` remains non-zero until forwarding outcome, ack/nack
   handoff, its monotonic counter, and `lastActivityAt` update complete as one observable state
   transition. No health snapshot may observe handler zero before ack/nack accounting is visible.
5. Add a pure tested verifier that derives `pendingStatus=zero|nonzero|unknown` only from the
   required snapshots, counter epochs, process identities, fresh topology, freeze boundary, and
   required quiet interval. Neither endpoint invents a numeric backlog; only this verifier may
   emit `zero`.
6. Write failing tests first for empty, buffered, queued, upload-in-flight, retrying, failed,
   concurrent-flush and counter-reset states; and for incomplete topology, listener startup
   failure, message in flight, successful ack, nack, forward failure, subscriber error, and stable
   quiescence. Include process restart, forwarder close, stale topology, duplicate listener,
   counter-epoch mismatch, and freeze-anchor-to-read delta cases.

**Artifacts:** RED/GREEN logs, endpoint schemas, source/image build identity, and privacy-contract
tests.

**Gate:** Isolated tests prove pending work can never report zero while any buffer, partial line,
queued chunk, upload, handler, retry, topology gap, listener failure, or unreported error exists.

### A7. Strengthen M6 merge and staging gates

Add after the M6 heading:

> M6 cannot PASS until M2.4 is merged in the exact candidate revisions, all focused
> drain-observability tests pass, and the staged Pub/Sub UI image and orchestrator artifact are tied
> to their reviewed source/tree hashes.

Add M6.3 step 5:

> Build and stage the exact reviewed Pub/Sub UI image and orchestrator artifact. Record OCI/image
> digest, source/tree hash, expected topology hash, and an explicit classification for every live
> subscription. Do not activate the new bridge image yet.

Extend the M6.3 gate:

> A stale or untraceable bridge image, source/image drift, an unclassified live subscription, or a
> missing drain schema blocks staging and M7.

### A8. Add M7.0 and strengthen the orchestrator canary

Insert before M7.1:

#### M7.0 Activate the exact reviewed drain telemetry

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

Add to M7.3 canary acceptance:

> During the production-owned canary, prove `logForwarderDrain` changes from zero to at least one
> non-zero active/buffered/queued/in-flight field, then returns to all-zero with no dropped-chunk
> delta after terminal completion and after any compliance/log tail has closed, but before M8
> starts.

### A9. Strengthen M8.1 final zero-work proof

Replace M8.1 step 2 and its Pub/Sub/log-forwarder criteria with:

2. After M7.0 is active, all M7 canaries and compliance/log tails are terminal, the draining profile
   is selected, and every producer targeting the DEV application runtime or emulator is paused,
   record the final producer-freeze boundary. Any activity after it fails the pair; after resolving
   the cause, record a later boundary and restart the proof from the beginning.
3. Immediately after that boundary, capture a signed freeze-anchor snapshot containing both
   `counterEpochId` values, process start times, expected/observed/active-listener topology hashes,
   fresh topology observation time, per-subscription listener multiplicity, all monotonic counters,
   and every drain gauge. Both process start times must be no later than the freeze boundary.
4. Repeat the authoritative ownership checks and both exact drain-health reads twice. The same
   bridge container/process, orchestrator process, and counter epochs must span the freeze anchor,
   read 1, and read 2. The interval from anchor to read 1 and from read 1 to read 2 is each at least
   the maximum of 600 seconds and every longer producer, poll, retry, callback, or
   subscription-redelivery interval established by inventory.

The anchor, two reads, and both interval deltas must additionally prove:

- each snapshot refreshes topology with non-mutating ListTopics/ListSubscriptions and has a fresh
  `topologyObservedAt`, unchanged observed topology hash, `topologyMatch=true`, no unclassified
  subscriptions, exactly one active listener per classified subscription,
  `activeListenerTopologyHash=observedTopologyHash`, `setupErrors=0`, and `inFlightHandlers=0`;
- received, acked, nacked, forward-failed, subscriber-error, and dropped-chunk deltas are zero from
  freeze anchor to read 1 and from read 1 to read 2;
- no Pub/Sub activity timestamp later than the producer-freeze boundary;
- orchestrator `activeForwarders=0`, `bufferedBytes=0`, `partialLineBytes=0`,
  `queuedChunks=0`, `inFlightBatches=0`, `inFlightChunks=0`, and
  `activeFlushOperations=0`;
- all existing task, evaluation, producer, old-Matrix-route, production-health, and retained-host
  predicates from this section.

The verifier may emit `pendingStatus=zero` only when every topology, listener, in-flight, error,
instance-stability, and quiet-period predicate passes. UNKNOWN remains failure. Evidence collection
must not invoke Pull or an additional StreamingPull probe, Ack, Nack, ModifyAckDeadline, Seek,
snapshot mutation, or emulator restart.

Replace the discard paragraph with:

> A non-zero or UNKNOWN result stops M8. A separately confirmed destructive disposition is a
> distinct mutation, never a measurement technique; after it, reverify the exact telemetry
> deployment, record a new freeze boundary and anchor, and repeat anchor → read 1 → read 2 from the
> beginning.

This replaces a nonexistent direct native backlog counter with a conservative derived result. It
is less direct as a single measurement, but the cutover gate is stronger: complete freshly listed
topology, one listener per subscription, in-flight counts, monotonic error/activity deltas,
freeze-anchor continuity, immutable process counter epochs, UNKNOWN-fail behavior, and two full
quiet intervals of at least ten minutes are all mandatory.

### A10. Strengthen M11 and document endpoint changes

Add to M11.1 and M11.2:

> Validate every ledger row through M11.1 before rendering and freeze that snapshot hash. Run a
> privacy scan that rejects human email addresses and raw user-home paths in tracked evidence.
> After the M11.2 evidence-PR closeout rows are appended, validate the entire final ledger again.
> Either schema or privacy validation failure blocks completion.

Add under `Endpoint Changes` → `Modified`:

- Home Dev Pub/Sub UI `GET /health` retains existing fields and adds the privacy-safe versioned
  `drain` aggregate.
- Home Dev orchestrator `GET /health` bumps the health contract version and adds the privacy-safe
  `logForwarderDrain` aggregate; every typed consumer is updated.

## Gate impact review

| Change | Gate impact |
| --- | --- |
| Schema-valid ledger, complete refs, full source universe, provider IDs, structured ownership evidence | Stronger |
| Tasker `derived-canonical` ID after proof that no native ID exists | Narrow representation exception; null/placeholder still fails |
| M0.4 recognizes a proven absence of a native non-mutating counter | M0 alone is less restrictive; M6 and every live cutover remain hard-blocked |
| M2.4, M6 source/image attestation, M7.0 exact activation, M8 stability/delta proof | Stronger |
| M11 schema validation and endpoint inventory | Stronger |

## Acceptance effect

Acceptance authorizes applying exactly A1–A10 to the accepted plan. It does not authorize an
external mutation, a Cloudflare apply, a provider configuration save, a Matrix canary, or any
destructive queue action; their existing just-in-time confirmation gates remain unchanged.

After exact application, the resulting plan SHA is shown to the user and becomes the source of the
new RUN_ID. Any textual deviation from A1–A10 requires another diff and acceptance.
