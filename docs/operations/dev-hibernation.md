# IntexuraOS DEV hibernation

This is the application-side runbook for reversibly hibernating the IntexuraOS DEV environment on
Home Dev. It owns dependency removal, release order, signed evidence, production cutover, external
integrations, the observation window, and the recovery drill. The canonical
[Home Dev host runbook](https://github.com/pbuchman/pbuchman-dev/blob/main/machine-setup/dev-hibernation.md)
owns immutable profile installation, the root mode controller, systemd ordering, container and
port checks, and host rollback. Use both runbooks with one evidence run ID; neither replaces the
other.

The accepted implementation plan is
[`docs/superpowers/plans/2026-08-27-intexuraos-dev-hibernation.md`](../superpowers/plans/2026-08-27-intexuraos-dev-hibernation.md).
Its milestone gates are normative. A later step may not turn a failed, missing, or UNKNOWN earlier
gate into PASS.

## Safety rules

- UI inspection or authentication uses Computer Use with Google Chrome (`com.google.Chrome`) and
  the existing `kontakt@pbuchman.com` session. Do not use Safari, install an extension, create a
  browser profile, reset a password, or substitute CLI login for a required UI observation.
- Never print, screenshot, commit, or append secrets, message payloads, callback URLs, task IDs,
  ack IDs, access tokens, or private Matrix content to the evidence ledger.
- Persistent Cloudflare and GCP resources are Terraform-owned. Imports, applies, credential
  creation or rotation, secret-package publication, ingress changes, producer pause/resume, and
  destructive queue disposition require the confirmation specified by the accepted plan.
- Do not run the Home Dev controller from an unmerged tree. Do not edit a generated Caddy profile
  on the host. Do not use `git reset`, `git clean`, force-push, or an unrecorded state repair.
- A dry run is not authorization for the matching mutation. Confirmation binds the exact command,
  full revisions, plan hash, evidence run ID, artifact hashes, expected transition, and rollback
  target.

## One evidence run

Use the accepted run ID and plan hash for every repository, host, provider, and release artifact.
The private evidence root is outside Git:

```bash
export EVIDENCE_RUN_ID=20260828T002847Z-paddc4965d21e-b265702826912
export PLAN_SHA256=addc4965d21e9fdfcf2248a0896eb07e0ed1042be219071a9d5dcbc8bcfefcdb
export HOST_EVIDENCE_ROOT="/var/lib/intexuraos-dev/evidence/$EVIDENCE_RUN_ID"
export OPERATOR_EVIDENCE_ROOT="$HOME/.local/state/intexuraos/dev-hibernation/$EVIDENCE_RUN_ID"
test "$(sha256sum docs/superpowers/plans/2026-08-27-intexuraos-dev-hibernation.md | awk '{print $1}')" = "$PLAN_SHA256"
```

Every controller-consumed artifact is created atomically below the protected root-owned
`$HOST_EVIDENCE_ROOT`; never pass a path below `$OPERATOR_EVIDENCE_ROOT` to the host controller.
The operator root is archival-only and may contain only private copies or redacted hash/index
records exported after host-side validation. On macOS use `shasum -a 256` for the local comparison.
Do not copy private evidence into a pull request. The final tracked evidence index contains hashes,
timestamps, result classes, revisions, and redacted object identities only. Append to the private
ledger through its validator; never rewrite a previous row.

Every artifact must identify:

- milestone and gate;
- evidence run ID and plan SHA-256;
- capture start/completion time and observation method;
- exact IntexuraOS and `pbuchman-dev` revisions where applicable;
- sanitized inputs and output hash;
- `PASS`, `FAIL`, or `UNKNOWN`, with UNKNOWN treated as failure;
- reviewer and rollback linkage.

## Required state transitions

| Phase | DEV ingress | DEV runtime | External DEV producers | Production dependencies |
| --- | --- | --- | --- | --- |
| Baseline | `active-pre-cutover` | active | active | legacy dependencies recorded |
| Post-cutover validation | `active-post-cutover` | active | paused only at recorded boundaries | DEV-independent |
| Drain | `draining` | active for terminal callbacks only | paused | DEV-independent |
| Hibernation | `hibernated` (`503`, no upstream) | stopped and disabled | paused or migrated | DEV-independent |
| Recovery drill, internal | still `hibernated` | resumed and internally verified | paused | DEV-independent |
| Recovery drill, public | `active-post-cutover` after a separate cutover | active | resumed in order after proof | DEV-independent |
| Final state | `hibernated` | stopped and disabled | paused or migrated | DEV-independent |

Normal resume never selects `active-pre-cutover`. Internal runtime recovery and public ingress
activation are separate transactions. Public ingress remains hibernated until aliases, internal
health, static release, PM2, container, port, and retained-resource checks all pass and the
M10.2 confirmation is recorded.

## Prerequisites

Before M3 or any live change, require all of the following:

1. M0 evidence ledger and baseline are PASS.
2. The reconciliation PR is merged and all pre-existing `pbuchman-dev` bytes are recoverable.
3. M1.4 has its exact pre-mutation confirmation, the deployed checkout is clean, and
   `HEAD == origin/main`; otherwise stop before touching the deployed checkout.
4. M2 profile fixtures pass deterministic generation and isolated Caddy validation:

   ```bash
   pnpm run verify:dev-edge-profiles
   ```

5. The host controller passes its repository tests and the real disposable Linux/systemd+Caddy
   gate. Fake command fixtures alone do not satisfy this prerequisite.
6. The privacy-safe Pub/Sub and orchestrator health contracts, collector, signature verification,
   and pure drain verifier pass focused tests. A health endpoint must never mutate queue state.
7. Both implementation worktrees are clean, reviewed, committed, pushed, and represented by exact
   pull-request SHAs before M6 merge.

## Release and cutover order

The order is strict. Record the artifact named in the accepted plan after every gate.

### M3 — Cloudflare desired state, no traffic change

1. With Computer Use in the existing Google-authenticated Chrome session, record the relevant
   tunnel, `dev.intexuraos.cloud`, Access application/policies, and service-token policy. Capture
   only non-secret names, IDs, hostnames, decisions, and modification timestamps.
2. Establish the authoritative Terraform owner in
   `pbuchman-dev/terraform/cloudflare-home-dev/`. Import only after the specific state-operation
   confirmation. Require a no-op plan for the imported baseline.
3. Declare `matrix-outbound.intexuraos.cloud` behind `matrix_outbound_enabled`; review both the
   disabled no-op plan and the enabled additive plan. Do not apply it in M3.
4. Prove the generated Matrix Caddy fragment exposes only
   `/api/matrix-outbound/*`, strips the prefix to the adapter, and has no catch-all route.

### M4 — remove production runtime dependence on DEV

1. Point production Matrix outbound configuration at
   `https://matrix-outbound.intexuraos.cloud/api/matrix-outbound` and update all contract tests.
2. Pin Home Dev orchestrator callback fallbacks to production Code Agent and usage webhook URLs.
   Task-provided callback ownership remains authoritative.
3. Record the environment/runtime-tag decision and non-printing secret equality attestations.
4. Run the dependency regression gate. Production runtime values and deployment inputs may not
   point to `dev.intexuraos.cloud` outside the reviewed allow-list.

### M5 — external producer inventory and pause plan

Inventory GCP schedules/retries, GitHub webhooks or Actions, Linear, Tasker, Auth0, Firebase, Meta,
mobile automation, and any other producer found in M0. For each object record owner, current state,
pause action, proof, resume action, order, and rollback. UNKNOWN ownership blocks M8. Do not pause a
shared or production-owned object merely because its name contains `dev`.

### M6 — review and merge

1. Run focused tests, full repository tests, secret scans, generated-profile validation, and the
   complete tracked CI gate in both repositories.
2. Obtain independent reviews for route safety, state-machine rollback, privacy, data loss,
   production dependencies, and test adequacy.
3. Merge exact reviewed SHAs. Re-run clean-tree CI from the merge commits.
4. Install only the merged immutable profile/controller revision after the installation
   confirmation. Capture the last-good active state before any stop.

### M7 — telemetry freeze, then reviewed cutovers

#### M7.0 — activate the exact reviewed drain telemetry

Start the M7.0 freeze boundary before any Matrix, production, orchestrator, or route-selection
mutation. Prove authoritative zero task/log-forwarder state, then activate the exact reviewed
orchestrator telemetry artifact and replace only the Pub/Sub UI/bridge with its reviewed image.
Do not restart or recreate `pubsub-emulator`, execute `bootstrap.mjs`, or mutate its topology.
Record unchanged emulator identity/start time, exact source/image identities, fresh topology, both
counter epochs, complete classification, one listener per subscription, and both health contracts.
Nothing in M7.1–M7.4 may start until this gate passes.

#### M7.1 — apply and prove the parallel Matrix edge

After its explicit confirmation, apply the reviewed Cloudflare plan that adds only the parallel
Matrix route and Access policy. Save and hash the state-compatible rollback plan before linking
the exact staged Caddy fragment. Through Computer Use in Google Chrome, verify unauthenticated
denial, service-identity authorization, adapter bearer denial/acceptance, health, and the separately
confirmed bounded canary. Keep `active-pre-cutover` and the old DEV Matrix route unchanged.

#### M7.2 — deploy the exact IntexuraOS production revision

Freeze `origin/development` at the reviewed M6 merge SHA, dispatch the production workflow from
that exact ref with the pinned numeric secret-package version, and require the workflow and deployed
revision to match it. Verify `/deployment.json`, the rendered PM2/static releases, service health,
and production Matrix traffic through the new host. Roll back to the preceding exact production
SHA and package version if any gate fails.

#### M7.3 — reproject and enable the production-owned orchestrator

Require zero active work, atomically project the reviewed production environment, enable and
restart the production-owned orchestrator, then run the separately authorized production canary.
Prove all callback surfaces reach one terminal completion and that `logForwarderDrain` becomes
non-zero during the canary, returns to exact zero, and remains quiet on the same counter epoch.

#### M7.4 — retire the legacy DEV Matrix route by profile selection

Only after production traffic no longer uses the old path, atomically select the exact reviewed
`active-post-cutover` profile. Verify the legacy prefix returns plain-text non-cacheable `410 Gone`,
never falls through to the SPA, and produces no adapter upstream request. Do not edit or regenerate
any profile on the host.

## M8 signed zero-work gate

The collector and verifier live in:

- `scripts/lib/dev-hibernation-drain-collector.mjs`;
- `scripts/lib/dev-hibernation-drain-verifier.mjs`.

Use an ephemeral Ed25519 signing key stored only in the private evidence directory. Each health
and ownership observation is collected inside its measured, signed capture; do not pass a cached
snapshot. The final signed aggregate must bind the wrappers, public-key identity, source
revisions, quiet/freshness parameters, verifier result, and capture timestamp.

The aggregate `evidenceRunId` must equal the accepted `EVIDENCE_RUN_ID`. Before collection, create a
unique 256-bit hexadecimal `operationNonce` and pass both values to the collector. Aggregate
`createdAt` must be exactly the signed read2 completion time, not a later signing clock read.
Immediately before any stop, the host gate pins the expected run ID, nonce, public-key fingerprint,
artifact hash, source revisions, and a maximum artifact age no greater than 15 minutes. It verifies
every Ed25519 signature, recomputes the result, and consumes the operation nonce exactly once under
the transaction lock. A missing context, stale, future-dated, replayed, wrong-run, wrong-key,
wrong-revision, or tampered artifact is UNKNOWN. Unsigned legacy zero-work JSON is invalid.

Before collecting any signed witness, perform these steps in order:

1. Review the host controller `drain --dry-run` and obtain the exact draining-profile confirmation.
   Select and verify the reviewed `draining` profile. Prove it blocks every static, browser, and
   new-work route while preserving only the exact terminal callback routes. Do not run the signed
   proof while `active-pre-cutover` or `active-post-cutover` is selected.
2. Pause every inventoried DEV-only producer in its reviewed order and record an independent PASS
   proof for every producer. Shared or production-owned producers remain untouched and must have
   their ownership proven.
3. Confirm all M7 canaries and compliance/log tails are terminal, all pre-existing DEV log flushes
   are complete, and the exact reviewed telemetry deployment is still active without a process or
   emulator restart.
4. Capture a fresh signed freeze-boundary witness from each drain surface using the frozen M0.4
   authoritative ownership collector and the exact source revisions being verified.

Any producer-state change invalidates the entire proof and requires a fresh witness, anchor, read1,
and read2 after the new producer state is independently proven. The draining profile must remain
selected and the verified producers must remain paused through `hibernate`; otherwise stop and
restart the proof from the beginning.

The required sequence is `witness → anchor → read1 → read2`. After the preconditions above, it must
prove, without comparing clocks from different hosts:

- unchanged process epochs and source/surface identities;
- a fresh, successful Pub/Sub topology observation for every read;
- exact expected/observed/listener topology and no unclassified or listener-less subscription;
- zero Pub/Sub handlers/errors and zero orchestrator workers, callbacks, forwarders, buffers,
  chunks, upload requests, detached retries, and flushes;
- unchanged monotonic Pub/Sub, log-forwarder, and terminal-callback counters;
- independent, signed ownership queries with unique observation receipts;
- `nonzeroCount=0`, `unknownCount=0`, and the full required quiet interval.

Any restart, counter reset/decrease, stale or reused observation, invalid signature, missing state
file, topology gap, health failure, non-zero value, or UNKNOWN result stops M8. Do not Pull, Ack,
Nack, Seek, restart the emulator, inspect messages, or infer a numeric backlog from an endpoint.

After the final signed aggregate verifies as PASS:

1. Capture and hash `last-good-active-state.json` while ingress remains draining and all producers
   remain paused. Its signed-drain runtime pins must include `devDrainVerifierSources`,
   `devDrainNodeSha256`, and `devDrainNodeVersion`, taken from the immutable root-owned verifier tree
   and root-owned Node executable rather than a user-writable deployment checkout.
2. Review the host controller `hibernate --dry-run` against that manifest and the signed PASS
   artifact, then obtain the exact hibernation confirmation.
3. Execute `hibernate` with the exact signed PASS artifact as its gate. Do not run `drain` again,
   switch to an active profile, resume a producer, or otherwise open a new-work path between proof
   and hibernation.
4. Verify deterministic public `503`, no DEV upstream, no candidate process/container/port, ordered
   terminal log flush and shutdown, and healthy retained resources.

The host observer polls once per second, but a PASS requires unchanged complete metrics for at
least 20 seconds: two full cycles of Alloy's pinned `file_match.sync_period = "10s"`. Equal,
regressing, stale, or closer capture timestamps are UNKNOWN; sleeping without a new timestamp
cannot satisfy the gate.

## M9 — 24-hour observation

Start the clock only after M8 is fully PASS. For 24 continuous hours record production and retained
Home Dev health, errors, queue/outbox ownership, Cloudflare behavior, Matrix canaries, resource
usage, unexpected resurrection, and the deterministic DEV `503`. A gap or UNKNOWN observation
restarts the window unless the accepted plan explicitly classifies it otherwise. Do not resume DEV
to investigate a production issue until rollback criteria require it and the event is recorded.

## M10 — recovery drill and re-hibernation

Keep external producers paused and bind both transactions to the exact last-good manifest. Set the
following to the reviewed values; do not discover or substitute a newer revision during the drill:

```bash
export INTEXURAOS_SHA='<reviewed-40-character-IntexuraOS-SHA>'
export LAST_GOOD_MANIFEST="$HOST_EVIDENCE_ROOT/last-good-active-state.json"
export LAST_GOOD_SHA256='<reviewed-M8-last-good-64-character-SHA-256>'
export ACTIVE_POST_PROFILE="/var/lib/intexuraos-dev/profiles/$INTEXURAOS_SHA/active-post-cutover.caddy"
printf '%s  %s\n' "$LAST_GOOD_SHA256" "$LAST_GOOD_MANIFEST" | sudo sha256sum --check --strict
```

### M10.1 — internal resume while public ingress stays closed

Review the dry run, obtain the M10.1 confirmation for the exact command and artifacts, then run the
same command without `--dry-run`:

```bash
sudo /usr/local/sbin/intexuraos-dev-mode resume \
  --revision "$INTEXURAOS_SHA" \
  --profile "$ACTIVE_POST_PROFILE" \
  --evidence-run-id "$EVIDENCE_RUN_ID" \
  --last-good-manifest "$LAST_GOOD_MANIFEST" \
  --last-good-manifest-sha256 "$LAST_GOOD_SHA256" \
  --dry-run

sudo /usr/local/sbin/intexuraos-dev-mode resume \
  --revision "$INTEXURAOS_SHA" \
  --profile "$ACTIVE_POST_PROFILE" \
  --evidence-run-id "$EVIDENCE_RUN_ID" \
  --last-good-manifest "$LAST_GOOD_MANIFEST" \
  --last-good-manifest-sha256 "$LAST_GOOD_SHA256"

sudo /usr/local/sbin/intexuraos-dev-mode status |
  jq -e --arg revision "$INTEXURAOS_SHA" \
    '.result == "PASS" and .mode == "resuming" and .revision == $revision'
```

The successful command leaves `MODE=resuming` and the hibernated public profile selected, so the
public origin must still return deterministic `503`. The resume controller owns its single
allowlisted Pub/Sub bootstrap; do not invoke a second bootstrap command. Prove emulator identity
continuity, then verify exact aliases, internal service health, static release, PM2, candidate
ports, callbacks, and retained resources. A failed or abandoned internal acceptance must use the
bounded host rollback from `resuming`; it must never activate public ingress as recovery.

### M10.2 — separately confirmed public activation

Only after the M10.1 artifact is PASS, review this separate dry run. Obtain the M10.2 confirmation,
then execute the explicit public cutover with its required confirmation flag:

```bash
sudo /usr/local/sbin/intexuraos-dev-mode cutover \
  --mode active-post-cutover \
  --revision "$INTEXURAOS_SHA" \
  --profile "$ACTIVE_POST_PROFILE" \
  --evidence-run-id "$EVIDENCE_RUN_ID" \
  --last-good-manifest "$LAST_GOOD_MANIFEST" \
  --last-good-manifest-sha256 "$LAST_GOOD_SHA256" \
  --dry-run

sudo /usr/local/sbin/intexuraos-dev-mode cutover \
  --mode active-post-cutover \
  --revision "$INTEXURAOS_SHA" \
  --profile "$ACTIVE_POST_PROFILE" \
  --evidence-run-id "$EVIDENCE_RUN_ID" \
  --last-good-manifest "$LAST_GOOD_MANIFEST" \
  --last-good-manifest-sha256 "$LAST_GOOD_SHA256" \
  --confirm-public-activation
```

Verify login, one read-only page, representative API health, Matrix isolation, callback ownership,
and absence of DEV-only production dependencies.

### M10.3 — fresh drain proof and final re-hibernation

Pause any drill-created producer activity and independently prove the final producer state. From
`MODE=resuming`, keep the hibernated profile selected and repeat the complete signed zero-work and
Alloy-flush proof before invoking the evidence-gated `hibernate` command directly; public ingress
must never open. From `MODE=active-post-cutover`, execute `drain`, verify that the draining profile
is selected, then repeat the complete M8 proof before `hibernate`. Any other starting mode is a hard
failure. Never reuse M8 evidence or an earlier M10 nonce. Verify the final state is hibernated. The
drill passes only when rollback can still restore the recorded last-good revision.

## M11 — closeout

Create the tracked, redacted evidence index and link every M0–M11 gate to its private artifact hash.
Run final full CI and verify both merged/deployed SHAs, the 24-hour window, the completed
resume-to-rehibernate drill, production dependency scan, and rollback package. Keep the M1 recovery
branch/package; deleting them is a separate user decision. Close the goal only when production is
healthy and DEV is again hibernated, not merely because implementation PRs merged.

## Rollback rules

Rollback immediately on signature or identity mismatch, non-zero/UNKNOWN work, Caddy validation or
reload failure, unexpected route/upstream, failed production canary, callback misrouting, emulator
identity change, bootstrap residue, missing alias, unhealthy service, changed retained resource,
partial unit enablement, or inconsistent mode record.

- Before hibernation: retain or restore the last known safe ingress profile and leave runtime
  untouched.
- During hibernation failure: keep ingress closed, restore only the recorded unit enablement and
  internal runtime, verify it, then reopen `active-post-cutover` as the final separate action.
- During resume failure: keep hibernated ingress, stop only resources started by that transaction,
  restore prior enablement, and emit a recovery-required artifact. Never claim `MODE=hibernated`
  while runtime cleanup or enablement restoration is incomplete.
- During production/Cloudflare failure: restore the recorded production config, secret-package
  version, Terraform switch/state, and last-good route according to the reviewed plan.

After rollback, append the failure and recovery artifacts to the private ledger and restart the
affected milestone gate. Do not skip directly to M8, M9, or M10.
