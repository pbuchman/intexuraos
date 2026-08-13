# Production Goal: Secret Packages

## Goal identity

| Field | Value |
| --- | --- |
| Status | ACTIVE |
| Started | 2026-08-13, Europe/Warsaw |
| Baseline | `origin/development` at `9faf87a17c06359bc29254c73d8b94f1315fa70d` |
| Implementation branch | `codex/secret-packages-production` |
| Linear issue | None by explicit user decision |
| GCP project | `intexuraos-dev-pbuchman` |
| Environments | local, dev/home-dev, prod/Hetzner, retained GCP transcription |
| Canonical evidence | This document |

## Single objective

Deploy to production a complete migration from independently loaded application secrets to two
atomic, numerically versioned Secret Manager packages:

- `INTEXURAOS_SECRET_PACKAGE_DEV`;
- `INTEXURAOS_SECRET_PACKAGE_PROD`.

The migration is complete only when all local, dev, worker, and production consumers load an exact
package version; the retained transcription function uses only its two required native secrets;
the Firebase browser API key is removed from tracked configuration and rotated; the Hetzner runtime
service-account credential is rotated and delivered without a bootstrap cycle; broad legacy IAM and
individual secret reads are removed; CI, Terraform, environment smoke tests, production cutover,
rollback proof, and redacted operational evidence all pass.

## Non-negotiable invariants

1. No secret value, private key, package payload, or reversible digest is committed, placed in
   Terraform state, printed to logs, included in test output, or recorded in this document.
2. Persistent resources and IAM are changed only through Terraform.
3. Package payloads are added as versions outside Terraform through stdin or a mode-`0600`
   ephemeral file that is deleted immediately.
4. Every deployment references an immutable numeric version. `latest` is forbidden.
5. A consumer can never use a credential contained inside a package to open that same package.
6. Package validation is fail-closed. A failed fetch, checksum, schema, membership, ownership, or
   permission check leaves the last working files untouched.
7. DEV and PROD are separate trust boundaries even though all runtimes share one GCP project.
8. Rollback is package-wide and uses a previously verified numeric version. Per-field fallback is
   forbidden.
9. Runtime services and code workers do not receive Secret Manager accessor permission.
10. Production is not declared complete until rollback has been exercised before irreversible
    cleanup.
11. The dedicated home-dev renderer identity remains outside DEV and can access only the DEV
    package; the broad `claude-code-dev` JSON is neither a package member nor a code-worker input.

## Target physical inventory

| Physical secret | Purpose | Allowed readers |
| --- | --- | --- |
| `INTEXURAOS_SECRET_PACKAGE_DEV` | Atomic local/dev/home-dev package | local operator identity and dedicated home-dev bootstrap/renderer |
| `INTEXURAOS_SECRET_PACKAGE_PROD` | Atomic production package | Hetzner provisioner and protected production deploy identity |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Native Gen2 transcription injection | transcription service account and package publisher |
| `INTEXURAOS_SPEECHMATICS_APP_API_KEY` | Native Gen2 transcription injection | transcription service account and package publisher |
| Cloud Build connection token | Google-managed GitHub connection | Cloud Build service agent only |

All application-level individual containers are retired after the observation window. A stale
Cloud Build token is deleted only after the active connection has been identified from resource
ownership evidence.

## Package contract

The canonical non-secret manifest is `config/environments/secret-packages.json`. Each payload is a
UTF-8 JSON document with this top-level contract:

```json
{
  "schemaVersion": 1,
  "environment": "dev-or-prod",
  "env": {},
  "files": {}
}
```

Requirements enforced by `scripts/lib/secret-package.mjs` and
`scripts/verify-secret-packages.mjs`:

