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
- `stableVersion`: a positive numeric version that has passed promotion;
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
- `stableVersion` moves only in a reviewed manifest change after candidate
  verification. Publishing a version does not promote it.
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

1. Select the target environment and record the current `stableVersion` as the
   rollback version.
2. For the initial build, resolve every manifest member from the reviewed
   numeric legacy source or protected external file. For later rotations, pin
   the exact active package version and provide protected private-file
   overrides only for the approved rotated members.
3. Create the candidate payload without printing it. Base64-encode multiline
   file material exactly once.
4. Run the package validator. A missing or extra member blocks publication.
5. Publish through the package CLI, which streams the payload to `gcloud`
   without placing it in an argument or log. Capture the returned numeric
   version and CRC32C result.
6. Fetch that exact numeric version into a different mode-`0600` staging path
   and validate it again.
7. Run shadow comparison with legacy values. Evidence may show only the
   package-level `MATCH`/`MISMATCH` result; the comparison uses an ephemeral
   HMAC key and must not persist digests.
8. Render each required consumer projection to staging. Validate names,
   ownership, modes, parsability, and service-specific allowlists without
   printing content.
9. Run environment smoke tests. Only after all gates pass, update
   `stableVersion` to the candidate's numeric version in a reviewed commit.
10. Delete candidate, fetch, render, and HMAC staging material.

The exact command contracts are:

