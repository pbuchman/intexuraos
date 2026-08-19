# Production Goal: Secret Packages

## Goal identity

| Field | Value |
| --- | --- |
| Status | ACTIVE — production package cutover and rollback proof are complete; DEV/code-worker rollout and delayed rotation, audit, cleanup, and recovery gates remain open |
| Started | 2026-08-13, Europe/Warsaw |
| Baseline/current merged rollout SHA | `origin/development` at `c8c24cddfe652995f0d5c69dce0f912b3a2315b8` |
| Implementation delivery | PR `#2454`, followed by production-only PRs `#2467`, `#2468`, `#2469`, and `#2470`, then DEV-package promotion PR `#2473` |
| Merged production chain | `65120992c650754600fe967abd4ca845b09f404e` → `7104a8772f3eaf2aee792df9f954e79d2166bc06` → `96d61ce6b2202b719fc483bdb2c7be97b5ab6019` → `606097aac9b5fab5ada2e8cf312dbfd842b48c72` → `ff487fb41da952d7798824b34afb089c93a254c2` → `c8c24cddfe652995f0d5c69dce0f912b3a2315b8` |
| Current working state | Production is healthy on exact PROD package `v2`, deploy run `32207286305`, and merged SHA `c8c24cddfe652995f0d5c69dce0f912b3a2315b8`; PM2 and semantic checks passed `19/19`, and direct/public attestations select that SHA, run, and numeric package version `2`. The earlier byte-identical `v1`/`v2` rollback drill passed in both directions. PR `#2473` promoted the reviewed DEV manifest pin to `v2`, and the local atomic DEV `v2` projection plus full consumer smoke pass. The goal remains ACTIVE because the home-dev/code-worker rollout and the time-dependent Firebase, runtime-key, legacy-read, reversible-disable, cleanup, and recovery gates below are not yet complete. |
| Linear issue | `INT-2087`, linked by GitHub automation after the user-approved no-manual-ID delivery |
| GCP project | `intexuraos-dev-pbuchman` |
| Environments | local, dev/home-dev, prod/Hetzner, retained GCP transcription |
| Canonical evidence | This document |

## Current execution state

- The scope-cleaned migration PR `#2454` merged as
  `65120992c650754600fe967abd4ca845b09f404e`. The first production cutover run
  `32192142422` activated the package but failed when the deploy user read intentionally
  `root:root` mode-`0600` metadata; automatic compensation restored the healthy pre-package
  projection.
- PR `#2467` fixed only that verifier privilege boundary and merged as
  `7104a8772f3eaf2aee792df9f954e79d2166bc06`. Deploy run `32194686180` then activated PROD `v1`:
  PM2 and semantic checks passed `19/19`, direct and public health checks passed, and Matrix, Alloy,
  and nginx passed.
- DEV package versions `v1` and `v2` were published and proven byte-identical with valid CRC32C,
  exact membership, and a package-level HMAC comparison. Provider credential values are opaque
  package members: provider entitlement, purchasing, and product support decisions are explicitly
  outside this migration and do not gate package rollout.
- Local rendering and the package-wide `v2 → v1 → v2` rollback mechanism were exercised. PR `#2473`
  promoted the reviewed DEV manifest pin to `v2`. The local Mac now uses atomic four-file projection
  `dev-projection-v2-f49cb298-325a-46f3-812b-7a1fd4cb5e85`: its release files are mode `0600`, its
  root/release directories are mode `0700`, and stable `.envrc` plus GitHub PEM endpoints are
  symlinks through `current`. PM2 is `20/20`, semantic health is `19/19`, and all `21/21` local
  consumers, including web and Pub/Sub UI, pass.
- Home-dev was migrated in place to the four-file atomic DEV `v1`
  projection `dev-projection-v1-7ce456b1-0c49-49c6-be7c-0fa690daec84`; its marker/files/symlinks and
  `0600`/`0700` modes passed, PM2 is `22/22`, semantic health is `19/19`, and the orchestrator plus
  Alloy are healthy. GitHub Actions run `32203968717` started Cloud Build
  `ca9dc515-1b15-48be-bad4-d0e3e7bfb940` from exact SHA
  `ff487fb41da952d7798824b34afb089c93a254c2`; registry digest
  `sha256:b9f4ba753e1579af6dce9c6036174f88fd253de9a3a812d9963e1f16c014c0dd` has no GCP credential
  environment, packaged service-account file, direct Secret Manager access, or sync command. A
  naturally dispatched worker on that exact image reported `gcp_auth=skipped` and
  `secret_sync=skipped`, received only the three allowlisted read-only projection files, reached
  readiness, and completed its task. At the 2026-08-19 02:23:59 UTC snapshot, seven containers still
  used the previous image: three had active tasks and four were terminal/preserved pending the
  existing retention cleanup. That image declares
  `GOOGLE_APPLICATION_CREDENTIALS` and whose entrypoint attempts direct legacy synchronization.
  Their credential file is absent, but this runtime path blocks the no-direct-Secret-Manager
  acceptance criterion and the 72-hour legacy-read `T0` until the workers are safely drained and
  replaced.
- PROD `v1` and `v2` are enabled, are byte-identical at `8566` bytes, and passed exact numeric fetch,
  CRC32C/readback, exact membership, HMAC `MATCH`, and offline render. PROD `v2` is the active
  version; PROD `v1` is retained as the verified rollback companion.
- PR `#2468` merged as `96d61ce6b2202b719fc483bdb2c7be97b5ab6019`; run `32197008479`
  activated PROD `v2`. Its formal production observations at `23:42:40`, `23:47:42`, and
  `23:52:42` UTC all passed. PR `#2469` merged as
  `606097aac9b5fab5ada2e8cf312dbfd842b48c72`; run `32199105331` rolled back to PROD `v1`, whose
  observations at `00:04:14`, `00:08:14`, and `00:13:07` UTC all passed. PR `#2470` merged as
  `ff487fb41da952d7798824b34afb089c93a254c2`; run `32201202140` restored PROD `v2`, whose
  observations at `00:34:26`, `00:39:13`, and `00:44:19` UTC all passed.
- PR `#2473` merged as `c8c24cddfe652995f0d5c69dce0f912b3a2315b8`, promoting only the DEV
  package manifest pin to `v2`. Its exact-SHA production deploy run `32207286305` retained PROD `v2`;
  preflight, activation, PM2 `19/19`, semantic checks `19/19`, direct/public endpoints, Matrix, Alloy,
  nginx, and exact `deployment.json` attestation all passed with zero compensation markers.
- Every observation in those three production series passed PM2 `19/19`, semantic checks `19/19`,
  direct/public endpoints, Matrix, Alloy, and nginx. Runtime Secret Manager
  calls/accesses/denials were `0/0/0` in every sample. Audit-log delivery can lag, so these immediate
  zeroes are preliminary evidence and do not satisfy the delayed 72-hour legacy-read gate.
- The active restricted Cloudflare token has non-secret ID
  `ade18caae171c71c3108fadf3de05705`, one account, exact zone `intexuraos.cloud`, and only
  `Zone: Read` plus `DNS: Edit`. Remote `prod-v1.json` and `prod-v2.json` attestations are
  `root:root` mode `0600`. The active runtime service-account key has metadata-only ID
  `4bf7371e272b2c67b6d0bd59cd52cae7daf18efc`; no private key material is recorded here.
