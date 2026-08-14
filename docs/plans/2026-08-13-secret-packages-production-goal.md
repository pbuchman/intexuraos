# Production Goal: Secret Packages

## Goal identity

| Field | Value |
| --- | --- |
| Status | ACTIVE |
| Started | 2026-08-13, Europe/Warsaw |
| Baseline | `origin/development` at `9faf87a17c06359bc29254c73d8b94f1315fa70d` |
| Implementation branch | `codex/secret-packages-production` |
| Pushed code/evidence baseline | `02018515f75eb02c03a8990861cd938142b96b18`, `c804f759193569b6f78ef4699a2607004f17938d`, `32e22ed5f3553fe556f5aed53e152a5362ead07a`, `27c0912ec89a7f1319180606d80886b2928cb738`, `59a709e61b83a9aee4a84206343eb33a05297d7d`, `eac2dc198a37ea15228d2cdf08cc4001b2bae238`, `4c716080ffe3f395b0dfd30dc254358ac7dca3f3` |
| Current working state | At the 2026-08-14 09:38 Europe/Warsaw capture, the scope-cleaned tree contains only the secret-package migration and its direct Firebase-key/runtime-SA/IAM/consumer/rollback work. Provider-health gating, provider purchase/login decisions, general logging/forensics hardening, and Firebase App Check were removed. The exact baseline diff is 110 paths (`27 A`, `83 M`); targeted migration tests pass `763/763`, full `pnpm run ci:tracked` passes all phases with `7986` tests, both Terraform roots validate, and the package/credential guards pass. Draft PR `#2454` remains unmerged; the scope-cleanup commit and its exact PR checks are pending at this capture. Terraform-managed retained-GCP resources were converged before removal of the unrelated App Check declarations; a new reviewed plan is required before any further apply. Live project IAM still contains two unmanaged Cloud Build service-agent `roles/secretmanager.admin` bindings pending Terraform adoption and least-privilege cleanup. DEV/PROD rollout and the Firebase, runtime-SA, and legacy-read observation intervals remain PENDING; no soak `T0` has begun. |
| Linear issue | None by explicit user decision |
| GCP project | `intexuraos-dev-pbuchman` |
| Environments | local, dev/home-dev, prod/Hetzner, retained GCP transcription |
| Canonical evidence | This document |

## Current execution state

- The last pushed revision before this scope cleanup is
  `4c716080ffe3f395b0dfd30dc254358ac7dca3f3`. Draft PR `#2454` targets `development`; nothing has
  been merged and no production deployment has run. Exact PR checks for the scope-cleaned commit
  remain pending.
- DEV package versions `v1` and `v2` were published and proven byte-identical with valid CRC32C,
  exact membership, and a package-level HMAC comparison. Provider credential values are opaque
  package members: provider entitlement, purchasing, and product support decisions are explicitly
  outside this migration and do not gate package rollout.
- Local rendering and the package-wide `v2 → v1 → v2` rollback mechanism were exercised. The
  local projection is on `v2`; home-dev currently remains on `v1` and must be aligned to the selected
  reviewed DEV version before the environment rollout is complete.
- The PROD package has no published version. Production staging, canary, activation, rollback,
  merge, and deployment are all pending.
- A live pre-cutover 24-hour baseline found `1138` authentication events for the previous Hetzner
  runtime key and `0` for the replacement. The old Firebase credential UID recorded `2` requests,
  both rejected with HTTP `403` by the Generative Language API; the replacement Firebase credential
  UID recorded `0`. These counts are readiness baselines, not soak evidence. No Firebase,
  runtime-SA, or 72-hour legacy-read `T0` has begun.
- Live IAM contains one unconditional and one expired conditional unmanaged project-level
  `roles/secretmanager.admin` binding for the Cloud Build service agent. The connection remains
  operational, but cleanup is gated on proving the active token's resource-level accessor and a
  post-cleanup `fetchGitRefs` canary.
- The pushed hardening adds durable publication recovery, crash-atomic DEV projection,
  host-serialized and structurally validated PROD projection, complete runtime-credential canaries,
  exact three-pin reconciliation, and an executable per-member DR source inventory. Test-first crash
  recovery now also covers incomplete DEV lock publication, durable PROD candidate publication, and
  interrupted stable-link activation. On the scope-cleaned tree, local `ci:tracked` passes all
  phases with `7986` tests. The required GCP topic plus package-scoped publisher metadata IAM were
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

