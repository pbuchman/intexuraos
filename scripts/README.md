# Scripts

Build, deployment, and utility scripts.

## build-secret-package.mjs

Builds a complete DEV or PROD candidate in one of two modes: initial migration
from the exact legacy numeric versions declared in the tracked, non-secret
`config/environments/secret-package-sources.json` manifest, or ongoing rotation
from one exact numeric version of the active package plus explicit private
member overrides. It never reads `latest` and never prints source values or
payloads.

```bash
node scripts/build-secret-package.mjs \
  --environment dev --project-id <project-id> \
  --output <mode-0600-candidate> \
  --firebase-api-key-file <mode-0600-file>
```

The PROD command additionally requires its two PROD-only external files:

```bash
node scripts/build-secret-package.mjs \
  --environment prod --project-id <project-id> \
  --output <mode-0600-candidate> \
  --firebase-api-key-file <mode-0600-file> \
  --runtime-gcp-service-account-file <mode-0600-file> \
  --cloudflare-dns-api-token-file <mode-0600-file>
```

Firebase is an external input for both environments. The runtime service-account
JSON and Cloudflare DNS token are external PROD-only inputs; supplying them for
DEV is rejected. The DEV GitHub App PEM comes from exact version `1` of
`INTEXURAOS_GITHUB_APP_PRIVATE_KEY`, while the PROD TLS PEM comes from exact
version `1` of `INTEXURAOS_SSL_PRIVATE_KEY`. All other legacy mappings and their
numeric versions are defined explicitly in the source manifest.

After the first complete package has been promoted, build later rotations from
that package even after legacy containers are removed. Pin the reviewed base
version and pass at least one override as a private file path; repeat either
override option to rotate more members:

```bash
node scripts/build-secret-package.mjs \
  --environment dev --project-id <project-id> \
  --output <mode-0600-candidate> \
  --base-version <numeric-version> \
  --override-env INTEXURAOS_OPENAI_APP_API_KEY=<mode-0600-file> \
  --override-file githubAppPrivateKeyPemBase64=<mode-0600-file>
```

`--override-env` accepts only an exact `envNames` member and
`--override-file` only an exact `files` member from the package manifest. The
builder validates the base package's server CRC32C and complete membership,
applies the named replacements, then validates the complete candidate again.
Base mode rejects `latest`, non-canonical versions such as `01`, duplicate or
unknown members, empty override sets, and all legacy external-input flags.

Every external or override input must be a non-symlink regular file with no
group/other permission bits and at most 64 KiB. The builder verifies source
CRC32C, creates the payload deterministically, runs the complete package
validator, and atomically installs the candidate with mode `0600`. Standard
output contains only validation metadata and counts. Optional
`--manifest <path>` and `--sources-manifest <path>` overrides are intended for
isolated verification and tests.

## secret-package.mjs

The single safe interface for validating, fetching, publishing, rendering, and
shadow-comparing the DEV/PROD package contracts in
`config/environments/secret-packages.json`.

```bash
node scripts/secret-package.mjs validate \
  --environment <dev-or-prod> --payload-file <mode-0600-candidate>
node scripts/secret-package.mjs publish \
  --environment <dev-or-prod> --project-id <project-id> \
  --payload-file <mode-0600-candidate>
node scripts/secret-package.mjs fetch \
  --environment <dev-or-prod> --version <numeric-version> \
  --project-id <project-id> --output <mode-0600-path>
node scripts/secret-package.mjs render \
  --environment <dev-or-prod> --version <numeric-version> \
  --project-id <project-id> --output-dir <private-directory>
node scripts/secret-package.mjs dual-compare \
  --environment <dev-or-prod> --left-payload-file <candidate-a> \
  --right-payload-file <candidate-b> --hmac-key-file <ephemeral-key>
```

`render` may use `--payload-file <already-fetched-file>` for offline validated
rendering. Otherwise it fetches the requested exact version. Never substitute
`latest`. The CLI enforces schema version, environment, exact env/file
membership, string values, base64/PEM/service-account JSON shape, 64 KiB
maximum payload, positive numeric versions, CRC32C, restrictive staging modes,
and atomic promotion. It invokes `gcloud` without logging payload data. Shadow
comparison uses an ephemeral HMAC and emits only package-level
`MATCH`/`MISMATCH`.

