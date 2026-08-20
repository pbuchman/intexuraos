# Runbook — Internal Service-to-Service Auth Rotation

IntexuraOS services authenticate internal requests with
`INTEXURAOS_INTERNAL_AUTH_TOKEN` in `x-internal-auth`. The value is:

- an env member of the DEV package;
- an env member of the PROD package;
- a native Secret Manager secret pinned numerically into the retained Gen2
  transcription function.

The current strict package contract does not contain a previous-token member,
and runtimes do not accept two internal-auth tokens. Rotation is therefore a
coordinated maintenance cutover with a tested package-wide rollback. Adding a
dual-token window would require a separate application, manifest, projection,
test, and deployment change before using such a procedure.

Never paste a token into commands, Git, Terraform, logs, evidence, chat, or
this runbook. Follow
[Secret Packages Operations](../operations/secret-packages.md) for secure
publication, exact numeric pins, rendering, audit, retention, and break glass.

## Preconditions

1. Obtain change approval and a maintenance window. Freeze unrelated package
   changes and deployments.
2. Record the current verified DEV and PROD numeric package versions and the
   transcription native numeric version. These are rollback pins; record no
   value or digest.
3. Inventory every caller and validator, including local/home-dev and
   production PM2, nginx-injected internal routes, Pub/Sub bridges, Scheduler
   callers, orchestrator, code workers, and retained transcription.
4. Confirm the previous DEV/PROD packages can still be fetched, validated, and
   rendered. Confirm the prior native version is enabled and deployable.
5. Prepare controls to stop new internal work and drain in-flight requests.
   Use the documented deployment/Terraform control plane; do not create ad hoc
   persistent resources.
6. Confirm Secret Manager Data Access audit logs and internal `401`/health
   telemetry are visible without request bodies or headers.

Stop if any consumer, rollback version, staging path, permission, or monitoring
gate is unknown.

## Prepare Candidates

1. Generate the replacement token with an approved cryptographically secure
   tool into a protected input channel or mode-`0600` ephemeral file. Do not
   display it or leave it in shell history.
2. Build complete DEV and PROD candidates. Change only
   `INTEXURAOS_INTERNAL_AUTH_TOKEN`; copy every other member from explicitly
   selected numeric sources.
3. Validate exact schema/membership, size, file formats, and CRC32C. Publish
   each candidate outside Terraform and record the returned numeric versions.
4. Fetch both returned versions by number into different mode-`0600` staging
   paths and validate again.
5. Run HMAC shadow comparison. It must report `MISMATCH` for the package as a
   whole because the token intentionally changed. Confirm from the candidate
   build record that every other member came from the same explicitly pinned
   source as the active package. Never persist HMACs or values.
6. Publish the same replacement as a new version of the native
   `INTEXURAOS_INTERNAL_AUTH_TOKEN` container. Record its numeric version. Do
   not yet change the function injection.
7. Stage all DEV and PROD projections, including nginx's
   `/etc/intexuraos/internal-auth-token`. Validate owner/mode and process
   allowlists without activating or printing them.
8. Prepare reviewed deployment changes that pin DEV, PROD, and transcription
   to the three new numeric versions. Publishing is not promotion.

## Coordinated Cutover

There is no safe mixed-token steady state. Keep the maintenance window active
until all callers and validators are on the same replacement or rollback is
complete.

1. Stop accepting new internal jobs and drain in-flight calls. Confirm queues,
   workers, and scheduled paths are at the approved cutover boundary.
2. Activate the staged DEV projection and reload home-dev PM2, nginx/bridges if
   applicable, orchestrator, and workers as one controlled wave. Run local
   internal caller/validator smoke checks.
3. Activate the staged PROD projection and reload production PM2 and nginx as
   one controlled wave. Verify an invalid token returns `401` and approved
   internal health/callback flows pass.
4. Deploy the retained transcription function pinned to the prepared native
   numeric version. Verify a bounded real transcription callback flow.
5. Resume ingress, Pub/Sub/Scheduler paths, and worker dispatch gradually.
6. Verify cross-runtime flows, `401` telemetry, PM2/nginx/function health, and
   Secret Manager audit principals. Any unexpected authentication failure
   triggers immediate rollback; do not attempt a per-service token edit.
7. Update reviewed `stableVersion` pins and deployment attestations with the
   exact numeric versions after verification. Evidence contains no value.

DEV and PROD may be staged independently, but they are not declared promoted
until their complete consumer inventories pass. If local developer processes
can call shared endpoints during the window, stop or update them before ingress
resumes.

## Observation And Closure

Monitor internal authentication failures, task callbacks, Pub/Sub/Scheduler
delivery, transcription, and audit logs for the approved observation period.
Keep the prior DEV/PROD and native versions enabled for rollback.

After the observation and rollback-drill gates pass:

1. disable obsolete native/package versions for the approved reversible
   window;
2. confirm zero reads of those versions;
3. destroy them according to retention policy, because disabled Secret Manager
   versions remain active/billable;
4. securely remove all ephemeral candidate/render files.

## Rollback

Rollback is coordinated and package-wide:

1. Re-enter maintenance, stop new internal work, and drain in-flight calls.
2. Fetch, CRC-check, validate, and stage the recorded prior numeric DEV and
   PROD versions. Do not reuse old staging files.
3. Atomically promote the complete prior projections and reload all DEV/PROD
   callers and validators.
4. Redeploy transcription pinned to its prior native numeric version.
5. Run invalid-token, internal API, nginx, Pub/Sub/Scheduler, orchestrator,
   worker, and transcription smoke tests.
6. Resume traffic only when every consumer is aligned to the prior token.
7. Record versions, timestamps, reason, and redacted results. Preserve the
   failed candidate's metadata for investigation.

Never roll back by editing one rendered field, selecting `latest`, mixing
package members, or leaving transcription on a different token.

If the old or new token may be compromised, do not roll back to the compromised
value. Generate another replacement, keep ingress paused, publish complete new
packages/native version, and perform an accelerated coordinated cutover. Invoke
the incident process and review audit/application logs.

## Cadence And Evidence

Rotate at least quarterly and immediately after suspected exposure, excessive
access, owner departure, or a failed repository scanner.

Evidence contains environment, package/native secret IDs, exact numeric
versions, commit/deployment, timestamp, principal, member counts, CRC32C and
validation status, smoke results, authentication-error counts, maintenance
start/end, and rollback pins. It must not contain token values, digests,
payload JSON, request headers, rendered files, or command environments.

## References

- Header: `x-internal-auth`
- Current env: `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- Package manifest: `config/environments/secret-packages.json`
- Package operations: `docs/operations/secret-packages.md`
