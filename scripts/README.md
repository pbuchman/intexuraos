# Scripts

Build, deployment, and utility scripts.

## sync-secrets.sh

Single entrypoint for local secrets workflow.

```bash
# Run from repository root
./scripts/sync-secrets.sh [environment]

# Examples:
./scripts/sync-secrets.sh                  # sync only (non-interactive)
./scripts/sync-secrets.sh dev              # explicit environment
./scripts/sync-secrets.sh --add-new        # sync + prompt for missing values
./scripts/sync-secrets.sh dev --add-new    # env-specific add-new mode
```

Mode 1: default (non-interactive)

1. Reads Terraform-defined `INTEXURAOS_*` secrets from `terraform/environments/<env>/main.tf`
2. Syncs readable/exportable secrets from GCP Secret Manager into `.envrc`
3. Prints missing/unreadable secrets (no prompts)

Mode 2: `--add-new` (interactive)

1. Runs the same sync flow as default mode
2. Prompts only for missing secret values (no overwrite flow)
3. Re-syncs `.envrc` after successful additions

Prerequisites:

- gcloud CLI installed and authenticated
- Project configured (or provided with `--project-id`)
- Terraform applied (secret resources must exist before adding versions)

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

### verify-deployment.sh

Verifies that deployed Cloud Run services in GCP respond with healthy status codes.

```bash
./scripts/verify-deployment.sh
```

### detect-tf-changes.sh

Detects which app services are affected by Terraform file changes between two git SHAs. Prints affected service names, one per line.

```bash
./scripts/detect-tf-changes.sh [BASE_SHA] [HEAD_SHA]
```

### setup-worker-network.sh

Creates an isolated Docker network for code-worker containers with IP-level restrictions blocking metadata server, localhost, and private IP ranges.

```bash
./scripts/setup-worker-network.sh
```

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

### reset-actions-status.mjs

Resets action documents in Firestore back to `pending` status. Useful for re-testing the action processing flow.

```bash
node scripts/reset-actions-status.mjs                    # Reset all actions
node scripts/reset-actions-status.mjs --dry-run          # Preview without applying
node scripts/reset-actions-status.mjs --type research    # Reset only research actions
node scripts/reset-actions-status.mjs --status awaiting_approval
```

### backfill-research-favourite.mjs

Backfills `favourite: false` on research documents that are missing the field. Requires `FIRESTORE_EMULATOR_HOST` to be set.

### embed-docs.ts

Generates OpenAI embeddings for documentation files and uploads them to Firestore for semantic search.

```bash
OPENAI_API_KEY=xxx pnpm run embed-docs
```

### test-llm-clients.ts

Integration test script that verifies all LLM provider clients (`research`, `generate`, `generateImage`) work correctly with real API keys fetched from user-service.

```bash
npx tsx scripts/test-llm-clients.ts <userId>
```

## Database Scripts

### migrate.mjs

Runs pending Firestore database migrations in order by numeric prefix. Tracks applied migrations in the `_migrations` collection.

```bash
node scripts/migrate.mjs                    # Run pending migrations
node scripts/migrate.mjs --status           # Show applied/pending
node scripts/migrate.mjs --dry-run          # Preview without applying
node scripts/migrate.mjs --project <id>     # Target specific project
```

### generate-firestore-config.mjs

Aggregates Firestore indexes and rules from all migration files and generates `firestore.indexes.json` and `firestore.rules`.

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

### verify-hash-routing.mjs

Verifies that `apps/web` uses `HashRouter` and not `BrowserRouter` (required for GCS static hosting).

### verify-llm-architecture.ts

Verifies LLM client architecture rules: only allowed implementations exist, clients use `usageLogger`, no hardcoded model/provider strings outside `llm-contract`.

### verify-logging.mjs

Verifies that factory functions accepting optional loggers are always called with a logger in `services.ts`.

### verify-migrations.mjs

Verifies migration files follow naming conventions (`NNN_name.mjs`), have sequential IDs, and export required metadata and `up` functions.

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

Installs the git pre-commit hook that blocks modifications to `vitest.config.ts`.

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