Rendering creates an immutable `<env>-v<N>-<crc32c-hex>/` release under the
output directory, then atomically switches `current`. Every release has
`environment.env` and `metadata.json`. DEV also has
`github-app-private-key.pem`; PROD has `cloudflare-dns-api-token`,
`runtime-gcp-service-account.json`, and `tls-private-key.pem`. All files and the
`current` target are implementation artifacts; consumer installers copy only
their allowlisted projection.

Candidates and rendered staging artifacts live outside the repository, use
mode `0600`, and are removed immediately. Terraform owns the containers and IAM
but not versions or values.

Run repository policy verification with the command below. It validates both
tracked manifests and prints names/counts only, never source versions or values.

```bash
pnpm run verify:secret-packages
```

See [Secret Packages Operations](../docs/operations/secret-packages.md) for the
candidate, promotion, rotation, rollback, and evidence procedure.

## sync-secrets.sh

Local/home-dev renderer for one exact DEV package version.

```bash
SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS="${HOME}/.config/intexuraos/secret-renderer-sa-key.json" \
  ./scripts/sync-secrets.sh --version <dev-numeric-version>
```

It merges repository-backed DEV configuration with the validated package
projection, writes an immutable release under
`${HOME}/.config/intexuraos/secret-packages/dev`, atomically switches `current`,
and writes mode-`0600` `.envrc`. It fetches no individual legacy secrets and
has no add-new mode. `.envrc.local` is sourced last for host-only overrides and
must not be used as shared secret storage.
The package `current` link, `.envrc`, and GitHub App PEM are transactional: any
failure after rendering restores the prior set, or removes the new set when no
prior projection existed.

## observability/load-grafana-cloud-env.sh

Builds the home-dev Grafana/Alloy projection without GCP access. It reads only
`INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN` from
`${SECRET_PACKAGE_RENDER_DIR}/current/environment.env`; the default render root
is `${HOME}/.config/intexuraos/secret-packages/dev`. It merges that token with
the tracked Loki URL and username and atomically installs `OUTPUT_FILE` as mode
`0600`. A missing render, token, or tracked value leaves the previous output
untouched.

Under sudo/systemd on home-dev, select the deployment user's render explicitly;
root's `HOME` is not the package owner:

```bash
sudo -n env \
  HOME=/home/pbuchman \
  SECRET_PACKAGE_RENDER_DIR=/home/pbuchman/.config/intexuraos/secret-packages/dev \
  INTEXURAOS_ENVIRONMENT=dev \
  bash scripts/observability/load-grafana-cloud-env.sh
```

Prerequisites:

- `gcloud` installed;
- an explicitly selected operator/renderer identity authorized only for the DEV
  package (`ixos-home-secret-renderer-dev`; home-dev transitional key at
  `/home/pbuchman/.config/intexuraos/secret-renderer-sa-key.json`, mode `0600`,
  selected only for the sync command; local Mac prefers ADC impersonation);
- the Terraform-managed package container/IAM already applied;
- an approved positive numeric version.

## verify-connections.sh

Verification script for Claude Code cloud development setup.

```bash
# Run from repository root
./scripts/verify-connections.sh
```

The script verifies:

1. GitHub/Git connectivity
2. GCP service account configuration
3. Security (gitignore verification)
4. Current branch status

See [docs/setup/10-claude-code-cloud-dev.md](../docs/setup/10-claude-code-cloud-dev.md) for full setup guide.

## CI Scripts

### ci.mjs

Runs the full CI pipeline in phases ordered by failure likelihood. Phases run in parallel within each phase, aborting on first failure for fast feedback.

```bash
pnpm run ci
```

### ci-tracked.mjs

Wrapper around `ci.mjs` that appends failure records to `.claude/ci-failures/{project}-{branch}.jsonl` for LLM learning and pattern recognition.

```bash
pnpm run ci:tracked
```

### ci-capture.sh

Runs `ci:tracked` and saves output to a timestamped file in `/tmp/` with branch-safe naming.

```bash
./scripts/ci-capture.sh
```

### ci-failure-report.mjs

Aggregates CI failure records from `.claude/ci-failures/` and reports patterns. Focuses on first-run failures to identify recurring LLM coding mistakes.

```bash
node scripts/ci-failure-report.mjs              # Full report
node scripts/ci-failure-report.mjs --first-run  # First-run failures only
node scripts/ci-failure-report.mjs --json       # JSON output
node scripts/ci-failure-report.mjs --days 7     # Last 7 days only
```

### ci-health.mjs

Minimal HTTP health server on port 8080. Used by CI infrastructure to verify the environment is responsive.

## Build Scripts

### build-service.mjs