- the environment matches the selected package;
- the exact manifest member set is present, with no unknown members;
- every environment value is a string;
- multiline file material uses explicit base64 encoding;
- PEM and service-account JSON shapes are validated without logging their contents;
- the final raw payload is at most 64 KiB;
- CRC32C is verified on publish and fetch;
- the requested version is a positive decimal integer;
- rendering uses staged files, restrictive modes, and atomic rename;
- comparison with legacy data reports only package-level `MATCH`/`MISMATCH` derived using an
  ephemeral HMAC key; neither member names nor values are emitted.

`INTEXURAOS_FIREBASE_API_KEY` is a build-time member of both packages. It remains publicly visible
in the compiled SPA by Firebase design, but no longer exists in tracked runtime configuration.

## Consumer cutover matrix

| Consumer | Source after cutover | Rendered projection | Primary implementation files |
| --- | --- | --- | --- |
| Local Mac | Exact DEV version | `.envrc`, selected local files | `scripts/sync-secrets.sh`, `ecosystem.config.cjs` |
| home-dev PM2 | Exact DEV version | `.envrc` and service-filtered env | `scripts/sync-secrets.sh`, `ecosystem.config.cjs` |
| home-dev orchestrator | Host-rendered DEV projection | env plus GitHub App PEM | `scripts/generate-orchestrator-env.mjs`, `workers/orchestrator/src/bootstrap/secret-manager.ts` |
| code-worker | Orchestrator-filtered projection | allowlisted env/files only | `docker/code-worker/entrypoint.sh`, `workers/orchestrator/src/services/isolation/*` |
| Grafana/Alloy | Exact DEV version through renderer | observability env file | `scripts/observability/load-grafana-cloud-env.sh` |
| Hetzner PM2 | Exact PROD version | `/etc/intexuraos/.env.prod` | `scripts/hetzner/load-secrets.sh`, `ecosystem.config.prod.cjs` |
| Hetzner GCP runtime | PROD file member | `/home/deploy/runtime-sa-key.json`, mode `0600` | `scripts/hetzner/load-secrets.sh`, `terraform/hetzner-prod/bootstrap.tf` |
| nginx/internal auth | PROD projection | `/etc/intexuraos/internal-auth-token`, mode `0640` | `scripts/hetzner/load-secrets.sh` |
| certbot/Cloudflare/TLS | PROD file projection | mode-`0600` credential/key files | `scripts/hetzner/install-nginx-and-cert.sh` |
| Production web build | Exact PROD env projection | ephemeral build env | `scripts/hetzner/deploy-web.sh` |
| Retained transcription Gen2 | Two exact native versions | native secret env injection | `terraform/environments/dev/main.tf`, `terraform/modules/cloud-function/*` |
| GitHub deployment | Protected numeric pin | deployment input and attestation | `.github/workflows/deploy.yml`, `scripts/hetzner/github-actions-deploy.sh` |

## Required implementation artifacts

### Package tooling and policy

- `config/environments/secret-packages.json`
- `config/environments/policy.json`
- `config/environments/common.json`
- `scripts/lib/secret-package.mjs`
- `scripts/secret-package.mjs`
- `scripts/verify-secret-packages.mjs`
- `scripts/__tests__/secret-packages.test.ts`
- `package.json`
- `scripts/ci.mjs`
- `.github/workflows/ci.yml`
- `.gitignore`

### Runtime integrations

- `scripts/sync-secrets.sh`
- `scripts/hetzner/load-secrets.sh`
- `scripts/hetzner/install-nginx-and-cert.sh`
- `scripts/hetzner/deploy-web.sh`
- `scripts/hetzner/github-actions-deploy.sh`
- `scripts/hetzner/verify-deployment-document.mjs`
- `scripts/observability/load-grafana-cloud-env.sh`
- `scripts/generate-orchestrator-env.mjs`
- `ecosystem.config.cjs`
- `ecosystem.config.prod.cjs`
- `docker/code-worker/entrypoint.sh`
- `workers/orchestrator/src/bootstrap/secret-manager.ts`
- `workers/orchestrator/src/start.ts`
- `workers/orchestrator/src/services/isolation/worker-create.ts`
- `workers/orchestrator/src/services/isolation/docker-volume.ts`
- `workers/orchestrator/src/services/isolation/worker-env.ts`
- relevant tests under `scripts/__tests__/` and `workers/orchestrator/src/__tests__/`

