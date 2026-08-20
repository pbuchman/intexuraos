# Secret Packages Operations

This runbook is the operational source of truth for the two atomic runtime
secret packages used by IntexuraOS. It covers package construction,
publication, promotion, rendering, rotation, rollback, emergency access, and
disaster recovery. The runtime/configuration boundary remains documented in
[Runtime Configuration And Secret Manager Policy](./runtime-configuration.md).

Never place a real value, private key, complete package, reversible digest, or
rendered environment file in Git, Terraform state, terminal history, logs,
screenshots, tickets, chat, or deployment evidence.

## Target Inventory

| Secret Manager container | Purpose | Normal readers |
| --- | --- | --- |
| `INTEXURAOS_SECRET_PACKAGE_DEV` | Atomic package for local, home-dev, orchestrator, workers, and dev observability | local operator/renderer and home-dev bootstrap/renderer only |
| `INTEXURAOS_SECRET_PACKAGE_PROD` | Atomic package for Hetzner services, web build, nginx, TLS, and Cloudflare projections | Hetzner provisioner and protected production deploy identity only |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Native Gen2 transcription injection | transcription service account and package publisher |
| `INTEXURAOS_SPEECHMATICS_APP_API_KEY` | Native Gen2 transcription injection | transcription service account and package publisher |

The Google-managed Cloud Build GitHub connection token is outside this
inventory. All other application-level individual containers are legacy and
must not be read after cutover.

The native names describe physical exceptions, not exclusive storage.
`INTEXURAOS_INTERNAL_AUTH_TOKEN` is also an env member of DEV and PROD;
`INTEXURAOS_SPEECHMATICS_APP_API_KEY` is also an env member of DEV. This keeps
non-Gen2 consumers inside the atomic package model while transcription uses
native numeric injection.

DEV and PROD are separate trust boundaries even though both are stored in the
same GCP project. No identity receives access to both packages merely for
convenience.

## Manifest And Payload Contract

`config/environments/secret-packages.json` is the non-secret, reviewable
contract. It has `schemaVersion: 1`, a `packages.dev` and `packages.prod`
record, and `nativeSecretNames`. Each package record declares:

- `secretId`: the physical container name;
- `stableVersion`: the positive numeric candidate selected in reviewed desired
  state before deployment; promotion is proved separately by successful runtime
  smoke evidence;
- `envNames`: the exact environment-variable member set;
- `files`: the exact base64-encoded file member set.

`config/environments/secret-package-sources.json` is the separate non-secret
candidate-build contract. Its `schemaVersion: 2` pins every initial-migration
legacy source to an exact positive numeric version, classifies every package
member as either a legacy Secret Manager source or an explicit external file,
and binds each environment to its `basePackageSecretId` for post-cleanup
rotations. CI validates it against `secret-packages.json`: missing, extra,
overlapping, mutable, unused, or mismatched base-package sources fail the
repository check. Neither manifest contains a value.

Every payload is UTF-8 JSON with this shape:

```json
{
  "schemaVersion": 1,
  "environment": "dev-or-prod",
  "env": {},
  "files": {}
}
```

The validator rejects a wrong environment, missing or extra members,
non-string environment values, malformed base64, malformed PEM/service-account
JSON, a payload over 64 KiB, or a non-numeric version. File member names encode
the expected representation:

| Package | File members |
| --- | --- |
| DEV | `githubAppPrivateKeyPemBase64` |
| PROD | `runtimeGcpServiceAccountJsonBase64`, `tlsPrivateKeyPemBase64`, `cloudflareDnsApiTokenBase64` |

The generic renderer writes `environment.env` and `metadata.json` for both
environments, plus `github-app-private-key.pem` for DEV and
`runtime-gcp-service-account.json`, `tls-private-key.pem`, and
`cloudflare-dns-api-token` for PROD. These are immutable release artifacts;
installers copy only the target-specific subset to final runtime paths.

`INTEXURAOS_FIREBASE_API_KEY` is an environment member of both packages. It is
a Firebase browser key and remains visible in the compiled SPA. Packaging it
removes it from tracked source and gives it a coordinated rotation path; it
does not make the browser key confidential.

Do not add a package member ad hoc. Change the manifest, policy, all required
projections, tests, and this runbook in one reviewed pull request. A consumer
must receive only its allowlisted projection, never the complete package.

## Ownership And IAM

Terraform owns containers, replication, labels, IAM, service accounts,
Workload Identity Federation, and native-secret version references. Terraform
must never own package payloads, package versions, service-account private key
material, or any `secret_data` value.

| Principal class | Required access | Explicitly forbidden |
| --- | --- | --- |
| Package publisher | add versions to the one approved package; read only sources required to build it | runtime execution, broad project administration, logging payloads |
| Local/dev renderer (`ixos-home-secret-renderer-dev`) | access one exact DEV version | PROD package, version creation, individual legacy secrets |
| Hetzner provisioner | access one exact PROD version | inclusion in PROD, application/data-plane runtime privileges |
| Hetzner runtime SA | Firestore/GCS/Pub/Sub/Firebase Auth minimum runtime roles | Secret Manager accessor, package publication, provisioner privileges |
| Local/home-dev runtime (`ixos-home-runtime-dev`) | minimum Firestore/GCS/Pub/Sub/Firebase Auth data-plane union | Secret Manager, Artifact Registry administration, operator privileges |
| Orchestrator (`ixos-home-orchestrator-dev`) | pull images from the DEV Artifact Registry repository | Secret Manager, data-plane runtime roles, full-package forwarding |
| Code worker | task-specific allowlisted env/files from orchestrator | Secret Manager access, package metadata, broad host credential |
| GitHub retained-GCP deploy | exchange protected OIDC identity to trigger the approved Cloud Build targets only | package access, long-lived GCP JSON key, unconditioned repository access |
| GitHub Hetzner deploy | SSH the reviewed commit and numeric PROD pin to the host; the host provisioner fetches PROD | any Google credential or direct package access |
| Transcription SA | access the two native secrets at pinned numeric versions | either package and all other application secrets |

Grant `roles/secretmanager.secretAccessor` on the package resource, not at
project level. Separate version-adder and accessor roles. Condition GitHub WIF
on immutable repository owner/repository identifiers and the exact approved
ref. Review IAM drift before every promotion.

The provisioner credential must remain outside PROD: a credential cannot be
used to open the package that contains the same credential. Prefer short-lived
ADC, service-account impersonation, or WIF for operators and automation. A
bootstrap key is a bounded exception, not a runtime credential.

The same rule applies to DEV. home-dev uses a dedicated renderer identity with
resource-level access to the DEV package only; its transitional bootstrap JSON
is `/home/pbuchman/.config/intexuraos/secret-renderer-sa-key.json`, mode `0600`,
outside the repository and package. The broad `claude-code-dev` key is not a
package member and must not be copied into code workers. A local Mac should
prefer user ADC plus impersonation of `ixos-home-secret-renderer-dev`.
PM2 uses the separate external
`${HOME}/.config/intexuraos/home-runtime-sa-key.json`; the orchestrator
generator fixes its host credential to
`${HOME}/.config/intexuraos/home-orchestrator-sa-key.json`. Both are mode
`0600`, outside the repository/package, and denied Secret Manager. The latter
has only repository-level Artifact Registry reader and is never forwarded to a
code worker.

## Immutable Version Rules

- Use positive decimal version numbers everywhere. `latest` and mutable aliases
  are forbidden for fetch, render, deploy, rollback, native injection, and
  evidence. Google documents access by version number as strongly consistent,
  while aliases and `latest` can be eventually consistent.
- A package version is immutable. Correct an error by publishing another
  version; never attempt per-member repair.
- Validate CRC32C on upload and download. A mismatch fails closed and leaves
  active files untouched.
- `stableVersion` moves in a reviewed desired-state change after offline
  candidate verification and before deployment, together with the Terraform
  and protected workflow pins. Publishing or selecting a version does not
  promote it; only successful runtime smoke evidence does. Compensation restores
  all three pins to the recorded prior version.
- Record secret ID, numeric version, payload byte count, member counts, CRC32C
  result, principal, timestamp, commit, and pass/fail only.

## Candidate Build And Publication

Use a private working directory created with mode `0700`. Candidate payloads
and rendered staging output must be mode `0600`, live outside the repository,
and be securely removed immediately after use. Disable shell tracing before any
step that handles a value.

The candidate builder's base command is:

```bash
node scripts/build-secret-package.mjs \
  --environment dev --project-id <project-id> \
  --output <mode-0600-candidate> \
  --firebase-api-key-file <mode-0600-file>
```

Firebase is the one required external input for both environments. A PROD build
also requires both PROD-only inputs:

```bash
node scripts/build-secret-package.mjs \
  --environment prod --project-id <project-id> \
  --output <mode-0600-candidate> \
  --firebase-api-key-file <mode-0600-file> \
  --runtime-gcp-service-account-file <mode-0600-file> \
  --cloudflare-dns-api-token-file <mode-0600-file>
```

Do not supply those two inputs to a DEV build. The builder obtains the DEV
`githubAppPrivateKeyPemBase64` member from exact legacy version `1` of
`INTEXURAOS_GITHUB_APP_PRIVATE_KEY`. It obtains the PROD
`tlsPrivateKeyPemBase64` member from exact legacy version `1` of
`INTEXURAOS_SSL_PRIVATE_KEY`. The source manifest declares the exact numeric
versions for every remaining legacy environment member.

External inputs must be non-symlink regular files with no group/other permission
bits and at most 64 KiB. The builder reads only the declared legacy versions,
checks the server-provided CRC32C, builds in manifest order, validates the
complete payload, and atomically writes the candidate as mode `0600`. It emits
only environment, counts, byte length, and checksum metadata; source values and
the payload never go to stdout or stderr. `--manifest <path>` and
`--sources-manifest <path>` are optional overrides for isolated verification and
tests, not a way to bypass review of the tracked contracts.

After the first complete version is promoted, and especially after individual
legacy containers are removed, build the next candidate from the reviewed
active package version plus only the members being rotated:

```bash
node scripts/build-secret-package.mjs \
  --environment dev --project-id <project-id> \
  --output <mode-0600-candidate> \
  --base-version <numeric-version> \
  --override-env INTEXURAOS_OPENAI_APP_API_KEY=<mode-0600-file> \
  --override-file githubAppPrivateKeyPemBase64=<mode-0600-file>
```

Repeat `--override-env NAME=<mode-0600-file>` or
`--override-file NAME=<mode-0600-file>` for every member in the approved
rotation. Names must be exact members of the target package manifest and at
least one override is required. The builder fetches only the declared
`basePackageSecretId` at the canonical positive numeric `--base-version`,
verifies the server CRC32C and complete base membership, applies the explicit
private-file replacements in manifest order, validates the complete candidate,
and writes it atomically as mode `0600`. It rejects `latest`, `01`, duplicate or
unknown members, and any attempt to mix base mode with the initial-migration
external flags. Secret values remain in private files, never in CLI arguments,
stdout, or stderr.

For a simulated or actual lost-container recovery, omit `--base-version` and
provide the complete package manifest as private files: one
`--override-env NAME=<mode-0600-file>` for every `envNames` member and one
`--override-file NAME=<mode-0600-file>` for every `files` member. In this mode
the builder does not call Secret Manager. It rejects partial, extra, unknown,
or duplicate member sets rather than falling back to a legacy source. Build
the repeated arguments from the reviewed recovery inventory without placing
values in shell history, command output, evidence, or the repository.

1. Select the target environment and record the current `stableVersion` as the
   rollback version.
2. For the initial build, resolve every manifest member from the reviewed
   numeric legacy source or protected external file. For later rotations, pin
   the exact active package version and provide protected private-file
   overrides only for the approved rotated members.
3. Create the candidate payload without printing it. Base64-encode multiline
   file material exactly once.
4. Run the package validator. A missing or extra member blocks publication.
5. Publish through the package CLI with a new private receipt path. The CLI
   first takes a package-scoped local journal lock, records the target's current
   maximum numeric version, and durably reserves a complete `publishing`
   receipt. It then streams the payload to `gcloud` without placing it in an
   argument or log and records the returned numeric version before readback.
6. If publication stops, preserve the candidate and receipt. Resume a
   `pending-verification` receipt directly. For an ambiguous `publishing`
   receipt, reconcile the exact version from Secret Manager metadata/audit
   evidence with `publish-reconcile`; neither recovery command creates a second
   version.
7. Fetch that exact numeric version into a different mode-`0600` staging path
   and validate it again.
8. Run shadow comparison with legacy values. Evidence may show only the
   package-level `MATCH`/`MISMATCH` result; the comparison uses an ephemeral
   HMAC key and must not persist digests.
9. Render each required consumer projection to staging. Validate names,
   ownership, modes, parsability, and service-specific allowlists without
   printing content.
10. Before deployment, update `stableVersion`, the Terraform bootstrap pin, and
    the protected workflow variable to the candidate's numeric version as one
    reviewed desired-state change. `stableVersion` is the selected deployment
    target, not proof that the candidate already passed production smoke.
11. Run environment smoke tests. Only after all gates pass may deployment
    evidence call that selected version promoted. If deployment compensates to
    the previous release, immediately restore all three desired-state pins in a
    reviewed recovery change; never leave a failed candidate recorded as stable.
12. Delete candidate, fetch, render, and HMAC staging material. Retain or archive
    the verified metadata-only receipt according to the change evidence policy.

The exact command contracts are:

```bash
node scripts/secret-package.mjs validate \
  --environment <dev-or-prod> --payload-file <candidate>
node scripts/secret-package.mjs publish \
  --environment <dev-or-prod> --project-id <project-id> \
  --payload-file <candidate> --receipt-file <private-receipt>
node scripts/secret-package.mjs publish-resume \
  --environment <dev-or-prod> --project-id <project-id> \
  --payload-file <candidate> --receipt-file <private-receipt>
node scripts/secret-package.mjs publish-reconcile \
  --environment <dev-or-prod> --project-id <project-id> \
  --payload-file <candidate> --receipt-file <private-receipt> \
  --version <exact-recovery-version>
node scripts/secret-package.mjs publish-unlock \
  --environment <dev-or-prod> --project-id <project-id> \
  --receipt-file <private-receipt>
node scripts/secret-package.mjs fetch \
  --environment <dev-or-prod> --version <numeric-version> \
  --project-id <project-id> --output <private-file>
node scripts/secret-package.mjs render \
  --environment <dev-or-prod> --version <numeric-version> \
  --project-id <project-id> --output-dir <private-render-root>
node scripts/secret-package.mjs dual-compare \
  --environment <dev-or-prod> --left-payload-file <source-a> \
  --right-payload-file <source-b> --hmac-key-file <ephemeral-key>
```

`render` also accepts `--payload-file <already-fetched-file>` for offline
rendering. It creates `<env>-v<N>-<crc32c-hex>/` and atomically switches
the generic package `current` inside the selected render root; consumers read
only `current/environment.env` and their allowlisted file(s). Production has a
second, independently managed runtime projection `current`: staging a complete
target projection does not switch that runtime pointer or its stable file
links. DEV also reserves
`${HOME}/.config/intexuraos/secret-packages/dev` for the four-file projection
published by `sync-secrets.sh`; never select that projection root for a generic
render. Use a distinct mode-`0700` scratch render root and remove it after
validation. Never bypass the CLI with direct
`gcloud secrets versions access` or `gcloud secrets versions add` in an
operational procedure.

### Interrupted Publication Recovery

The receipt must live below one canonical private journal parent: an
owner-writable mode-`0700` directory on a local filesystem that provides hard
links and durable directory `fsync`. Use one publisher/freeze for the package.
The exclusive mode-`0600` lock name is derived from project and package secret
ID, not from the receipt filename, so two different receipt paths in this same
parent cannot publish concurrently. A different parent or host is outside that
local lock domain and is forbidden for the operation.

`publish` rejects an existing destination, symbolic link, non-regular file, or
file with group/other access. Under the package lock, it lists only the target
package's version metadata and records the greatest numeric ID as
`prePublishMaxVersion` (`0` for an empty container). It then writes a complete
private temporary inode, synchronizes it, installs the final pathname with a
no-replace hard link, and synchronizes the parent. The same complete-inode
reservation applies to the lock. `addVersion` is not called until the final
receipt is durable. A power loss therefore leaves either no reserved receipt
before any add or a complete schema-v2 receipt in state `publishing` with
`version: null`, never a partially written final receipt.

The schema-v2 receipt binds the operation with a UUID-v4 `operationId`, the
canonical UTC `startedAt`, and `prePublishMaxVersion`. It also contains exactly
schema/operation, state, environment, project ID, package secret ID, and a
positive numeric version or `null` while the response is ambiguous. It contains
no payload, member value, base64, checksum, digest, credential, or private-file
path. Do not paste or print the candidate while diagnosing a failed
publication.

Immediately after `addVersion` returns and before the first exact-version
readback, `publish` atomically changes the receipt to `pending-verification`
with the returned positive numeric version. A successful server CRC32C and
byte-for-byte readback changes only its state to `verified`.

When the first command fails with a durable `pending-verification` receipt:

1. Freeze the candidate and receipt; do not edit or replace either file.
2. Confirm both remain private regular non-symlink files and that the explicit
   environment/project still match the approved change.
3. Run `publish-resume` with those same paths. It validates the complete
   candidate, rejects mismatched receipt metadata, reads only the recorded
   numeric version, verifies server CRC32C and exact bytes, and atomically marks
   the receipt `verified`.
4. Continue with the independent exact-version fetch and remaining promotion
   gates only after resume succeeds.

When the receipt remains in state `publishing`, the request may have committed
even though the client did not receive the response. Do not call `publish`
again, and do not use `publish-resume`. Freeze the candidate and publication
window, inspect metadata-only Secret Manager version listing plus Data
Access/Admin Activity audit evidence, and run `publish-reconcile` with
`--version <exact-recovery-version>`.

Before accessing payload bytes, reconciliation requires exactly one observed
version ID greater than `prePublishMaxVersion`. That sole candidate must equal
the explicit recovery version and its creation timestamp must be equal to or
later than `startedAt`. Only then does it access that exact version, validate
the server CRC32C and bytes, and atomically record it as `verified`. This rejects
an old byte-identical version. Zero or multiple post-watermark versions, a
predating timestamp, a wrong explicit version, or a byte mismatch leaves the
ambiguous receipt unchanged and blocked.

There is no supported `publish-abort`. Even zero currently visible
post-watermark versions is not treated as sufficiently robust proof that no
version committed. Preserve the receipt and stop/escalate for manual audit
reconciliation; do not delete or replace it, choose another journal parent, or
create another version.

A hard crash may leave the local journal lock. On the same host, first verify
that the PID recorded in the mode-`0600` lock is no longer running, then use
`publish-unlock` with the same environment, project, and receipt path. It
refuses a live PID or mismatched identity. Unlocking never reads a payload,
creates a version, or changes the receipt. A result of `publishing` must be
followed by `publish-reconcile`; `pending-verification` or `verified`
must be followed by `publish-resume`. A result of `unreserved` means the process
stopped before the synchronized receipt reservation and therefore before
`addVersion`; only that result permits a new `publish` using the same canonical
receipt path and parent.

The operator must not run `publish` again for a candidate that has a receipt;
that would request another immutable version. A second receipt path or second
publisher is not a retry mechanism. `publish-resume` deliberately has no
`addVersion` capability and is safe to repeat for a `verified` receipt;
`publish-reconcile` accepts only an ambiguous `publishing` receipt. If the
receipt cannot be reserved or its integrity/private-file checks fail, stop
publication and reconcile version-creation metadata through approved Secret
Manager audit/console evidence before any further add operation. Each dedicated
publisher has resource-level `roles/secretmanager.viewer` only on its own target
package for metadata listing, in addition to version creation; it receives no
opposite-environment package access and no payload access through the viewer
role.

## Rendering And Promotion

Rendering has two atomic layers:

1. **Generic package render:** fetch and validate an exact numeric version,
   write an immutable release through private staging, then atomically switch
   the generic package `current` only after every member passes validation. DEV
   generic render and projection sync share one root-local writer lock; an empty
   lock directory is valid in a scratch root, while only the durable projection
   marker forbids later generic rendering.
2. **Consumer projection:** construct and validate the target-specific staging
   release. For production, `--stage-only` leaves the runtime projection
   `current` and stable runtime links unchanged; `--activate` switches them as
   one unit before the controlled reload and semantic health checks.

Neither layer may partially update its active pointer. A generic render failure
leaves the previous generic package pointer active; a projection staging or
preflight failure leaves the previous runtime projection and stable runtime
files active. Do not edit a rendered file manually. The deployment attestation
records only the numeric version and redacted verification metadata.

### Local Mac

1. Obtain short-lived or external bootstrap credentials authorized only for
   the DEV package.
2. Select the reviewed DEV numeric version; do not infer it from `latest`.
3. Set `SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS` for the sync command and
   run `scripts/sync-secrets.sh` with that numeric version. It atomically
   renders the immutable release under
   `${HOME}/.config/intexuraos/secret-packages/dev`, atomically switches
   `current`, and installs `.envrc` as mode `0600` from the approved projection.
   The `current` link, `.envrc`, and GitHub App PEM form one fail-closed local
   transaction: a later publication failure restores all three previous
   artifacts, or removes all three if this was the first sync.