Builds a single app service using esbuild, bundling all `@intexuraos/*` workspace packages and externalizing third-party dependencies.

```bash
node scripts/build-service.mjs <service-name>
```

### build-all-services.mjs

Builds a predefined set of Cloud Run services by invoking `build-service.mjs` in sequence.

```bash
node scripts/build-all-services.mjs
```

### build-worker-image.sh

Builds and pushes the code-worker Docker image to Artifact Registry.

```bash
./scripts/build-worker-image.sh [image-tag]
```

### push-missing-images.sh

Detects services with Dockerfiles, checks which images are missing from Artifact Registry, and builds and pushes the missing ones.

```bash
./scripts/push-missing-images.sh
```

## Deployment Scripts

### deploy-workers.sh

Deploys Cloud Function workers to GCS. Builds the worker, generates a production `package.json`, creates `function.zip`, and uploads to the GCS functions source bucket.

```bash
./scripts/deploy-workers.sh                  # Interactive: choose workers
./scripts/deploy-workers.sh vm-lifecycle     # Deploy specific worker
./scripts/deploy-workers.sh --all            # Deploy all workers
```

### setup-worker-network.sh

Creates and validates the dual-stack Docker network for code-worker containers. Existing
networks that do not match the required IPv4, IPv6, fixed Linux bridge name, and masquerade
contract are rejected without modification.

```bash
./scripts/setup-worker-network.sh
```

### Artifact Registry Cleanup Tools

Safe inventory and prune tooling for `intexuraos-dev` lives under `scripts/artifact-registry/`.

```bash
node scripts/artifact-registry/export-live-images.mjs ...
node scripts/artifact-registry/generate-prune-plan.mjs ...
node scripts/artifact-registry/apply-prune-plan.mjs ...
```

See [docs/operations/artifact-registry-cleanup.md](../docs/operations/artifact-registry-cleanup.md) for the full runbook.

## Development Scripts

### dev-setup.mjs

Starts Docker emulators and validates the development environment. Does not sync data from GCP.

```bash
pnpm run dev:setup
```

### pm2-wait-start.mjs

Polls a health URL before starting a service's entry point. Used by PM2-managed services that depend on `app-settings-service` being available at startup.

### pubsub-publish-test.mjs

Publishes test events to local Pub/Sub for development and debugging. Supports all event types used across the system.

```bash
node scripts/pubsub-publish-test.mjs [event-type]
```

### backfill-research-favourite.mjs

Backfills `favourite: false` on research documents that are missing the field. Requires `FIRESTORE_EMULATOR_HOST` to be set.

### test-llm-clients.ts

Integration test script that verifies all LLM provider clients (`research`, `generate`, `generateImage`) work correctly with real API keys fetched from user-service.

```bash
npx tsx scripts/test-llm-clients.ts <userId>
```

## Database Scripts

### migrate.mjs

Runs pending Firestore database migrations in order by numeric prefix. Tracks applied migrations in the `_migrations` collection. Also supports regenerating the tracked Firestore artifacts without deploying.

```bash
node scripts/migrate.mjs                    # Run pending migrations
node scripts/migrate.mjs --status           # Show applied/pending
node scripts/migrate.mjs --dry-run          # Preview without applying
node scripts/migrate.mjs --project <id>     # Target specific project
node scripts/migrate.mjs --write-artifacts-only
```

### generate-firestore-config.mjs

Aggregates Firestore indexes and rules from all migration files and writes the tracked `firestore.indexes.json` and `firestore.rules` artifacts. This is equivalent to `node scripts/migrate.mjs --write-artifacts-only`.

```bash
node scripts/generate-firestore-config.mjs
```

### migrate-v8-ignore.mjs

One-time migration script that converts legacy inline `v8 ignore` comments to the current start/stop format.

## Parallel Execution Scripts

### typecheck-parallel.mjs

Runs `tsc --noEmit` in parallel across all workspaces that have a typecheck script. Significantly faster than sequential execution.

```bash
pnpm run typecheck
```

### lint-parallel.mjs

Runs ESLint in batches of 4 workspaces at a time to prevent OOM crashes with `strictTypeChecked` config.

```bash
pnpm run lint
```

## Verification Scripts (CI)

These scripts run as part of `pnpm run ci` Static Validation phase.

### verify-boundaries.mjs

Verifies that the ESLint `boundaries` plugin is loaded and package import boundary rules are correctly enforced. Uses positive and negative test cases.

### verify-common.mjs

Verifies that `packages/common-core` contains only cross-cutting utilities and has not accumulated domain-specific logic.