### Infrastructure and IAM

- `terraform/environments/dev/main.tf`
- `terraform/modules/secret-manager/*`
- `terraform/modules/iam/*`
- `terraform/modules/cloud-build/*`
- `terraform/modules/cloud-function/*`
- `terraform/modules/github-wif/*`
- `terraform/hetzner-prod/*`
- `cloudbuild/scripts/deploy-function.sh`
- `.github/workflows/deploy.yml`

### Operations documentation

- `docs/operations/secret-packages.md`
- `docs/operations/runtime-configuration.md`
- `docs/operations/hetzner-prod-runbook.md`
- `docs/runbooks/internal-auth-rotation.md`
- `docs/operations/runtime-secret-manager-cleanup.md`
- `docs/site-index.json`
- `.claude/CLAUDE.md`
- `.claude/reference/environments.md`
- `.claude/reference/env-vars-patterns.md`
- `.claude/reference/infrastructure.md`
- `.claude/reference/firestore-access.md`
- `terraform/README.md`
- `workers/orchestrator/README.md`
- `workers/orchestrator/DEPLOYMENT.md`
- `docker/README.md`
- `scripts/README.md`
- `.envrc.local.example`

## Execution procedure

### Phase 1 — Baseline and tests

- [x] Record current containers, enabled versions, readers, and numeric source versions without
  accessing payloads.
- [x] Identify the active Cloud Build GitHub connection token and mark unowned tokens for later
  cleanup.
- [x] Fix the live home-dev `sa-key.json` permission from `0644` to `0600` and record metadata-only
  verification.
- [x] Add failing tests for package schema, exact membership, size, checksums, numeric pins,
  rendering, redaction, IAM, and absence of direct per-secret reads.
- [x] Capture proof that the new tests fail before implementation.

### Phase 2 — Code and Terraform foundation

- [x] Implement package validation, publish/fetch, render, and HMAC comparison tools.
- [x] Replace loaders and direct readers with exact-version package projections.
- [x] Remove Firebase API key from tracked common configuration and policy allowlist.
- [x] Add CI guards for provider-shaped private credentials, untracked SA key filenames, package
  payload files, Terraform `secret_data`, and `versions/latest`.
- [x] Define package containers, narrow IAM, exact native versions, and WIF conditions in Terraform.
- [x] Validate Terraform and apply the reviewed additive foundation without deletions.

### Phase 3 — Build candidate packages

- [x] Resolve every required logical member before restart; missing legacy members block cutover.
- [ ] Build DEV and PROD candidates from explicitly selected numeric legacy versions and approved
  external credential files.
- [ ] Publish both environment candidates without logging payloads. DEV `v1` and `v2` are complete;
  PROD remains gated on the narrowly scoped Cloudflare DNS token.
- [ ] Record only secret IDs, numeric versions, byte counts, CRC32C verification results, and member
  counts.
- [ ] Execute shadow comparison against legacy values and require all members to report `MATCH`.

### Phase 4 — Firebase browser key rotation

- [x] Create the replacement browser key through Terraform alongside the existing protected key.
- [x] Verify the replacement has only approved prod/dev/localhost referrers and Firebase APIs, with
  no Generative Language API.
- [ ] Put the replacement value into new DEV and PROD candidate versions through the secure
  publisher.
- [ ] Deploy and verify dev web Auth, token refresh, and Firestore access.
- [ ] Deploy and verify prod web Auth, token refresh, and Firestore access.
- [ ] Delete the previous API key only after both deployments pass, replacement traffic is present
  on both origins, and the old Firebase key request count is `0` for 24 continuous hours; any old-key
  request resets the interval.