4. Run `direnv allow`, restart PM2 with updated environment, and verify local
   Auth, Firestore, GCS, and Pub/Sub-emulator flows.
5. Verify the process does not hold Secret Manager access after rendering.

### home-dev

1. Authenticate as the dedicated external home-dev renderer identity and fetch
   the same reviewed DEV numeric version used for the rollout.
2. Render the host release under
   `${HOME}/.config/intexuraos/secret-packages/dev`, then build `.envrc`, the
   observability projection, and strict orchestrator projection from `current`;
   validate modes and ownership.
3. Select the dedicated home runtime key for PM2 and let the orchestrator
   generator fix its separate Artifact Registry reader key. Promote atomically,
   restart PM2 and the systemd orchestrator, then run health checks.
4. Start one code-worker canary. Confirm it receives only the task allowlist and
   cannot access Secret Manager; then drain/replace remaining workers.
5. Record the numeric version in redacted deployment evidence.

### Production / Hetzner

1. The provisioner fetches one reviewed PROD numeric version into a private
   staging directory.
2. Validate the package before writing any target file.
3. Render, but do not activate, `/etc/intexuraos/.env.prod`, the runtime SA JSON,
   nginx internal-auth token, certbot/Cloudflare credential, TLS key, and the
   ephemeral web-build environment. Validate owner/mode and member allowlists.
4. Run the complete candidate credential canary directly against the staged
   runtime key without changing the runtime projection `current` or stable
   runtime links: obtain a token; perform Firestore `listCollectionIds`; list at
   most one entry from `intexuraos-images-dev` while returning only the response
   kind; query only the Firebase Auth account count with
   `returnUserInfo=false`; and publish one constant redacted message to
   `intexuraos-runtime-credential-canary-dev`. That Terraform-owned topic has no
   subscription, and the publish proof must contain one server message ID.
5. Verify the packaged Cloudflare token is active, resolves only the expected
   account/zone, and can list DNS records on that zone. Complete the
   package-bound Cloudflare DNS Edit attestation below before this read-only
   proof. All API bodies and credentials remain outside logs and evidence.
6. Atomically promote the complete projection, reload only `code-agent` with
   the candidate environment, and require its semantic health including the
   Firestore check. Only then reload the complete PM2 fleet/nginx and run the
   remaining direct-origin and public smoke suite.
7. Attest the commit and exact PROD numeric version without payload data.

#### Cloudflare DNS Edit attestation

Cloudflare's non-mutating DNS-record list accepts either `DNS Read` or
`DNS Edit`, so the API proof cannot distinguish `DNS Read` from `DNS Edit`.
Do not create/delete a DNS record merely to test the candidate. Instead, bind a
human-reviewed policy assertion to the token ID returned by Cloudflare's
read-only token-verification endpoint.

For every PROD package version `<VERSION>`:

1. In Cloudflare **My Profile → API Tokens**, open the dedicated certificate
   token without copying its value. Verify `Zone DNS Edit` and `Zone Read`, both
   scoped to the single active `intexuraos.cloud` zone in account
   `e4bc566c37e21368bffb131d2ac69358`. Record the non-secret 32-character token
   ID, reviewer, UTC timestamp, and change-record reference.
2. On Hetzner, retain a root-managed directory
   `/etc/intexuraos/cloudflare-dns-attestations` with mode `0700`. Write the
   following non-secret document as
   `prod-v<VERSION>.json` with mode `0600`; preserve one file per rollback
   version:

   ```json
   {
     "schemaVersion": 1,
     "environment": "prod",
     "packageVersion": "<VERSION>",
     "accountId": "e4bc566c37e21368bffb131d2ac69358",
     "zoneName": "intexuraos.cloud",
     "permission": "Zone DNS Edit",
     "resourceScope": "exact-zone",
     "tokenId": "<32-character-token-id>",
     "verifiedAt": "<UTC-RFC3339>",
     "verifiedBy": "<operator-identity>",
     "evidenceReference": "<change-record-reference>"
   }
   ```

3. Run the loader preflight. It checks directory/file type and mode, exact
   package/account/zone fields, active token status and matching token ID, exact
   active-zone resolution, and a read-only DNS-record list. The review timestamp
   may be no more than 24 hours old and no more than five minutes in the future.
   A missing, malformed, mismatched, or stale-review replacement document must
   stop before activation; never bypass the gate in a production deployment.
4. The loader cannot observe later policy edits. Re-open and re-attest the token
   for every package version and before deliberately reactivating an old version
   with `--activate`. Automated compensation uses `--rollback` to restore only
   the previously recorded, already verified projection without depending on a
   current Cloudflare attestation or external API availability; the deploy
   wrapper then immediately runs the complete post-switch health suite.
   The `SKIP_CLOUDFLARE_CREDENTIAL_SMOKE` switch exists only for isolated
   offline tests, never for a deployment or recovery.

The required target modes are documented in the
[Hetzner production runbook](./hetzner-prod-runbook.md).

## Version Reconciliation Gate

A promotion is not closed until every independently persisted version pin has
been reconciled. For PROD, the reviewed manifest, Terraform bootstrap input,
and protected workflow variable select the same candidate before any remote
mutation; this is desired state, not a claim that production smoke already
passed. Runtime pointers and public evidence join that value only after
activation. A failed deployment must compensate runtime and restore the three
desired-state pins to the recorded prior version in a reviewed recovery change.

### Ordered compensated-deployment pin recovery

After the deployment wrapper has restored the recorded prior runtime release,
recover the three desired-state pins in this order:

1. Impose a release freeze: freeze automatic production deployment dispatches
   by stopping merges/pushes to `development`, and cancel every queued deploy.
   Do not cancel the compensation process that is restoring runtime.
2. Verify the runtime projection `current`, stable runtime links, Alloy, PM2,
   nginx, and `/deployment.json` all identify the recorded prior version. If
   compensation did not complete, treat this as an incident and do not mutate
   any pin.
3. In repository settings, set `PROD_SECRET_PACKAGE_VERSION` to the recorded
   prior version. Changing the protected repository variable does not itself
   dispatch a workflow.
4. Revert both tracked pins in one reviewed commit:
   `packages.prod.stableVersion` in
   `config/environments/secret-packages.json` and
   `prod_secret_package_version` in
   `terraform/hetzner-prod/prod.auto.tfvars.json`. The commit must contain no
   unrelated desired-state change.
5. Merge that recovery commit as the only permitted `development` change. Its
   deployment must pass the pre-remote three-pin verifier, observe the already
   restored prior projection, and complete the full health and public
   attestation checks without changing to the failed candidate.
6. Record the repository-variable audit event, recovery commit, workflow run,
   three numeric pin values, runtime pointer, and attestation result. Resume
   deployment dispatches only after every source equals the recorded prior
   version and the recovery run is green.

Never revert the tracked pins first: that push would start with the candidate
still selected by the protected repository variable and must fail the
pre-remote gate. Never leave the repository variable on the failed candidate
while the tracked desired state records the prior release.

- For DEV, compare `packages.dev.stableVersion`, the numeric version selected by
  local/home-dev sync, the generic package `current/metadata.json`, the
  `INTEXURAOS_SECRET_PACKAGE_VERSION` projected to `.envrc`, and the version
  recorded for the home-dev orchestrator/observability rollout.
- For PROD, compare `packages.prod.stableVersion`, the repository variable
  `PROD_SECRET_PACKAGE_VERSION`, Terraform
  `prod_secret_package_version`, generic package `current/metadata.json`, runtime
  projection `current/metadata.json` and `.env.prod`, and public
  `/deployment.json.secretPackageVersion` after attestation succeeds.
- For native transcription injection, compare the two reviewed numeric
  Terraform version inputs with the deployed function revision metadata.

PASS requires every value in an environment to be the same positive decimal
integer and every pointer to resolve to the expected immutable release. Record
the source names, numeric values, commit, workflow run, and UTC timestamp only.
Any missing value, alias, mismatch, stale public attestation, or pointer to a
different release blocks closure and cleanup.

## Rotation Procedures

### Firebase Browser API Key

The browser key is not an authorization boundary. Firestore Security Rules,
Firebase Auth, API-key restrictions, and quotas protect the backend.

1. Treat the repository alert as exposure of the old key. Do not merely delete
   the source line.
2. Create a replacement browser key through Terraform alongside the old key.
3. Restrict it to exactly the three Terraform-declared dev, production, and
   localhost referrers and exactly the four declared Firebase APIs. The
   Generative Language API must not be enabled for this key. Terraform creates
   the replacement alongside the old key and keeps both protected from destroy
   until cutover; it never outputs `key_string`.
4. Retrieve the replacement key for `intexuraos-firebase-browser-2026` through
   an approved private API/console view without logging, screenshots, shell
   arguments, or Terraform state/output. The existing sensitive Terraform
   `firebase_api_key` output still resolves the old/default web-app key during
   the additive phase; do not use it as the replacement source.
5. Add the replacement value to new DEV and PROD candidate packages. Validate
   and publish both as separate numeric versions.
6. Deploy DEV; verify sign-in, token refresh, Firestore reads/writes allowed by
   Rules, and browser error telemetry.
7. Deploy PROD and repeat the same checks.
8. Confirm traffic has moved, then use a separate reviewed cleanup change to
   remove the old imported/resource definition and correct/remove the legacy
   `firebase_api_key` output before deleting the old key. Close
   the repository alert as revoked; record only its alert identifier.

Firebase cutover PASS is quantitative:

- On each approved DEV and PROD origin, one supported test client must complete
  sign-in, forced token refresh, one Rules-allowed Firestore read, and one
  disposable write/delete cycle with zero failed steps.
- Credential-filtered API metrics must show global replacement-key traffic and
  old-key request count exactly zero for 24 continuous hours after the later
  deployment. The metric has no HTTP-referrer/origin dimension, so the two
  explicit origin smoke tests above—not the metric—prove DEV and PROD origin
  coverage. Any request attributed to the old key resets the 24-hour window.
- Browser telemetry during the same window must contain zero new failures
  attributable to API-key restrictions, Auth token refresh, or Firestore Rules.
- Evidence records the old and replacement resource IDs, metric interval/counts,
  origin/test matrix, alert identifier, revoked state, and UTC closure time. It
  never records either key value.

#### Executable Firebase key traffic gate