Baseline: `9faf87a17c06359bc29254c73d8b94f1315fa70d`. The exact paths below are the
normative changed-file inventory after removing non-secret-migration scope. Current inventory: 110
paths (`27 A`, `83 M`, no delete/rename); sorted-path SHA-256:
`ae1503ecfe3ae046fb102881ad11fbc8bf4f28ad7f4e73d922d29caa127ea7c3`. Any later
path change requires refreshing this inventory before completion.

Verify completeness from the repository root; PASS means the first `comm`
prints no path, `path_count=110`, and the recorded digest matches. Backtick
tokens are compared as exact entries, so a longer filename cannot satisfy a
shorter path:

```bash
baseline_commit=9faf87a17c06359bc29254c73d8b94f1315fa70d
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
- [ ] Build the PROD candidate from explicitly selected numeric legacy versions, the rotated
  runtime service-account file, and approved external credential files.
- [ ] Publish the PROD candidate without logging its payload. Publication remains gated on a
  narrowly scoped Cloudflare token with `DNS: Edit` for the single `intexuraos.cloud` zone.
- [ ] Record only secret IDs, numeric versions, byte counts, CRC32C verification results, and member
  counts for the replacement DEV and PROD candidates.
- [ ] Execute final DEV and PROD shadow comparisons and require all members to report `MATCH`.

### Package input and recovery gates

- [ ] Cloudflare: the PROD package requires a raw DNS token value restricted to `DNS: Edit` for the
  single `intexuraos.cloud` zone. No recoverable value exists in the current host projections; obtain
  it only when building the PROD candidate and pass it through an ephemeral mode-`0600` input file.
- [ ] Offline recovery escrow: schema-v2 inventory identifies every encryption/signing member that
  requires byte-identical recovery, but two independently held encrypted copies and a successful
  reconstruction drill have not been attested. Legacy/container destruction is blocked until they
  are proven without exposing values or value-derived fingerprints.

### Phase 4 — Firebase browser key rotation

- [x] Create the replacement browser key through Terraform alongside the existing protected key.
- [x] Verify the replacement has only approved prod/dev/localhost referrers and Firebase APIs, with
  no Generative Language API.
- [ ] Put the replacement value into new DEV and PROD candidate versions through the secure
  publisher.
- [ ] Deploy and verify dev web Auth, token refresh, and Firestore access.
- [ ] Deploy and verify prod web Auth, token refresh, and Firestore access.
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
- [ ] Put the replacement JSON into the PROD package using the provisioner as the distinct bootstrap
  identity.
- [ ] Validate only `type`, `project_id`, `client_email`, `private_key_id`, and parseability.
- [ ] Atomically render the credential at mode `0600` and verify token issuance plus minimal
  Firestore, GCS, Pub/Sub, and Firebase Auth operations.
- [ ] Reload a canary and then all production PM2 processes.
- [ ] Start runtime-SA `T0` only after the complete production fleet uses the replacement credential
  and the canary plus full smoke suite pass. For a closed `[T0,T1]` interval of at least 24 hours,
  evaluate the key-authentication metric only after `T1 + 3 hours` and require previous-key count
  `0`, replacement-key count `> 0`, and credential-related failure count `0`.
- [ ] Only then disable the previous key. During the seven-day disabled window require the key state
  to remain `DISABLED`, replacement-key authentication count `> 0`, and credential-related failure
  count `0`. Google excludes disabled keys from the metric, so this window does not claim zero
  attempted use. Delete it only after these measurable gates pass.
- [x] Replace broad local/home-dev worker credentials with a dedicated least-privilege identity or
  short-lived impersonated credentials; never place the bootstrap key inside DEV.

### Phase 6 — Environment rollout

- [ ] Local Mac renders exact DEV package `v2`; complete the package-consumer service smoke without
  treating third-party provider entitlement as a migration gate.
- [ ] home-dev PM2 and systemd orchestrator use the same selected verified DEV version. The previous
  rollback exercise left home-dev active on `v1`, so it still requires version alignment and smoke.
- [ ] One code-worker isolation canary runs without direct Secret Manager access; the no-GCP-env and
  no-GCP-file assertions pass; complete the package-projection canary and all-worker cutover.
- [x] Grafana/Alloy reads its rendered projection. On 2026-08-13 18:48 Europe/Warsaw the installed
  token matched the active DEV `v1` render in-memory, the projection was mode `0600` owned by
  `root:root`, and `alloy.service` explicitly loaded it and reported `running` with exit status `0`.
- [ ] Production stages the exact PROD version without replacing active files.
- [x] The Terraform-owned `intexuraos-runtime-credential-canary-dev` topic is applied before the
  first PROD preflight; its emulator/UI/publish-test registrations are verified in lockstep.
- [ ] Before staging, manifest `stableVersion`, the Terraform bootstrap pin,
  and the protected workflow variable select that same candidate in one
  reviewed desired-state change; the word stable is not treated as pre-smoke
  evidence. A compensated failure restores all three prior pins.
- [ ] Production canary passes Firestore, GCS, Pub/Sub, Auth/OAuth, WhatsApp, Matrix, Sentry,
  certbot, Alloy, web build, and direct-origin health checks.
- [ ] Atomic production publication and full PM2/nginx reload complete.
- [ ] Deployment attestation records the package version without any secret material.
- [ ] Version reconciliation proves the manifest stable pin, deployment input, Terraform bootstrap
  pin, generic/runtime projection metadata, native injection metadata, and deployment attestation
  all identify the expected positive numeric versions.

### Phase 7 — Rollback proof and legacy cleanup

- [ ] Select two byte-identical, exact-membership DEV package versions for the final forward and
  rollback exercise. Existing provider values remain opaque and unchanged; only credentials that
  are intentionally rotated by this migration affect whether an older version is rollback-safe.
- [ ] Switch to the prior verified numeric version, render, restart, and pass three five-minute
  smoke/error-count samples over 15 minutes with zero unexpected auth/credential/health failures.
- [ ] Switch forward again and repeat the identical three-sample, 15-minute gate.
- [ ] Freeze the 34-name legacy audit set from the reviewed Terraform commit and observe zero
  exact `google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion` events in the
  closed `[T0,T1]` interval with exhaustive pagination for at least 72 continuous hours plus exact
  numeric package-read positive controls at both boundaries and the log-delivery delay.
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
  offline candidate, every bootstrap/member source has an owner and exact recovery method, all
  package/metadata/rotation sources and both offline-escrow copies are available, and no
  production pointer changes.

## Verification commands and evidence

Evidence must contain command, timestamp, exit status, relevant counts/IDs, and redacted result.

| Verification | Required result | Evidence |
| --- | --- | --- |
| Targeted package tests | PASS | 2026-08-13 20:55 Europe/Warsaw: complete then-current-tree selection covering package publication/recovery, builder/DR, DEV writer races, PROD loader/first-cutover rollback, runtime canary, deployment pinning, integrations, Terraform IAM, and fresh-host behavior passed `333/333` |
| Runtime/Hetzner/orchestrator tests | PASS | 2026-08-14 09:38 Europe/Warsaw: focused secret-migration matrix passed `763/763`; the subsequent full scope-cleaned `ci:tracked` passed `7986` tests |
| Documentation contract tests | test-first FAIL, then PASS | 2026-08-14 00:04 Europe/Warsaw: `scripts/__tests__/secret-package-integrations.test.ts` passed `18/18`, including publication recovery, DR inventory, pin recovery, historical-plan wording, executable observation gates, Cloud Build least-privilege cleanup, and token-argv safety contracts |
| `pnpm run verify:secret-packages` | PASS | 2026-08-13 20:56 Europe/Warsaw: manifest/source/recovery schema coverage valid; DEV 35 env + 1 file, PROD 28 env + 3 files; 19 named recovery sources cover every member; both environments bind the correct base package for post-cleanup rotations |
| `pnpm run verify:credential-files` | PASS | 2026-08-13 20:56 Europe/Warsaw: credential file guard PASS |
| Documentation format/diff checks | PASS | 2026-08-14 00:35 Europe/Warsaw: repository-wide format phase and post-build checks passed in the complete exact-clean-commit `ci:tracked` run; `git diff --check` PASS |
| `pnpm run typecheck:tests` | PASS | 2026-08-13 20:56 Europe/Warsaw: then-current-tree test typecheck PASS; the later exact-clean-commit Type/Lint phase also passed |
| `pnpm run ci:tracked` | PASS on the scope-cleaned implementation tree; exact pushed-commit checks pending | 2026-08-14 09:38 Europe/Warsaw: exit `0`; Type/Lint, Static Validation, `7986/7986` tests with coverage, Coverage Validation, Web Build & Format, and Post-Build Checks all passed. This run preceded only the evidence-only update to this goal artifact; exact PR checks for the resulting commit remain PENDING. |
| Terraform format | no diff | 2026-08-13 20:57 Europe/Warsaw: `terraform fmt -check -recursive terraform` PASS |
| Terraform validate, retained GCP | PASS | 2026-08-13 20:47 Europe/Warsaw: retained GCP and Hetzner roots validate PASS after publisher metadata IAM and canary-topic changes |
| Terraform plan, retained GCP | reviewed plan, then post-apply exit `0` with no drift | 2026-08-13 20:52 Europe/Warsaw: reviewed additive plan applied the topic and two package-scoped metadata-viewer bindings through a Terraform-managed JIT bootstrap; bootstrap was destroyed, live operator project `secretmanager.admin` count is `0`, and the final full un-targeted plan exited `0` with `0` non-noop changes and `No changes` |
| Terraform validate/plan, Hetzner | PASS and reviewed | 2026-08-13 16:03 Europe/Warsaw: validate PASS; fresh plan with the provisioner identity reviewed as `2 add / 0 change / 1 replace-delete` (`terraform_data.bootstrap_prod` replacement plus additive legacy runtime-key migration guard); deliberately not applied before the package-aware release exists on the server |
| DEV shadow comparison | all members `MATCH` | 2026-08-13 15:52 Europe/Warsaw: dedicated DEV publisher impersonation rebuilt all 35 exact legacy sources plus the external Firebase member; dedicated renderer fetched numeric `v2`; ephemeral HMAC comparison returned `MATCH`; payload is 5,838 bytes with verified server CRC32C. Provider values were preserved as opaque members and were not used as a rollout gate |
| PROD shadow comparison | all members `MATCH` | PENDING |
| Local smoke | PASS | PARTIAL — 2026-08-13: exact `v2` projection and modes PASS; web build PASS and contains replacement—not previous—Firebase key; version projection regression fixed test-first and local `v2 → v1 → v2` transaction PASS. Remaining service smoke is PENDING |
| home-dev smoke | PASS | PARTIAL — exact DEV rendering and restart mechanics exercised, but the rollback attempt left the host active on `v1`; align it to the selected DEV version and repeat the package-consumer smoke |
| code-worker canary | PASS without Secret Manager access | PARTIAL — live isolation assertion passed with no GCP credential environment variable or credential file; full package-projection canary remains PENDING |
| Production canary | PASS | PENDING |
| Production full smoke | PASS | PENDING |
| Version reconciliation | all persisted pins/pointers equal the promoted numeric versions | PENDING |
| Rollback drill | DEV prior/forward and PROD prior/forward each have three PASS samples over 15 minutes with zero unexpected auth/credential/health failures | PENDING — local `v2 → v1 → v2` package transaction passed; the complete home-dev and PROD drills remain PENDING |
| Secret Manager audit | frozen 34-name set, exhaustive pages, zero legacy reads for 72 hours, both positive controls PASS | PENDING — all consumers have not completed cutover; the 72-hour legacy-read `T0` has not begun |
| Firebase usage cutover | both origin smoke matrices PASS; global replacement credential UID count `> 0`; old credential UID count `0` over a closed interval of at least 24 hours evaluated after the 30-minute visibility delay; zero attributable failures | PENDING — live pre-cutover baseline: old credential UID `2` requests, both HTTP `403` to the Generative Language API; replacement credential UID `0`; Firebase `T0` has not begun |
| Runtime SA rotation soak | closed pre-disable interval of at least 24 hours evaluated after the three-hour visibility delay: previous key `0`, replacement key `> 0`, credential failures `0`; then seven days with the old key continuously `DISABLED`, replacement use `> 0`, and failures `0` | PENDING — live pre-cutover baseline: previous key `1138`, replacement key `0`; runtime-SA `T0` has not begun; disabled-key attempts are not observable through this metric |
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
| 2026-08-13 Europe/Warsaw | DEV package publication | DEV `v1` and `v2` published and fetched by numeric version; equal 5,838-byte payloads, server CRC32C verified, HMAC comparison `MATCH`; ephemeral payloads and comparison key removed after verification. Existing provider values were preserved unchanged as opaque package members |
| 2026-08-13 Europe/Warsaw | DEV renderer/rollback | dedicated renderer fetched exact `v2` locally and from home-dev; local projection exercised `v2 → v1 → v2`; `.envrc`, renderer credential, and GitHub PEM verified mode `0600`. home-dev currently remains on `v1`, so its final alignment and complete drill are still required |
| 2026-08-13 Europe/Warsaw | Firebase build cutover proof | local production-mode SPA build passed using DEV `v2`; byte-safe check confirmed replacement key is present and previous key is absent without logging either value |
| 2026-08-13 15:09 Europe/Warsaw | Fresh retained-GCP convergence | `GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev plan -input=false -lock-timeout=60s -detailed-exitcode -out=<ephemeral-plan> -no-color`; the fresh retained-GCP plan exited `0` with `No changes`; ephemeral plan removed. Historical after the canary-topic Terraform change. |
| 2026-08-13 15:09 Europe/Warsaw | Home identity live IAM | Read-only project-IAM query plus exhaustive iteration over every Secret Manager container found exactly `0` Secret Manager bindings for both home identities. `ixos-home-runtime-dev`: only `datastore.user`, `firebaseauth.admin`, `logging.logWriter`, `pubsub.publisher`, plus `storage.objectAdmin` on `intexuraos-whatsapp-media-dev`, `intexuraos-shared-content-dev`, and `intexuraos-images-dev`. `ixos-home-orchestrator-dev`: only repository-level `artifactregistry.reader` |
| 2026-08-13 15:36 Europe/Warsaw | Publisher IAM recovery | Initial all-in-one apply exposed an ordering hazard: WIF/account changes completed, but resource-level Secret Manager bindings failed after the operator's broad role was removed. Recovery used three explicit Terraform plans: one-resource temporary bootstrap, `65` narrow publisher bindings, then bootstrap destruction. No secret, version, or workload resource was deleted. |
| 2026-08-13 15:52 Europe/Warsaw | Publisher/WIF live proof | Both DEV and PROD publisher impersonations returned tokens; the local operator has `0` project bindings for `secretmanager.admin` or project-wide `serviceAccountTokenCreator`; both WIF providers require immutable owner ID `368465`, repository ID `1118959310`, exact repository, and `refs/heads/development`. |
| 2026-08-13 16:17 Europe/Warsaw | Historical retained-GCP convergence and metadata IAM | Full un-targeted refresh plan exited `0` with `No changes`. A separate metadata-only live audit confirmed package metadata and `getIamPolicy` access, no project `secretmanager.admin` for the audited operator/publisher principals, no project-wide Token Creator, the numeric project-prefix condition, and own-package-only publisher readback with no DEV/PROD crossover. No payload was accessed. This evidence predates the canary-topic Terraform change. |
| 2026-08-13 20:52 Europe/Warsaw | Canary topic and publisher metadata IAM convergence | The reviewed plan contained exactly three creates and no change/delete: the no-subscription `intexuraos-runtime-credential-canary-dev` topic plus `roles/secretmanager.viewer` on each publisher's own package. The first apply created the topic and correctly received `403` for both secret-policy writes. Terraform then created one temporary project `secretmanager.admin` bootstrap for `claude-code-dev`, applied exactly the two package-scoped bindings, and destroyed the bootstrap. Live policy checks found DEV only on DEV, PROD only on PROD, and exactly `0` project `secretmanager.admin` bindings for the operator. A final full un-targeted plan exited `0`, reported `0` non-noop changes and `No changes`; all ephemeral plan/output files were removed without touching the protected rollout directory. No payload was accessed. |
| 2026-08-13 16:29 Europe/Warsaw | Historical code verification | `pnpm run ci:tracked` PASS: Type/Lint, Static Validation, `7929/7929` tests, coverage validation, web build, format, and post-build checks; focused package/runtime selection `260/260` and both manifest/credential guards also PASS. This run is preserved as historical evidence but is stale after the later package-transaction and executable-audit revisions and cannot satisfy the final CI gate. |
| 2026-08-13 16:31 Europe/Warsaw | Post-cleanup rotation path | Dedicated DEV publisher fetched exact package `v2`; base-package mode applied one explicit private-file override, validated server CRC32C and exact membership, wrote mode `0600`, and reproduced the reviewed package byte-for-byte. The candidate was moved to Trash; no value was logged. |
| 2026-08-14 00:53 Europe/Warsaw | Git delivery state | Commit `eac2dc198a37ea15228d2cdf08cc4001b2bae238` is pushed on `codex/secret-packages-production`; draft PR `#2454` is `MERGEABLE` and `CLEAN` against `development`. Its exact check rollup is `15` `SUCCESS`, `8` path-filtered `SKIPPED`, `0` failed, and `0` pending. No merge, PROD package publication, or production deployment exists. |
| 2026-08-13 17:55 Europe/Warsaw | Goal artifact verification | File-scoped Prettier write/check and `git diff --check -- docs/plans/2026-08-13-secret-packages-production-goal.md` exited `0`; no repository-wide verification was claimed. |
| 2026-08-13 20:55 Europe/Warsaw | Transaction/recovery verification at capture | The complete focused then-current-tree matrix passed `333/333`: durable schema-v2 publication receipt/reconcile; post-cleanup and lost-container builds; shared DEV writer lock and staged projection consistency; sealed first-cutover legacy rollback; strict PROD membership/ownership/path/timeout checks; full runtime credential canary; exact pin reconciliation; Terraform contracts; and fresh-host bootstrap. Subsequent test-first cases cover incomplete lock-owner inode recovery, live preparation serialization, durable PROD release publication, committed stable-link cleanup, and wrapper recovery after an ambiguous activation attempt. |
| 2026-08-13 21:49 Europe/Warsaw | Historical local code verification | Complete then-current-tree `pnpm run ci:tracked` run `#5` PASS: Type/Lint, Static Validation, `8009` tests with coverage, Coverage Validation, Web Build & Format, and Post-Build Checks. Independent final diff review found no remaining P0/P1 in the DEV/PROD crash-recovery paths. This run predates the final executable-audit revision and current scope cleanup. |
| 2026-08-13 23:08 Europe/Warsaw | Live environment checkpoint | Local projection points to DEV `v2`; no local orchestrator is running. home-dev points to DEV `v1`, has `22/22` PM2 processes online, `19/19` HTTP health checks passing, and an active orchestrator, but its deployed checkout is the older `02018515f75eb02c03a8990861cd938142b96b18` revision. Hetzner remains entirely on the legacy path: no package/projection `current`, `19/19` PM2 processes online, `19/19` health checks passing, public deployment commit `9faf87a17c06359bc29254c73d8b94f1315fa70d`, and no `secretPackageVersion` field. This is availability evidence, not package-cutover evidence. |
| 2026-08-13 23:20 Europe/Warsaw | Ephemeral payload cleanup | A completion audit found two retained mode-`0600` DEV package payloads that contradicted the earlier cleanup claim. Only those two explicitly identified payload files were removed and their absence verified; the protected replacement runtime credential, dedicated home credentials, and Firebase package input remain mode `0600` for the pending rollout. |
| 2026-08-13 23:35 Europe/Warsaw | Quantitative soak readiness | Metadata-only 24-hour Monitoring queries found old runtime-key authentication count `1138`, replacement runtime-key count `0`, old Firebase credential-UID request count `2` (both HTTP `403` Generative Language requests), and replacement Firebase credential-UID count `0`. Therefore no Firebase/runtime/legacy observation `T0` has begun. The runbook requires exhaustive REST pagination and the documented metric/log visibility delays. |
| 2026-08-14 01:00 Europe/Warsaw | Cloud Build service-agent least privilege refresh | IAM v3 still has the same two broad, Terraform-unmanaged project `roles/secretmanager.admin` bindings for `service-544224260556@gcp-sa-cloudbuild.iam.gserviceaccount.com` (etag `BwZY8iQeXcI=`): one unconditional and one expired `cloudbuild-connection-setup` condition. The connection remains `COMPLETE`, enabled, and non-reconciling; metadata-only `fetchGitRefs` passed with `19` branch refs, including exactly one `main` and one `development`. The currently authenticated administrative principal, whose Secret Manager metadata access is limited, was denied `secretmanager.secrets.getIamPolicy` on the exact OAuth-token secret, so no IAM mutation was attempted. Reauthentication and the documented Terraform adopt → plan-zero → exact-two-delete → canary sequence remain mandatory. |
| 2026-08-14 00:55 Europe/Warsaw | Live package refresh | Secret Manager metadata shows exactly DEV versions `v1` and `v2` enabled and `0` enabled PROD package versions. No package payload was accessed and no GCP state was changed. |
| 2026-08-14 00:35 Europe/Warsaw | Exact clean-commit local code verification | On clean commit `eac2dc198a37ea15228d2cdf08cc4001b2bae238`, `pnpm run ci:tracked` exited `0`: Type/Lint PASS (`156.153s`), Static Validation PASS (`21.553s`), `8010/8010` tests with coverage PASS (`574.534s`), Coverage Validation PASS (`1.057s`), Web Build & Format PASS (`19.398s`), and Post-Build Checks PASS (`0.091s`). The exact pushed commit then received `15` successful applicable PR checks, `8` path-filtered skips, and no failures or pending checks. |
| 2026-08-14 09:38 Europe/Warsaw | Scope-cleaned migration verification | Removed provider-health/purchase/login work, general logging/forensics hardening, and App Check from this goal while retaining direct no-GCP code-worker isolation assertions. The exact baseline diff is 110 paths (`27 A`, `83 M`) with sorted-path SHA-256 `ae1503ecfe3ae046fb102881ad11fbc8bf4f28ad7f4e73d922d29caa127ea7c3`. Focused migration tests passed `763/763`; package and credential guards, test typecheck, Terraform format, and both Terraform validates passed; full `ci:tracked` passed Type/Lint, Static Validation, `7986/7986` tests, coverage validation, web build/format, and post-build checks. No Cloudflare token, provider credential, purchase, GCP mutation, merge, or deployment was performed. |
| 2026-08-13 18:48 Europe/Warsaw | home-dev observability projection | Read-only in-memory comparison proved `/etc/intexuraos/grafana-cloud.env` uses the same non-empty Loki token as exact DEV package `v1`; no value or digest was emitted. Render root mode is `0700`; installed projection is `0600 root:root`; `alloy.service` declares the projection as a required `EnvironmentFile`, is `running`, and has main exit status `0`. |