- [ ] Close the GitHub alert as revoked and record the alert number, not the key value.
- [ ] Enable Firebase App Check in monitoring mode, verify telemetry, then enforce it in a separate
  controlled gate if compatible with all clients.

### Phase 5 — Runtime service-account rotation

- [x] Create a replacement key for the Hetzner runtime service account outside Terraform.
- [ ] Put the replacement JSON into the PROD package using the provisioner as the distinct bootstrap
  identity.
- [ ] Validate only `type`, `project_id`, `client_email`, `private_key_id`, and parseability.
- [ ] Atomically render the credential at mode `0600` and verify token issuance plus minimal
  Firestore, GCS, Pub/Sub, and Firebase Auth operations.
- [ ] Reload a canary and then all production PM2 processes.
- [ ] Require a 24-hour pre-disable observation with zero old-key use and zero credential failures,
  disable the previous key, then delete it only after a seven-day disabled soak with the same zero
  counts.
- [ ] Replace broad local/home-dev worker credentials with a dedicated least-privilege identity or
  short-lived impersonated credentials; never place the bootstrap key inside DEV.

### Phase 6 — Environment rollout

- [x] Local Mac renders exact DEV package `v2`; service-level smoke remains part of the rollout gate.
- [ ] home-dev PM2 and systemd orchestrator use the same verified DEV version.
- [ ] One code-worker canary runs without direct Secret Manager access; then all workers cut over.
- [ ] Grafana/Alloy reads its rendered projection.
- [ ] Production stages the exact PROD version without replacing active files.
- [ ] Production canary passes Firestore, GCS, Pub/Sub, Auth/OAuth, WhatsApp, Matrix, Sentry,
  certbot, Alloy, web build, and direct-origin health checks.
- [ ] Atomic production publication and full PM2/nginx reload complete.
- [ ] Deployment attestation records the package version without any secret material.
- [ ] Version reconciliation proves the manifest stable pin, deployment input, Terraform bootstrap
  pin, generic/runtime projection metadata, native injection metadata, and deployment attestation
  all identify the expected positive numeric versions.

### Phase 7 — Rollback proof and legacy cleanup

- [x] Publish rollback-safe DEV `v1` and forward DEV `v2` containing the same current credentials.
- [ ] Switch to the prior verified numeric version, render, restart, and pass three five-minute
  smoke/error-count samples over 15 minutes with zero unexpected auth/credential/health failures.
- [ ] Switch forward again and repeat the identical three-sample, 15-minute gate.
- [ ] Freeze the 34-name legacy audit set from the reviewed Terraform commit and observe zero
  `AccessSecretVersion` events with exhaustive pagination for at least 72 continuous hours plus
  package-read positive controls at both boundaries.
- [ ] Remove legacy IAM, disable old versions for a seven-day reversible window, then destroy the
  versions and remove their containers through Terraform.
- [ ] Retain only the active and immediately previous package versions during the observation
  window; destroy obsolete disabled versions because disabled versions remain billable.

### Cross-cutting emergency and recovery gates

- [ ] Break-glass design requires two-person approval, one package, one numeric version, and one
  Terraform-managed resource-level conditional accessor with a maximum 60-minute TTL; evidence must
  include removal and live zero-binding proof. Do not execute a break-glass grant merely to test it.
- [ ] A redacted isolated DR drill meets the four-hour recovery time objective: active and previous
  versions fetch/render successfully, the lost-container reconstruction path yields a complete
  offline candidate, every bootstrap/member source has an owner, and no production pointer changes.

## Verification commands and evidence

Evidence must contain command, timestamp, exit status, relevant counts/IDs, and redacted result.