### verify-date-formatting.mjs

Verifies that date formatting in `apps/web` uses the centralized utility from `@/utils/dateFormat` rather than scattered local implementations.

### verify-env-vars.mjs

Verifies that all `process.env` usages in apps are declared in `REQUIRED_ENV` and registered in `ecosystem.config.cjs`.

### verify-error-serializers.mjs

Verifies that all logger configurations include error serializers to prevent `{ error: {} }` in structured logs.

### verify-firestore-ownership.mjs

Verifies that each Firestore collection is only accessed by its owning service, as registered in `firestore-collections.json`.

### verify-firestore-artifacts.mjs

Verifies that committed `firestore.indexes.json` and `firestore.rules` still match the current migration aggregation.

### verify-hash-routing.mjs

Verifies that `apps/web` uses complete declarative or data hash-router wiring and no browser-history
router (required for GCS static hosting).

### verify-llm-architecture.ts

Verifies LLM client architecture rules: only allowed implementations exist, clients use `usageLogger`, no hardcoded model/provider strings outside `llm-contract`.

### verify-logging.mjs

Verifies that factory functions accepting optional loggers are always called with a logger in `services.ts`.

### verify-migrations.mjs

Verifies migration files follow naming conventions (`NNN_name.mjs`), have sequential IDs, export required metadata and `up` functions, and match the tracked `migrations/manifest.json` checksums.

### verify-no-console.mjs

Verifies that `eslint-disable` comments are not used to bypass the `no-console` rule in non-exempt paths.

### verify-package-json.mjs

Verifies that `package.json` does not contain truncation artifacts (`...`) from LLM-generated edits.

### verify-pattern-suppression.mjs

Verifies that all `@allow-*` suppression comments include a reason after `--`.

### verify-prompt-versions.mjs

Verifies that all `PromptBuilder` objects have a valid semver `version` field and that versions are bumped when prompt content changes.

### verify-pubsub.mjs

Verifies that all Pub/Sub publishers extend `BasePubSubPublisher`.

### verify-reply-send.mjs

Verifies that all HTTP responses use `reply.ok()` or `reply.fail()` instead of raw `reply.send()` or direct object returns.

### verify-required-endpoints.mjs

Verifies that all apps expose `/openapi.json`, `/health`, and `/docs` endpoints.

### verify-sentry-logging.mjs

Verifies that all loggers in apps are created via `createAppLogger()` from `@intexuraos/infra-sentry` rather than direct `pino()` calls.

### verify-terraform-secrets.mjs

Scans Terraform files for hardcoded secrets (API keys, tokens, private keys).

### verify-test-isolation.mjs

Verifies that tests use in-memory fakes and do not make external network calls, require Docker, or connect to real emulators.

### verify-test-stdout.mjs

Verifies that test output contains only vitest-expected lines, detecting accidental `console.log` or non-silent logger usage in tests.

### verify-v8-ignore.mjs

Verifies that all `v8 ignore` comments use a valid category from the canonical list and include a reason.

### verify-vitest-config.mjs

Verifies that coverage thresholds in `vitest.config.ts` remain at 95% and the exclusion list has not grown.

### verify-workspace-deps.mjs

Verifies that all `@intexuraos/*` imports in apps and packages are declared in their `package.json` dependencies, preventing Docker build failures.

## Workspace Verification Scripts

### verify-workspace.sh

Runs targeted verification (typecheck, lint, tests + coverage) for a single workspace.

```bash
./scripts/verify-workspace.sh <workspace-name>
# Example: ./scripts/verify-workspace.sh research-agent
```

### verify-workspace-tracked.mjs

Wrapper around `verify-workspace.sh` that tracks failures to `.claude/ci-failures/` for LLM learning.

```bash
pnpm run verify:workspace:tracked -- <workspace-name>
```

## Utility Scripts

### install-hooks.mjs

Installs:

- a `pre-commit` hook that blocks modifications to `vitest.config.ts`
- a `pre-push` hook that runs `pnpm verify:migrations` and `pnpm verify:firestore-artifacts`

```bash
node scripts/install-hooks.mjs
```

### show-low-coverage.mjs

Reads `coverage/coverage-summary.json` and prints files with the lowest coverage percentages.

```bash
node scripts/show-low-coverage.mjs
```

### import-issues.sh

Imports GitHub issues from `scripts/github-issues.yaml` using the `gh` CLI.

```bash
./scripts/import-issues.sh
./scripts/import-issues.sh --dry-run
```