## Production acceptance criteria

- [ ] Exactly two package containers exist for application bundles.
- [ ] Only the two documented native application secrets remain individually injected.
- [ ] Every package and native injection is pinned to a numeric version.
- [ ] No active runtime path calls `versions/latest` or reads an individual application secret.
- [ ] No package payload or service-account private key exists in Git, Terraform state, logs, or
  deployment attestations.
- [ ] Firebase rotation has passed independent DEV and PROD origin smoke matrices, a global
  replacement-UID count `> 0`, an old-UID count `0` over the delayed-evaluation 24-hour interval,
  and zero attributable failures; the previous key is deleted and the repository alert is closed as
  revoked.
- [ ] The Hetzner runtime credential is installed mode `0600`, has no Secret Manager access, passes
  the delayed-evaluation 24-hour pre-disable gate, and the previous key is deleted only after the
  measurable seven-day disabled-state/replacement-use/failure gate.
- [ ] Bootstrap credentials remain outside the packages and have package-specific least privilege.
- [ ] The Cloud Build service agent retains only its managed service-agent role and one
  resource-level `roles/secretmanager.secretAccessor` binding on the active connection-token secret;
  it has zero project-level Secret Manager roles, the connection is `COMPLETE`, and `fetchGitRefs`
  passes after cleanup.
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