| Verification | Required result | Evidence |
| --- | --- | --- |
| Targeted package tests | PASS | 2026-08-13 16:18 Europe/Warsaw: final package/builder/integration/deployment/Hetzner/runtime/Terraform selection `260/260`; post-cleanup base-package builder selection `134/134` |
| Runtime/Hetzner/orchestrator tests | PASS | 2026-08-13 16:29 Europe/Warsaw: included in the complete `7929/7929` test run |
| Documentation contract tests | test-first FAIL, then PASS | 2026-08-13: five new audit-derived checks failed before the documentation change; final `scripts/__tests__/secret-package-integrations.test.ts` `13/13` PASS |
| `pnpm run verify:secret-packages` | PASS | 2026-08-13 16:18 Europe/Warsaw: schema-v2 source coverage valid; DEV 35 env + 1 file, PROD 28 env + 3 files; both environments bind the correct base package for post-cleanup rotations |
| `pnpm run verify:credential-files` | PASS | 2026-08-13 16:18 Europe/Warsaw: credential file guard PASS |
| Documentation format/diff checks | PASS | 2026-08-13 16:29 Europe/Warsaw: complete CI format phase and `git diff --check` PASS |
| `pnpm run typecheck:tests` | PASS | 2026-08-13 16:29 Europe/Warsaw: PASS in complete CI run |
| `pnpm run ci:tracked` | PASS, complete run | 2026-08-13 16:29 Europe/Warsaw: run `#3` PASS after final IAM-condition, Alloy, sync-version and post-cleanup builder changes; Type/Lint, Static Validation, `7929/7929` tests, coverage validation, web build, format, and post-build checks all PASS |
| Terraform format | no diff | 2026-08-13 15:39 Europe/Warsaw: `terraform fmt -check -recursive terraform` PASS |
| Terraform validate, retained GCP | PASS | 2026-08-13 15:39 Europe/Warsaw: retained GCP, Hetzner, and standalone web-app module validation PASS after WIF/publisher and payload-removal changes |
| Terraform plan, retained GCP | exit `0`, no drift | 2026-08-13 16:17 Europe/Warsaw: after applying publisher own-package readback, removing the temporary migration admin role, and correcting the metadata-only condition to the numeric project resource-name prefix, a fresh retained-GCP plan exited `0` with `No changes` |
| Terraform validate/plan, Hetzner | PASS and reviewed | 2026-08-13 16:03 Europe/Warsaw: validate PASS; fresh plan with the provisioner identity reviewed as `2 add / 0 change / 1 replace-delete` (`terraform_data.bootstrap_prod` replacement plus additive legacy runtime-key migration guard); deliberately not applied before the package-aware release exists on the server |
| DEV shadow comparison | all members `MATCH` | 2026-08-13 15:52 Europe/Warsaw: dedicated DEV publisher impersonation rebuilt all 35 exact legacy sources plus the external Firebase member; dedicated renderer fetched numeric `v2`; ephemeral HMAC comparison returned `MATCH`; payload is 5,838 bytes with verified server CRC32C |
| PROD shadow comparison | all members `MATCH` | PENDING |
| Local smoke | PASS | PARTIAL — 2026-08-13: exact `v2` projection and modes PASS; web build PASS and contains replacement—not previous—Firebase key; version projection regression fixed test-first and local `v2 → v1 → v2` transaction PASS; service smoke remains PENDING |
| home-dev smoke | PASS | PENDING |
| code-worker canary | PASS without Secret Manager access | PENDING |
| Production canary | PASS | PENDING |
| Production full smoke | PASS | PENDING |
| Version reconciliation | all persisted pins/pointers equal the promoted numeric versions | PENDING |
| Rollback drill | prior and forward each have three PASS samples over 15 minutes with zero unexpected auth/credential/health failures | PENDING |
| Secret Manager audit | frozen 34-name set, exhaustive pages, zero legacy reads for 72 hours, both positive controls PASS | PENDING |
| Firebase usage cutover | replacement traffic on DEV/PROD; old-key count `0` for 24 continuous hours | PENDING |
| Runtime SA rotation soak | 24-hour pre-disable and seven-day disabled intervals both have zero old-key use/failures | PENDING |
| Break-glass control review | two approvals; one resource; 60-minute conditional binding; removal/zero-binding evidence defined | PENDING — design review only; do not create a grant for testing |
| DR drill | isolated fetch/render/reconstruction PASS within four hours; no production pointer changed | PENDING |
| GitHub alert | closed as revoked | PENDING |
| Active version inventory | target inventory reached | PENDING |