Use the API Keys metadata endpoint and Cloud Monitoring REST API; do not use
`getKeyString`, `lookupKey`, Terraform output, or a package fetch to identify a
key. The API Keys `get` response exposes `name`, `uid`, display name, and
restrictions without the key string. The `consumed_api` monitored resource uses
`credential_id` in the form `apikey:<UID>`, and
`serviceruntime.googleapis.com/api/request_count` can be delayed by 30 minutes.
These details are defined by the [API Keys resource
schema](https://cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys),
[Consumed API resource
schema](https://cloud.google.com/monitoring/api/resources#tag_consumed_api), and
[Service Runtime metric
catalog](https://cloud.google.com/monitoring/api/metrics_gcp_p_z#serviceruntime).

Run with a read-only operator that has API Keys metadata and Monitoring viewer
access. Turn off shell tracing first. The two resource IDs below are public
metadata and are deliberately fixed; the response files remain private and are
deleted on exit.

```bash
set +x
project_id='intexuraos-dev-pbuchman'
old_key_id='d8251549-1bde-49c0-82a7-b0525a2fe688'
replacement_key_id='intexuraos-firebase-browser-2026'
firebase_t0='<RFC3339 UTC: later of the completed DEV/PROD deployments>'
firebase_t1='<RFC3339 UTC: observation end, at least 24h after firebase_t0>'

firebase_gate_dir="$(mktemp -d "${TMPDIR:-/tmp}/firebase-key-gate.XXXXXX")"
chmod 700 "${firebase_gate_dir}"
trap 'rm -rf -- "${firebase_gate_dir}"' EXIT

for key_id in "${old_key_id}" "${replacement_key_id}"; do
  gcloud services api-keys describe "${key_id}" \
    --project="${project_id}" \
    --location=global \
    --format='json(name,uid,displayName,restrictions)' \
    >"${firebase_gate_dir}/${key_id}.json"
  chmod 600 "${firebase_gate_dir}/${key_id}.json"
  jq -e \
    --arg suffix "/locations/global/keys/${key_id}" \
    '(.name | endswith($suffix)) and
     (.uid | type == "string" and length > 0) and
     (.displayName | type == "string" and length > 0) and
     (.restrictions | type == "object") and
     (has("keyString") | not)' \
    "${firebase_gate_dir}/${key_id}.json" >/dev/null
done

old_key_uid="$(jq -er '.uid' "${firebase_gate_dir}/${old_key_id}.json")"
replacement_key_uid="$(jq -er '.uid' "${firebase_gate_dir}/${replacement_key_id}.json")"
[[ "${old_key_uid}" != "${replacement_key_uid}" ]]

node - "${firebase_t0}" "${firebase_t1}" <<'NODE'
const [startText, endText] = process.argv.slice(2);
const start = Date.parse(startText);
const end = Date.parse(endText);
if (!Number.isFinite(start) || !Number.isFinite(end)) process.exit(1);
if (end - start < 24 * 60 * 60 * 1000) process.exit(2);
if (Date.now() - end < 30 * 60 * 1000) process.exit(3);
NODE
```

Query one UID at a time and follow every `nextPageToken`. The literal
credential filter is `resource.labels.credential_id="apikey:<UID>"`. The
`pageSize=100000` value is the documented maximum for a full-view
`projects.timeSeries.list` request; a token still requires another request.
The helper emits only aggregate request and page counts, never time-series
bodies or credentials. See the [Monitoring `timeSeries.list` REST
contract](https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list).

```bash
api_key_request_count() {
  local key_uid="$1"
  local page_token=''
  local response_file="${firebase_gate_dir}/monitoring-page.json"
  local filter="metric.type=\"serviceruntime.googleapis.com/api/request_count\" AND resource.type=\"consumed_api\" AND resource.labels.project_id=\"${project_id}\" AND resource.labels.credential_id=\"apikey:${key_uid}\""
  local total=0
  local pages=0
  local page_total=0
  local curl_args=()

  while :; do
    curl_args=(
      --fail --silent --show-error --get
      --header "@${firebase_gate_dir}/monitoring-auth-header"
      --data-urlencode "filter=${filter}"
      --data-urlencode "interval.startTime=${firebase_t0}"
      --data-urlencode "interval.endTime=${firebase_t1}"
      --data-urlencode 'view=FULL'
      --data-urlencode 'pageSize=100000'
    )
    if [[ -n "${page_token}" ]]; then
      curl_args+=(--data-urlencode "pageToken=${page_token}")
    fi

    curl "${curl_args[@]}" \
      "https://monitoring.googleapis.com/v3/projects/${project_id}/timeSeries" \
      >"${response_file}"
    chmod 600 "${response_file}"
    page_total="$(jq -er \
      '[.timeSeries[]?.points[]?.value.int64Value // "0" | tonumber] | add // 0' \
      "${response_file}")"
    total=$((total + page_total))
    pages=$((pages + 1))
    page_token="$(jq -er '.nextPageToken // ""' "${response_file}")"
    [[ -n "${page_token}" ]] || break
  done
  printf '%s %s\n' "${total}" "${pages}"
}

firebase_access_token="$(gcloud auth print-access-token)"
printf 'Authorization: Bearer %s\n' "${firebase_access_token}" \
  >"${firebase_gate_dir}/monitoring-auth-header"
chmod 600 "${firebase_gate_dir}/monitoring-auth-header"
unset firebase_access_token

read -r old_request_count old_page_count < <(api_key_request_count "${old_key_uid}")
read -r replacement_request_count replacement_page_count \
  < <(api_key_request_count "${replacement_key_uid}")

[[ "${old_request_count}" -eq 0 ]]
[[ "${replacement_request_count}" -gt 0 ]]
printf 'old_requests=%s old_pages=%s replacement_requests=%s replacement_pages=%s\n' \
  "${old_request_count}" "${old_page_count}" \
  "${replacement_request_count}" "${replacement_page_count}"
```

This metric is global and has no HTTP-referrer/origin label. Therefore, during
the same interval, run two separate supported-browser smokes and retain their
redacted results:

1. On `https://dev.intexuraos.cloud`, sign in, force an ID-token refresh, make
   one Rules-allowed Firestore read, then create and delete one disposable test
   document. Record four PASS/FAIL fields and browser-console error counts.
2. Repeat the identical four operations independently on
   `https://intexuraos.cloud`; do not infer PROD coverage from the DEV smoke or
   from the global metric.

PASS requires both origin smokes to have zero failed steps, replacement traffic
greater than zero globally, old traffic exactly zero, an interval of at least
24 hours, and a query end at least 30 minutes in the past. Any old-key point or
failed origin smoke resets `firebase_t0` to the later corrective deployment.

Console/Computer View path for the private handoff:

1. Open Google Cloud Console for the retained project and go to **APIs &
   Services → Credentials**.
2. Open the replacement key by its resource name and verify application/API
   restrictions before revealing/copying anything.
3. Use the console's copy control and paste directly into the protected package
   builder input on the operator host. Do not paste into the terminal command
   line, Computer View transcript, chat, issue, or clipboard history manager;
   do not take a screenshot.
4. Close the value view, publish/validate the two candidates, then clear the
   clipboard and remove the mode-`0600` input file.

Computer View may be used to navigate and verify labels/restrictions, but the
operator performs the value handoff privately. Evidence captures resource
name, restrictions, numeric package versions, and PASS/FAIL only.

Deleting Git history is not a substitute for revocation. Consider history
rewriting only after rotation, with repository-owner coordination, because it
changes commit IDs and every clone must be cleaned.

### Runtime Service-Account JSON

Google recommends avoiding user-managed service-account keys. The target is
short-lived federation or impersonation wherever the workload supports it. The
Hetzner runtime key is a bounded compatibility exception.

1. Create a replacement key outside Terraform and outside the repository. Do
   not print it, pass it as an argument, or put it in Terraform state.
2. Build a new PROD candidate with the replacement JSON. The provisioner, not
   the runtime SA, publishes/fetches it.
3. Validate only the expected account/project identifiers, `type`,
   `private_key_id`, and parseability; never log the private key.
4. Fetch the new numeric version, stage the rendered file, install it as
   `/home/deploy/runtime-sa-key.json` with mode `0600`, and obtain a token.
5. Run the same non-printing candidate canary enforced by the loader: token
   issuance; Firestore `listCollectionIds`; a one-entry metadata-only list on
   `intexuraos-images-dev`; Firebase Auth count query with
   `returnUserInfo=false`; one constant redacted publish with a required message
   ID to the no-subscription
   `intexuraos-runtime-credential-canary-dev` topic; and the Cloudflare checks
   bound to the fresh package-version attestation. Stop if the Terraform-owned
   topic or reviewed Cloudflare attestation is unavailable.
6. Reload the canary and then all production processes. Start a 24-hour
   pre-disable observation only after the complete fleet is healthy. PASS
   requires zero new credential-related authentication/authorization failures
   and zero use of the previous key ID throughout that interval.
7. Disable the previous key, but do not delete it. Keep a seven-day disabled
   soak. Google excludes disabled keys from its key-authentication metric, so
   this interval cannot claim to observe rejected attempts with that key.
   Instead require that the old key remains disabled, replacement-key
   authentication continues, and runtime telemetry contains zero credential
   failures. Any failure stops deletion and starts the incident/rollback
   decision; a compromised old key is never re-enabled.
8. Delete the disabled key only after the seven-day gate passes. Destroy all
   temporary local copies. Record only account, old/new key IDs, canary result,
   observation boundaries/counts, disable/delete timestamps, and result.

Console/Computer View path for the compatibility key:

1. Open **IAM & Admin → Service Accounts**, select the approved Hetzner runtime
   account, then open **Keys**.
2. Choose **Add key → Create new key → JSON**. The downloaded JSON is the only
   copy Google supplies; immediately move it to a private external directory
   and set mode `0600`.
3. Record only the account and new key ID. Do not open the JSON in an editor,
   console preview, screenshot, chat, or agent transcript.
4. Feed the file directly into the protected PROD package builder, publish and
   canary the returned numeric version, then securely remove the downloaded and
   staging copies.
5. Return to **Keys**, disable the old key after cutover, monitor, and delete it
   after the soak gate. If Google already disabled it for exposure, do not
   re-enable it.

Computer View may navigate the console and verify non-secret metadata; the
human operator handles the downloaded file outside the visible session.

Never delete the old key before the new package has passed canary checks. Never
put the provisioner credential in DEV or PROD.

#### Executable runtime key metric and soak gate

The key-authentication metric is
`iam.googleapis.com/service_account/key/authn_events_count`; filter it by the
runtime service account's numeric `uniqueId` and `metric.labels.key_id`. It is
sampled every ten minutes and may remain unavailable for three hours. Google
also states that service-account key metrics exclude disabled keys. See the
[IAM metric catalog](https://cloud.google.com/monitoring/api/metrics_gcp_i_o#iam)
and [service-account monitoring
guide](https://cloud.google.com/iam/docs/service-account-monitoring).

Start the 24-hour pre-disable window only after every PROD process has reloaded
the replacement. Supply key IDs as metadata; never derive them by opening a JSON
key. The command validates both IDs against IAM without printing key material.

```bash
set +x
project_id='intexuraos-dev-pbuchman'
runtime_sa='ixos-hetzner-runtime-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
old_runtime_key_id='<old 40-character key ID>'
replacement_runtime_key_id='<replacement 40-character key ID>'
runtime_t0='<RFC3339 UTC: full-fleet replacement reload completed>'
runtime_t1='<RFC3339 UTC: observation end, at least 24h after runtime_t0>'

[[ "${old_runtime_key_id}" =~ ^[0-9a-f]{40}$ ]]
[[ "${replacement_runtime_key_id}" =~ ^[0-9a-f]{40}$ ]]
[[ "${old_runtime_key_id}" != "${replacement_runtime_key_id}" ]]

runtime_gate_dir="$(mktemp -d "${TMPDIR:-/tmp}/runtime-key-gate.XXXXXX")"
chmod 700 "${runtime_gate_dir}"
trap 'rm -rf -- "${runtime_gate_dir}"' EXIT

runtime_sa_unique_id="$(gcloud iam service-accounts describe "${runtime_sa}" \
  --project="${project_id}" --format='value(uniqueId)')"
[[ "${runtime_sa_unique_id}" =~ ^[0-9]+$ ]]

for key_id in "${old_runtime_key_id}" "${replacement_runtime_key_id}"; do
  gcloud iam service-accounts keys describe "${key_id}" \
    --iam-account="${runtime_sa}" \
    --project="${project_id}" \
    --format='json(name,keyType,disabled,validAfterTime,validBeforeTime)' \
    >"${runtime_gate_dir}/${key_id}.json"
  chmod 600 "${runtime_gate_dir}/${key_id}.json"
  jq -e --arg suffix "/keys/${key_id}" \
    '(.name | endswith($suffix)) and .keyType == "USER_MANAGED"' \
    "${runtime_gate_dir}/${key_id}.json" >/dev/null
done

node - "${runtime_t0}" "${runtime_t1}" <<'NODE'
const [startText, endText] = process.argv.slice(2);
const start = Date.parse(startText);
const end = Date.parse(endText);
if (!Number.isFinite(start) || !Number.isFinite(end)) process.exit(1);
if (end - start < 24 * 60 * 60 * 1000) process.exit(2);
if (Date.now() - end < 3 * 60 * 60 * 1000) process.exit(3);
NODE
```

Query each key through all Monitoring pages. Only aggregate counts leave the
private directory.

```bash
runtime_key_authn_count() {
  local key_id="$1"
  local page_token=''
  local response_file="${runtime_gate_dir}/monitoring-page.json"
  local filter="metric.type=\"iam.googleapis.com/service_account/key/authn_events_count\" AND resource.type=\"iam_service_account\" AND resource.labels.project_id=\"${project_id}\" AND resource.labels.unique_id=\"${runtime_sa_unique_id}\" AND metric.labels.key_id=\"${key_id}\""
  local total=0
  local pages=0
  local page_total=0
  local curl_args=()

  while :; do
    curl_args=(
      --fail --silent --show-error --get
      --header "@${runtime_gate_dir}/monitoring-auth-header"
      --data-urlencode "filter=${filter}"
      --data-urlencode "interval.startTime=${runtime_t0}"
      --data-urlencode "interval.endTime=${runtime_t1}"
      --data-urlencode 'view=FULL'
      --data-urlencode 'pageSize=100000'
    )
    if [[ -n "${page_token}" ]]; then
      curl_args+=(--data-urlencode "pageToken=${page_token}")
    fi
    curl "${curl_args[@]}" \
      "https://monitoring.googleapis.com/v3/projects/${project_id}/timeSeries" \
      >"${response_file}"
    chmod 600 "${response_file}"
    page_total="$(jq -er \
      '[.timeSeries[]?.points[]?.value.int64Value // "0" | tonumber] | add // 0' \
      "${response_file}")"
    total=$((total + page_total))
    pages=$((pages + 1))
    page_token="$(jq -er '.nextPageToken // ""' "${response_file}")"
    [[ -n "${page_token}" ]] || break
  done
  printf '%s %s\n' "${total}" "${pages}"
}

runtime_access_token="$(gcloud auth print-access-token)"
printf 'Authorization: Bearer %s\n' "${runtime_access_token}" \
  >"${runtime_gate_dir}/monitoring-auth-header"
chmod 600 "${runtime_gate_dir}/monitoring-auth-header"
unset runtime_access_token

read -r old_authn_count old_authn_pages \
  < <(runtime_key_authn_count "${old_runtime_key_id}")
read -r replacement_authn_count replacement_authn_pages \
  < <(runtime_key_authn_count "${replacement_runtime_key_id}")
[[ "${old_authn_count}" -eq 0 ]]
[[ "${replacement_authn_count}" -gt 0 ]]
printf 'old_authn=%s old_pages=%s replacement_authn=%s replacement_pages=%s\n' \
  "${old_authn_count}" "${old_authn_pages}" \
  "${replacement_authn_count}" "${replacement_authn_pages}"
```

The 24-hour gate also requires three successful production health samples, the
non-printing candidate credential canary, and zero new credential-related
`401`/`403` or token-issuance failures. Wait three hours after `runtime_t1`
before the final metric query. Any old-key event resets `runtime_t0`.

After disabling the old key, do not use the absent old-key series as evidence:
disabled keys are excluded. The measurable seven-day gate is instead:

- eight snapshots from the disable boundary through a final snapshot at least
  168 hours later, each showing the old key's metadata field `disabled=true`;
- seven non-overlapping 24-hour replacement-key metric intervals, each queried
  only after its three-hour lag and each with replacement count greater than
  zero;
- one successful non-printing credential canary and complete PROD health sample
  in every interval;
- zero unexpected credential/authentication failures and zero
  `EnableServiceAccountKey` Admin Activity entries for the old key during the
  bounded interval.

Use the following bounded Audit Log query only as supplementary evidence;
Google documents that many, but not all, services populate
`serviceAccountKeyName`. It cannot replace the key metric before disable or the
measurable soak after disable. Wait 15 minutes after the query end, and never
pass `--limit` so `gcloud logging read` exhausts its default unlimited result
set. The selected output fields contain metadata only. See [Google's
service-account audit-log
example](https://cloud.google.com/iam/docs/audit-logging/examples-service-accounts#auth-with-key)
and [`gcloud logging read`
reference](https://cloud.google.com/sdk/gcloud/reference/logging/read).

```bash
runtime_audit_t0='<RFC3339 UTC: full-fleet replacement reload completed>'
runtime_audit_t1='<RFC3339 UTC: bounded query end; wait 15m before reading>'
old_runtime_key_name="//iam.googleapis.com/projects/${project_id}/serviceAccounts/${runtime_sa}/keys/${old_runtime_key_id}"
runtime_audit_filter="protoPayload.authenticationInfo.serviceAccountKeyName=\"${old_runtime_key_name}\" AND timestamp>=\"${runtime_audit_t0}\" AND timestamp<=\"${runtime_audit_t1}\""

gcloud logging read "${runtime_audit_filter}" \
  --project="${project_id}" \
  --order=asc \
  --format='json(timestamp,insertId,protoPayload.serviceName,protoPayload.methodName,protoPayload.status.code)' \
  >"${runtime_gate_dir}/old-key-audit.json"
chmod 600 "${runtime_gate_dir}/old-key-audit.json"
jq 'length' "${runtime_gate_dir}/old-key-audit.json"
```

Where organization policy supports it, enforce
`constraints/iam.serviceAccountKeyExposureResponse=DISABLE_KEY` so Google can
automatically disable a detected exposed service-account key. Detection is not
guaranteed and does not replace repository scanning, least privilege, manual
revocation, or this rotation order. If Google disables a key, treat it as an
incident: identify the affected runtime by key ID, create a replacement,
publish/canary a complete package, verify audit logs, and delete the exposed key
after recovery. Never re-enable it merely to restore service.

### Internal Authentication And Native Secrets

Follow [Internal Auth Rotation](../runbooks/internal-auth-rotation.md) for the
coordinated maintenance cutover. The current strict contract has no
previous-token member, so DEV/PROD consumers and the transcription function's
native numeric version must be staged, switched, and verified as one controlled
change with a tested whole-version rollback. `INTEXURAOS_SPEECHMATICS_APP_API_KEY`
follows the same immutable native version rule but is needed only in DEV and
the native transcription injection, not PROD.

## GitHub Actions And WIF

Retained-GCP automation must use GitHub OIDC to exchange a short-lived token
through WIF. Do not store a GCP service-account JSON key in GitHub. The Hetzner
job does not authenticate to Google: it connects by SSH and the external
provisioner identity on the VM fetches the exact PROD package.

- Terraform owns the pool, provider, service account, IAM, and conditions.
- Match immutable numeric GitHub repository/owner IDs, not only mutable names.
- Restrict `assertion.ref` to `refs/heads/development` and set the same narrow
  condition on both retained providers.
- Grant only Cloud Build trigger/impersonation permissions required by the
  retained-GCP workflow; do not grant either WIF principal package access.
- Pin third-party actions to reviewed immutable commits and protect numeric
  package-version inputs.
- Log subject, repository/ref claims, commit, package ID, numeric version, and
  result; never log OIDC or Google access tokens.

### Cloud Build GitHub connection IAM cleanup

The retained `pbuchman-github` connection is allowed to read only its managed
OAuth-token secret. Google states that the Cloud Build service agent uses this
secret, that `roles/secretmanager.secretAccessor` can be granted on the single
secret, and that the setup-time `roles/secretmanager.admin` grant can be
revoked after the connection reaches `COMPLETE`. See [Cloud Build's console
connection flow](https://cloud.google.com/build/docs/automating-builds/github/connect-repo-github?generation=2nd-gen)
and [programmatic connection IAM
example](https://cloud.google.com/build/docs/automating-builds/github/connect-repo-github#connect_to_a_github_host_programmatically).

This procedure removes exactly the unconditional and expired conditional
project grants for
`service-544224260556@gcp-sa-cloudbuild.iam.gserviceaccount.com`. Persistent IAM
changes are Terraform-only. Use a verified administrative principal, clear all
emulator variables, save every plan, and never fetch or display the OAuth token.

1. Record a metadata-only baseline in a mode-`0700` directory. The connection
   must be `COMPLETE`, not disabled, and not reconciling; the repository URI
   must be exact.

   ```bash
   set +x
   project_id='intexuraos-dev-pbuchman'
   region='europe-central2'
   connection='pbuchman-github'
   repository='pbuchman-intexuraos'
   oauth_secret='pbuchman-github-github-oauthtoken-8b04fa'
   p4sa='service-544224260556@gcp-sa-cloudbuild.iam.gserviceaccount.com'
   p4sa_member="serviceAccount:${p4sa}"

   cloud_build_gate_dir="$(mktemp -d \
     "${TMPDIR:-/tmp}/cloud-build-iam-gate.XXXXXX")"
   chmod 700 "${cloud_build_gate_dir}"
   trap 'rm -rf -- "${cloud_build_gate_dir}"' EXIT

   gcloud builds connections describe "${connection}" \
     --project="${project_id}" --region="${region}" \
     --format='json(name,installationState.stage,disabled,reconciling)' \
     >"${cloud_build_gate_dir}/connection.json"
   gcloud builds repositories describe "${repository}" \
     --connection="${connection}" \
     --project="${project_id}" --region="${region}" \
     --format='json(name,remoteUri)' \
     >"${cloud_build_gate_dir}/repository.json"
   chmod 600 "${cloud_build_gate_dir}/connection.json" \
     "${cloud_build_gate_dir}/repository.json"
   jq -e \
     '.installationState.stage == "COMPLETE" and
      (.disabled // false) == false and (.reconciling // false) == false' \
     "${cloud_build_gate_dir}/connection.json" >/dev/null
   jq -e \
     '.remoteUri == "https://github.com/pbuchman/intexuraos.git"' \
     "${cloud_build_gate_dir}/repository.json" >/dev/null
   ```

2. Add a non-authoritative
   `google_secret_manager_secret_iam_member` in
   `terraform/environments/dev/main.tf` for exactly the OAuth secret, role
   `roles/secretmanager.secretAccessor`, and `${p4sa_member}`. Do not manage the
   token version or payload. Query the live secret policy into a private file.
   If the exact member already exists, import it using the [provider's
   secret-IAM import
   format](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam);
   otherwise review and apply a saved plan containing exactly that one add.

   ```bash
   gcloud secrets get-iam-policy "${oauth_secret}" \
     --project="${project_id}" --format=json \
     >"${cloud_build_gate_dir}/oauth-policy.json"
   chmod 600 "${cloud_build_gate_dir}/oauth-policy.json"
   oauth_accessor_count="$(jq --arg member "${p4sa_member}" \
     '[.bindings[]? | select(.role == "roles/secretmanager.secretAccessor") |
       .members[]? | select(. == $member)] | length' \
     "${cloud_build_gate_dir}/oauth-policy.json")"
   [[ "${oauth_accessor_count}" -eq 0 || "${oauth_accessor_count}" -eq 1 ]]

   # Existing-member branch only; use the actual reviewed Terraform address.
   if [[ "${oauth_accessor_count}" -eq 1 ]]; then
     STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
       terraform -chdir=terraform/environments/dev import \
       google_secret_manager_secret_iam_member.cloud_build_connection_oauth_accessor \
       "projects/${project_id}/secrets/${oauth_secret} roles/secretmanager.secretAccessor ${p4sa_member}"
   fi
   ```

   If the policy cannot be read, stop and use an appropriately authorized
   metadata/IAM operator; inability to prove this one-secret accessor blocks
   cleanup. Finish either branch with a full un-targeted plan that reports no
   changes and a live recount of exactly one accessor.

3. Add two temporary non-authoritative `google_project_iam_member` resources
   matching the live grants byte-for-byte: one unconditional; one with title
   `cloudbuild-connection-setup` and expression
   `request.time < timestamp("2026-01-21T01:30:54.054Z")`. Import both to
   Terraform state. A conditional member import appends the condition title;
   see the [Google provider project-IAM import
   contract](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_iam#google_project_iam_member).

   ```bash
   STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
     terraform -chdir=terraform/environments/dev import \
     google_project_iam_member.cloud_build_service_agent_secret_admin_unconditional \
     "${project_id} roles/secretmanager.admin ${p4sa_member}"

   STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
     terraform -chdir=terraform/environments/dev import \
     google_project_iam_member.cloud_build_service_agent_secret_admin_expired \
     "${project_id} roles/secretmanager.admin ${p4sa_member} cloudbuild-connection-setup"

   STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
     terraform -chdir=terraform/environments/dev plan \
     -detailed-exitcode -out="${cloud_build_gate_dir}/adoption-plan.tfplan"
   ```

   Adoption PASS requires exit `0` and `No changes`: import → plan0. Any change
   means the configuration does not exactly describe live IAM; correct it
   before continuing. Keep the reviewed configuration/import history in Git
   until the cleanup evidence is accepted.

4. Run the non-mutating baseline canary below. It calls only
   [`fetchGitRefs`](https://cloud.google.com/build/docs/api/reference/rest/v2/projects.locations.connections.repositories/fetchGitRefs),
   follows every page, emits counts rather than ref names, and requires the
   development branch. The OAuth access token is held in a private header file,
   never in curl arguments or output.

   ```bash
   fetch_git_refs_canary() {
     local label="$1"
     local page_token=''
     local page_count=0
     local ref_count=0
     local development_count=0
     local response_file="${cloud_build_gate_dir}/refs-${label}.json"
     local curl_args=()

     while :; do
       curl_args=(
         --fail --silent --show-error --get
         --header "@${cloud_build_gate_dir}/cloud-build-auth-header"
         --data-urlencode 'refType=BRANCH'
         --data-urlencode 'pageSize=100'
       )
       if [[ -n "${page_token}" ]]; then
         curl_args+=(--data-urlencode "pageToken=${page_token}")
       fi
       curl "${curl_args[@]}" \
         "https://cloudbuild.googleapis.com/v2/projects/${project_id}/locations/${region}/connections/${connection}/repositories/${repository}:fetchGitRefs" \
         >"${response_file}"
       chmod 600 "${response_file}"
       ref_count=$((ref_count + $(jq '.refNames // [] | length' \
         "${response_file}")))
       development_count=$((development_count + $(jq \
         '[.refNames[]? | select(. == "refs/heads/development" or . == "development")] | length' \
         "${response_file}")))
       page_count=$((page_count + 1))
       page_token="$(jq -er '.nextPageToken // ""' "${response_file}")"
       [[ -n "${page_token}" ]] || break
     done
     [[ "${ref_count}" -gt 0 && "${development_count}" -eq 1 ]]
     printf '%s refs=%s pages=%s development=%s\n' \
       "${label}" "${ref_count}" "${page_count}" "${development_count}"
   }

   cloud_build_access_token="$(gcloud auth print-access-token)"
   printf 'Authorization: Bearer %s\n' "${cloud_build_access_token}" \
     >"${cloud_build_gate_dir}/cloud-build-auth-header"
   chmod 600 "${cloud_build_gate_dir}/cloud-build-auth-header"
   unset cloud_build_access_token
   fetch_git_refs_canary before
   ```

5. Remove only the two temporary project-admin resource blocks from desired
   configuration. Keep the OAuth secret accessor. Save a full un-targeted plan.
   Its JSON proof must show exactly two deletes and no other non-noop action;
   then apply that exact saved plan.

   ```bash
   STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
     terraform -chdir=terraform/environments/dev plan \
     -out="${cloud_build_gate_dir}/cleanup.tfplan"
   terraform -chdir=terraform/environments/dev show -json \
     "${cloud_build_gate_dir}/cleanup.tfplan" \
     >"${cloud_build_gate_dir}/cleanup-plan.json"
   chmod 600 "${cloud_build_gate_dir}/cleanup-plan.json"
   jq -e '
     [.resource_changes[] |
       select(.change.actions != ["no-op"]) |
       {address,actions:.change.actions}] | sort_by(.address) == [
       {address:"google_project_iam_member.cloud_build_service_agent_secret_admin_expired",actions:["delete"]},
       {address:"google_project_iam_member.cloud_build_service_agent_secret_admin_unconditional",actions:["delete"]}
     ]' "${cloud_build_gate_dir}/cleanup-plan.json" >/dev/null

   STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
     terraform -chdir=terraform/environments/dev apply \
     "${cloud_build_gate_dir}/cleanup.tfplan"
   ```

6. Re-read project IAM and the OAuth secret IAM. Require zero project
   `roles/secretmanager.admin` grants for the P4SA and exactly one secret-level
   accessor. Run `fetch_git_refs_canary after`, recheck connection state, and
   finish with a full un-targeted `terraform plan -detailed-exitcode` exit `0`.
   This is the cleanup PASS gate.

Rollback is narrow and Terraform-only. If the accessor is absent, restore only
the one-secret accessor from its reviewed resource and rerun the canary. If the
accessor is present and the connection remains `COMPLETE`, do not reflexively
restore project admin; preserve responses, stop deployment triggers, and
investigate connection state. Only when evidence proves the admin removal is
causal and service restoration is urgent may a saved, reviewed plan temporarily
re-add the unconditional admin member; never re-add the expired conditional
grant. Rerun `fetchGitRefs`, repair the secret-level dependency, then remove the
temporary admin through another exact saved plan. Direct `gcloud ... add-iam`
or `remove-iam` mutations are forbidden.

## Audit And Evidence

Enable Secret Manager Data Access audit logs explicitly. Review
`secretmanager.googleapis.com` activity for `AccessSecretVersion` and version
creation. A normal deployment should show only the approved renderer/deploy
principal reading the selected package.

Evidence for every candidate and rollout contains:

- UTC timestamp and operator/automation principal;
- environment, secret ID, and exact numeric version;
- commit/deployment identifier;
- payload byte count and env/file member counts;
- CRC32C, validation, shadow comparison, permissions, smoke, and audit result;
- rollback version and observation deadline.

Evidence never contains values, full command environments, package JSON,
rendered file excerpts, tokens, private keys, base64, reversible checksums, or
request/response bodies. Use `MATCH`/`MISMATCH`, counts, metadata, and key IDs.

For the legacy-read gate, freeze the exact 34-name sorted legacy set from
`local.legacy_secret_container_names` at the reviewed commit and record the
commit plus all names (names are metadata, not values). Set `T0` only after the
last local/dev/prod consumer has restarted on package projections. Query Secret
Manager Data Access logs for every `AccessSecretVersion` event over `[T0,T1]`
with exhaustive pagination; `T1 - T0` must be at least 72 continuous hours.
PASS requires exactly zero events whose resource name is in the frozen set.
Perform an approved package access at both boundaries and require its audit
event as a positive control. Record query interval, pages/records inspected,
legacy count `0`, all four DEV/PROD package positive-control counts, zero project
or organization `SetIamPolicy` events, zero Logging configuration mutations,
and the final result. Native exceptions are intentionally outside this 34-name
legacy-read query. Any legacy event, policy or logging-routing mutation, or
missing positive control resets `T0`. Only then remove legacy IAM, disable old
versions for the reversible window, and later destroy versions/containers
through Terraform.

### Executable 34-name legacy-read gate

Secret Manager records a successful secret payload read under the exact method
`google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion`. Data
Access logging must remain enabled, and the reader needs Private Logs Viewer.
The method classification and required role are documented in the [Secret
Manager audit-log
reference](https://cloud.google.com/secret-manager/docs/audit-logging#accesssecretversion)
and [Data Access configuration
guide](https://cloud.google.com/logging/docs/audit/configure-data-access).

The project has the exact organization parent `398419898183` and no folder.
Project policy alone cannot prove the effective inherited audit configuration.
T0 remains blocked until the explicitly selected organization reader can attest
the parent policy, organization audit log, and project private Data Access log
without reauthentication. A
permission failure, an interactive reauthentication prompt, a different parent,
or missing organization/private-log access is a hard STOP before any package
control or T0 receipt. The currently expired `kontakt@pbuchman.com` reauthentication means
this runbook is not declaring the live gate T0-ready.

Do not start this gate while home-dev traffic is drained. The final home-dev
DEV-v2 prior/forward samples must pass, `cloudflared.service is active`, Cloud
Scheduler is `ENABLED`, there are zero code-worker containers on any image with
forbidden GCP credential environment, credential file, direct Secret Manager,
or secret-sync wiring, and one `post-resume package-only canary` must complete
on the replacement image. Its evidence must show the package-only bootstrap and
the expected allowlisted projection without a direct Secret Manager path. The
post-resume canary gate requires a terminal task callback and secret-isolation
PASS; it does not require model/provider success. Provider usage, quota, or
entitlement outcomes are outside this secret migration and do not reset T0 when
the callback is terminal, bootstrap/projection checks pass, and
authentication/Secret Manager error counts are zero. Only then may the T0
controls run. Pausing normal traffic, returning to a legacy projection,
changing the frozen inventory, or deliberately reading a frozen legacy secret
resets T0.

First freeze the inventory from the fully reviewed 40-character commit, never
from an uncommitted worktree. Review the resulting names line by line in the
change approval. This parser accepts only the quoted entries in the exact
`local.legacy_secret_container_names` block, sorts them, and fails unless there
are exactly 34 unique names. The workspace is deliberately persistent and
private: `/tmp` and an EXIT trap for the whole workspace are forbidden because
the four boundary receipts must survive separate shells and host restarts
during the 72-hour interval.

At each boundary, fetch both approved packages at their frozen exact positive
numeric versions. Use the publisher identities because the migration operator
has resource-level Token Creator on those identities and each publisher has
accessor permission only on its own target package. Do not add Token Creator to
a renderer or copy the Hetzner provisioner credential. Each payload exists only
as a mode-`0600` temporary file, is checked for non-empty bytes, and is removed
before its metadata-only receipt is committed. The existing fetcher validates it
only in process memory; it is never printed, copied or checksummed into
evidence, or retained after control cleanup. HUP, INT, TERM, and every normal
exit remove the entire validated scratch directory. After an untrappable stop
or host restart, the next stage removes any matching stale scratch, receipt
staging, request, response, and page-token files, then aborts before network or
secret access; that interruption resets T0. The Logging access token exists
only in shell memory and curl's stdin configuration pipe and is immediately
unset; it is never written to a file or placed in an executed process argv.

```bash
set -euo pipefail
set +x
unset CLOUDSDK_AUTH_ACCESS_TOKEN
unset CLOUDSDK_AUTH_ACCESS_TOKEN_FILE
umask 077
project_id='intexuraos-dev-pbuchman'
project_number='544224260556'
org_id='398419898183'
org_policy_reader_account='kontakt@pbuchman.com'
reviewed_sha='c8c24cddfe652995f0d5c69dce0f912b3a2315b8'
expected_inventory_sha256='6324dca830a96cff486aeff3a1cf3cad9bf2aa42192b1957de6362015e1e5413'
expected_default_sink_filter='NOT LOG_ID("cloudaudit.googleapis.com/activity") AND NOT LOG_ID("externalaudit.googleapis.com/activity") AND NOT LOG_ID("cloudaudit.googleapis.com/system_event") AND NOT LOG_ID("externalaudit.googleapis.com/system_event") AND NOT LOG_ID("cloudaudit.googleapis.com/access_transparency") AND NOT LOG_ID("externalaudit.googleapis.com/access_transparency")'
operator_credential_file="${HOME}/.config/gcloud/sa-key.json"
[[ "${reviewed_sha}" =~ ^[0-9a-f]{40}$ ]]
repo_root="$(git rev-parse --show-toplevel)"
git -C "${repo_root}" cat-file -e "${reviewed_sha}^{commit}"

git -C "${repo_root}" diff --quiet "${reviewed_sha}" -- \
  terraform/environments/dev/main.tf \
  config/environments/secret-packages.json \
  scripts/secret-package.mjs \
  scripts/lib/secret-package.mjs \
  scripts/lib/dev-secret-sync-lock.mjs

OPERATOR_CREDENTIAL_FILE="${operator_credential_file}" \
  EXPECTED_PROJECT_ID="${project_id}" node <<'NODE'
const { lstatSync, readFileSync } = require('node:fs');
const path = process.env.OPERATOR_CREDENTIAL_FILE;
const projectId = process.env.EXPECTED_PROJECT_ID;
if (typeof path !== 'string' || typeof projectId !== 'string') process.exit(1);
const status = lstatSync(path);
if (
  !status.isFile() ||
  status.isSymbolicLink() ||
  (status.mode & 0o777) !== 0o600 ||
  status.uid !== process.getuid()
) {
  process.exit(1);
}
const metadata = JSON.parse(readFileSync(path, 'utf8'));
if (
  metadata.type !== 'service_account' ||
  metadata.client_email !==
    'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com' ||
  metadata.project_id !== projectId ||
  typeof metadata.private_key_id !== 'string' ||
  metadata.private_key_id.length === 0
) {
  process.exit(2);
}
NODE

legacy_gate_parent="${HOME}/.local/state/intexuraos/secret-migration"
if [[ -e "${legacy_gate_parent}" || -L "${legacy_gate_parent}" ]]; then
  [[ -d "${legacy_gate_parent}" && ! -L "${legacy_gate_parent}" ]]
fi
install -d -m 700 "${legacy_gate_parent}"
chmod 700 "${legacy_gate_parent}"
GATE_PARENT="${legacy_gate_parent}" node <<'NODE'
const { lstatSync, realpathSync } = require('node:fs');
const parent = process.env.GATE_PARENT;
if (typeof parent !== 'string' || !parent.startsWith('/')) process.exit(1);
const status = lstatSync(parent);
if (
  realpathSync(parent) !== parent ||
  !status.isDirectory() ||
  status.isSymbolicLink() ||
  (status.mode & 0o777) !== 0o700 ||
  status.uid !== process.getuid()
) {
  process.exit(2);
}
NODE
legacy_gate_dir="$(mktemp -d "${legacy_gate_parent}/legacy-read-gate.XXXXXX")"
chmod 700 "${legacy_gate_dir}"
printf 'export LEGACY_GATE_DIR=%q\n' "${legacy_gate_dir}"

git -C "${repo_root}" show "${reviewed_sha}:terraform/environments/dev/main.tf" \
  >"${legacy_gate_dir}/reviewed-main.tf"
chmod 600 "${legacy_gate_dir}/reviewed-main.tf"

node - "${legacy_gate_dir}/reviewed-main.tf" \
  "${legacy_gate_dir}/legacy-names.json" <<'NODE'
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [inputPath, outputPath] = process.argv.slice(2);
const source = readFileSync(inputPath, 'utf8');
const block = source.match(
  /legacy_secret_container_names\s*=\s*toset\(\[([\s\S]*?)\]\)/u,
);
if (!block) process.exit(1);
const names = [...block[1].matchAll(/"(INTEXURAOS_[A-Z0-9_]+)"/gu)]
  .map((match) => match[1])
  .sort();
if (names.length !== 34 || new Set(names).size !== 34) process.exit(2);
writeFileSync(outputPath, `${JSON.stringify(names, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE

jq -e 'length == 34 and . == (sort | unique)' \
  "${legacy_gate_dir}/legacy-names.json" >/dev/null

inventory_sha256="$(node - "${legacy_gate_dir}/legacy-names.json" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
process.stdout.write(createHash('sha256').update(readFileSync(process.argv[2])).digest('hex'));
NODE
)"
[[ "${inventory_sha256}" == "${expected_inventory_sha256}" ]]
rm -f -- "${legacy_gate_dir}/reviewed-main.tf"

jq -n \
  --arg reviewedSha "${reviewed_sha}" \
  --arg inventorySha256 "${inventory_sha256}" \
  --slurpfile names "${legacy_gate_dir}/legacy-names.json" \
  '{reviewedSha:$reviewedSha,inventorySha256:$inventorySha256,
    legacyNameCount:($names[0] | length),legacyNames:$names[0]}' \
  >"${legacy_gate_dir}/inventory.json"
chmod 600 "${legacy_gate_dir}/inventory.json"
dev_control_secret='INTEXURAOS_SECRET_PACKAGE_DEV'
dev_control_version='2'
dev_control_principal='ixos-secret-publisher-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
prod_control_secret='INTEXURAOS_SECRET_PACKAGE_PROD'
prod_control_version='2'
prod_control_principal='ixos-secret-publisher-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
[[ "${dev_control_version}" =~ ^[1-9][0-9]*$ ]]
[[ "${prod_control_version}" =~ ^[1-9][0-9]*$ ]]

git -C "${repo_root}" show "${reviewed_sha}:config/environments/secret-packages.json" \
  >"${legacy_gate_dir}/reviewed-manifest.json"
chmod 600 "${legacy_gate_dir}/reviewed-manifest.json"
jq -e \
  --arg devSecret "${dev_control_secret}" \
  --arg devVersion "${dev_control_version}" \
  --arg prodSecret "${prod_control_secret}" \
  --arg prodVersion "${prod_control_version}" \
  '.packages.dev.secretId == $devSecret and
   (.packages.dev.stableVersion | tostring) == $devVersion and
   .packages.prod.secretId == $prodSecret and
   (.packages.prod.stableVersion | tostring) == $prodVersion' \
  "${legacy_gate_dir}/reviewed-manifest.json" >/dev/null
rm -f -- "${legacy_gate_dir}/reviewed-manifest.json"

verify_inventory_integrity() {
  local boundary="$1"
  local actual_inventory_sha256=''
  local output_file="${legacy_gate_dir}/inventory-check-${boundary}.json"
  local staging_file="${output_file}.tmp.$$"
  [[ "${boundary}" == 't0' || "${boundary}" == 't1' || "${boundary}" == 'query' ]]
  [[ ! -e "${output_file}" ]]

  actual_inventory_sha256="$(node - \
    "${legacy_gate_dir}/legacy-names.json" \
    "${legacy_gate_dir}/inventory.json" \
    "${reviewed_sha}" "${expected_inventory_sha256}" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const [namesPath, inventoryPath, reviewedSha, expectedHash] = process.argv.slice(2);
const namesSource = readFileSync(namesPath);
const names = JSON.parse(namesSource.toString('utf8'));
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const sorted = Array.isArray(names) ? [...names].sort() : [];
const validNames =
  Array.isArray(names) &&
  names.length === 34 &&
  new Set(names).size === 34 &&
  names.every((name, index) =>
    typeof name === 'string' &&
    /^INTEXURAOS_[A-Z0-9_]+$/u.test(name) &&
    name === sorted[index]
  );
const actualHash = createHash('sha256').update(namesSource).digest('hex');
const inventoryMatches =
  inventory.reviewedSha === reviewedSha &&
  inventory.inventorySha256 === expectedHash &&
  inventory.legacyNameCount === 34 &&
  JSON.stringify(inventory.legacyNames) === JSON.stringify(names);
if (!validNames || actualHash !== expectedHash || !inventoryMatches) process.exit(1);
process.stdout.write(actualHash);
NODE
  )"
  [[ "${actual_inventory_sha256}" == "${expected_inventory_sha256}" ]]

  jq -n \
    --arg boundary "${boundary}" \
    --arg checkedAt "$(node -e 'process.stdout.write(new Date().toISOString())')" \
    --arg inventorySha256 "${actual_inventory_sha256}" \
    '{boundary:$boundary,checkedAt:$checkedAt,
      inventorySha256:$inventorySha256,result:"PASS"}' >"${staging_file}"
  chmod 600 "${staging_file}"
  mv -- "${staging_file}" "${output_file}"
}

verify_data_read_logging() (
  set -euo pipefail
  local boundary="$1"
  local output_file="${legacy_gate_dir}/audit-config-${boundary}.json"
  local scratch_dir=''
  local scratch_name=''

  cleanup_audit_config_ephemera() {
    local rc=$?
    trap - EXIT
    if [[ -n "${scratch_dir}" ]]; then
      [[ "${scratch_dir}" == "${legacy_gate_dir}/"* ]] || rc=1
      scratch_name="${scratch_dir#"${legacy_gate_dir}/"}"
      case "${scratch_name}" in
        .audit-config-t0.*|.audit-config-t1.*|.audit-config-query.*)
          rm -rf -- "${scratch_dir}" || rc=1
          ;;
        *) rc=1 ;;
      esac
    fi
    exit "${rc}"
  }
  trap cleanup_audit_config_ephemera EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  [[ "${boundary}" == 't0' || "${boundary}" == 't1' || "${boundary}" == 'query' ]]
  [[ ! -e "${output_file}" ]]
  scratch_dir="$(mktemp -d "${legacy_gate_dir}/.audit-config-${boundary}.XXXXXX")"
  chmod 700 "${scratch_dir}"

  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud projects describe "${project_id}" --format=json \
    >"${scratch_dir}/project.json"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud projects get-iam-policy "${project_id}" --format=json \
    >"${scratch_dir}/project-policy.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet organizations get-iam-policy "${org_id}" \
      --account="${org_policy_reader_account}" --format=json \
    >"${scratch_dir}/org-policy.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging read \
      "logName=\"organizations/${org_id}/logs/cloudaudit.googleapis.com%2Factivity\"" \
      --organization="${org_id}" --limit=1 --freshness=7d --order=desc \
      --account="${org_policy_reader_account}" --format=json \
    >/dev/null
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging read \
      "logName=\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Fdata_access\"" \
      --project="${project_id}" --limit=1 --freshness=7d --order=desc \
      --account="${org_policy_reader_account}" --format=json \
    >/dev/null
  chmod 600 "${scratch_dir}"/*.json

  node - \
    "${scratch_dir}/project.json" \
    "${scratch_dir}/project-policy.json" \
    "${scratch_dir}/org-policy.json" \
    "${boundary}" "${project_id}" "${org_id}" \
    "${org_policy_reader_account}" "${scratch_dir}/receipt.json" <<'NODE'
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [
  projectPath,
  projectPolicyPath,
  orgPolicyPath,
  boundary,
  projectId,
  orgId,
  orgPolicyReader,
  outputPath,
] = process.argv.slice(2);
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
const projectPolicy = JSON.parse(readFileSync(projectPolicyPath, 'utf8'));
const orgPolicy = JSON.parse(readFileSync(orgPolicyPath, 'utf8'));
if (
  project.projectId !== projectId ||
  project.parent?.type !== 'organization' ||
  String(project.parent?.id) !== orgId
) {
  process.exit(1);
}
const relevantServices = new Set(['secretmanager.googleapis.com', 'allServices']);
const collectConfigs = (policy, scope) =>
  (policy.auditConfigs ?? []).flatMap((auditConfig) => {
    if (!relevantServices.has(auditConfig.service)) return [];
    return (auditConfig.auditLogConfigs ?? [])
      .filter((config) => config.logType === 'DATA_READ')
      .map((config) => ({
        scope,
        service: auditConfig.service,
        exemptedMembers: [...(config.exemptedMembers ?? [])].sort(),
      }));
  });
const effectiveConfigs = [
  ...collectConfigs(projectPolicy, `projects/${projectId}`),
  ...collectConfigs(orgPolicy, `organizations/${orgId}`),
].sort((left, right) =>
  `${left.scope}:${left.service}`.localeCompare(`${right.scope}:${right.service}`),
);
const exemptedMembers = effectiveConfigs.flatMap((config) => config.exemptedMembers);
if (effectiveConfigs.length === 0 || exemptedMembers.length !== 0) process.exit(2);
const receipt = {
  boundary,
  checkedAt: new Date().toISOString(),
  projectParent: { type: 'organization', id: orgId },
  projectPolicyReader:
    'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
  orgPolicyReader,
  orgLogAccessProbe: 'PASS',
  projectPrivateLogAccessProbe: 'PASS',
  effectiveConfigs,
  exemptedMembers: [],
  result: 'PASS',
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE
  mv -- "${scratch_dir}/receipt.json" "${output_file}"
  rm -rf -- "${scratch_dir}"
  scratch_dir=''
)

verify_logging_route() (
  set -euo pipefail
  local boundary="$1"
  local output_file="${legacy_gate_dir}/logging-route-${boundary}.json"
  local scratch_dir=''
  local scratch_name=''

  cleanup_logging_route_ephemera() {
    local rc=$?
    trap - EXIT
    if [[ -n "${scratch_dir}" ]]; then
      [[ "${scratch_dir}" == "${legacy_gate_dir}/"* ]] || rc=1
      scratch_name="${scratch_dir#"${legacy_gate_dir}/"}"
      case "${scratch_name}" in
        .logging-route-t0.*|.logging-route-t1.*|.logging-route-query.*)
          rm -rf -- "${scratch_dir}" || rc=1
          ;;
        *) rc=1 ;;
      esac
    fi
    exit "${rc}"
  }
  trap cleanup_logging_route_ephemera EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  [[ "${boundary}" == 't0' || "${boundary}" == 't1' || "${boundary}" == 'query' ]]
  [[ ! -e "${output_file}" ]]
  scratch_dir="$(mktemp -d "${legacy_gate_dir}/.logging-route-${boundary}.XXXXXX")"
  chmod 700 "${scratch_dir}"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud logging sinks describe _Default --project="${project_id}" --format=json \
    >"${scratch_dir}/sink.json"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud logging buckets describe _Default --location=global \
      --project="${project_id}" --format=json >"${scratch_dir}/bucket.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging sinks list --organization="${org_id}" \
      --account="${org_policy_reader_account}" --format=json \
    >"${scratch_dir}/org-sinks.json"
  chmod 600 "${scratch_dir}"/*.json

  EXPECTED_DEFAULT_SINK_FILTER="${expected_default_sink_filter}" node - \
    "${scratch_dir}/sink.json" "${scratch_dir}/bucket.json" \
    "${scratch_dir}/org-sinks.json" \
    "${boundary}" "${project_id}" "${org_id}" \
    "${org_policy_reader_account}" "${scratch_dir}/receipt.json" <<'NODE'
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [
  sinkPath,
  bucketPath,
  orgSinksPath,
  boundary,
  projectId,
  orgId,
  orgPolicyReader,
  outputPath,
] = process.argv.slice(2);
const sink = JSON.parse(readFileSync(sinkPath, 'utf8'));
const bucket = JSON.parse(readFileSync(bucketPath, 'utf8'));
const orgSinks = JSON.parse(readFileSync(orgSinksPath, 'utf8'));
const expectedFilter = process.env.EXPECTED_DEFAULT_SINK_FILTER;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const disabled = hasOwn(sink, 'disabled') ? sink.disabled : false;
const exclusions = hasOwn(sink, 'exclusions') ? sink.exclusions : [];
const locked = hasOwn(bucket, 'locked') ? bucket.locked : false;
const expectedDestination =
  `logging.googleapis.com/projects/${projectId}/locations/global/buckets/_Default`;
const expectedBucketName = `projects/${projectId}/locations/global/buckets/_Default`;
if (
  sink.name !== '_Default' ||
  sink.destination !== expectedDestination ||
  sink.filter !== expectedFilter ||
  typeof disabled !== 'boolean' ||
  disabled !== false ||
  !Array.isArray(exclusions) ||
  exclusions.length !== 0
) {
  process.exit(1);
}
if (
  bucket.name !== expectedBucketName ||
  bucket.lifecycleState !== 'ACTIVE' ||
  !Number.isInteger(bucket.retentionDays) ||
  bucket.retentionDays < 30 ||
  typeof locked !== 'boolean'
) {
  process.exit(2);
}
if (!Array.isArray(orgSinks)) process.exit(3);
const booleanField = (object, key) => {
  if (!hasOwn(object, key)) return false;
  if (typeof object[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  return object[key];
};
const enabledInterceptingSinks = orgSinks.filter(
  (orgSink) =>
    !booleanField(orgSink, 'disabled') &&
    booleanField(orgSink, 'includeChildren') &&
    booleanField(orgSink, 'interceptChildren'),
);
if (enabledInterceptingSinks.length !== 0) process.exit(4);
const receipt = {
  boundary,
  checkedAt: new Date().toISOString(),
  sink: {
    name: sink.name,
    destination: sink.destination,
    filter: sink.filter,
    disabled,
    exclusions: [],
  },
  bucket: {
    name: bucket.name,
    lifecycleState: bucket.lifecycleState,
    retentionDays: bucket.retentionDays,
    locked,
  },
  organization: {
    id: orgId,
    reader: orgPolicyReader,
    sinkCount: orgSinks.length,
    enabledInterceptingSinkCount: 0,
  },
  result: 'PASS',
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE
  mv -- "${scratch_dir}/receipt.json" "${output_file}"
  rm -rf -- "${scratch_dir}"
  scratch_dir=''
)

preflight_no_stale_ephemera() {
  local stale_path=''
  local stale_name=''
  local found=0
  local candidates=()
  shopt -s nullglob
  candidates=(
    "${legacy_gate_dir}"/.control-t0-dev.*
    "${legacy_gate_dir}"/.control-t0-prod.*
    "${legacy_gate_dir}"/.control-t1-dev.*
    "${legacy_gate_dir}"/.control-t1-prod.*
    "${legacy_gate_dir}"/control-t0-dev.json.tmp.*
    "${legacy_gate_dir}"/control-t0-prod.json.tmp.*
    "${legacy_gate_dir}"/control-t1-dev.json.tmp.*
    "${legacy_gate_dir}"/control-t1-prod.json.tmp.*
    "${legacy_gate_dir}"/.audit-config-t0.*
    "${legacy_gate_dir}"/.audit-config-t1.*
    "${legacy_gate_dir}"/.audit-config-query.*
    "${legacy_gate_dir}"/.logging-route-t0.*
    "${legacy_gate_dir}"/.logging-route-t1.*
    "${legacy_gate_dir}"/.logging-route-query.*
  )
  shopt -u nullglob
  for stale_path in "${candidates[@]}" \
    "${legacy_gate_dir}/request.json" \
    "${legacy_gate_dir}/response.json" \
    "${legacy_gate_dir}/page-tokens"; do
    [[ -e "${stale_path}" || -L "${stale_path}" ]] || continue
    found=1
    [[ "${stale_path}" == "${legacy_gate_dir}/"* ]]
    stale_name="${stale_path#"${legacy_gate_dir}/"}"
    case "${stale_name}" in
      .control-t0-dev.*|.control-t0-prod.*|.control-t1-dev.*|.control-t1-prod.*|\
      .audit-config-t0.*|.audit-config-t1.*|.audit-config-query.*|\
      .logging-route-t0.*|.logging-route-t1.*|.logging-route-query.*)
        rm -rf -- "${stale_path}"
        ;;
      control-t0-dev.json.tmp.*|control-t0-prod.json.tmp.*|\
      control-t1-dev.json.tmp.*|control-t1-prod.json.tmp.*|\
      request.json|response.json|page-tokens)
        rm -f -- "${stale_path}"
        ;;
      *)
        return 2
        ;;
    esac
  done
  if ((found != 0)); then
    printf 'Removed stale secret-control ephemera; reset T0 before continuing\n' >&2
    return 1
  fi
}

run_package_control() (
  set -euo pipefail
  local boundary="$1"
  local environment="$2"
  local control_secret=''
  local control_version=''
  local control_principal=''
  local output_file=''
  local scratch_dir=''
  local payload_file=''
  local staging_file=''
  local before=''
  local after=''

  cleanup_control_ephemera() {
    local rc=$?
    local scratch_name=''
    trap - EXIT
    if [[ -n "${scratch_dir}" ]]; then
      [[ "${scratch_dir}" == "${legacy_gate_dir}/"* ]] || rc=1
      scratch_name="${scratch_dir#"${legacy_gate_dir}/"}"
      case "${scratch_name}" in
        .control-t0-dev.*|.control-t0-prod.*|.control-t1-dev.*|.control-t1-prod.*)
          rm -rf -- "${scratch_dir}" || rc=1
          ;;
        *)
          rc=1
          ;;
      esac
    fi
    if [[ -n "${staging_file}" ]]; then
      [[ "${staging_file}" == "${output_file}.tmp."* ]] || rc=1
      rm -f -- "${staging_file}" || rc=1
    fi
    exit "${rc}"
  }

  trap cleanup_control_ephemera EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  [[ "${boundary}" == 't0' || "${boundary}" == 't1' ]]
  case "${environment}" in
    dev)
      control_secret="${dev_control_secret}"
      control_version="${dev_control_version}"
      control_principal="${dev_control_principal}"
      ;;
    prod)
      control_secret="${prod_control_secret}"
      control_version="${prod_control_version}"
      control_principal="${prod_control_principal}"
      ;;
    *)
      return 2
      ;;
  esac
  output_file="${legacy_gate_dir}/control-${boundary}-${environment}.json"
  [[ ! -e "${output_file}" ]]
  preflight_no_stale_ephemera

  scratch_dir="$(mktemp -d \
    "${legacy_gate_dir}/.control-${boundary}-${environment}.XXXXXX")"
  chmod 700 "${scratch_dir}"
  payload_file="${scratch_dir}/payload.json"
  staging_file="${output_file}.tmp.$$"
  before="$(node -e 'process.stdout.write(new Date().toISOString())')"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT="${control_principal}" \
    node "${repo_root}/scripts/secret-package.mjs" fetch \
      --environment "${environment}" \
      --version "${control_version}" \
      --project-id "${project_id}" \
      --output "${payload_file}" >/dev/null
  [[ -s "${payload_file}" ]]
  rm -rf -- "${scratch_dir}"
  scratch_dir=''
  after="$(node -e 'process.stdout.write(new Date().toISOString())')"

  jq -n \
    --arg boundary "${boundary}" \
    --arg environment "${environment}" \
    --arg before "${before}" \
    --arg after "${after}" \
    --arg secret "${control_secret}" \
    --arg version "${control_version}" \
    --arg principal "${control_principal}" \
    '{boundary:$boundary,environment:$environment,before:$before,after:$after,
      secret:$secret,version:$version,principal:$principal}' \
    >"${staging_file}"
  chmod 600 "${staging_file}"
  mv -- "${staging_file}" "${output_file}"
  staging_file=''
)

# T0 stage: run only after the normal-traffic prerequisites above pass.
repo_root="$(git rev-parse --show-toplevel)"
preflight_no_stale_ephemera
verify_inventory_integrity t0
verify_data_read_logging t0
verify_logging_route t0
run_package_control t0 dev
run_package_control t0 prod
audit_t0="$(jq -sr 'map(.before) | min' \
  "${legacy_gate_dir}/control-t0-dev.json" \
  "${legacy_gate_dir}/control-t0-prod.json")"
t0_controls_complete_at="$(jq -sr 'map(.after) | max' \
  "${legacy_gate_dir}/control-t0-dev.json" \
  "${legacy_gate_dir}/control-t0-prod.json")"

node - "${audit_t0}" "${t0_controls_complete_at}" \
  "${legacy_gate_dir}/t0.json" <<'NODE'
const { writeFileSync, chmodSync } = require('node:fs');
const [startText, controlsCompleteText, outputPath] = process.argv.slice(2);
const start = Date.parse(startText);
const controlsComplete = Date.parse(controlsCompleteText);
if (!Number.isFinite(start) || !Number.isFinite(controlsComplete)) process.exit(1);
const receipt = {
  t0: new Date(start).toISOString(),
  controlsCompleteAt: new Date(controlsComplete).toISOString(),
  notBeforeT1: new Date(start + 72 * 60 * 60 * 1000).toISOString(),
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE
```

Exit the T0 shell without deleting `legacy_gate_dir` and preserve its printed
absolute path as `LEGACY_GATE_DIR`. At least 72 continuous hours later, run the
self-contained T1 block below from the reviewed repository. Its only operator
input is that recorded path. The block redeclares every fixed value and helper;
it never sources executable content from the mutable evidence workspace. The
time check runs before any T1 receipt or package access, so an early attempt
leaves no partial T1 boundary.

```bash
# T1 stage
set -euo pipefail
set +x
unset CLOUDSDK_AUTH_ACCESS_TOKEN
unset CLOUDSDK_AUTH_ACCESS_TOKEN_FILE
umask 077
project_id='intexuraos-dev-pbuchman'
project_number='544224260556'
org_id='398419898183'
org_policy_reader_account='kontakt@pbuchman.com'
reviewed_sha='c8c24cddfe652995f0d5c69dce0f912b3a2315b8'
expected_inventory_sha256='6324dca830a96cff486aeff3a1cf3cad9bf2aa42192b1957de6362015e1e5413'
expected_default_sink_filter='NOT LOG_ID("cloudaudit.googleapis.com/activity") AND NOT LOG_ID("externalaudit.googleapis.com/activity") AND NOT LOG_ID("cloudaudit.googleapis.com/system_event") AND NOT LOG_ID("externalaudit.googleapis.com/system_event") AND NOT LOG_ID("cloudaudit.googleapis.com/access_transparency") AND NOT LOG_ID("externalaudit.googleapis.com/access_transparency")'
operator_credential_file="${HOME}/.config/gcloud/sa-key.json"
legacy_gate_parent="${HOME}/.local/state/intexuraos/secret-migration"
legacy_gate_dir="${LEGACY_GATE_DIR:?export LEGACY_GATE_DIR to the exact path printed at T0}"
repo_root="$(git rev-parse --show-toplevel)"
dev_control_secret='INTEXURAOS_SECRET_PACKAGE_DEV'
dev_control_version='2'
dev_control_principal='ixos-secret-publisher-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
prod_control_secret='INTEXURAOS_SECRET_PACKAGE_PROD'
prod_control_version='2'
prod_control_principal='ixos-secret-publisher-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com'

GATE_PARENT="${legacy_gate_parent}" \
  GATE_DIR="${legacy_gate_dir}" \
  OPERATOR_CREDENTIAL_FILE="${operator_credential_file}" \
  EXPECTED_PROJECT_ID="${project_id}" node <<'NODE'
const { lstatSync, readFileSync, realpathSync } = require('node:fs');
const { basename, dirname } = require('node:path');
const parent = process.env.GATE_PARENT;
const gate = process.env.GATE_DIR;
const credential = process.env.OPERATOR_CREDENTIAL_FILE;
const projectId = process.env.EXPECTED_PROJECT_ID;
if (![parent, gate, credential, projectId].every((value) => typeof value === 'string')) {
  process.exit(1);
}
const parentStatus = lstatSync(parent);
const gateStatus = lstatSync(gate);
if (
  !parent.startsWith('/') ||
  realpathSync(parent) !== parent ||
  !parentStatus.isDirectory() ||
  parentStatus.isSymbolicLink() ||
  (parentStatus.mode & 0o777) !== 0o700 ||
  parentStatus.uid !== process.getuid() ||
  !gate.startsWith('/') ||
  realpathSync(gate) !== gate ||
  realpathSync(dirname(gate)) !== realpathSync(parent) ||
  !/^legacy-read-gate\.[A-Za-z0-9]+$/u.test(basename(gate)) ||
  !gateStatus.isDirectory() ||
  gateStatus.isSymbolicLink() ||
  (gateStatus.mode & 0o777) !== 0o700 ||
  gateStatus.uid !== process.getuid()
) {
  process.exit(2);
}
const credentialStatus = lstatSync(credential);
const metadata = JSON.parse(readFileSync(credential, 'utf8'));
if (
  !credentialStatus.isFile() ||
  credentialStatus.isSymbolicLink() ||
  (credentialStatus.mode & 0o777) !== 0o600 ||
  credentialStatus.uid !== process.getuid() ||
  metadata.type !== 'service_account' ||
  metadata.client_email !==
    'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com' ||
  metadata.project_id !== projectId ||
  typeof metadata.private_key_id !== 'string' ||
  metadata.private_key_id.length === 0
) {
  process.exit(3);
}
NODE

git -C "${repo_root}" cat-file -e "${reviewed_sha}^{commit}"
git -C "${repo_root}" diff --quiet "${reviewed_sha}" -- \
  terraform/environments/dev/main.tf \
  config/environments/secret-packages.json \
  scripts/secret-package.mjs \
  scripts/lib/secret-package.mjs \
  scripts/lib/dev-secret-sync-lock.mjs

verify_inventory_integrity() {
  local boundary="$1"
  local actual_inventory_sha256=''
  local output_file="${legacy_gate_dir}/inventory-check-${boundary}.json"
  local staging_file="${output_file}.tmp.$$"
  [[ "${boundary}" == 't1' ]]
  [[ ! -e "${output_file}" ]]
  actual_inventory_sha256="$(node - \
    "${legacy_gate_dir}/legacy-names.json" \
    "${legacy_gate_dir}/inventory.json" \
    "${reviewed_sha}" "${expected_inventory_sha256}" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const [namesPath, inventoryPath, reviewedSha, expectedHash] = process.argv.slice(2);
const namesSource = readFileSync(namesPath);
const names = JSON.parse(namesSource.toString('utf8'));
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const sorted = Array.isArray(names) ? [...names].sort() : [];
const validNames =
  Array.isArray(names) && names.length === 34 && new Set(names).size === 34 &&
  names.every((name, index) =>
    typeof name === 'string' && /^INTEXURAOS_[A-Z0-9_]+$/u.test(name) &&
    name === sorted[index]
  );
const actualHash = createHash('sha256').update(namesSource).digest('hex');
const inventoryMatches =
  inventory.reviewedSha === reviewedSha &&
  inventory.inventorySha256 === expectedHash &&
  inventory.legacyNameCount === 34 &&
  JSON.stringify(inventory.legacyNames) === JSON.stringify(names);
if (!validNames || actualHash !== expectedHash || !inventoryMatches) process.exit(1);
process.stdout.write(actualHash);
NODE
  )"
  [[ "${actual_inventory_sha256}" == "${expected_inventory_sha256}" ]]
  jq -n \
    --arg boundary "${boundary}" \
    --arg checkedAt "$(node -e 'process.stdout.write(new Date().toISOString())')" \
    --arg inventorySha256 "${actual_inventory_sha256}" \
    '{boundary:$boundary,checkedAt:$checkedAt,
      inventorySha256:$inventorySha256,result:"PASS"}' >"${staging_file}"
  chmod 600 "${staging_file}"
  mv -- "${staging_file}" "${output_file}"
}

verify_data_read_logging() (
  set -euo pipefail
  local boundary="$1"
  local output_file="${legacy_gate_dir}/audit-config-${boundary}.json"
  local scratch_dir=''
  local scratch_name=''

  cleanup_audit_config_ephemera() {
    local rc=$?
    trap - EXIT
    if [[ -n "${scratch_dir}" ]]; then
      [[ "${scratch_dir}" == "${legacy_gate_dir}/"* ]] || rc=1
      scratch_name="${scratch_dir#"${legacy_gate_dir}/"}"
      case "${scratch_name}" in
        .audit-config-t0.*|.audit-config-t1.*|.audit-config-query.*)
          rm -rf -- "${scratch_dir}" || rc=1
          ;;
        *) rc=1 ;;
      esac
    fi
    exit "${rc}"
  }
  trap cleanup_audit_config_ephemera EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  [[ "${boundary}" == 't0' || "${boundary}" == 't1' || "${boundary}" == 'query' ]]
  [[ ! -e "${output_file}" ]]
  scratch_dir="$(mktemp -d "${legacy_gate_dir}/.audit-config-${boundary}.XXXXXX")"
  chmod 700 "${scratch_dir}"

  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud projects describe "${project_id}" --format=json \
    >"${scratch_dir}/project.json"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud projects get-iam-policy "${project_id}" --format=json \
    >"${scratch_dir}/project-policy.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet organizations get-iam-policy "${org_id}" \
      --account="${org_policy_reader_account}" --format=json \
    >"${scratch_dir}/org-policy.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging read \
      "logName=\"organizations/${org_id}/logs/cloudaudit.googleapis.com%2Factivity\"" \
      --organization="${org_id}" --limit=1 --freshness=7d --order=desc \
      --account="${org_policy_reader_account}" --format=json \
    >/dev/null
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging read \
      "logName=\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Fdata_access\"" \
      --project="${project_id}" --limit=1 --freshness=7d --order=desc \
      --account="${org_policy_reader_account}" --format=json \
    >/dev/null
  chmod 600 "${scratch_dir}"/*.json

  node - \
    "${scratch_dir}/project.json" \
    "${scratch_dir}/project-policy.json" \
    "${scratch_dir}/org-policy.json" \
    "${boundary}" "${project_id}" "${org_id}" \
    "${org_policy_reader_account}" "${scratch_dir}/receipt.json" <<'NODE'
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [
  projectPath,
  projectPolicyPath,
  orgPolicyPath,
  boundary,
  projectId,
  orgId,
  orgPolicyReader,
  outputPath,
] = process.argv.slice(2);
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
const projectPolicy = JSON.parse(readFileSync(projectPolicyPath, 'utf8'));
const orgPolicy = JSON.parse(readFileSync(orgPolicyPath, 'utf8'));
if (
  project.projectId !== projectId ||
  project.parent?.type !== 'organization' ||
  String(project.parent?.id) !== orgId
) {
  process.exit(1);
}
const relevantServices = new Set(['secretmanager.googleapis.com', 'allServices']);
const collectConfigs = (policy, scope) =>
  (policy.auditConfigs ?? []).flatMap((auditConfig) => {
    if (!relevantServices.has(auditConfig.service)) return [];
    return (auditConfig.auditLogConfigs ?? [])
      .filter((config) => config.logType === 'DATA_READ')
      .map((config) => ({
        scope,
        service: auditConfig.service,
        exemptedMembers: [...(config.exemptedMembers ?? [])].sort(),
      }));
  });
const effectiveConfigs = [
  ...collectConfigs(projectPolicy, `projects/${projectId}`),
  ...collectConfigs(orgPolicy, `organizations/${orgId}`),
].sort((left, right) =>
  `${left.scope}:${left.service}`.localeCompare(`${right.scope}:${right.service}`),
);
const exemptedMembers = effectiveConfigs.flatMap((config) => config.exemptedMembers);
if (effectiveConfigs.length === 0 || exemptedMembers.length !== 0) process.exit(2);
const receipt = {
  boundary,
  checkedAt: new Date().toISOString(),
  projectParent: { type: 'organization', id: orgId },
  projectPolicyReader:
    'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
  orgPolicyReader,
  orgLogAccessProbe: 'PASS',
  projectPrivateLogAccessProbe: 'PASS',
  effectiveConfigs,
  exemptedMembers: [],
  result: 'PASS',
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE
  mv -- "${scratch_dir}/receipt.json" "${output_file}"
  rm -rf -- "${scratch_dir}"
  scratch_dir=''
)

verify_logging_route() (
  set -euo pipefail
  local boundary="$1"
  local output_file="${legacy_gate_dir}/logging-route-${boundary}.json"
  local scratch_dir=''
  local scratch_name=''

  cleanup_logging_route_ephemera() {
    local rc=$?
    trap - EXIT
    if [[ -n "${scratch_dir}" ]]; then
      [[ "${scratch_dir}" == "${legacy_gate_dir}/"* ]] || rc=1
      scratch_name="${scratch_dir#"${legacy_gate_dir}/"}"
      case "${scratch_name}" in
        .logging-route-t0.*|.logging-route-t1.*|.logging-route-query.*)
          rm -rf -- "${scratch_dir}" || rc=1
          ;;
        *) rc=1 ;;
      esac
    fi
    exit "${rc}"
  }
  trap cleanup_logging_route_ephemera EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  [[ "${boundary}" == 't0' || "${boundary}" == 't1' || "${boundary}" == 'query' ]]
  [[ ! -e "${output_file}" ]]
  scratch_dir="$(mktemp -d "${legacy_gate_dir}/.logging-route-${boundary}.XXXXXX")"
  chmod 700 "${scratch_dir}"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud logging sinks describe _Default --project="${project_id}" --format=json \
    >"${scratch_dir}/sink.json"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud logging buckets describe _Default --location=global \
      --project="${project_id}" --format=json >"${scratch_dir}/bucket.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging sinks list --organization="${org_id}" \
      --account="${org_policy_reader_account}" --format=json \
    >"${scratch_dir}/org-sinks.json"
  chmod 600 "${scratch_dir}"/*.json

  EXPECTED_DEFAULT_SINK_FILTER="${expected_default_sink_filter}" node - \
    "${scratch_dir}/sink.json" "${scratch_dir}/bucket.json" \
    "${scratch_dir}/org-sinks.json" \
    "${boundary}" "${project_id}" "${org_id}" \
    "${org_policy_reader_account}" "${scratch_dir}/receipt.json" <<'NODE'
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [
  sinkPath,
  bucketPath,
  orgSinksPath,
  boundary,
  projectId,
  orgId,
  orgPolicyReader,
  outputPath,
] = process.argv.slice(2);
const sink = JSON.parse(readFileSync(sinkPath, 'utf8'));
const bucket = JSON.parse(readFileSync(bucketPath, 'utf8'));
const orgSinks = JSON.parse(readFileSync(orgSinksPath, 'utf8'));
const expectedFilter = process.env.EXPECTED_DEFAULT_SINK_FILTER;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const disabled = hasOwn(sink, 'disabled') ? sink.disabled : false;
const exclusions = hasOwn(sink, 'exclusions') ? sink.exclusions : [];
const locked = hasOwn(bucket, 'locked') ? bucket.locked : false;
const expectedDestination =
  `logging.googleapis.com/projects/${projectId}/locations/global/buckets/_Default`;
const expectedBucketName = `projects/${projectId}/locations/global/buckets/_Default`;
if (
  sink.name !== '_Default' ||
  sink.destination !== expectedDestination ||
  sink.filter !== expectedFilter ||
  typeof disabled !== 'boolean' ||
  disabled !== false ||
  !Array.isArray(exclusions) ||
  exclusions.length !== 0
) {
  process.exit(1);
}
if (
  bucket.name !== expectedBucketName ||
  bucket.lifecycleState !== 'ACTIVE' ||
  !Number.isInteger(bucket.retentionDays) ||
  bucket.retentionDays < 30 ||
  typeof locked !== 'boolean'
) {
  process.exit(2);
}
if (!Array.isArray(orgSinks)) process.exit(3);
const booleanField = (object, key) => {
  if (!hasOwn(object, key)) return false;
  if (typeof object[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  return object[key];
};
const enabledInterceptingSinks = orgSinks.filter(
  (orgSink) =>
    !booleanField(orgSink, 'disabled') &&
    booleanField(orgSink, 'includeChildren') &&
    booleanField(orgSink, 'interceptChildren'),
);
if (enabledInterceptingSinks.length !== 0) process.exit(4);
const receipt = {
  boundary,
  checkedAt: new Date().toISOString(),
  sink: {
    name: sink.name,
    destination: sink.destination,
    filter: sink.filter,
    disabled,
    exclusions: [],
  },
  bucket: {
    name: bucket.name,
    lifecycleState: bucket.lifecycleState,
    retentionDays: bucket.retentionDays,
    locked,
  },
  organization: {
    id: orgId,
    reader: orgPolicyReader,
    sinkCount: orgSinks.length,
    enabledInterceptingSinkCount: 0,
  },
  result: 'PASS',
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE
  mv -- "${scratch_dir}/receipt.json" "${output_file}"
  rm -rf -- "${scratch_dir}"
  scratch_dir=''
)

preflight_no_stale_ephemera() {
  local stale_path=''
  local stale_name=''
  local found=0
  local candidates=()
  shopt -s nullglob
  candidates=(
    "${legacy_gate_dir}"/.control-t0-dev.*
    "${legacy_gate_dir}"/.control-t0-prod.*
    "${legacy_gate_dir}"/.control-t1-dev.*
    "${legacy_gate_dir}"/.control-t1-prod.*
    "${legacy_gate_dir}"/control-t0-dev.json.tmp.*
    "${legacy_gate_dir}"/control-t0-prod.json.tmp.*
    "${legacy_gate_dir}"/control-t1-dev.json.tmp.*
    "${legacy_gate_dir}"/control-t1-prod.json.tmp.*
    "${legacy_gate_dir}"/.audit-config-t0.*
    "${legacy_gate_dir}"/.audit-config-t1.*
    "${legacy_gate_dir}"/.audit-config-query.*
    "${legacy_gate_dir}"/.logging-route-t0.*
    "${legacy_gate_dir}"/.logging-route-t1.*
    "${legacy_gate_dir}"/.logging-route-query.*
  )
  shopt -u nullglob
  for stale_path in "${candidates[@]}" \
    "${legacy_gate_dir}/request.json" \
    "${legacy_gate_dir}/response.json" \
    "${legacy_gate_dir}/page-tokens"; do
    [[ -e "${stale_path}" || -L "${stale_path}" ]] || continue
    found=1
    [[ "${stale_path}" == "${legacy_gate_dir}/"* ]]
    stale_name="${stale_path#"${legacy_gate_dir}/"}"
    case "${stale_name}" in
      .control-t0-dev.*|.control-t0-prod.*|.control-t1-dev.*|.control-t1-prod.*|\
      .audit-config-t0.*|.audit-config-t1.*|.audit-config-query.*|\
      .logging-route-t0.*|.logging-route-t1.*|.logging-route-query.*)
        rm -rf -- "${stale_path}"
        ;;
      control-t0-dev.json.tmp.*|control-t0-prod.json.tmp.*|\
      control-t1-dev.json.tmp.*|control-t1-prod.json.tmp.*|\
      request.json|response.json|page-tokens)
        rm -f -- "${stale_path}"
        ;;
      *)
        return 2
        ;;
    esac
  done
  if ((found != 0)); then
    printf 'Removed stale secret-control ephemera; reset T0 before continuing\n' >&2
    return 1
  fi
}

run_package_control() (
  set -euo pipefail
  local boundary="$1"
  local environment="$2"
  local control_secret=''
  local control_version=''
  local control_principal=''
  local output_file=''
  local scratch_dir=''
  local payload_file=''
  local staging_file=''
  local before=''
  local after=''
  cleanup_control_ephemera() {
    local rc=$?
    local scratch_name=''
    trap - EXIT
    if [[ -n "${scratch_dir}" ]]; then
      [[ "${scratch_dir}" == "${legacy_gate_dir}/"* ]] || rc=1
      scratch_name="${scratch_dir#"${legacy_gate_dir}/"}"
      case "${scratch_name}" in
        .control-t0-dev.*|.control-t0-prod.*|.control-t1-dev.*|.control-t1-prod.*)
          rm -rf -- "${scratch_dir}" || rc=1
          ;;
        *) rc=1 ;;
      esac
    fi
    if [[ -n "${staging_file}" ]]; then
      [[ "${staging_file}" == "${output_file}.tmp."* ]] || rc=1
      rm -f -- "${staging_file}" || rc=1
    fi
    exit "${rc}"
  }
  trap cleanup_control_ephemera EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  [[ "${boundary}" == 't1' ]]
  case "${environment}" in
    dev)
      control_secret="${dev_control_secret}"
      control_version="${dev_control_version}"
      control_principal="${dev_control_principal}"
      ;;
    prod)
      control_secret="${prod_control_secret}"
      control_version="${prod_control_version}"
      control_principal="${prod_control_principal}"
      ;;
    *) return 2 ;;
  esac
  output_file="${legacy_gate_dir}/control-${boundary}-${environment}.json"
  [[ ! -e "${output_file}" ]]
  preflight_no_stale_ephemera
  scratch_dir="$(mktemp -d \
    "${legacy_gate_dir}/.control-${boundary}-${environment}.XXXXXX")"
  chmod 700 "${scratch_dir}"
  payload_file="${scratch_dir}/payload.json"
  staging_file="${output_file}.tmp.$$"
  before="$(node -e 'process.stdout.write(new Date().toISOString())')"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT="${control_principal}" \
    node "${repo_root}/scripts/secret-package.mjs" fetch \
      --environment "${environment}" \
      --version "${control_version}" \
      --project-id "${project_id}" \
      --output "${payload_file}" >/dev/null
  [[ -s "${payload_file}" ]]
  rm -rf -- "${scratch_dir}"
  scratch_dir=''
  after="$(node -e 'process.stdout.write(new Date().toISOString())')"
  jq -n \
    --arg boundary "${boundary}" \
    --arg environment "${environment}" \
    --arg before "${before}" \
    --arg after "${after}" \
    --arg secret "${control_secret}" \
    --arg version "${control_version}" \
    --arg principal "${control_principal}" \
    '{boundary:$boundary,environment:$environment,before:$before,after:$after,
      secret:$secret,version:$version,principal:$principal}' >"${staging_file}"
  chmod 600 "${staging_file}"
  mv -- "${staging_file}" "${output_file}"
  staging_file=''
)

preflight_no_stale_ephemera
node - "${legacy_gate_dir}/t0.json" <<'NODE'
const { readFileSync } = require('node:fs');
const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const notBefore = Date.parse(receipt.notBeforeT1);
if (!Number.isFinite(notBefore) || Date.now() < notBefore) process.exit(1);
NODE

verify_inventory_integrity t1
verify_data_read_logging t1
verify_logging_route t1
run_package_control t1 dev
run_package_control t1 prod
audit_t0="$(jq -er '.t0' "${legacy_gate_dir}/t0.json")"
audit_t1="$(jq -sr 'map(.after) | max' \
  "${legacy_gate_dir}/control-t1-dev.json" \
  "${legacy_gate_dir}/control-t1-prod.json")"

node - "${audit_t0}" "${audit_t1}" "${legacy_gate_dir}/t1.json" <<'NODE'
const { writeFileSync, chmodSync } = require('node:fs');
const [startText, endText, outputPath] = process.argv.slice(2);
const start = Date.parse(startText);
const end = Date.parse(endText);
if (!Number.isFinite(start) || !Number.isFinite(end)) process.exit(1);
if (end - start < 72 * 60 * 60 * 1000) process.exit(2);
const receipt = {
  t0: new Date(start).toISOString(),
  t1: new Date(end).toISOString(),
  durationSeconds: Math.floor((end - start) / 1000),
  query_not_before: new Date(end + 15 * 60 * 1000).toISOString(),
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE
```

Wait at least 15 minutes after `audit_t1` for log ingestion. The exact bounds
are `timestamp>="${audit_t0}"` and `timestamp<="${audit_t1}"`. Build one filter
that admits only the frozen 34 legacy resources, the two exact package controls,
project and organization Admin Activity `SetIamPolicy` entries, and project
`logging.googleapis.com` Admin Activity writes. Run the self-contained query
block with the same recorded `LEGACY_GATE_DIR`; it redeclares and validates its
entire context. The explicitly selected organization reader must authorize both
project and organization `resourceNames`; a permission or reauthentication
failure is STOP. Then call Logging `entries.list` until `nextPageToken` is absent—even if an
intermediate page has no entries. The Logging API explicitly requires this
behavior; see the [`entries.list` REST
contract](https://cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list).
All mutation counters use the same closed `[audit_t0,audit_t1]` window and its
15-minute delivery lag. The query-boundary policy, sink, bucket, and parent
receipts are a fresh endpoint attestation; this procedure does not claim an
unlagged exhaustive mutation count from `audit_t1` through query execution.
Do not pass `--limit` to a `gcloud logging read` fallback; its default is
unlimited, while a numeric limit would make the zero-read claim incomplete.
The REST loop itself has a 10,000-page safety bound and rejects a repeated page
token. Either condition is FAIL, never a truncated PASS.

```bash
# Query stage
set -euo pipefail
set +x
unset CLOUDSDK_AUTH_ACCESS_TOKEN
unset CLOUDSDK_AUTH_ACCESS_TOKEN_FILE
umask 077
project_id='intexuraos-dev-pbuchman'
project_number='544224260556'
org_id='398419898183'
org_policy_reader_account='kontakt@pbuchman.com'
reviewed_sha='c8c24cddfe652995f0d5c69dce0f912b3a2315b8'
expected_inventory_sha256='6324dca830a96cff486aeff3a1cf3cad9bf2aa42192b1957de6362015e1e5413'
expected_default_sink_filter='NOT LOG_ID("cloudaudit.googleapis.com/activity") AND NOT LOG_ID("externalaudit.googleapis.com/activity") AND NOT LOG_ID("cloudaudit.googleapis.com/system_event") AND NOT LOG_ID("externalaudit.googleapis.com/system_event") AND NOT LOG_ID("cloudaudit.googleapis.com/access_transparency") AND NOT LOG_ID("externalaudit.googleapis.com/access_transparency")'
operator_credential_file="${HOME}/.config/gcloud/sa-key.json"
legacy_gate_parent="${HOME}/.local/state/intexuraos/secret-migration"
legacy_gate_dir="${LEGACY_GATE_DIR:?export LEGACY_GATE_DIR to the exact path printed at T0}"
dev_control_secret='INTEXURAOS_SECRET_PACKAGE_DEV'
dev_control_version='2'
dev_control_principal='ixos-secret-publisher-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'
prod_control_secret='INTEXURAOS_SECRET_PACKAGE_PROD'
prod_control_version='2'
prod_control_principal='ixos-secret-publisher-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com'

GATE_PARENT="${legacy_gate_parent}" \
  GATE_DIR="${legacy_gate_dir}" \
  OPERATOR_CREDENTIAL_FILE="${operator_credential_file}" \
  EXPECTED_PROJECT_ID="${project_id}" node <<'NODE'
const { lstatSync, readFileSync, realpathSync } = require('node:fs');
const { basename, dirname } = require('node:path');
const parent = process.env.GATE_PARENT;
const gate = process.env.GATE_DIR;
const credential = process.env.OPERATOR_CREDENTIAL_FILE;
const projectId = process.env.EXPECTED_PROJECT_ID;
if (![parent, gate, credential, projectId].every((value) => typeof value === 'string')) {
  process.exit(1);
}
const parentStatus = lstatSync(parent);
const gateStatus = lstatSync(gate);
if (
  !parent.startsWith('/') ||
  realpathSync(parent) !== parent ||
  !parentStatus.isDirectory() ||
  parentStatus.isSymbolicLink() ||
  (parentStatus.mode & 0o777) !== 0o700 ||
  parentStatus.uid !== process.getuid() ||
  !gate.startsWith('/') ||
  realpathSync(gate) !== gate ||
  realpathSync(dirname(gate)) !== realpathSync(parent) ||
  !/^legacy-read-gate\.[A-Za-z0-9]+$/u.test(basename(gate)) ||
  !gateStatus.isDirectory() ||
  gateStatus.isSymbolicLink() ||
  (gateStatus.mode & 0o777) !== 0o700 ||
  gateStatus.uid !== process.getuid()
) {
  process.exit(2);
}
const credentialStatus = lstatSync(credential);
const metadata = JSON.parse(readFileSync(credential, 'utf8'));
if (
  !credentialStatus.isFile() ||
  credentialStatus.isSymbolicLink() ||
  (credentialStatus.mode & 0o777) !== 0o600 ||
  credentialStatus.uid !== process.getuid() ||
  metadata.type !== 'service_account' ||
  metadata.client_email !==
    'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com' ||
  metadata.project_id !== projectId ||
  typeof metadata.private_key_id !== 'string' ||
  metadata.private_key_id.length === 0
) {
  process.exit(3);
}
NODE

verify_inventory_integrity() {
  local boundary="$1"
  local actual_inventory_sha256=''
  local output_file="${legacy_gate_dir}/inventory-check-${boundary}.json"
  local staging_file="${output_file}.tmp.$$"
  [[ "${boundary}" == 'query' ]]
  [[ ! -e "${output_file}" ]]
  actual_inventory_sha256="$(node - \
    "${legacy_gate_dir}/legacy-names.json" \
    "${legacy_gate_dir}/inventory.json" \
    "${reviewed_sha}" "${expected_inventory_sha256}" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const [namesPath, inventoryPath, reviewedSha, expectedHash] = process.argv.slice(2);
const namesSource = readFileSync(namesPath);
const names = JSON.parse(namesSource.toString('utf8'));
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const sorted = Array.isArray(names) ? [...names].sort() : [];
const validNames =
  Array.isArray(names) && names.length === 34 && new Set(names).size === 34 &&
  names.every((name, index) =>
    typeof name === 'string' && /^INTEXURAOS_[A-Z0-9_]+$/u.test(name) &&
    name === sorted[index]
  );
const actualHash = createHash('sha256').update(namesSource).digest('hex');
const inventoryMatches =
  inventory.reviewedSha === reviewedSha &&
  inventory.inventorySha256 === expectedHash &&
  inventory.legacyNameCount === 34 &&
  JSON.stringify(inventory.legacyNames) === JSON.stringify(names);
if (!validNames || actualHash !== expectedHash || !inventoryMatches) process.exit(1);
process.stdout.write(actualHash);
NODE
  )"
  [[ "${actual_inventory_sha256}" == "${expected_inventory_sha256}" ]]
  jq -n \
    --arg boundary "${boundary}" \
    --arg checkedAt "$(node -e 'process.stdout.write(new Date().toISOString())')" \
    --arg inventorySha256 "${actual_inventory_sha256}" \
    '{boundary:$boundary,checkedAt:$checkedAt,
      inventorySha256:$inventorySha256,result:"PASS"}' >"${staging_file}"
  chmod 600 "${staging_file}"
  mv -- "${staging_file}" "${output_file}"
}

verify_data_read_logging() (
  set -euo pipefail
  local boundary="$1"
  local output_file="${legacy_gate_dir}/audit-config-${boundary}.json"
  local scratch_dir=''
  local scratch_name=''

  cleanup_audit_config_ephemera() {
    local rc=$?
    trap - EXIT
    if [[ -n "${scratch_dir}" ]]; then
      [[ "${scratch_dir}" == "${legacy_gate_dir}/"* ]] || rc=1
      scratch_name="${scratch_dir#"${legacy_gate_dir}/"}"
      case "${scratch_name}" in
        .audit-config-t0.*|.audit-config-t1.*|.audit-config-query.*)
          rm -rf -- "${scratch_dir}" || rc=1
          ;;
        *) rc=1 ;;
      esac
    fi
    exit "${rc}"
  }
  trap cleanup_audit_config_ephemera EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  [[ "${boundary}" == 't0' || "${boundary}" == 't1' || "${boundary}" == 'query' ]]
  [[ ! -e "${output_file}" ]]
  scratch_dir="$(mktemp -d "${legacy_gate_dir}/.audit-config-${boundary}.XXXXXX")"
  chmod 700 "${scratch_dir}"

  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud projects describe "${project_id}" --format=json \
    >"${scratch_dir}/project.json"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud projects get-iam-policy "${project_id}" --format=json \
    >"${scratch_dir}/project-policy.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet organizations get-iam-policy "${org_id}" \
      --account="${org_policy_reader_account}" --format=json \
    >"${scratch_dir}/org-policy.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging read \
      "logName=\"organizations/${org_id}/logs/cloudaudit.googleapis.com%2Factivity\"" \
      --organization="${org_id}" --limit=1 --freshness=7d --order=desc \
      --account="${org_policy_reader_account}" --format=json \
    >/dev/null
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging read \
      "logName=\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Fdata_access\"" \
      --project="${project_id}" --limit=1 --freshness=7d --order=desc \
      --account="${org_policy_reader_account}" --format=json \
    >/dev/null
  chmod 600 "${scratch_dir}"/*.json

  node - \
    "${scratch_dir}/project.json" \
    "${scratch_dir}/project-policy.json" \
    "${scratch_dir}/org-policy.json" \
    "${boundary}" "${project_id}" "${org_id}" \
    "${org_policy_reader_account}" "${scratch_dir}/receipt.json" <<'NODE'
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [
  projectPath,
  projectPolicyPath,
  orgPolicyPath,
  boundary,
  projectId,
  orgId,
  orgPolicyReader,
  outputPath,
] = process.argv.slice(2);
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
const projectPolicy = JSON.parse(readFileSync(projectPolicyPath, 'utf8'));
const orgPolicy = JSON.parse(readFileSync(orgPolicyPath, 'utf8'));
if (
  project.projectId !== projectId ||
  project.parent?.type !== 'organization' ||
  String(project.parent?.id) !== orgId
) {
  process.exit(1);
}
const relevantServices = new Set(['secretmanager.googleapis.com', 'allServices']);
const collectConfigs = (policy, scope) =>
  (policy.auditConfigs ?? []).flatMap((auditConfig) => {
    if (!relevantServices.has(auditConfig.service)) return [];
    return (auditConfig.auditLogConfigs ?? [])
      .filter((config) => config.logType === 'DATA_READ')
      .map((config) => ({
        scope,
        service: auditConfig.service,
        exemptedMembers: [...(config.exemptedMembers ?? [])].sort(),
      }));
  });
const effectiveConfigs = [
  ...collectConfigs(projectPolicy, `projects/${projectId}`),
  ...collectConfigs(orgPolicy, `organizations/${orgId}`),
].sort((left, right) =>
  `${left.scope}:${left.service}`.localeCompare(`${right.scope}:${right.service}`),
);
const exemptedMembers = effectiveConfigs.flatMap((config) => config.exemptedMembers);
if (effectiveConfigs.length === 0 || exemptedMembers.length !== 0) process.exit(2);
const receipt = {
  boundary,
  checkedAt: new Date().toISOString(),
  projectParent: { type: 'organization', id: orgId },
  projectPolicyReader:
    'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com',
  orgPolicyReader,
  orgLogAccessProbe: 'PASS',
  projectPrivateLogAccessProbe: 'PASS',
  effectiveConfigs,
  exemptedMembers: [],
  result: 'PASS',
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE
  mv -- "${scratch_dir}/receipt.json" "${output_file}"
  rm -rf -- "${scratch_dir}"
  scratch_dir=''
)

verify_logging_route() (
  set -euo pipefail
  local boundary="$1"
  local output_file="${legacy_gate_dir}/logging-route-${boundary}.json"
  local scratch_dir=''
  local scratch_name=''

  cleanup_logging_route_ephemera() {
    local rc=$?
    trap - EXIT
    if [[ -n "${scratch_dir}" ]]; then
      [[ "${scratch_dir}" == "${legacy_gate_dir}/"* ]] || rc=1
      scratch_name="${scratch_dir#"${legacy_gate_dir}/"}"
      case "${scratch_name}" in
        .logging-route-t0.*|.logging-route-t1.*|.logging-route-query.*)
          rm -rf -- "${scratch_dir}" || rc=1
          ;;
        *) rc=1 ;;
      esac
    fi
    exit "${rc}"
  }
  trap cleanup_logging_route_ephemera EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  [[ "${boundary}" == 't0' || "${boundary}" == 't1' || "${boundary}" == 'query' ]]
  [[ ! -e "${output_file}" ]]
  scratch_dir="$(mktemp -d "${legacy_gate_dir}/.logging-route-${boundary}.XXXXXX")"
  chmod 700 "${scratch_dir}"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud logging sinks describe _Default --project="${project_id}" --format=json \
    >"${scratch_dir}/sink.json"
  CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${operator_credential_file}" \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud logging buckets describe _Default --location=global \
      --project="${project_id}" --format=json >"${scratch_dir}/bucket.json"
  env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet logging sinks list --organization="${org_id}" \
      --account="${org_policy_reader_account}" --format=json \
    >"${scratch_dir}/org-sinks.json"
  chmod 600 "${scratch_dir}"/*.json

  EXPECTED_DEFAULT_SINK_FILTER="${expected_default_sink_filter}" node - \
    "${scratch_dir}/sink.json" "${scratch_dir}/bucket.json" \
    "${scratch_dir}/org-sinks.json" \
    "${boundary}" "${project_id}" "${org_id}" \
    "${org_policy_reader_account}" "${scratch_dir}/receipt.json" <<'NODE'
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [
  sinkPath,
  bucketPath,
  orgSinksPath,
  boundary,
  projectId,
  orgId,
  orgPolicyReader,
  outputPath,
] = process.argv.slice(2);
const sink = JSON.parse(readFileSync(sinkPath, 'utf8'));
const bucket = JSON.parse(readFileSync(bucketPath, 'utf8'));
const orgSinks = JSON.parse(readFileSync(orgSinksPath, 'utf8'));
const expectedFilter = process.env.EXPECTED_DEFAULT_SINK_FILTER;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const disabled = hasOwn(sink, 'disabled') ? sink.disabled : false;
const exclusions = hasOwn(sink, 'exclusions') ? sink.exclusions : [];
const locked = hasOwn(bucket, 'locked') ? bucket.locked : false;
const expectedDestination =
  `logging.googleapis.com/projects/${projectId}/locations/global/buckets/_Default`;
const expectedBucketName = `projects/${projectId}/locations/global/buckets/_Default`;
if (
  sink.name !== '_Default' ||
  sink.destination !== expectedDestination ||
  sink.filter !== expectedFilter ||
  typeof disabled !== 'boolean' ||
  disabled !== false ||
  !Array.isArray(exclusions) ||
  exclusions.length !== 0
) {
  process.exit(1);
}
if (
  bucket.name !== expectedBucketName ||
  bucket.lifecycleState !== 'ACTIVE' ||
  !Number.isInteger(bucket.retentionDays) ||
  bucket.retentionDays < 30 ||
  typeof locked !== 'boolean'
) {
  process.exit(2);
}
if (!Array.isArray(orgSinks)) process.exit(3);
const booleanField = (object, key) => {
  if (!hasOwn(object, key)) return false;
  if (typeof object[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  return object[key];
};
const enabledInterceptingSinks = orgSinks.filter(
  (orgSink) =>
    !booleanField(orgSink, 'disabled') &&
    booleanField(orgSink, 'includeChildren') &&
    booleanField(orgSink, 'interceptChildren'),
);
if (enabledInterceptingSinks.length !== 0) process.exit(4);
const receipt = {
  boundary,
  checkedAt: new Date().toISOString(),
  sink: {
    name: sink.name,
    destination: sink.destination,
    filter: sink.filter,
    disabled,
    exclusions: [],
  },
  bucket: {
    name: bucket.name,
    lifecycleState: bucket.lifecycleState,
    retentionDays: bucket.retentionDays,
    locked,
  },
  organization: {
    id: orgId,
    reader: orgPolicyReader,
    sinkCount: orgSinks.length,
    enabledInterceptingSinkCount: 0,
  },
  result: 'PASS',
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
NODE
  mv -- "${scratch_dir}/receipt.json" "${output_file}"
  rm -rf -- "${scratch_dir}"
  scratch_dir=''
)

preflight_no_stale_ephemera() {
  local stale_path=''
  local stale_name=''
  local found=0
  local candidates=()
  shopt -s nullglob
  candidates=(
    "${legacy_gate_dir}"/.control-t0-dev.*
    "${legacy_gate_dir}"/.control-t0-prod.*
    "${legacy_gate_dir}"/.control-t1-dev.*
    "${legacy_gate_dir}"/.control-t1-prod.*
    "${legacy_gate_dir}"/control-t0-dev.json.tmp.*
    "${legacy_gate_dir}"/control-t0-prod.json.tmp.*
    "${legacy_gate_dir}"/control-t1-dev.json.tmp.*
    "${legacy_gate_dir}"/control-t1-prod.json.tmp.*
    "${legacy_gate_dir}"/.audit-config-t0.*
    "${legacy_gate_dir}"/.audit-config-t1.*
    "${legacy_gate_dir}"/.audit-config-query.*
    "${legacy_gate_dir}"/.logging-route-t0.*
    "${legacy_gate_dir}"/.logging-route-t1.*
    "${legacy_gate_dir}"/.logging-route-query.*
  )
  shopt -u nullglob
  for stale_path in "${candidates[@]}" \
    "${legacy_gate_dir}/request.json" \
    "${legacy_gate_dir}/response.json" \
    "${legacy_gate_dir}/page-tokens"; do
    [[ -e "${stale_path}" || -L "${stale_path}" ]] || continue
    found=1
    [[ "${stale_path}" == "${legacy_gate_dir}/"* ]]
    stale_name="${stale_path#"${legacy_gate_dir}/"}"
    case "${stale_name}" in
      .control-t0-dev.*|.control-t0-prod.*|.control-t1-dev.*|.control-t1-prod.*|\
      .audit-config-t0.*|.audit-config-t1.*|.audit-config-query.*|\
      .logging-route-t0.*|.logging-route-t1.*|.logging-route-query.*)
        rm -rf -- "${stale_path}"
        ;;
      control-t0-dev.json.tmp.*|control-t0-prod.json.tmp.*|\
      control-t1-dev.json.tmp.*|control-t1-prod.json.tmp.*|\
      request.json|response.json|page-tokens)
        rm -f -- "${stale_path}"
        ;;
      *)
        return 2
        ;;
    esac
  done
  if ((found != 0)); then
    printf 'Removed stale secret-control ephemera; reset T0 before continuing\n' >&2
    return 1
  fi
}

preflight_no_stale_ephemera
node - "${legacy_gate_dir}/t1.json" <<'NODE'
const { readFileSync } = require('node:fs');
const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const notBefore = Date.parse(receipt.query_not_before);
if (!Number.isFinite(notBefore) || Date.now() < notBefore) process.exit(1);
NODE

verify_inventory_integrity query
verify_data_read_logging query
verify_logging_route query
audit_t0="$(jq -er '.t0' "${legacy_gate_dir}/t1.json")"
audit_t1="$(jq -er '.t1' "${legacy_gate_dir}/t1.json")"
[[ ! -e "${legacy_gate_dir}/filter.txt" ]]
[[ ! -e "${legacy_gate_dir}/entries.ndjson" ]]
[[ ! -e "${legacy_gate_dir}/query.json" ]]
[[ ! -e "${legacy_gate_dir}/result.json" ]]

cleanup_logging_ephemera() {
  local rc=$?
  trap - EXIT
  unset logging_access_token || true
  rm -f -- \
    "${legacy_gate_dir}/request.json" \
    "${legacy_gate_dir}/response.json" \
    "${legacy_gate_dir}/page-tokens" || rc=1
  exit "${rc}"
}
remove_logging_ephemera() {
  unset logging_access_token || true
  rm -f -- \
    "${legacy_gate_dir}/request.json" \
    "${legacy_gate_dir}/response.json" \
    "${legacy_gate_dir}/page-tokens"
}
trap cleanup_logging_ephemera EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
logging_access_token=''

legacy_resource_regex="$(node - \
  "${legacy_gate_dir}/legacy-names.json" \
  "${project_id}" "${project_number}" \
  "${expected_inventory_sha256}" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const [path, projectId, projectNumber, expectedHash] = process.argv.slice(2);
const namesSource = readFileSync(path);
const names = JSON.parse(namesSource.toString('utf8'));
const actualHash = createHash('sha256').update(namesSource).digest('hex');
if (actualHash !== expectedHash || !Array.isArray(names) || names.length !== 34) {
  process.exit(1);
}
const escapeRe2 = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const alternatives = names.map(escapeRe2).join('|');
process.stdout.write(
  `^projects/(${escapeRe2(projectId)}|${escapeRe2(projectNumber)})/` +
    `secrets/(${alternatives})/versions/[^/]+$`,
);
NODE
)"

control_resource_regex="^projects/(${project_id}|${project_number})/secrets/(${dev_control_secret}/versions/${dev_control_version}|${prod_control_secret}/versions/${prod_control_version})$"
secret_manager_filter="logName=\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Fdata_access\" AND protoPayload.serviceName=\"secretmanager.googleapis.com\" AND protoPayload.methodName=\"google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion\" AND (protoPayload.resourceName=~\"${legacy_resource_regex}\" OR protoPayload.resourceName=~\"${control_resource_regex}\")"
project_set_iam_policy_filter="logName=\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Factivity\" AND protoPayload.serviceName=\"cloudresourcemanager.googleapis.com\" AND protoPayload.methodName=\"SetIamPolicy\""
org_set_iam_policy_filter="logName=\"organizations/${org_id}/logs/cloudaudit.googleapis.com%2Factivity\" AND protoPayload.serviceName=\"cloudresourcemanager.googleapis.com\" AND protoPayload.methodName=\"SetIamPolicy\""
project_hierarchy_mutation_filter="(logName=\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Factivity\" OR logName=\"organizations/${org_id}/logs/cloudaudit.googleapis.com%2Factivity\") AND protoPayload.serviceName=\"cloudresourcemanager.googleapis.com\" AND (protoPayload.resourceName=\"projects/${project_id}\" OR protoPayload.resourceName=\"projects/${project_number}\")"
project_logging_config_filter="logName=\"projects/${project_id}/logs/cloudaudit.googleapis.com%2Factivity\" AND protoPayload.serviceName=\"logging.googleapis.com\""
org_logging_config_filter="logName=\"organizations/${org_id}/logs/cloudaudit.googleapis.com%2Factivity\" AND protoPayload.serviceName=\"logging.googleapis.com\""
logging_config_filter="((${project_logging_config_filter}) OR (${org_logging_config_filter}))"
audit_filter="timestamp>=\"${audit_t0}\" AND timestamp<=\"${audit_t1}\" AND ((${secret_manager_filter}) OR (${project_set_iam_policy_filter}) OR (${org_set_iam_policy_filter}) OR (${project_hierarchy_mutation_filter}) OR (${logging_config_filter}))"
printf '%s' "${audit_filter}" >"${legacy_gate_dir}/filter.txt"
chmod 600 "${legacy_gate_dir}/filter.txt"

page_token=''
page_count=0
record_count=0
max_page_count=10000
: >"${legacy_gate_dir}/entries.ndjson"
: >"${legacy_gate_dir}/page-tokens"
chmod 600 "${legacy_gate_dir}/entries.ndjson"
chmod 600 "${legacy_gate_dir}/page-tokens"

while :; do
  if ((page_count >= max_page_count)); then
    printf 'Legacy audit exceeded fail-closed page bound\n' >&2
    exit 1
  fi
  jq -n \
    --arg project "projects/${project_id}" \
    --arg organization "organizations/${org_id}" \
    --arg filter "${audit_filter}" \
    --arg token "${page_token}" \
    '{resourceNames:[$project,$organization],filter:$filter,
      orderBy:"timestamp asc",pageSize:1000}
      + if $token == "" then {} else {pageToken:$token} end' \
    >"${legacy_gate_dir}/request.json"
  chmod 600 "${legacy_gate_dir}/request.json"

  logging_access_token="$(env -u GOOGLE_APPLICATION_CREDENTIALS \
    CLOUDSDK_AUTH_ACCESS_TOKEN='' \
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE='' \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE='' \
    CLOUDSDK_CORE_DISABLE_PROMPTS=1 \
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT='' \
    gcloud --quiet auth print-access-token \
      --account="${org_policy_reader_account}")"
  [[ "${logging_access_token}" =~ ^[A-Za-z0-9._~-]+$ ]]
  printf 'header = "Authorization: Bearer %s"\n' "${logging_access_token}" |
    curl --disable --config - --fail --silent --show-error \
      --connect-timeout 10 \
      --max-time 60 \
      --request POST \
      --header 'Content-Type: application/json' \
      --data-binary "@${legacy_gate_dir}/request.json" \
      'https://logging.googleapis.com/v2/entries:list' \
      >"${legacy_gate_dir}/response.json"
  unset logging_access_token
  chmod 600 "${legacy_gate_dir}/response.json"

  jq -e '(.error | not) and ((.entries // []) | type == "array")' \
    "${legacy_gate_dir}/response.json" >/dev/null
  jq -c '.entries[]? | {
    timestamp,insertId,
    logName,
    resourceType:.resource.type,
    serviceName:.protoPayload.serviceName,
    methodName:.protoPayload.methodName,
    resourceName:.protoPayload.resourceName,
    principalEmail:.protoPayload.authenticationInfo.principalEmail,
    statusCode:(.protoPayload.status.code // 0)
  }' "${legacy_gate_dir}/response.json" \
    >>"${legacy_gate_dir}/entries.ndjson"
  page_count=$((page_count + 1))
  record_count=$((record_count + $(jq '.entries // [] | length' \
    "${legacy_gate_dir}/response.json")))
  page_token="$(jq -er '.nextPageToken // ""' \
    "${legacy_gate_dir}/response.json")"
  [[ -n "${page_token}" ]] || break
  if grep -Fqx -- "${page_token}" "${legacy_gate_dir}/page-tokens"; then
    printf 'Legacy audit returned a repeated page token\n' >&2
    exit 1
  fi
  printf '%s\n' "${page_token}" >>"${legacy_gate_dir}/page-tokens"
done

query_completed_at="$(node -e 'process.stdout.write(new Date().toISOString())')"
remove_logging_ephemera
trap - EXIT HUP INT TERM

query_staging_file="${legacy_gate_dir}/query.json.tmp.$$"
jq -n \
  --argjson pages "${page_count}" \
  --argjson records "${record_count}" \
  --arg completedAt "${query_completed_at}" \
  '{pages:$pages,records:$records,completedAt:$completedAt}' >"${query_staging_file}"
chmod 600 "${query_staging_file}"
mv -- "${query_staging_file}" "${legacy_gate_dir}/query.json"
```

Classify locally against the frozen list and validate all four exact-version
positive controls within their recorded boundary windows. Record all four
DEV/PROD package positive-control counts and no native-secret count, because
native exceptions are not members of the frozen legacy set. The durable
artifact contains only the reviewed SHA, inventory names/hash, timestamps,
resource names, principal emails, page/record counts, control counts, and
PASS/FAIL. It contains no payload, bearer token, full API response, reversible
secret digest, or credential path.

```bash
# Classification stage
set -euo pipefail
set +x
unset CLOUDSDK_AUTH_ACCESS_TOKEN
unset CLOUDSDK_AUTH_ACCESS_TOKEN_FILE
umask 077
project_id='intexuraos-dev-pbuchman'
project_number='544224260556'
org_id='398419898183'
legacy_gate_parent="${HOME}/.local/state/intexuraos/secret-migration"
legacy_gate_dir="${LEGACY_GATE_DIR:?export LEGACY_GATE_DIR to the exact path printed at T0}"
GATE_PARENT="${legacy_gate_parent}" GATE_DIR="${legacy_gate_dir}" node <<'NODE'
const { lstatSync, realpathSync } = require('node:fs');
const { basename, dirname } = require('node:path');
const parent = process.env.GATE_PARENT;
const gate = process.env.GATE_DIR;
if (typeof parent !== 'string' || typeof gate !== 'string') process.exit(1);
const parentStatus = lstatSync(parent);
const status = lstatSync(gate);
if (
  !parent.startsWith('/') ||
  realpathSync(parent) !== parent ||
  !parentStatus.isDirectory() ||
  parentStatus.isSymbolicLink() ||
  (parentStatus.mode & 0o777) !== 0o700 ||
  parentStatus.uid !== process.getuid() ||
  !gate.startsWith('/') ||
  realpathSync(gate) !== gate ||
  realpathSync(dirname(gate)) !== realpathSync(parent) ||
  !/^legacy-read-gate\.[A-Za-z0-9]+$/u.test(basename(gate)) ||
  !status.isDirectory() ||
  status.isSymbolicLink() ||
  (status.mode & 0o777) !== 0o700 ||
  status.uid !== process.getuid()
) {
  process.exit(2);
}
NODE
for stale_path in \
  "${legacy_gate_dir}/request.json" \
  "${legacy_gate_dir}/response.json" \
  "${legacy_gate_dir}/page-tokens"; do
  [[ ! -e "${stale_path}" && ! -L "${stale_path}" ]]
done
if compgen -G "${legacy_gate_dir}/.control-*" >/dev/null || \
  compgen -G "${legacy_gate_dir}/.audit-config-*" >/dev/null || \
  compgen -G "${legacy_gate_dir}/.logging-route-*" >/dev/null || \
  compgen -G "${legacy_gate_dir}/control-*.json.tmp.*" >/dev/null || \
  compgen -G "${legacy_gate_dir}/query.json.tmp.*" >/dev/null; then
  printf 'Stale secret-migration ephemera forbids classification\n' >&2
  exit 1
fi
page_count="$(jq -er '.pages | numbers' "${legacy_gate_dir}/query.json")"
record_count="$(jq -er '.records | numbers' "${legacy_gate_dir}/query.json")"
query_completed_at="$(jq -er '.completedAt | strings' "${legacy_gate_dir}/query.json")"
node - \
  "${legacy_gate_dir}/legacy-names.json" \
  "${legacy_gate_dir}/inventory.json" \
  "${legacy_gate_dir}/entries.ndjson" \
  "${legacy_gate_dir}/control-t0-dev.json" \
  "${legacy_gate_dir}/control-t0-prod.json" \
  "${legacy_gate_dir}/control-t1-dev.json" \
  "${legacy_gate_dir}/control-t1-prod.json" \
  "${legacy_gate_dir}/t1.json" \
  "${legacy_gate_dir}/audit-config-t0.json" \
  "${legacy_gate_dir}/audit-config-t1.json" \
  "${legacy_gate_dir}/audit-config-query.json" \
  "${legacy_gate_dir}/logging-route-t0.json" \
  "${legacy_gate_dir}/logging-route-t1.json" \
  "${legacy_gate_dir}/logging-route-query.json" \
  "${project_id}" "${project_number}" "${org_id}" \
  "${page_count}" "${record_count}" \
  "${query_completed_at}" \
  "${legacy_gate_dir}/result.json" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [
  namesPath,
  inventoryPath,
  entriesPath,
  t0DevPath,
  t0ProdPath,
  t1DevPath,
  t1ProdPath,
  intervalPath,
  auditConfigT0Path,
  auditConfigT1Path,
  auditConfigQueryPath,
  loggingRouteT0Path,
  loggingRouteT1Path,
  loggingRouteQueryPath,
  projectId,
  projectNumber,
  orgId,
  pagesText,
  recordsText,
  queryCompletedAtText,
  outputPath,
] = process.argv.slice(2);
const reviewedSha = 'c8c24cddfe652995f0d5c69dce0f912b3a2315b8';
const expectedInventorySha256 =
  '6324dca830a96cff486aeff3a1cf3cad9bf2aa42192b1957de6362015e1e5413';
const namesSource = readFileSync(namesPath);
const namesArray = JSON.parse(namesSource.toString('utf8'));
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const sortedNames = Array.isArray(namesArray) ? [...namesArray].sort() : [];
const actualInventorySha256 = createHash('sha256').update(namesSource).digest('hex');
const inventoryIntegrity =
  Array.isArray(namesArray) &&
  namesArray.length === 34 &&
  new Set(namesArray).size === 34 &&
  namesArray.every((name, index) =>
    typeof name === 'string' &&
    /^INTEXURAOS_[A-Z0-9_]+$/u.test(name) &&
    name === sortedNames[index]
  ) &&
  actualInventorySha256 === expectedInventorySha256 &&
  inventory.reviewedSha === reviewedSha &&
  inventory.inventorySha256 === expectedInventorySha256 &&
  inventory.legacyNameCount === 34 &&
  JSON.stringify(inventory.legacyNames) === JSON.stringify(namesArray);
const names = new Set(Array.isArray(namesArray) ? namesArray : []);
const lines = readFileSync(entriesPath, 'utf8').split('\n').filter(Boolean);
const entries = lines.map((line) => JSON.parse(line));
const controls = [t0DevPath, t0ProdPath, t1DevPath, t1ProdPath].map((path) =>
  JSON.parse(readFileSync(path, 'utf8'))
);
const interval = JSON.parse(readFileSync(intervalPath, 'utf8'));
const auditConfigReceipts = [
  auditConfigT0Path,
  auditConfigT1Path,
  auditConfigQueryPath,
].map((path) => JSON.parse(readFileSync(path, 'utf8')));
const loggingRouteReceipts = [
  loggingRouteT0Path,
  loggingRouteT1Path,
  loggingRouteQueryPath,
].map((path) => JSON.parse(readFileSync(path, 'utf8')));
const secretManagerService = 'secretmanager.googleapis.com';
const accessVersionMethod =
  'google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion';
const dataAccessLogName =
  `projects/${projectId}/logs/cloudaudit.googleapis.com%2Fdata_access`;
const projectActivityLogName =
  `projects/${projectId}/logs/cloudaudit.googleapis.com%2Factivity`;
const orgActivityLogName =
  `organizations/${orgId}/logs/cloudaudit.googleapis.com%2Factivity`;
const expectedDefaultSinkFilter =
  'NOT LOG_ID("cloudaudit.googleapis.com/activity") AND ' +
  'NOT LOG_ID("externalaudit.googleapis.com/activity") AND ' +
  'NOT LOG_ID("cloudaudit.googleapis.com/system_event") AND ' +
  'NOT LOG_ID("externalaudit.googleapis.com/system_event") AND ' +
  'NOT LOG_ID("cloudaudit.googleapis.com/access_transparency") AND ' +
  'NOT LOG_ID("externalaudit.googleapis.com/access_transparency")';
const expectedBoundaries = ['t0', 't1', 'query'];
const validCheckedAt = (receipt) => Number.isFinite(Date.parse(receipt.checkedAt));
const auditConfigEvidencePass = auditConfigReceipts.every((receipt, index) => {
  const configs = receipt.effectiveConfigs;
  return (
    receipt.boundary === expectedBoundaries[index] &&
    validCheckedAt(receipt) &&
    receipt.projectParent?.type === 'organization' &&
    String(receipt.projectParent?.id) === orgId &&
    receipt.projectPolicyReader ===
      'claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com' &&
    receipt.orgPolicyReader === 'kontakt@pbuchman.com' &&
    receipt.orgLogAccessProbe === 'PASS' &&
    receipt.projectPrivateLogAccessProbe === 'PASS' &&
    Array.isArray(configs) &&
    configs.length > 0 &&
    configs.every(
      (config) =>
        (config.scope === `projects/${projectId}` ||
          config.scope === `organizations/${orgId}`) &&
        (config.service === secretManagerService || config.service === 'allServices') &&
        Array.isArray(config.exemptedMembers) &&
        config.exemptedMembers.length === 0,
    ) &&
    Array.isArray(receipt.exemptedMembers) &&
    receipt.exemptedMembers.length === 0 &&
    receipt.result === 'PASS'
  );
});
const expectedSinkDestination =
  `logging.googleapis.com/projects/${projectId}/locations/global/buckets/_Default`;
const expectedBucketName = `projects/${projectId}/locations/global/buckets/_Default`;
const loggingRouteEvidencePass = loggingRouteReceipts.every((receipt, index) =>
  receipt.boundary === expectedBoundaries[index] &&
  validCheckedAt(receipt) &&
  receipt.sink?.name === '_Default' &&
  receipt.sink?.destination === expectedSinkDestination &&
  receipt.sink?.filter === expectedDefaultSinkFilter &&
  receipt.sink?.disabled === false &&
  Array.isArray(receipt.sink?.exclusions) &&
  receipt.sink.exclusions.length === 0 &&
  receipt.bucket?.name === expectedBucketName &&
  receipt.bucket?.lifecycleState === 'ACTIVE' &&
  Number.isInteger(receipt.bucket?.retentionDays) &&
  receipt.bucket.retentionDays >= 30 &&
  receipt.organization?.id === orgId &&
  receipt.organization?.reader === 'kontakt@pbuchman.com' &&
  Number.isInteger(receipt.organization?.sinkCount) &&
  receipt.organization.sinkCount >= 0 &&
  receipt.organization?.enabledInterceptingSinkCount === 0 &&
  receipt.result === 'PASS'
);
const resourcePattern = new RegExp(
  `^projects/(?:${projectId}|${projectNumber})/secrets/([^/]+)/versions/([^/]+)$`,
  'u',
);
let legacyCount = 0;
for (const entry of entries) {
  const match = resourcePattern.exec(entry.resourceName ?? '');
  if (
    entry.logName === dataAccessLogName &&
    entry.serviceName === secretManagerService &&
    entry.methodName === accessVersionMethod &&
    match &&
    names.has(match[1])
  ) {
    legacyCount += 1;
  }
}
const setIamPolicyEventCount = entries.filter(
  (entry) =>
    entry.logName === projectActivityLogName &&
    entry.serviceName === 'cloudresourcemanager.googleapis.com' &&
    entry.methodName === 'SetIamPolicy'
).length;
const parentPolicyMutationCount = entries.filter(
  (entry) =>
    entry.logName === orgActivityLogName &&
    entry.serviceName === 'cloudresourcemanager.googleapis.com' &&
    entry.methodName === 'SetIamPolicy'
).length;
const loggingConfigMutationCount = entries.filter(
  (entry) =>
    (entry.logName === projectActivityLogName || entry.logName === orgActivityLogName) &&
    entry.serviceName === 'logging.googleapis.com'
).length;
const projectHierarchyMutationCount = entries.filter(
  (entry) =>
    (entry.logName === projectActivityLogName || entry.logName === orgActivityLogName) &&
    entry.serviceName === 'cloudresourcemanager.googleapis.com' &&
    (entry.resourceName === `projects/${projectId}` ||
      entry.resourceName === `projects/${projectNumber}`)
).length;
const controlTuple = (control) =>
  JSON.stringify([
    control.boundary,
    control.environment,
    control.secret,
    control.version,
    control.principal,
  ]);
const expectedControlTuples = new Set([
  ['t0', 'dev', 'INTEXURAOS_SECRET_PACKAGE_DEV', '2',
    'ixos-secret-publisher-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'],
  ['t0', 'prod', 'INTEXURAOS_SECRET_PACKAGE_PROD', '2',
    'ixos-secret-publisher-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com'],
  ['t1', 'dev', 'INTEXURAOS_SECRET_PACKAGE_DEV', '2',
    'ixos-secret-publisher-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com'],
  ['t1', 'prod', 'INTEXURAOS_SECRET_PACKAGE_PROD', '2',
    'ixos-secret-publisher-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com'],
].map((tuple) => JSON.stringify(tuple)));
const actualControlTuples = controls.map(controlTuple);
const actualControlTupleSet = new Set(actualControlTuples);
const controlsExact =
  controls.length === 4 &&
  new Set(actualControlTuples).size === 4 &&
  actualControlTuples.every((tuple) => expectedControlTuples.has(tuple)) &&
  [...expectedControlTuples].every((tuple) => actualControlTupleSet.has(tuple));
const controlResults = controls.map((control) => {
  const earliest = Date.parse(control.before) - 60_000;
  const latest = Date.parse(control.after) + 60_000;
  const matches = entries.filter((entry) => {
    const resource = resourcePattern.exec(entry.resourceName ?? '');
    const timestamp = Date.parse(entry.timestamp ?? '');
    return entry.logName === dataAccessLogName &&
      entry.serviceName === secretManagerService &&
      entry.methodName === accessVersionMethod &&
      entry.statusCode === 0 &&
      resource?.[1] === control.secret &&
      resource?.[2] === control.version &&
      entry.principalEmail === control.principal &&
      timestamp >= earliest && timestamp <= latest;
  }).length;
  return { boundary: control.boundary, environment: control.environment, matches };
});
const pages = Number(pagesText);
const records = Number(recordsText);
const queryExecutedAtMs = Date.parse(queryCompletedAtText);
const queryExecutedAt = Number.isFinite(queryExecutedAtMs)
  ? new Date(queryExecutedAtMs).toISOString()
  : null;
const timingPass =
  Date.parse(interval.t1) - Date.parse(interval.t0) >= 72 * 60 * 60 * 1000 &&
  Number.isFinite(queryExecutedAtMs) &&
  queryExecutedAtMs >= Date.parse(interval.query_not_before);
const t0ControlStart = Math.min(
  ...controls.filter((control) => control.boundary === 't0').map((control) => Date.parse(control.before)),
);
const t1ControlStart = Math.min(
  ...controls.filter((control) => control.boundary === 't1').map((control) => Date.parse(control.before)),
);
const evidenceTimes = expectedBoundaries.map((_, index) => [
  Date.parse(auditConfigReceipts[index]?.checkedAt),
  Date.parse(loggingRouteReceipts[index]?.checkedAt),
]);
const metadataTimingPass =
  evidenceTimes.flat().every(Number.isFinite) &&
  evidenceTimes[0].every(
    (value) => value <= t0ControlStart && value >= t0ControlStart - 15 * 60 * 1000,
  ) &&
  evidenceTimes[1].every(
    (value) => value <= t1ControlStart && value >= t1ControlStart - 15 * 60 * 1000,
  ) &&
  evidenceTimes[2].every(
    (value) =>
      value >= Date.parse(interval.query_not_before) && value <= queryExecutedAtMs,
  );
const pass =
  inventoryIntegrity &&
  auditConfigEvidencePass &&
  loggingRouteEvidencePass &&
  pages >= 1 &&
  pages <= 10000 &&
  records === entries.length &&
  timingPass &&
  metadataTimingPass &&
  legacyCount === 0 &&
  setIamPolicyEventCount === 0 &&
  parentPolicyMutationCount === 0 &&
  loggingConfigMutationCount === 0 &&
  projectHierarchyMutationCount === 0 &&
  controlsExact &&
  controlResults.every((result) => result.matches > 0);
const result = {
  t0: interval.t0,
  t1: interval.t1,
  queryExecutedAt,
  pages,
  records,
  inventorySha256: actualInventorySha256,
  legacyCount,
  setIamPolicyEventCount,
  parentPolicyMutationCount,
  loggingConfigMutationCount,
  projectHierarchyMutationCount,
  boundaryEvidence: {
    auditConfig: auditConfigEvidencePass,
    loggingRoute: loggingRouteEvidencePass,
    timing: metadataTimingPass,
  },
  controls: controlResults,
  result: pass ? 'PASS' : 'FAIL',
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
chmodSync(outputPath, 0o600);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!pass) process.exit(1);
NODE
```

PASS is exactly: the reviewed 34-name inventory and exact SHA-256 still match,
at least 72 hours elapsed, the final query ran after the 15-minute lag,
pagination exhausted below the fail-closed bound, `legacyCount=0`,
`setIamPolicyEventCount=0`, `parentPolicyMutationCount=0`,
`loggingConfigMutationCount=0`, `projectHierarchyMutationCount=0`, every
T0/T1/query effective-policy and `_Default` sink/bucket receipt passes, every
organization boundary has zero enabled intercepting sinks, and the four unique
DEV/PROD T0/T1 controls have a successful (`statusCode=0`) audit entry under
their approved publishers. Any mismatch, legacy read, project or organization
`SetIamPolicy` event, project hierarchy mutation, Logging configuration write,
enabled organization intercepting sink, missing/repeated page, missing control,
stale secret ephemera, inherited audit-config mismatch, routing/retention
mismatch, or interruption of normal traffic resets `T0`; retain legacy IAM and
versions. A failed provider/model result remains outside this decision when the
terminal callback and secret-isolation conditions above pass.

## Rollback

Rollback is package-wide.

1. Stop deployment/reload and preserve the failed candidate's redacted
   metadata.
2. Select the previously verified numeric version recorded before promotion.
3. Fetch, CRC-check, validate, and render that exact version to a new staging
   target.
4. Atomically promote all projections together and restart the same consumers.
5. Run the full environment smoke suite and audit verification.
6. Update the protected version pin/manifest only after runtime recovery.

Do not mix fields from old and new versions. Do not re-enable an exposed
Firebase key or a compromised service-account key; publish a new complete
package that contains replacements instead.

Exercise rollback before legacy cleanup. Before switching, record the exact
prior and forward numeric versions, commit/workflow run, immutable release
names, and expected consumer inventory. Switch package-wide to the prior
version, confirm every generic/runtime projection pointer and projected version,
restart the same consumer set, and run the complete environment smoke matrix.
Observe three five-minute samples over a 15-minute interval: every required
health/canary operation must pass, and new unexpected `401`/`403`, credential,
Secret Manager denial, and dependency-health failure counts attributable to the
drill must each be `0`. Intentional invalid-token probes are recorded separately.
Then switch forward and repeat the identical checks and observation interval.
Evidence records commands, exit statuses, both version/pointer inventories,
three sample timestamps per direction, per-check PASS/FAIL and error counts,
and the final forward pointer. A single failed/missing sample fails the drill.

## Break-Glass Access

Break glass only when normal WIF/impersonation or the designated renderer is
unavailable and an active production incident justifies emergency access. It
requires two-person approval from the incident commander and infrastructure
approver; neither may approve alone.

1. Record both approver identities, incident ID, scope, one package, requested
   numeric version, principal, grant start, and expiry without values. The
   maximum TTL is 60 minutes and may not be extended in place.
2. Use a reviewed Terraform change for exactly one resource-level conditional
   `roles/secretmanager.secretAccessor` binding with a `request.time` expiry.
   The plan must contain that single grant and no project-level Secret Manager
   access. If the binding cannot be represented/reviewed in Terraform, stop;
   direct CLI IAM mutation is forbidden.
3. Use a private host and explicit staging target; disable tracing and session
   recording that could capture payloads.
4. Perform only fetch/validate/render/recovery. Do not inspect or print values.
5. Remove the binding through a second reviewed Terraform apply immediately
   after recovery and always before expiry. Verify live package and project IAM
   contain zero bindings for the emergency principal, revoke temporary
   credentials, and review Data Access logs.
6. Attach the two approvals, both plan/apply exit statuses, effective TTL,
   numeric version, access-log result, and live zero-binding proof to the
   incident. Rotate the package if exposure cannot be excluded.

Break glass does not relax numeric pinning, CRC, validation, redaction, or
two-person review for destructive cleanup.

## Disaster Recovery

The infrastructure on-call owns DR coordination; each provider/credential owner
owns reconstruction of their declared member. The recovery time objective is
four hours from incident declaration to a validated package and all required
allowlisted projections ready for controlled activation. The recovery point is
the latest promoted numeric version; the immediately previous verified version
is the rollback target. Package payloads are not backed up in Git or Terraform.
The exact per-member owner and recovery-source inventory is
`config/environments/secret-package-recovery.json`. Its schema-v2 catalog maps
every environment/file member to exactly one reviewed source ID and one of four
methods; CI verifies owner/source one-to-one coverage, rejects unknown or unused
sources, and emits counts only:

- `provider-regeneration`: create a replacement in the named provider's
  authoritative settings, then coordinate downstream replacement and revoke
  the old credential;
- `coordinated-rotation`: generate fresh cryptographic material with the
  documented consumer cutover and rollback procedure;
- `offline-escrow`: recover byte-identical encryption/signing material from the
  independent two-copy encrypted escrow outside GCP and Git;
- `authoritative-metadata`: reconstruct non-secret IDs/bindings from the named
  provider/account records and independently cross-check them.

The inventory never contains a value, private location, key ID, or value-derived
fingerprint. Before legacy/container cleanup, each named provider account must
be accessible and the offline escrow must have two readable, independently held
copies plus a tested decryption/reconstruction procedure. An unavailable source
fails the cleanup and DR gates. Record every drill or incident using
`docs/templates/secret-package-recovery-evidence.md`, which deliberately has no
field for values or value-derived fingerprints.

- Keep at least the active and immediately previous verified package versions
  enabled during normal operation and the observation window.
- Regularly test exact-version fetch and render using the recovery identity.
- Maintain external recovery procedures for the provisioner credential, domain
  registrar/DNS control, GitHub App private key, TLS material, and provider API
  tokens. Do not archive those values with documentation.
- Attest every catalog source by source ID and method. Do not mark full recovery
  ready until provider access, authoritative metadata, coordinated-rotation
  dependencies, and the two-copy offline escrow are all available.
- If a package container is lost, Terraform recreates the empty container and
  IAM. Authorized owners reconstruct one private file per member from
  authoritative providers. Run the builder in full-recovery mode (all
  `--override-env` and `--override-file` members, no `--base-version` and no
  legacy/external flags), publish it outside Terraform, validate it, and
  perform normal candidate promotion. Exact membership is an executable gate
  and the builder performs zero Secret Manager reads.
- If the bootstrap identity is lost, recover or federate that identity first;
  the package cannot solve its own bootstrap dependency.
- Treat destroyed Secret Manager versions as unrecoverable. Reconstruct and
  rotate every member whose authoritative source is unavailable or uncertain.

Run a redacted recovery drill at least annually and after changing schema,
identity, or renderer behavior. Use an isolated private output root and never
switch production pointers during the drill. PASS requires: the active and
previous numeric versions can both be fetched, CRC/schema/member-validated and
rendered; all output modes/allowlists pass; the external provisioner/bootstrap
recovery path and every authoritative member source have a named current owner;
the simulated lost-container path can reconstruct a complete offline candidate;
no value enters logs/evidence; and total elapsed time is at most four hours.
Record owners, exact versions, counts, start/end, elapsed time, per-gate result,
and remediation due dates. Any unavailable source, owner, version, or bootstrap
path fails the drill.

## Retention And Cost

As verified against Google's pricing page on 2026-08-13, Secret Manager charges
by active secret version; enabled and disabled versions are both
active/billable, while destroyed versions are not. The free tier includes six
active versions and 10,000 access operations per month. Beyond the allowance,
one automatic-replication active version is listed at USD 0.06/month and access
at USD 0.03 per 10,000 operations; consumption is prorated. Recheck the linked
pricing page before a budget decision.

At this project's scale, steady state is four active physical versions (two
packages plus two native exceptions), within the six-version allowance. Keeping
active and previous versions for all four physical secrets would temporarily
mean eight active versions: two over the allowance, approximately USD
0.12/month if retained for a full month. Expected access remains within the
free 10,000 operations when renderers fetch once per deployment rather than
polling from every process.

Keep only versions required for the active deployment, immediate rollback, and
an approved observation window. After audit and rollback gates pass, destroy
obsolete disabled versions. Do not poll Secret Manager from each runtime;
render once per deployment/start boundary and use the local projection.

## Documentation Change Procedure

Every schema, member, owner, IAM, projection, path, or rotation change must
update in the same pull request:

1. the manifest and policy;
2. validator/renderer tests and CI guards;
3. Terraform containers/IAM without payload data;
4. affected environment/deployment documentation;
5. this runbook and `docs/site-index.json`;
6. recovery and rollback evidence templates.

Reviewers must verify that examples use placeholders, every version is numeric,
no payload is committed, DEV/PROD boundaries remain separate, bootstrap is not
circular, and each consumer receives only the declared projection.

## Primary References

- [Secret Manager best practices](https://cloud.google.com/secret-manager/docs/best-practices)
- [Secret Manager consistency and numeric versions](https://cloud.google.com/secret-manager/docs/reference/consistency)
- [Secret Manager data integrity and CRC32C](https://cloud.google.com/secret-manager/docs/data-integrity)
- [Secret Manager quotas (64 KiB payload limit)](https://cloud.google.com/secret-manager/quotas)
- [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing)
- [Secret Manager audit logging](https://cloud.google.com/secret-manager/docs/audit-logging)
- [Service-account key rotation](https://cloud.google.com/iam/docs/key-rotation)
- [Organization policy for exposed service-account keys](https://docs.cloud.google.com/organization-policy/restrict-service-accounts)
- [Workload Identity Federation for deployment pipelines](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [WIF best practices](https://cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation)
- [GitHub Actions OpenID Connect](https://docs.github.com/actions/concepts/security/openid-connect)
- [Firebase API key guidance](https://firebase.google.com/docs/projects/api-keys)
- [Cloud Monitoring API request metrics](https://cloud.google.com/monitoring/api/metrics_gcp_p_z#serviceruntime)
- [Service-account key usage monitoring](https://cloud.google.com/iam/docs/service-account-monitoring)
- [Cloud Build second-generation GitHub connection IAM](https://cloud.google.com/build/docs/automating-builds/github/connect-repo-github?generation=2nd-gen)
- [Removing sensitive data from GitHub](https://docs.github.com/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