- Ephemeral local package payloads, source inputs, HMAC material, render roots, and canary scratch
  were removed after the final forward verification. Only two metadata-only publication receipts
  and the two protected remote attestations were retained.
- Deferred destructive gates remain: Firebase requires at least 24 hours plus a 30-minute metric
  visibility delay; the runtime key requires at least 24 hours plus a three-hour visibility delay,
  followed by seven days disabled; legacy Secret Manager reads require at least 72 hours plus a
  15-minute log-delivery delay, followed by a seven-day reversible disabled window.
- Live IAM contains one unconditional and one expired conditional unmanaged project-level
  `roles/secretmanager.admin` binding for the Cloud Build service agent. The connection remains
  operational, but cleanup is gated on proving the active token's resource-level accessor and a
  post-cleanup `fetchGitRefs` canary.
- The pushed hardening adds durable publication recovery, crash-atomic DEV projection,
  host-serialized and structurally validated PROD projection, complete runtime-credential canaries,
  exact three-pin reconciliation, and an executable per-member DR source inventory. Test-first crash
  recovery now also covers incomplete DEV lock publication, durable PROD candidate publication, and
  interrupted stable-link activation. On the post-merge tree before this evidence update, local
  `ci:tracked` passes all phases with `7968` tests. The required GCP topic plus package-scoped
  publisher metadata IAM were
  applied with a fresh `No changes` plan before the unrelated App Check declarations were removed;
  no new Terraform apply is authorized by that historical plan.

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
- `config/environments/secret-package-sources.json`
- `config/environments/secret-package-recovery.json`
- `config/environments/policy.json`
- `config/environments/common.json`
- `scripts/build-secret-package.mjs`
- `scripts/lib/dev-secret-projection.mjs`
- `scripts/lib/dev-secret-sync-lock.mjs`
- `scripts/lib/secret-package.mjs`
- `scripts/secret-package.mjs`
- `scripts/verify-secret-packages.mjs`
- `scripts/hetzner/verify-secret-package-version-pins.mjs`
- `scripts/hetzner/validate-prod-secret-candidate.sh`
- `scripts/__tests__/secret-packages.test.ts`
- `scripts/__tests__/build-secret-package.test.ts`
- `scripts/__tests__/prod-secret-package-candidate-canary.test.ts`
- `scripts/__tests__/secret-package-version-reconciliation.test.ts`
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
- `docker/code-worker/test-fixtures/claude-stub.sh`
- `workers/orchestrator/src/bootstrap/secret-manager.ts`
- `workers/orchestrator/src/bootstrap/api-key-validator.ts`
- `workers/orchestrator/src/bootstrap/service-wiring.ts`
- `workers/orchestrator/src/start.ts`
- `workers/orchestrator/src/types/api.ts`
- `workers/orchestrator/src/services/isolation/worker-create.ts`
- `workers/orchestrator/src/services/isolation/docker-container.ts`
- `workers/orchestrator/src/services/isolation/docker-volume.ts`
- `workers/orchestrator/src/services/isolation/worker-env.ts`
- `apps/code-agent/src/domain/models/workerSettings.ts`
- `apps/code-agent/src/domain/services/codeTaskDispatchBlockers.ts`
- `apps/code-agent/src/infra/services/workerHealthProbe.ts`
- relevant tests under `scripts/__tests__/` and `workers/orchestrator/src/__tests__/`

### Infrastructure and IAM

- `terraform/environments/dev/main.tf`
- `terraform/modules/secret-manager/*`
- `terraform/modules/iam/*`
- `terraform/modules/cloud-build/*`
- `terraform/modules/cloud-function/*`
- `terraform/modules/github-wif/*`
- `terraform/modules/pubsub-topic/*`
- `terraform/hetzner-prod/*`
- `cloudbuild/scripts/deploy-function.sh`
- `.github/workflows/deploy.yml`

### Operations documentation

- `docs/operations/secret-packages.md`
- `docs/templates/secret-package-recovery-evidence.md`
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

### Exact changed-path completeness supplement

Baseline: `1007254930138f59eea0c0b1717732adcc5f0b97`. The exact paths below are the
normative changed-file inventory after removing non-secret-migration scope. Current inventory: 110
paths (`27 A`, `83 M`, no delete/rename); sorted-path SHA-256:
`ae1503ecfe3ae046fb102881ad11fbc8bf4f28ad7f4e73d922d29caa127ea7c3`. Any later
path change requires refreshing this inventory before completion.

Verify completeness from the repository root; PASS means the first `comm`
prints no path, `path_count=110`, and the recorded digest matches. Backtick
tokens are compared as exact entries, so a longer filename cannot satisfy a
shorter path:

```bash
baseline_commit=1007254930138f59eea0c0b1717732adcc5f0b97
inventory_file=docs/plans/2026-08-13-secret-packages-production-goal.md
comm -23 \
  <(git diff --name-only "$baseline_commit" -- | LC_ALL=C sort) \
  <(rg -o '`[^`]+`' "$inventory_file" | sed 's/^`//; s/`$//' | LC_ALL=C sort -u)
printf 'path_count=%s\n' "$(git diff --name-only "$baseline_commit" -- | wc -l | tr -d ' ')"
git diff --name-only "$baseline_commit" -- | LC_ALL=C sort | shasum -a 256
```

- `.claude/reference/env-vars-patterns.md`
- `.claude/reference/environments.md`
- `.claude/reference/firestore-access.md`
- `.claude/reference/infrastructure.md`
- `.envrc.local.example`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.gitignore`
- `cloudbuild/scripts/deploy-function.sh`
- `config/environments/common.json`
- `config/environments/policy.json`
- `config/environments/secret-package-recovery.json`
- `config/environments/secret-package-sources.json`
- `config/environments/secret-packages.json`
- `docker/README.md`
- `docker/code-worker/Dockerfile`
- `docker/code-worker/Dockerfile.test`
- `docker/code-worker/entrypoint.sh`
- `docker/code-worker/test-fixtures/claude-stub.sh`
- `docs/operations/hetzner-prod-runbook.md`
- `docs/operations/runtime-configuration.md`
- `docs/operations/runtime-secret-manager-cleanup.md`
- `docs/operations/secret-packages.md`
- `docs/plans/2026-08-13-secret-packages-production-goal.md`
- `docs/runbooks/internal-auth-rotation.md`
- `docs/site-index.json`
- `docs/templates/secret-package-recovery-evidence.md`
- `package.json`
- `scripts/README.md`
- `scripts/__tests__/build-secret-package.test.ts`
- `scripts/__tests__/ecosystem.config.test.ts`
- `scripts/__tests__/hetzner-runtime.test.ts`
- `scripts/__tests__/message-digest-cutover.test.ts`
- `scripts/__tests__/observability.test.ts`
- `scripts/__tests__/prod-secret-package-candidate-canary.test.ts`
- `scripts/__tests__/runtime-config-deploy.test.ts`
- `scripts/__tests__/runtime-config-terraform.test.ts`
- `scripts/__tests__/runtime-config.test.ts`
- `scripts/__tests__/secret-package-deployment-pin.test.ts`
- `scripts/__tests__/secret-package-fresh-host.test.ts`
- `scripts/__tests__/secret-package-integrations.test.ts`
- `scripts/__tests__/secret-package-prod-loader.test.ts`
- `scripts/__tests__/secret-package-version-reconciliation.test.ts`
- `scripts/__tests__/secret-packages.test.ts`
- `scripts/__tests__/verify-credential-files.test.ts`
- `scripts/build-secret-package.mjs`
- `scripts/ci.mjs`
- `scripts/generate-orchestrator-env.mjs`
- `scripts/hetzner/github-actions-deploy.sh`
- `scripts/hetzner/install-nginx-and-cert.sh`
- `scripts/hetzner/load-secrets.sh`
- `scripts/hetzner/provision.sh`
- `scripts/hetzner/validate-prod-secret-candidate.sh`
- `scripts/hetzner/verify-deployment-document.mjs`
- `scripts/hetzner/verify-secret-package-version-pins.mjs`
- `scripts/lib/dev-secret-projection.mjs`
- `scripts/lib/dev-secret-sync-lock.mjs`
- `scripts/lib/secret-package.mjs`
- `scripts/observability/load-grafana-cloud-env.sh`
- `scripts/pubsub-publish-test.mjs`
- `scripts/secret-package.mjs`
- `scripts/sync-secrets.sh`
- `scripts/verify-credential-files.mjs`
- `scripts/verify-secret-packages.mjs`
- `scripts/verify-terraform-secrets.mjs`
- `terraform/README.md`
- `terraform/environments/dev/main.tf`
- `terraform/environments/dev/terraform.tfvars.example`
- `terraform/hetzner-prod/bootstrap.tf`
- `terraform/hetzner-prod/outputs.tf`
- `terraform/hetzner-prod/prod.auto.tfvars.json`
- `terraform/hetzner-prod/retained-gcp.tf`
- `terraform/hetzner-prod/terraform.tfvars.example`
- `terraform/hetzner-prod/variables.tf`
- `terraform/modules/claude-code-dev/README.md`
- `terraform/modules/claude-code-dev/main.tf`
- `terraform/modules/cloud-build/main.tf`
- `terraform/modules/cloud-build/variables.tf`
- `terraform/modules/cloud-function/main.tf`
- `terraform/modules/cloud-function/variables.tf`
- `terraform/modules/github-wif/main.tf`
- `terraform/modules/github-wif/variables.tf`
- `terraform/modules/iam/main.tf`
- `terraform/modules/iam/variables.tf`
- `terraform/modules/pubsub-topic/main.tf`
- `terraform/modules/pubsub-topic/outputs.tf`
- `terraform/modules/pubsub-topic/variables.tf`
- `terraform/modules/web-app/main.tf`
- `terraform/modules/web-app/outputs.tf`
- `terraform/modules/web-app/variables.tf`
- `tools/pubsub-ui/README.md`
- `tools/pubsub-ui/index.html`
- `tools/pubsub-ui/server.mjs`
- `workers/orchestrator/DEPLOYMENT.md`
- `workers/orchestrator/README.md`
- `workers/orchestrator/src/__tests__/bootstrap/env-config.test.ts`
- `workers/orchestrator/src/__tests__/bootstrap/gcp-validator.test.ts`
- `workers/orchestrator/src/__tests__/bootstrap/secret-manager.test.ts`
- `workers/orchestrator/src/__tests__/bootstrap/service-wiring.test.ts`
- `workers/orchestrator/src/__tests__/start.test.ts`
- `workers/orchestrator/src/bootstrap/env-config.ts`
- `workers/orchestrator/src/bootstrap/gcp-validator.ts`
- `workers/orchestrator/src/bootstrap/secret-manager.ts`
- `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`
- `workers/orchestrator/src/services/isolation/__tests__/e2e-container.test.ts`
- `workers/orchestrator/src/services/isolation/worker-create.ts`
- `workers/orchestrator/src/services/isolation/worker-env.ts`
- `workers/orchestrator/src/services/prompts/prompt-shared.ts`
- `workers/orchestrator/src/start.ts`

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
- [ ] Reauthenticate and verify `pbuchman-github`, then prove the Cloud Build service agent has—or
  add through Terraform—exactly one resource-level `roles/secretmanager.secretAccessor` binding on
  the active `pbuchman-github-github-oauthtoken-8b04fa` secret.
- [ ] Adopt both live project-level `roles/secretmanager.admin` bindings into Terraform and require
  a full zero-change plan before removal; then review and apply a saved plan containing exactly
  `0 add / 0 change / 2 destroy`.
- [ ] After cleanup, require zero project-level Secret Manager Admin bindings for the service agent,
  exactly the intended token-secret accessor, connection state `COMPLETE`, and a successful
  non-mutating `fetchGitRefs` canary. Any failed canary stops cleanup and restores IAM only through
  the reviewed Terraform rollback.

### Phase 3 — Build candidate packages

- [x] Resolve every required logical member for the initial DEV candidates before restart; missing
  members block candidate construction.
- [x] Publish initial DEV `v1` and `v2` without logging payloads and prove exact byte equality,
  numeric fetches, server/readback CRC32C, exact membership, and package-level HMAC `MATCH`.
- [x] Preserve all existing provider credential values unchanged as opaque members. Provider
  availability, entitlement, purchasing, and worker-type lifecycle are not acceptance gates for
  this secret-storage migration.
- [x] Build PROD `v1` and its byte-identical rollback companion `v2` from explicitly selected
  numeric legacy versions, the rotated runtime service-account file, and approved external
  credential files.
- [x] Publish PROD `v1` and `v2` without logging their payloads, using the narrowly scoped
  Cloudflare token with `DNS: Edit` and `Zone: Read` for the single `intexuraos.cloud` zone.
- [x] Record only secret IDs, numeric versions, byte counts, CRC32C verification results, and member
  counts for the replacement DEV and PROD candidates.
- [x] Execute final DEV and PROD shadow comparisons and require all members to report `MATCH`.

### Package input and recovery gates

- [x] Cloudflare: create a replacement token restricted to `DNS: Edit` and `Zone: Read` for only the
  `intexuraos.cloud` zone, verify it without logging the value, pass it through an ephemeral
  mode-`0600` input file, and install version-bound mode-`0600` production attestations for both
  rollback versions.
- [ ] Offline recovery escrow: schema-v2 inventory identifies every encryption/signing member that
  requires byte-identical recovery, but two independently held encrypted copies and a successful
  reconstruction drill have not been attested. Legacy/container destruction is blocked until they
  are proven without exposing values or value-derived fingerprints.

### Phase 4 — Firebase browser key rotation

- [x] Create the replacement browser key through Terraform alongside the existing protected key.
- [x] Verify the replacement has only approved prod/dev/localhost referrers and Firebase APIs, with
  no Generative Language API.
- [x] Put the replacement value into new DEV and PROD candidate versions through the secure
  publisher.
- [ ] Deploy and verify dev web Auth, token refresh, and Firestore access.
- [x] Deploy the replacement Firebase member through active PROD `v2`; independent browser Auth,
  token-refresh, and Firestore smoke remains part of the delayed Firebase gate.
- [ ] Start Firebase `T0` only after the replacement key is deployed and the complete
  Auth/token-refresh/Firestore smoke matrix passes independently on both DEV and PROD origins. For
  a closed `[T0,T1]` interval of at least 24 hours, evaluate metrics only after `T1 + 30 minutes`
  and require global replacement-credential-UID request count `> 0`, old-credential-UID request
  count `0`, and zero attributable browser failures. Any old-key request, including a rejected
  request, resets `T0`. The metric has no origin dimension; only the two smoke matrices prove origin
  coverage. Delete the previous key only after this gate passes.
- [ ] Close the GitHub alert as revoked and record the alert number, not the key value.

### Phase 5 — Runtime service-account rotation

- [x] Create a replacement key for the Hetzner runtime service account outside Terraform.
- [x] Put the replacement JSON into the PROD package through the dedicated publisher while keeping
  the provisioner outside the package as the distinct production bootstrap identity.
- [x] Validate only `type`, `project_id`, `client_email`, `private_key_id`, and parseability.
- [x] Atomically render the credential at mode `0600` and verify token issuance plus minimal
  Firestore, GCS, Pub/Sub, and Firebase Auth operations.
- [x] Reload a canary and then all production PM2 processes; every v1/v2 deployment reported PM2
  `19/19` and semantic checks `19/19`.
- [x] Start runtime-SA `T0` only after the complete production fleet uses the replacement credential
  and the canary plus full smoke suite pass. The conservative observation start is the final
  forward deployment timestamp `2026-08-19T00:28:25Z`.
- [ ] For a closed `[T0,T1]` interval of at least 24 hours, evaluate the key-authentication metric
  only after `T1 + 3 hours` and require previous-key count `0`, replacement-key count `> 0`, and
  credential-related failure count `0`.
- [ ] Only then disable the previous key. During the seven-day disabled window require the key state
  to remain `DISABLED`, replacement-key authentication count `> 0`, and credential-related failure
  count `0`. Google excludes disabled keys from the metric, so this window does not claim zero
  attempted use. Delete it only after these measurable gates pass.
- [x] Replace broad local/home-dev worker credentials with a dedicated least-privilege identity or
  short-lived impersonated credentials; never place the bootstrap key inside DEV.

### Phase 6 — Environment rollout

- [x] Local Mac renders exact DEV package `v2` through the atomic four-file projection; PM2 `20/20`,
  semantic health `19/19`, web, and Pub/Sub UI passed without treating third-party provider
  entitlement as a migration gate.
- [ ] home-dev PM2 and systemd orchestrator use the same selected verified DEV version. The host is
  healthy on the atomic DEV `v1` projection and the reviewed DEV manifest pin is now `v2`; wait for
  zero running workers, then sync/restart and complete the prior/forward observation series.
- [ ] One code-worker isolation canary completed without direct Secret Manager access; the
  no-GCP-env, no-GCP-file, allowlisted-projection, `gcp_auth=skipped`, and `secret_sync=skipped`
  assertions passed. Complete the safe natural drain/replacement of the seven prior-image workers.
- [x] Grafana/Alloy reads its rendered projection. On 2026-08-13 18:48 Europe/Warsaw the installed
  token matched the active DEV `v1` render in-memory, the projection was mode `0600` owned by
  `root:root`, and `alloy.service` explicitly loaded it and reported `running` with exit status `0`.
- [x] Production stages the exact PROD version without replacing active files.
- [x] The Terraform-owned `intexuraos-runtime-credential-canary-dev` topic is applied before the
  first PROD preflight; its emulator/UI/publish-test registrations are verified in lockstep.
- [x] Before staging, manifest `stableVersion`, the Terraform bootstrap pin,
  and the protected workflow variable select that same candidate in one
  reviewed desired-state change; the word stable is not treated as pre-smoke
  evidence. A compensated failure restores all three prior pins.
- [x] Production canary passes Firestore, GCS, Pub/Sub, Auth/OAuth, WhatsApp, Matrix, Sentry,
  certbot, Alloy, web build, and direct-origin health checks.
- [x] Atomic production publication and full PM2/nginx reload complete.
- [x] Deployment attestation records the package version without any secret material.
- [x] Version reconciliation proves the manifest stable pin, deployment input, Terraform bootstrap
  pin, generic/runtime projection metadata, native injection metadata, and deployment attestation
  all identify the expected positive numeric versions.

### Phase 7 — Rollback proof and legacy cleanup

- [x] Select byte-identical, exact-membership `v1`/`v2` pairs for DEV and PROD. Existing provider
  values remain opaque and unchanged; only credentials intentionally rotated by this migration
  affect whether an older version is rollback-safe.
- [ ] Complete the final home-dev package-wide prior/forward exercise and package-consumer smoke;
  the local DEV `v2 → v1 → v2` transaction already passed.
- [x] Switch production from `v2` to prior verified `v1`, render, restart, and pass the formal
  `00:04:14`/`00:08:14`/`00:13:07` UTC smoke and error-count samples.
- [x] Switch production forward to `v2` and pass the identical
  `00:34:26`/`00:39:13`/`00:44:19` UTC sample gate.
- [ ] Freeze the 34-name legacy audit set from the reviewed Terraform commit and observe zero
  exact `google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion` events in the
  closed `[T0,T1]` interval with exhaustive pagination for at least 72 continuous hours plus exact
  numeric package-read positive controls at both boundaries and a 15-minute log-delivery delay.
- [ ] Remove legacy IAM, disable old versions for a seven-day reversible window, then destroy the
  versions and remove their containers through Terraform.
- [ ] Refactor legacy cleanup into two Terraform phases before any destructive apply. Do not set
  `legacy_secret_manager_enabled = false`: the current implementation removes legacy IAM and the
  containers in the same apply, which cannot preserve the required seven-day disabled rollback
  window. Phase A must remove readers and disable versions while retaining containers; Phase B may
  destroy versions and containers only after the seven-day evidence passes.
- [ ] Retain only the active and immediately previous package versions during the observation
  window; destroy obsolete disabled versions because disabled versions remain billable.

### Cross-cutting emergency and recovery gates

- [ ] Break-glass design requires two-person approval, one package, one numeric version, and one
  Terraform-managed resource-level conditional accessor with a maximum 60-minute TTL; evidence must
  include removal and live zero-binding proof. Do not execute a break-glass grant merely to test it.
- [ ] A redacted isolated DR drill meets the four-hour recovery time objective: active and previous
  versions fetch/render successfully, the lost-container reconstruction path yields a complete
  offline candidate, every bootstrap/member source has an owner and exact recovery method, all
  package/metadata/rotation sources and both offline-escrow copies are available, and no
  production pointer changes.

## Verification commands and evidence

Evidence must contain command, timestamp, exit status, relevant counts/IDs, and redacted result.

| Verification | Required result | Evidence |
| --- | --- | --- |
| Targeted package tests | PASS | 2026-08-13 20:55 Europe/Warsaw: complete then-current-tree selection covering package publication/recovery, builder/DR, DEV writer races, PROD loader/first-cutover rollback, runtime canary, deployment pinning, integrations, Terraform IAM, and fresh-host behavior passed `333/333` |
| Runtime/Hetzner/orchestrator tests | PASS | 2026-08-18 23:48 Europe/Warsaw: the first complete post-merge `ci:tracked` passed `7968/7968` tests; all preceding Type/Lint and Static Validation phases and all following coverage/build/format checks also passed |
| Documentation contract tests | test-first FAIL, then PASS | 2026-08-14 00:04 Europe/Warsaw: `scripts/__tests__/secret-package-integrations.test.ts` passed `18/18`, including publication recovery, DR inventory, pin recovery, historical-plan wording, executable observation gates, Cloud Build least-privilege cleanup, and token-argv safety contracts |
| `pnpm run verify:secret-packages` | PASS | 2026-08-13 20:56 Europe/Warsaw: manifest/source/recovery schema coverage valid; DEV 35 env + 1 file, PROD 28 env + 3 files; 19 named recovery sources cover every member; both environments bind the correct base package for post-cleanup rotations |
| `pnpm run verify:credential-files` | PASS | 2026-08-13 20:56 Europe/Warsaw: credential file guard PASS |
| Documentation format/diff checks | PASS | 2026-08-19 04:38 Europe/Warsaw: file-scoped Prettier write/check passed; `scripts/__tests__/secret-package-integrations.test.ts` passed `18/18`; `git diff --check` passed. The full exact-tree `ci:tracked` gate is required again before this evidence update is committed. |
| `pnpm run typecheck:tests` | PASS | 2026-08-13 20:56 Europe/Warsaw: then-current-tree test typecheck PASS; the later exact-clean-commit Type/Lint phase also passed |
| `pnpm run ci:tracked` | PASS for the production implementation and pin transitions | PRs `#2467`, `#2468`, `#2469`, `#2470`, and DEV promotion PR `#2473` each passed the full local `7968/7968` suite and all applicable exact-head checks before merge; PR `#2473` received `15` successful and `7` path-filtered checks with no failure or pending check. This documentation-only evidence branch is verified with the focused documentation contract and format/diff checks |
| Terraform format | no diff | 2026-08-13 20:57 Europe/Warsaw: `terraform fmt -check -recursive terraform` PASS |
| Terraform validate, both roots | PASS | 2026-08-19: `terraform/environments/dev` and `terraform/hetzner-prod` both exited `0` on merged SHA `ff487fb41da952d7798824b34afb089c93a254c2` |
| Terraform plan, retained GCP | NOT CONVERGED — do not apply | 2026-08-19 full sequential plan exited `2` with `0 add / 0 change / 5 destroy`: three out-of-scope App Check rollback resources plus the retained home-orchestrator legacy accessor and the broad `claude-code-dev` admin grant. The mixed plan must not be applied; secret IAM removal waits for the 72-hour gate and App Check remains outside this goal. Refresh-only differences were computed metadata only. |
| Terraform plan, Hetzner | NOT CONVERGED — do not apply | 2026-08-19 full sequential plan exited `2` with `2 add / 0 change / 1 destroy`: replacement of `terraform_data.bootstrap_prod[0]` plus creation of `terraform_data.legacy_runtime_sa_bootstrap[0]`. The already healthy package-aware production runtime is not changed from this plan. Refresh-only differences were provider normalization only. |
| DEV shadow comparison | all members `MATCH` | 2026-08-13 15:52 Europe/Warsaw: dedicated DEV publisher impersonation rebuilt all 35 exact legacy sources plus the external Firebase member; dedicated renderer fetched numeric `v2`; ephemeral HMAC comparison returned `MATCH`; payload is 5,838 bytes with verified server CRC32C. Provider values were preserved as opaque members and were not used as a rollout gate |
| PROD shadow comparison | all members `MATCH` | PROD `v1` and `v2` are byte-identical `8566`-byte payloads; exact numeric fetch, schema, complete `28` env + `3` file membership, CRC32C/readback, byte comparison, HMAC `MATCH`, and offline render passed without emitting any member value or reversible digest |
| Local smoke | PASS | PASS — 2026-08-19: exact atomic four-file DEV `v2` projection `dev-projection-v2-f49cb298-325a-46f3-812b-7a1fd4cb5e85`; release files mode `0600`, directories mode `0700`, stable `.envrc` and GitHub PEM symlinks through `current`; PM2 `20/20`, semantic health `19/19`, and local consumers `21/21`, including web and Pub/Sub UI. The earlier local `v2 → v1 → v2` transaction also passed. |
| home-dev smoke | PASS | PARTIAL — exact DEV `v1` sync migrated the host to `dev-projection-v1-7ce456b1-0c49-49c6-be7c-0fa690daec84`; projection modes/symlinks, PM2 `22/22`, semantic health `19/19`, orchestrator, and Alloy passed. The reviewed manifest pin is now DEV `v2`; zero-running-worker activation and the final prior/forward observation series remain open. |
| code-worker canary | PASS without Secret Manager access | PASS canary / PARTIAL fleet — GitHub Actions run `32203968717` and Cloud Build `ca9dc515-1b15-48be-bad4-d0e3e7bfb940` succeeded for exact SHA `ff487fb41da952d7798824b34afb089c93a254c2`; image digest `sha256:b9f4ba753e1579af6dce9c6036174f88fd253de9a3a812d9963e1f16c014c0dd` has no forbidden GCP env/file/direct-sync path. A natural exact-image worker reported `gcp_auth=skipped` and `secret_sync=skipped`, received exactly three allowlisted read-only files, reached readiness, and completed. At `2026-08-19T02:23:59Z`, the prior-image fleet comprised three active and four terminal/preserved containers; drain/replacement remains required before `T0`. |
| Production canary | PASS | PROD `v1`, initial `v2`, rollback `v1`, and final `v2` candidate canaries passed Firestore, GCS, Pub/Sub, Auth/OAuth, WhatsApp, Matrix, Sentry, certbot, Alloy, web build, and direct-origin checks; first run `32192142422` compensated safely before hotfix `#2467` |
| Production full smoke | PASS | Runs `32194686180`, `32197008479`, `32199105331`, `32201202140`, and `32207286305` passed PM2 `19/19`, semantic checks `19/19`, direct/public endpoints, Matrix, Alloy, and nginx; current active run is `32207286305` on SHA `c8c24cddfe652995f0d5c69dce0f912b3a2315b8` |
| PROD version reconciliation | all persisted PROD pins/pointers equal the promoted numeric version | PASS — manifest, Terraform, protected workflow input, generic projection metadata, runtime projection metadata, and `deployment.json` all identify PROD `v2`; current deployment SHA/run are `c8c24cddfe652995f0d5c69dce0f912b3a2315b8`/`32207286305`. DEV remains PARTIAL until home-dev moves from atomic `v1` to the reviewed manifest/local `v2`. |
| Rollback drill | DEV prior/forward and PROD prior/forward each have three PASS samples over 15 minutes with zero unexpected auth/credential/health failures | PARTIAL overall — production `v2 → v1 → v2` and all three sample series passed; local DEV transaction passed; final home-dev prior/forward smoke remains open |
| Secret Manager audit | frozen 34-name set, exhaustive pages, zero legacy reads for 72 hours, both positive controls PASS | PENDING delayed gate — every production sample reported runtime calls/accesses/denials `0/0/0`, but these immediate counts are preliminary; require the closed 72-hour interval, exhaustive pages, boundary controls, and `T1 + 15 minutes` before cleanup |
| Firebase usage cutover | both origin smoke matrices PASS; global replacement credential UID count `> 0`; old credential UID count `0` over a closed interval of at least 24 hours evaluated after the 30-minute visibility delay; zero attributable failures | PENDING delayed gate — the replacement member is active in PROD `v2`; retain the previous key until both origin smokes and the closed 24-hour interval evaluated after `T1 + 30 minutes` pass |
| Runtime SA rotation soak | closed pre-disable interval of at least 24 hours evaluated after the three-hour visibility delay: previous key `0`, replacement key `> 0`, credential failures `0`; then seven days with the old key continuously `DISABLED`, replacement use `> 0`, and failures `0` | PENDING delayed gate — metadata-only replacement key ID `4bf7371e272b2c67b6d0bd59cd52cae7daf18efc` is active fleet-wide; retain the previous key until the 24-hour interval evaluated after `T1 + 3 hours`, then keep it disabled for seven measured days before deletion |
| Break-glass control review | two approvals; one resource; 60-minute conditional binding; removal/zero-binding evidence defined | PENDING — design review only; do not create a grant for testing |
| DR drill | isolated fetch/render/reconstruction PASS within four hours; no production pointer changed | PENDING |
| GitHub alert | closed as revoked | PENDING |
| Active version inventory | target inventory reached | PARTIAL — PROD `v1` and `v2` are enabled and verified, with `v2` active and `v1` retained for rollback; final inventory reduction waits for delayed audit, reversible-disable, and DR gates |

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
| 2026-08-13 Europe/Warsaw | DEV package publication | DEV `v1` and `v2` published and fetched by numeric version; equal 5,838-byte payloads, server CRC32C verified, HMAC comparison `MATCH`; ephemeral payloads and comparison key removed after verification. Existing provider values were preserved unchanged as opaque package members |
| 2026-08-19 Europe/Warsaw | DEV renderer/rollback | PR `#2473` promoted the reviewed DEV manifest pin to `v2`. Dedicated renderer activated local atomic projection `dev-projection-v2-f49cb298-325a-46f3-812b-7a1fd4cb5e85`; four exact files, marker/endpoints, `0600`/`0700` modes, PM2 `20/20`, semantic health `19/19`, web, and Pub/Sub UI passed. Home-dev exact `v1` sync remains healthy on atomic projection `dev-projection-v1-7ce456b1-0c49-49c6-be7c-0fa690daec84`; its final prior/forward drill to `v2` waits for zero running workers. |
| 2026-08-13 Europe/Warsaw | Firebase build cutover proof | local production-mode SPA build passed using DEV `v2`; byte-safe check confirmed replacement key is present and previous key is absent without logging either value |
| 2026-08-13 15:09 Europe/Warsaw | Fresh retained-GCP convergence | `GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev plan -input=false -lock-timeout=60s -detailed-exitcode -out=<ephemeral-plan> -no-color`; the fresh retained-GCP plan exited `0` with `No changes`; ephemeral plan removed. Historical after the canary-topic Terraform change. |
| 2026-08-13 15:09 Europe/Warsaw | Home identity live IAM | Read-only project-IAM query plus exhaustive iteration over every Secret Manager container found exactly `0` Secret Manager bindings for both home identities. `ixos-home-runtime-dev`: only `datastore.user`, `firebaseauth.admin`, `logging.logWriter`, `pubsub.publisher`, plus `storage.objectAdmin` on `intexuraos-whatsapp-media-dev`, `intexuraos-shared-content-dev`, and `intexuraos-images-dev`. `ixos-home-orchestrator-dev`: only repository-level `artifactregistry.reader` |
| 2026-08-13 15:36 Europe/Warsaw | Publisher IAM recovery | Initial all-in-one apply exposed an ordering hazard: WIF/account changes completed, but resource-level Secret Manager bindings failed after the operator's broad role was removed. Recovery used three explicit Terraform plans: one-resource temporary bootstrap, `65` narrow publisher bindings, then bootstrap destruction. No secret, version, or workload resource was deleted. |
| 2026-08-13 15:52 Europe/Warsaw | Publisher/WIF live proof | Both DEV and PROD publisher impersonations returned tokens; the local operator has `0` project bindings for `secretmanager.admin` or project-wide `serviceAccountTokenCreator`; both WIF providers require immutable owner ID `368465`, repository ID `1118959310`, exact repository, and `refs/heads/development`. |
| 2026-08-13 16:17 Europe/Warsaw | Historical retained-GCP convergence and metadata IAM | Full un-targeted refresh plan exited `0` with `No changes`. A separate metadata-only live audit confirmed package metadata and `getIamPolicy` access, no project `secretmanager.admin` for the audited operator/publisher principals, no project-wide Token Creator, the numeric project-prefix condition, and own-package-only publisher readback with no DEV/PROD crossover. No payload was accessed. This evidence predates the canary-topic Terraform change. |
| 2026-08-13 20:52 Europe/Warsaw | Canary topic and publisher metadata IAM convergence | The reviewed plan contained exactly three creates and no change/delete: the no-subscription `intexuraos-runtime-credential-canary-dev` topic plus `roles/secretmanager.viewer` on each publisher's own package. The first apply created the topic and correctly received `403` for both secret-policy writes. Terraform then created one temporary project `secretmanager.admin` bootstrap for `claude-code-dev`, applied exactly the two package-scoped bindings, and destroyed the bootstrap. Live policy checks found DEV only on DEV, PROD only on PROD, and exactly `0` project `secretmanager.admin` bindings for the operator. A final full un-targeted plan exited `0`, reported `0` non-noop changes and `No changes`; all ephemeral plan/output files were removed without touching the protected rollout directory. No payload was accessed. |
| 2026-08-13 16:29 Europe/Warsaw | Historical code verification | `pnpm run ci:tracked` PASS: Type/Lint, Static Validation, `7929/7929` tests, coverage validation, web build, format, and post-build checks; focused package/runtime selection `260/260` and both manifest/credential guards also PASS. This run is preserved as historical evidence but is stale after the later package-transaction and executable-audit revisions and cannot satisfy the final CI gate. |
| 2026-08-13 16:31 Europe/Warsaw | Post-cleanup rotation path | Dedicated DEV publisher fetched exact package `v2`; base-package mode applied one explicit private-file override, validated server CRC32C and exact membership, wrote mode `0600`, and reproduced the reviewed package byte-for-byte. The candidate was moved to Trash; no value was logged. |
| 2026-08-13 17:55 Europe/Warsaw | Goal artifact verification | File-scoped Prettier write/check and `git diff --check -- docs/plans/2026-08-13-secret-packages-production-goal.md` exited `0`; no repository-wide verification was claimed. |
| 2026-08-13 20:55 Europe/Warsaw | Transaction/recovery verification at capture | The complete focused then-current-tree matrix passed `333/333`: durable schema-v2 publication receipt/reconcile; post-cleanup and lost-container builds; shared DEV writer lock and staged projection consistency; sealed first-cutover legacy rollback; strict PROD membership/ownership/path/timeout checks; full runtime credential canary; exact pin reconciliation; Terraform contracts; and fresh-host bootstrap. Subsequent test-first cases cover incomplete lock-owner inode recovery, live preparation serialization, durable PROD release publication, committed stable-link cleanup, and wrapper recovery after an ambiguous activation attempt. |
| 2026-08-13 21:49 Europe/Warsaw | Historical local code verification | Complete then-current-tree `pnpm run ci:tracked` run `#5` PASS: Type/Lint, Static Validation, `8009` tests with coverage, Coverage Validation, Web Build & Format, and Post-Build Checks. Independent final diff review found no remaining P0/P1 in the DEV/PROD crash-recovery paths. This run predates the final executable-audit revision and current scope cleanup. |
| 2026-08-19 00:44:19 UTC | Ephemeral rollout cleanup | Removed the explicitly scoped local PROD payloads, package inputs, HMAC comparison material, offline render roots, and canary scratch after final forward verification. Retained only two mode-`0600`, metadata-only publication receipts in the mode-`0700` canonical private journal plus remote `prod-v1.json`/`prod-v2.json` attestations; no secret value or reversible digest remains in the evidence artifact. |
| 2026-08-19 UTC | Deferred observation gates | Firebase: closed interval at least 24 hours, evaluated after `T1 + 30 minutes`. Runtime key: closed interval at least 24 hours, evaluated after `T1 + 3 hours`, then seven days continuously disabled. Legacy Secret Manager: closed interval at least 72 hours, evaluated after `T1 + 15 minutes`, then seven days reversibly disabled before destruction. |
| 2026-08-14 01:00 Europe/Warsaw | Cloud Build service-agent least privilege refresh | IAM v3 still has the same two broad, Terraform-unmanaged project `roles/secretmanager.admin` bindings for `service-544224260556@gcp-sa-cloudbuild.iam.gserviceaccount.com` (etag `BwZY8iQeXcI=`): one unconditional and one expired `cloudbuild-connection-setup` condition. The connection remains `COMPLETE`, enabled, and non-reconciling; metadata-only `fetchGitRefs` passed with `19` branch refs, including exactly one `main` and one `development`. The currently authenticated administrative principal, whose Secret Manager metadata access is limited, was denied `secretmanager.secrets.getIamPolicy` on the exact OAuth-token secret, so no IAM mutation was attempted. Reauthentication and the documented Terraform adopt → plan-zero → exact-two-delete → canary sequence remain mandatory. |
| 2026-08-14 00:35 Europe/Warsaw | Exact clean-commit local code verification | On clean commit `eac2dc198a37ea15228d2cdf08cc4001b2bae238`, `pnpm run ci:tracked` exited `0`: Type/Lint PASS (`156.153s`), Static Validation PASS (`21.553s`), `8010/8010` tests with coverage PASS (`574.534s`), Coverage Validation PASS (`1.057s`), Web Build & Format PASS (`19.398s`), and Post-Build Checks PASS (`0.091s`). The exact pushed commit then received `15` successful applicable PR checks, `8` path-filtered skips, and no failures or pending checks. |
| 2026-08-14 09:38 Europe/Warsaw | Scope-cleaned migration verification | Removed provider-health/purchase/login work, general logging/forensics hardening, and App Check from this goal while retaining direct no-GCP code-worker isolation assertions. The exact baseline diff is 110 paths (`27 A`, `83 M`) with sorted-path SHA-256 `ae1503ecfe3ae046fb102881ad11fbc8bf4f28ad7f4e73d922d29caa127ea7c3`. Focused migration tests passed `763/763`; package and credential guards, test typecheck, Terraform format, and both Terraform validates passed; full `ci:tracked` passed Type/Lint, Static Validation, `7986/7986` tests, coverage validation, web build/format, and post-build checks. |
| 2026-08-18 UTC | PROD package publication | Dedicated publisher impersonation built PROD `v1` and byte-identical `v2`: each `8566` bytes with `28` env + `3` file members. Exact numeric fetch, server/readback CRC32C, byte comparison, HMAC `MATCH`, and offline render all passed. Both versions remain enabled; no value or reversible digest was emitted. |
| 2026-08-18 UTC | Restricted Cloudflare evidence | Active token ID `ade18caae171c71c3108fadf3de05705` is restricted to one account and exact zone `intexuraos.cloud`, with only `Zone: Read` and `DNS: Edit`. Remote version-bound attestations `prod-v1.json` and `prod-v2.json` are `root:root` mode `0600`. |
| 2026-08-18 UTC | First cutover and compensation | PR `#2454` merged as `65120992c650754600fe967abd4ca845b09f404e`. Run `32192142422` activated the package, failed only on deploy-user access to root-owned mode-`0600` metadata, compensated to the healthy pre-package projection, and preserved `19/19` service health. |
| 2026-08-18 UTC | Metadata verifier hotfix and PROD v1 | PR `#2467` merged as `7104a8772f3eaf2aee792df9f954e79d2166bc06`. Run `32194686180` activated PROD `v1`; PM2 `19/19`, semantic checks `19/19`, direct/public checks, Matrix, Alloy, nginx, and immediate runtime Secret Manager zero checks passed. |
| 2026-08-18 UTC | Initial PROD v2 promotion | PR `#2468` merged as `96d61ce6b2202b719fc483bdb2c7be97b5ab6019`. Run `32197008479` activated PROD `v2`; formal observations at `23:42:40`, `23:47:42`, and `23:52:42` UTC each passed PM2 `19/19`, semantic checks `19/19`, direct/public checks, Matrix, Alloy, nginx, and runtime calls/accesses/denials `0/0/0`. |
| 2026-08-19 UTC | Controlled rollback to PROD v1 | PR `#2469` merged as `606097aac9b5fab5ada2e8cf312dbfd842b48c72`. Run `32199105331` activated PROD `v1`; observations at `00:04:14`, `00:08:14`, and `00:13:07` UTC passed the same full matrix with runtime calls/accesses/denials `0/0/0`. |
| 2026-08-19 UTC | Final forward to PROD v2 | PR `#2470` merged as `ff487fb41da952d7798824b34afb089c93a254c2`. Run `32201202140` activated PROD `v2`; observations at `00:34:26`, `00:39:13`, and `00:44:19` UTC passed the same full matrix with runtime calls/accesses/denials `0/0/0`. Manifest, Terraform, protected workflow input, both projection metadata records, and `deployment.json` all report version `2`. Immediate audit zeroes remain preliminary until the documented log-delivery delay and full observation window pass. |
| 2026-08-19 02:05–02:08 UTC | DEV v2 pin and current production deploy | PR `#2473` changed only the reviewed DEV manifest pin and its contract test from `v1` to `v2`; local `7968/7968` and exact-head checks (`15` success, `7` path-filtered skips) passed before merge as `c8c24cddfe652995f0d5c69dce0f912b3a2315b8`. Automatic production run `32207286305` retained exact PROD `v2`; preflight, activation, PM2 `19/19`, semantic checks `19/19`, direct/public surfaces, Matrix, Alloy, nginx, and exact SHA/run/version attestation passed with zero compensation markers. |
| 2026-08-19 02:23 UTC | Local atomic DEV v2 smoke | Dedicated renderer activated `dev-projection-v2-f49cb298-325a-46f3-812b-7a1fd4cb5e85` with four exact mode-`0600` release files, mode-`0700` directories, and stable `.envrc`/GitHub PEM symlinks through `current`. Local PM2 was `20/20`, semantic health `19/19`, web and Pub/Sub UI returned `200`, and all `21/21` consumers passed with package version `2` and the retained project ID. |
| 2026-08-19 UTC | Runtime credential metadata | Active fleet projection identifies replacement key ID `4bf7371e272b2c67b6d0bd59cd52cae7daf18efc`; evidence is metadata-only. The previous key remains available until the 24-hour plus three-hour delayed metric gate passes, then must remain disabled for seven days before deletion. |
| 2026-08-19 UTC | Legacy cleanup safety stop | `legacy_secret_manager_enabled = false` is forbidden for the next cleanup apply because current Terraform couples reader/IAM removal with container destruction. A reviewed two-phase implementation must first remove readers and disable versions while retaining containers, observe seven days, and only then destroy versions and containers. |
| 2026-08-19 UTC | Current merged baseline | `origin/development` and deployed production identify `c8c24cddfe652995f0d5c69dce0f912b3a2315b8`; active deployment run is `32207286305`, with exact PROD package version `2`. The formal PROD rollback/forward sample proof remains the earlier `ff487fb41da952d7798824b34afb089c93a254c2` run `32201202140`. |
| 2026-08-19 01:20–01:29 UTC | code-worker image/canary cutover | GitHub run `32203968717` and Cloud Build `ca9dc515-1b15-48be-bad4-d0e3e7bfb940` succeeded from exact SHA `ff487fb41da952d7798824b34afb089c93a254c2`. Registry `latest` and the exact-SHA tag resolve to OCI digest `sha256:b9f4ba753e1579af6dce9c6036174f88fd253de9a3a812d9963e1f16c014c0dd`; image inspection found no `GOOGLE_APPLICATION_CREDENTIALS`, package-renderer variable, `/secrets/gcp-sa.json`, direct Secret Manager call, or sync command. A naturally dispatched exact-image worker reported `gcp_auth=skipped` and `secret_sync=skipped`, received exactly three allowlisted read-only files, reached readiness, and completed with terminal status `completed`. Seven prior-image workers remained in the 01:27 UTC snapshot. |
| 2026-08-13 18:48 Europe/Warsaw | home-dev observability projection | Read-only in-memory comparison proved `/etc/intexuraos/grafana-cloud.env` uses the same non-empty Loki token as exact DEV package `v1`; no value or digest was emitted. Render root mode is `0700`; installed projection is `0600 root:root`; `alloy.service` declares the projection as a required `EnvironmentFile`, is `running`, and has main exit status `0`. |

## Production acceptance criteria

- [x] Exactly two package containers exist for application bundles.
- [x] Only the two documented native application secrets remain individually injected.
- [x] Every package and native injection is pinned to a numeric version.
- [ ] No active runtime path calls `versions/latest` or reads an individual application secret. At
  the 2026-08-19 02:23:59 UTC snapshot, three active and four terminal/preserved home-dev containers
  still contained the old direct-sync startup path and must be naturally completed/cleaned and
  replaced before this criterion and the legacy-read `T0` can pass.
- [x] No package payload or service-account private key exists in Git, Terraform state, logs, or
  deployment attestations.
- [ ] Firebase rotation has passed independent DEV and PROD origin smoke matrices, a global
  replacement-UID count `> 0`, an old-UID count `0` over the delayed-evaluation 24-hour interval,
  and zero attributable failures; the previous key is deleted and the repository alert is closed as
  revoked.
- [ ] The Hetzner runtime credential is installed mode `0600`, has no Secret Manager access, passes
  the delayed-evaluation 24-hour pre-disable gate, and the previous key is deleted only after the
  measurable seven-day disabled-state/replacement-use/failure gate.
- [x] Bootstrap credentials remain outside the packages and have package-specific least privilege.
- [ ] The Cloud Build service agent retains only its managed service-agent role and one
  resource-level `roles/secretmanager.secretAccessor` binding on the active connection-token secret;
  it has zero project-level Secret Manager roles, the connection is `COMPLETE`, and `fetchGitRefs`
  passes after cleanup.
- [ ] code-worker receives only an allowlisted projection and no broad admin credential.
- [ ] All CI, Terraform, environment smoke, production smoke, audit, and rollback evidence is PASS.
- [x] Documentation and recovery procedures are complete and discoverable from `docs/site-index.json`.
- [ ] Legacy resources are destroyed only after the observation and reversible-disable windows.

## Endpoint Changes

- Modified: `GET /deployment.json` adds the required positive numeric string field
  `secretPackageVersion`; publication and verification require exactly
  `commitSha`, `workflowRunId`, `deployedAt`, and `secretPackageVersion`.
- Created: none.
- Removed: none.
- Unchanged: all other public and internal HTTP contracts. Package version evidence is deliberately
  exposed in the uncached public deployment attestation and recorded in this goal artifact.

## Rollback boundary

Before credential revocation, rollback uses the previous verified package version. After a Firebase
or service-account key is revoked, any version containing it is permanently invalid and must not be
selected. A new rollback-safe version containing the current credential and previous non-credential
configuration must therefore be published before revocation. Provider credentials that are not
being rotated remain opaque, byte-preserved members and do not affect package eligibility. The final
DEV and PROD drills use the selected reviewed forward version and its byte-identical rollback-safe
companion.

## Completion record

This section records the verified rollout state without declaring the entire goal complete. Final
completion requires every unchecked acceptance criterion and deferred gate above to pass.

| Field | Value |
| --- | --- |
| Final status | ACTIVE — production cutover and PROD rollback/forward drill complete; delayed observation, disable, cleanup, DEV/code-worker, and recovery gates remain |
| Merged commit | `c8c24cddfe652995f0d5c69dce0f912b3a2315b8` |
| Production deployment run | `32207286305` |
| DEV package version | Manifest and local atomic projection `v2`; local `v2 → v1 → v2` transaction and full consumer smoke passed; home-dev atomic `v1` migration/smoke passed, while the zero-running-worker gate and final home-dev prior/forward observation remain open |
| PROD package version | Active `v2`; byte-identical verified rollback companion `v1` retained |
| Native secret versions | `INTEXURAOS_INTERNAL_AUTH_TOKEN` `v2`; `INTEXURAOS_SPEECHMATICS_APP_API_KEY` `v1` |
| Firebase replacement key resource ID | `intexuraos-firebase-browser-2026`; previous-key deletion waits for the 24-hour plus 30-minute gate |
| Runtime credential key ID | `4bf7371e272b2c67b6d0bd59cd52cae7daf18efc` (metadata only); previous-key deletion waits for the 24-hour plus three-hour gate and seven-day disabled window |
| Rollback versions tested | PROD `v2 → v1 → v2` PASS; all three production observation series PASS |
| Legacy cleanup completed | NO — require 72 hours plus 15 minutes, then implement two-phase Terraform cleanup and preserve a seven-day disabled rollback window |
| Final CI evidence | Production implementation/pin PRs `#2467`–`#2470` and DEV promotion PR `#2473` each passed `7968/7968` locally and all applicable exact-head checks; PR `#2473` had `15` successful and `7` path-filtered checks. This evidence-only update has focused verification recorded above. |