### Baseline evidence

| Timestamp | Check | Redacted result |
| --- | --- | --- |
| 2026-08-13 Europe/Warsaw | Local Terraform credential | mode `0600`; service-account type; expected project and administrative account; project API access confirmed |
| 2026-08-13 Europe/Warsaw | Secret Manager metadata inventory | 43 containers; 44 enabled versions; 8 destroyed versions; `INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN` has no version; no payload accessed |
| 2026-08-13 Europe/Warsaw | Cloud Build v2 connection | one complete connection, `pbuchman-github`; active managed token container suffix `8b04fa`; five non-active token containers retained pending cleanup gate |
| 2026-08-13 Europe/Warsaw | home-dev credential permission | changed `/home/pbuchman/.config/gcloud/sa-key.json` from `0644` to `0600`; owner unchanged; metadata matches expected account/project |
| 2026-08-13 Europe/Warsaw | Test-first integration baseline | `scripts/__tests__/secret-package-integrations.test.ts`: 6 tests written and all 6 failed against the baseline for the intended missing behavior (package CLI, rendered consumers, orchestrator file source, worker sync removal, Firebase membership, deployment pin) |
| 2026-08-13 Europe/Warsaw | Applied package foundation | refreshed Terraform plan `No changes`; DEV/PROD package containers exist with narrow reader IAM; transcription native versions are `2` and `1`; replacement Firebase restrictions match the approved three referrers and four Firebase APIs |
| 2026-08-13 Europe/Warsaw | Credential staging | new runtime and dedicated DEV renderer keys created outside Terraform/repository; metadata/account/project and mode `0600` validated; old runtime key retained for rollback |
| 2026-08-13 Europe/Warsaw | DEV package publication | DEV `v1` and `v2` published and fetched by numeric version; equal 5,838-byte payloads, server CRC32C verified, HMAC comparison `MATCH`; ephemeral payloads and comparison key removed after verification |
| 2026-08-13 Europe/Warsaw | DEV renderer/rollback | dedicated renderer fetched exact `v2` locally and from home-dev; local projection exercised `v2 → v1 → v2`; `.envrc`, renderer credential, and GitHub PEM verified mode `0600` |
| 2026-08-13 Europe/Warsaw | Firebase build cutover proof | local production-mode SPA build passed using DEV `v2`; byte-safe check confirmed replacement key is present and previous key is absent without logging either value |
| 2026-08-13 15:09 Europe/Warsaw | Fresh retained-GCP convergence | `GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev plan -input=false -lock-timeout=60s -detailed-exitcode -out=<ephemeral-plan> -no-color`; exit `0`; `No changes`; ephemeral plan removed |
| 2026-08-13 15:09 Europe/Warsaw | Home identity live IAM | Read-only project-IAM query plus exhaustive iteration over every Secret Manager container found exactly `0` Secret Manager bindings for both home identities. `ixos-home-runtime-dev`: only `datastore.user`, `firebaseauth.admin`, `logging.logWriter`, `pubsub.publisher`, plus `storage.objectAdmin` on `intexuraos-whatsapp-media-dev`, `intexuraos-shared-content-dev`, and `intexuraos-images-dev`. `ixos-home-orchestrator-dev`: only repository-level `artifactregistry.reader` |
| 2026-08-13 15:36 Europe/Warsaw | Publisher IAM recovery | Initial all-in-one apply exposed an ordering hazard: WIF/account changes completed, but resource-level Secret Manager bindings failed after the operator's broad role was removed. Recovery used three explicit Terraform plans: one-resource temporary bootstrap, `65` narrow publisher bindings, then bootstrap destruction. No secret, version, or workload resource was deleted. |
| 2026-08-13 15:52 Europe/Warsaw | Publisher/WIF live proof | Both DEV and PROD publisher impersonations returned tokens; the local operator has `0` project bindings for `secretmanager.admin` or project-wide `serviceAccountTokenCreator`; both WIF providers require immutable owner ID `368465`, repository ID `1118959310`, exact repository, and `refs/heads/development`. |
| 2026-08-13 16:17 Europe/Warsaw | Final retained-GCP convergence and metadata IAM | Full un-targeted refresh plan exited `0` with `No changes`. A separate metadata-only live audit confirmed package metadata and `getIamPolicy` access, no project `secretmanager.admin`, no project-wide Token Creator, the numeric project-prefix condition, and own-package-only publisher readback with no DEV/PROD crossover. No payload was accessed. |
| 2026-08-13 16:29 Europe/Warsaw | Final pre-PROD code verification | `pnpm run ci:tracked` PASS: Type/Lint, Static Validation, `7929/7929` tests, coverage validation, web build, format, and post-build checks; focused package/runtime selection `260/260` and both manifest/credential guards also PASS. |
| 2026-08-13 16:31 Europe/Warsaw | Post-cleanup rotation path | Dedicated DEV publisher fetched exact package `v2`; base-package mode applied one explicit private-file override, validated server CRC32C and exact membership, wrote mode `0600`, and reproduced the reviewed package byte-for-byte. The candidate was moved to Trash; no value was logged. |