```bash
node scripts/secret-package.mjs validate \
  --environment <dev-or-prod> --payload-file <candidate>
node scripts/secret-package.mjs publish \
  --environment <dev-or-prod> --project-id <project-id> --payload-file <candidate>
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
links. Never bypass the CLI with direct `gcloud secrets versions access` or
`gcloud secrets versions add` in an operational procedure.

## Rendering And Promotion

Rendering has two atomic layers:

1. **Generic package render:** fetch and validate an exact numeric version,
   write an immutable release through private staging, then atomically switch
   the generic package `current` only after every member passes validation.
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

#### Third-party provider credential gate

Provider-backed code workers must use the authentication environment expected
by their Anthropic-compatible upstream. MiniMax, MiMo, DashScope, and
OpenRouter use `ANTHROPIC_AUTH_TOKEN` (Bearer); Kimi uses
`ANTHROPIC_API_KEY` (`x-api-key`). The task projection explicitly blanks the
competing variable so a stale host value cannot change the selected header.

The orchestrator publishes a live status for each configured provider under
`GET /health` → `providerApiKeys`: `valid` for a successful upstream response,
`invalid` for `401`/`403`, `degraded` for `429` or upstream `5xx`, and `unknown`
for network or unclassified failures. Empty values are `missing`. Code-agent
dispatch is fail-closed and selects a provider worker only when that entry is
both configured and `valid`; Claude OAuth and Codex auth remain separate.

Rotate a provider credential as a whole-package change:

1. Confirm the provider product, account, region, plan entitlement, API base,
   and model match the worker definition. Creating a persistent key, accepting
   provider terms, or buying a plan requires the responsible operator's
   explicit approval.
2. Create the replacement in the provider console. Write it once to an
   ephemeral regular file with mode `0600`; never paste it into a command,
   issue, chat, log, or tracked file.
3. Build from the exact active DEV package with one or more explicit
   `--override-env NAME=<mode-0600-file>` arguments. Use only canonical manifest
   names such as `INTEXURAOS_MIMO_APP_API_KEY`,
   `INTEXURAOS_DASHSCOPE_APP_API_KEY`, or
   `INTEXURAOS_KIMI_APP_API_KEY`.
4. Validate and publish a new numeric DEV version, fetch it back with server
   CRC32C verification, render it on local and home-dev, and restart the
   orchestrator. Require the corresponding health entries to become `valid`.
5. Run one real task canary per affected worker type and three five-minute
   health/error samples. A format-only check or a non-empty key is not proof of
   validity.
6. Publish a second byte-identical version containing the same replacements.
   Exercise rollback from the forward version to the prior replacement version
   and forward again. Never use a version containing a revoked, expired, or
   upstream-rejected credential as a rollback target.
7. Revoke the former provider key only after both versions and the rollback
   drill pass, then securely remove all ephemeral files.

### Production / Hetzner

1. The provisioner fetches one reviewed PROD numeric version into a private
   staging directory.
2. Validate the package before writing any target file.
3. Render, but do not activate, `/etc/intexuraos/.env.prod`, the runtime SA JSON,
   nginx internal-auth token, certbot/Cloudflare credential, TLS key, and the
   ephemeral web-build environment. Validate owner/mode and member allowlists.
4. Run token issuance and minimal Firestore preflight directly against the
   staged runtime key without changing the runtime projection `current` or
   stable runtime links. The generic package `current` may already point at the
   validated candidate.
5. Atomically promote the complete projection, reload only `code-agent` with
   the candidate environment, and require its semantic health including the
   Firestore check. Only then reload the complete PM2 fleet/nginx and run the
   remaining direct-origin and public smoke suite.
6. Attest the commit and exact PROD numeric version without payload data.

The required target modes are documented in the
[Hetzner production runbook](./hetzner-prod-runbook.md).

## Version Reconciliation Gate

A promotion is not closed until every independently persisted version pin has
been reconciled. Candidate deployment may temporarily use a new numeric version
while the reviewed `stableVersion` still identifies the prior release, but that
state is never final evidence.

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
Firebase Auth, API-key restrictions, quotas, and App Check protect the backend.

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
9. Enable App Check in monitoring mode and review legitimate-client telemetry.
   Enforcement is a separate controlled change after compatibility is proven.

Firebase cutover PASS is quantitative:

- On each approved DEV and PROD origin, one supported test client must complete
  sign-in, forced token refresh, one Rules-allowed Firestore read, and one
  disposable write/delete cycle with zero failed steps.
- Credential-filtered API metrics must show replacement-key traffic on both
  deployed origins and old-key request count exactly zero for 24 continuous
  hours after the later deployment. Any request attributed to the old key
  resets the 24-hour window.
- Browser telemetry during the same window must contain zero new failures
  attributable to API-key restrictions, Auth token refresh, Firestore Rules, or
  App Check. App Check enforcement remains a separate change; monitoring must
  identify every supported client class before that change is approved.
- Evidence records the old and replacement resource IDs, metric interval/counts,
  origin/test matrix, alert identifier, revoked state, and UTC closure time. It
  never records either key value.

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
5. Run the minimum canary matrix: obtain a token without printing it; perform
   the Firestore `listCollectionIds` read; create, read, and delete one zero-byte
   object under a change-specific canary prefix in each of
   `intexuraos-whatsapp-media-dev`, `intexuraos-shared-content-dev`, and
   `intexuraos-images-dev`; publish one redacted change-ID event to a
   pre-approved no-production-effect canary topic named in the change record and
   require a message ID; and read metadata for the pre-approved synthetic
   Firebase Auth account without modifying it. Stop if a safe topic/account is
   not approved before the window.
6. Reload the canary and then all production processes. Start a 24-hour
   pre-disable observation only after the complete fleet is healthy. PASS
   requires zero new credential-related authentication/authorization failures
   and zero use of the previous key ID throughout that interval.
7. Disable the previous key, but do not delete it. Keep a seven-day disabled
   soak and require zero attempted use of that key ID plus zero failures
   attributable to the replacement. Any failure stops deletion and starts the
   incident/rollback decision; a compromised old key is never re-enabled.
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
legacy count `0`, expected package/native counts by approved principal, and
positive-control result. Any legacy event or missing positive control resets
`T0`. Only then remove legacy IAM, disable old versions for the reversible
window, and later destroy versions/containers through Terraform.

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

- Keep at least the active and immediately previous verified package versions
  enabled during normal operation and the observation window.
- Regularly test exact-version fetch and render using the recovery identity.
- Maintain external recovery procedures for the provisioner credential, domain
  registrar/DNS control, GitHub App private key, TLS material, and provider API
  tokens. Do not archive those values with documentation.
- If a package container is lost, Terraform recreates the empty container and
  IAM. Authorized owners reconstruct a full candidate from authoritative
  providers, publish it outside Terraform, validate it, and perform normal
  candidate promotion.
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
- [Removing sensitive data from GitHub](https://docs.github.com/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