## Production acceptance criteria

- [ ] Exactly two package containers exist for application bundles.
- [ ] Only the two documented native application secrets remain individually injected.
- [ ] Every package and native injection is pinned to a numeric version.
- [ ] No active runtime path calls `versions/latest` or reads an individual application secret.
- [ ] No package payload or service-account private key exists in Git, Terraform state, logs, or
  deployment attestations.
- [ ] Firebase browser key is absent from tracked configuration, rotated, deployed, and the alert is
  closed.
- [ ] Hetzner runtime credential is rotated, mode `0600`, and runtime has no Secret Manager access.
- [ ] Bootstrap credentials remain outside the packages and have package-specific least privilege.
- [ ] code-worker receives only an allowlisted projection and no broad admin credential.
- [ ] All CI, Terraform, environment smoke, production smoke, audit, and rollback evidence is PASS.
- [ ] Documentation and recovery procedures are complete and discoverable from `docs/site-index.json`.
- [ ] Legacy resources are destroyed only after the observation and reversible-disable windows.

## Endpoint Changes

- Modified: `GET /deployment.json` adds the required positive numeric string field
  `secretPackageVersion`; publication and verification require exactly
  `commitSha`, `workflowRunId`, `deployedAt`, and `secretPackageVersion`.
- Created: none.
- Removed: none.
- Unchanged: all other public and internal HTTP contracts. Package version evidence is deliberately
  exposed in this uncached public deployment attestation and recorded in this goal artifact.

## Rollback boundary

Before credential revocation, rollback uses the previous verified package version. After a Firebase
or service-account key is revoked, any version containing it is permanently invalid and must not be
selected. A new rollback-safe version containing the current credential and previous non-credential
configuration must therefore be published before revocation.

## Completion record

This section is populated only after every production acceptance criterion passes.

| Field | Value |
| --- | --- |
| Final status | PENDING |
| Merged commit | PENDING |
| Production deployment run | PENDING |
| DEV package version | PENDING |
| PROD package version | PENDING |
| Native secret versions | PENDING |
| Firebase replacement key resource ID | PENDING |
| Runtime credential key ID | PENDING |
| Rollback versions tested | PENDING |
| Legacy cleanup completed | PENDING |
| Final CI evidence | PENDING |
