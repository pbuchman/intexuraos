# INT-1536 — Infrastructure & Env-Var Management Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** [INT-1536](https://linear.app/pbuchman/issue/INT-1536)
**Parent:** INT-1473 (System Refactoring)
**Evidence:** `docs/reviews/2026-04-24-refactoring-analysis.md` §8
**Priority:** High

**Goal:** Collapse the three-location env-var contract and 21× infrastructure copy-paste into single sources of truth, backed by CI enforcement, so drift becomes impossible.

**Architecture:** The refactor is decomposed into **7 fully parallelisable subtasks**, each scoped to a distinct file surface (scripts, terraform, docker/cloudbuild, single service code, root package.json, web app manifest, docs). No subtask imports the output of another — they share only well-defined on-disk contracts (JSON manifests, Terraform locals, JS regexes) documented in the "Contracts" section below. Seven parallel agents can run simultaneously with zero coordination overhead.

**Tech Stack:** Node 22, pnpm 10, Terraform, Cloud Build YAML, GitHub Actions, Fastify, PM2, Corepack, Google Cloud Run / Secret Manager.

---

## Endpoint Changes

None. This is an infrastructure-only refactor — no HTTP routes, Pub/Sub topics, or Firestore collections are added, removed, or modified.

## Complete File Inventory

| Subtask                                | Created                                                                                                                             | Modified                                                                                                                                                                                                                          | Deleted                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A. Web service manifest                | `apps/web/service-manifest.json`, `scripts/verify-web-service-manifest.mjs`                                                         | `apps/web/cloudbuild.yaml`, `.github/workflows/deploy.yml`, `scripts/ci-tracked.mjs`                                                                                                                                              | —                                                                                       |
| B. CI enforcement scripts              | `scripts/verify-terraform-env-consumers.mjs`, `scripts/verify-ecosystem-coverage.mjs`, `scripts/verify-terraform-secret-mounts.mjs` | `scripts/verify-env-vars.mjs`, `scripts/ci-tracked.mjs`                                                                                                                                                                           | —                                                                                       |
| C. api-docs-hub env validation         | —                                                                                                                                   | `apps/api-docs-hub/src/index.ts`, `ecosystem.config.cjs`, `scripts/verify-required-endpoints.mjs` (if applicable)                                                                                                                 | —                                                                                       |
| D. pnpm pin + Dockerfile consolidation | `docker/Dockerfile.service`, `cloudbuild/scripts/deploy-service.sh`                                                                 | `package.json` (packageManager), all `apps/<svc>/Dockerfile` (21), all `cloudbuild/scripts/deploy-<svc>.sh` (21), `apps/web/cloudbuild.yaml` (pnpm line), `docker/code-worker/Dockerfile`, `docker/code-worker/Dockerfile.test` | — (optional: remove per-service dockerfiles once shared one is proven; keep as stage 2) |
| E. Terraform dev split                 | `terraform/environments/dev/services.tf`, `secrets.tf`, `iam.tf`, `pubsub.tf`, `locals.tf`                                          | `terraform/environments/dev/main.tf` (shrunk to providers + module glue)                                                                                                                                                          | —                                                                                       |
| F. Orphan cleanup                      | —                                                                                                                                   | `terraform/environments/dev/main.tf` (remove 8 orphan secrets, dead `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`), `ecosystem.config.cjs` (dead env var)                                                                               | —                                                                                       |
| G. Prod environment decision           | Either: `terraform/environments/prod/**`, OR: —                                                                                     | `.claude/CLAUDE.md`, `.claude/reference/infrastructure.md`, `.claude/reference/environments.md`                                                                                                                                   | —                                                                                       |

## Contracts Between Subtasks (No Runtime Dependencies)

Subtasks communicate through on-disk file contracts, not code imports. Each contract is frozen before any subtask begins.

### Contract 1 — `apps/web/service-manifest.json` (owner: Subtask A)

```json
{
  "$schema": "./service-manifest.schema.json",
  "description": "Single source of truth for Cloud Run services whose URLs are injected into the web bundle at build time. Consumed by apps/web/cloudbuild.yaml and .github/workflows/deploy.yml.",
  "services": [
    { "name": "user-service",                 "envSuffix": "USER_SERVICE" },
    { "name": "whatsapp-service",             "envSuffix": "WHATSAPP_SERVICE" },
    { "name": "notion-service",               "envSuffix": "NOTION_SERVICE" },
    { "name": "mobile-notifications-service", "envSuffix": "MOBILE_NOTIFICATIONS_SERVICE" },
    { "name": "research-agent",               "envSuffix": "RESEARCH_AGENT" },
    { "name": "commands-agent",               "envSuffix": "COMMANDS_AGENT" },
    { "name": "actions-agent",                "envSuffix": "ACTIONS_AGENT" },
    { "name": "notes-agent",                  "envSuffix": "NOTES_AGENT" },
    { "name": "todos-agent",                  "envSuffix": "TODOS_AGENT" },
    { "name": "bookmarks-agent",              "envSuffix": "BOOKMARKS_AGENT" },
    { "name": "calendar-agent",               "envSuffix": "CALENDAR_AGENT" },
    { "name": "chat-agent",                   "envSuffix": "CHAT_AGENT" },
    { "name": "linear-agent",                 "envSuffix": "LINEAR_AGENT" },
    { "name": "code-agent",                   "envSuffix": "CODE_AGENT" },
    { "name": "image-service",                "envSuffix": "IMAGE_SERVICE" },
    { "name": "web-agent",                    "envSuffix": "WEB_AGENT" },
    { "name": "app-settings-service",         "envSuffix": "APP_SETTINGS_SERVICE" },
    { "name": "cron-agent",                   "envSuffix": "CRON_AGENT" },
    { "name": "hellscript-agent",             "envSuffix": "HELLSCRIPT_AGENT" },
    { "name": "llm-usage-service",            "envSuffix": "LLM_USAGE_SERVICE" }
  ]
}
```

**Consumers:** `apps/web/cloudbuild.yaml` (reads via `jq -r '.services[] | "\(.name):\(.envSuffix)"'`), `.github/workflows/deploy.yml` (both `monolith` and `individual` branches — same jq read), `apps/web/src/config.ts` (only if the file already enumerates suffixes — no new coupling).

**Enforcement:** `scripts/verify-web-service-manifest.mjs` fails CI when (a) a manifest entry has no corresponding Terraform `module "<name>"` in `terraform/environments/dev/`, (b) `cloudbuild.yaml` still contains a literal `CLOUD_RUN_SERVICES=(` array (must be replaced with `jq`), (c) `deploy.yml` contains a literal `CLOUD_RUN_SERVICES=(` array.

### Contract 2 — Terraform `local.services` shape (owner: Subtask E)

After the split, `terraform/environments/dev/locals.tf` exposes:

```hcl
locals {
  services = {
    user-service = {
      port             = 8080
      memory           = "512Mi"
      service_account  = google_service_account.user_service.email
      secret_refs      = ["INTEXURAOS_AUTH0_MGMT_CLIENT_SECRET", ...]
      extra_env_vars   = { INTEXURAOS_AUTH0_DOMAIN = var.auth0_domain, ... }
    }
    # ... one entry per Cloud Run service
  }
}
```

**Consumers:** `services.tf` iterates `local.services` with `for_each` to instantiate the `cloud-run-service` module. No other subtask reads this.

**Enforcement:** Subtask B's `verify-terraform-env-consumers.mjs` and `verify-ecosystem-coverage.mjs` parse Terraform `.tf` files with `hcl2-parser` (or regex fallback); they must recognise both the old inline `module "<svc>" { ... env_vars = {...} }` syntax and the new `for_each = local.services` syntax. Both scripts ship with fixture tests covering both shapes.

### Contract 3 — Shared Dockerfile + deploy script contract (owner: Subtask D)

`docker/Dockerfile.service` accepts exactly one build arg:

```Dockerfile
ARG SERVICE
# Service pkg name is derived: @intexuraos/${SERVICE}
RUN pnpm run --filter @intexuraos/${SERVICE} build
# ...
CMD ["node", "apps/${SERVICE}/dist/index.js"]
```

`cloudbuild/scripts/deploy-service.sh` reads `$SERVICE` from env, invokes the shared Dockerfile with `--build-arg SERVICE=$SERVICE`.

**Consumers:** Cloud Build triggers (`cloudbuild/*.yaml`) that currently call `bash cloudbuild/scripts/deploy-<svc>.sh` are updated to call `SERVICE=<svc> bash cloudbuild/scripts/deploy-service.sh`. Per-service `apps/<svc>/Dockerfile` files are reduced to a 3-line stub that `FROM` the shared one (or deleted outright if Cloud Build allows `--file docker/Dockerfile.service`).

**Out-of-scope:** `docker/code-worker/Dockerfile` keeps its own file (VM image, non-trivially different — 141 lines). Only the pnpm line is updated.

### Contract 4 — Root `packageManager` field (owner: Subtask D, gate for all Dockerfiles)

```json
{
  "packageManager": "pnpm@10.15.0"
}
```

(Exact patch version pulled from current `pnpm -v` in repo root.) Once this is set, every Dockerfile line that says `corepack prepare pnpm@10 --activate` becomes `corepack enable` (Corepack reads `packageManager` automatically). `apps/web/cloudbuild.yaml:83` (`npm install -g pnpm@9`) becomes `corepack enable && corepack prepare --activate` (no explicit version).

### Contract 5 — api-docs-hub env validation (owner: Subtask C)

`apps/api-docs-hub/src/index.ts` must (a) declare `REQUIRED_ENV: readonly string[]`, (b) call `validateRequiredEnv(REQUIRED_ENV, logger)` before `fastify.listen(...)`. Subtask B's `verify-ecosystem-coverage.mjs` will additionally fail CI if any app under `apps/` is missing the `validateRequiredEnv(` call — generalising beyond api-docs-hub.

---

## Subtasks (each a DIRECT child of INT-1536)

Each subtask below is shippable independently. All 7 run in parallel. No dependencies between them — the contracts above are the only coupling.

### Subtask A — Web Service Manifest Single Source
**Owner agent:** 1 agent, service boundary: `apps/web` + `scripts/`
**Issue title:** `[INT-1536] Web service manifest — single-source CLOUD_RUN_SERVICES`
**Files:**
- Create: `apps/web/service-manifest.json` (Contract 1)
- Create: `scripts/verify-web-service-manifest.mjs`
- Modify: `apps/web/cloudbuild.yaml` (lines 14-35 → `jq` read; line 83 pnpm pin — see Subtask D coordination note)
- Modify: `.github/workflows/deploy.yml` (lines 188-212, 372-396)
- Modify: `scripts/ci-tracked.mjs` (add new verify script)

**Steps:**
- [ ] Write failing fixture test `scripts/__tests__/verify-web-service-manifest.test.mjs` asserting: manifest must list all 20 Cloud Run services, and `cloudbuild.yaml` must not contain `CLOUD_RUN_SERVICES=(`.
- [ ] Run test — expect FAIL ("CLOUD_RUN_SERVICES=( found").
- [ ] Create `apps/web/service-manifest.json` with the exact 20-entry array from Contract 1.
- [ ] Rewrite `apps/web/cloudbuild.yaml` `fetch-config` step to read the manifest: `mapfile -t CLOUD_RUN_SERVICES < <(jq -r '.services[] | "\(.name):\(.envSuffix)"' apps/web/service-manifest.json)`. Cloud Build container already has `jq` on `gcr.io/google.com/cloudsdktool/cloud-sdk`; if not, `apt-get install -y jq`.
- [ ] Rewrite both `deploy.yml` branches (monolith line 188, individual line 372) identically.
- [ ] Implement `scripts/verify-web-service-manifest.mjs`: parses JSON, greps cloudbuild.yaml / deploy.yml, fails on literal array.
- [ ] Add `node scripts/verify-web-service-manifest.mjs` to `scripts/ci-tracked.mjs` run list.
- [ ] Run `pnpm run ci:tracked` — expect PASS.
- [ ] Commit `feat(web): single-source CLOUD_RUN_SERVICES via service-manifest.json`.

**Acceptance:** CI fails on a PR that adds a new service to cloudbuild.yaml without adding it to manifest.

---

### Subtask B — CI Enforcement Scripts
**Owner agent:** 1 agent, service boundary: `scripts/`
**Issue title:** `[INT-1536] CI — enforce Terraform↔code↔ecosystem parity`
**Files:**
- Create: `scripts/verify-terraform-env-consumers.mjs`
- Create: `scripts/verify-ecosystem-coverage.mjs`
- Create: `scripts/verify-terraform-secret-mounts.mjs`
- Create: `scripts/__tests__/verify-terraform-env-consumers.test.mjs`
- Create: `scripts/__tests__/verify-ecosystem-coverage.test.mjs`
- Create: `scripts/__tests__/verify-terraform-secret-mounts.test.mjs`
- Modify: `scripts/verify-env-vars.mjs` (optional: re-export helpers if shared)
- Modify: `scripts/ci-tracked.mjs` (add 3 new scripts)

**Steps (apply once per script — example for Script 1):**
- [ ] Write failing test `verify-terraform-env-consumers.test.mjs`: given a fixture `main.tf` with `INTEXURAOS_FOO_URL = "bar"` and no consumer under `apps/*/src/`, script must exit 1.
- [ ] Run — expect FAIL ("script not found").
- [ ] Implement `verify-terraform-env-consumers.mjs`:
  - Walk every `.tf` file under `terraform/environments/dev/`.
  - Extract right-hand side keys of every `env_vars = { ... }` block (regex on `(\s+INTEXURAOS_[A-Z0-9_]+)\s*=`). Also support the Terraform `for_each = local.services` shape by parsing `locals.tf`.
  - For each `INTEXURAOS_*` name: `rg -l "\\b${name}\\b" apps/*/src/ workers/*/src/`. If no match AND not in `KNOWN_UNCONSUMED` allowlist (empty by default), fail with filename + var.
- [ ] Repeat for Script 2 (`verify-ecosystem-coverage.mjs`): every directory under `apps/` with a Terraform `module "<name>"` must appear in `ecosystem.config.cjs` `apps:` array. Also assert every app `src/index.ts` calls `validateRequiredEnv(`.
- [ ] Repeat for Script 3 (`verify-terraform-secret-mounts.mjs`): every `google_secret_manager_secret.<foo>` resource must be referenced in at least one `secrets = { ... }` block of a `module "cloud-run-service"` instantiation. Allowlist supports `// verify-terraform-secret-mounts:ignore = reason` comments for bootstrap secrets.
- [ ] Add all three to `scripts/ci-tracked.mjs`.
- [ ] Run `pnpm run ci:tracked` — expect initial output to report existing drift (dead `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`, 8 orphan secrets, missing `api-docs-hub` in ecosystem, missing `validateRequiredEnv` in api-docs-hub). **Do not fix these in this subtask** — that is owned by Subtasks C + F + G. Instead, add each to a `KNOWN_VIOLATIONS` file `scripts/__fixtures__/known-drift.json` with a TODO-issue link; CI still fails when a NEW violation is introduced.
- [ ] Commit `feat(ci): enforce Terraform↔code↔ecosystem↔Secret Manager parity`.

**Acceptance:** Adding a Cloud Run service without updating `ecosystem.config.cjs` fails CI. Declaring a `google_secret_manager_secret` with no `secrets={}` consumer fails CI.

---

### Subtask C — api-docs-hub Env Validation + ecosystem registration
**Owner agent:** 1 agent, service boundary: `apps/api-docs-hub`
**Issue title:** `[INT-1536] api-docs-hub — add validateRequiredEnv + ecosystem entry`
**Files:**
- Modify: `apps/api-docs-hub/src/index.ts`
- Modify: `ecosystem.config.cjs` (add api-docs-hub entry)

**Steps:**
- [ ] Read `apps/user-service/src/index.ts` as reference pattern. Note the shape of `REQUIRED_ENV: readonly string[]` and the `validateRequiredEnv(REQUIRED_ENV, logger)` call before `app.listen(...)`.
- [ ] Read `apps/api-docs-hub/src/index.ts`. Enumerate every `process.env.INTEXURAOS_*` read (and shared library reads via tracing). Declare `REQUIRED_ENV` accordingly.
- [ ] Write failing test `apps/api-docs-hub/src/__tests__/env-validation.test.ts`: starts the app without a required var, expects a thrown error containing the var name.
- [ ] Run — expect FAIL.
- [ ] Add `validateRequiredEnv(REQUIRED_ENV, logger)` before `app.listen(...)`. Import from `@intexuraos/common-core`.
- [ ] Run — expect PASS.
- [ ] Add `api-docs-hub` entry to `ecosystem.config.cjs` `apps:` array, mirroring `apps/user-service` entry with api-docs-hub-specific env vars.
- [ ] Verify with `pnpm run verify:workspace:tracked -- api-docs-hub`.
- [ ] Commit `fix(api-docs-hub): add validateRequiredEnv and ecosystem entry`.

**Acceptance:** Starting api-docs-hub without a required env var fails fast with a clear error.

---

### Subtask D — pnpm Pin + Shared Dockerfile / Deploy Script
**Owner agent:** 1 agent, service boundary: `docker/`, `cloudbuild/scripts/`, `package.json`, `apps/*/Dockerfile`, `workers/*/Dockerfile`
**Issue title:** `[INT-1536] Pin pnpm, consolidate Dockerfiles and deploy scripts`
**Files:**
- Create: `docker/Dockerfile.service` (shared, parameterised by `ARG SERVICE`)
- Create: `cloudbuild/scripts/deploy-service.sh` (shared, parameterised by `$SERVICE`)
- Modify: `package.json` (add `"packageManager": "pnpm@<EXACT-VERSION>"`)
- Modify: all 21 `apps/<svc>/Dockerfile` (collapse to `FROM` stub OR delete and reference shared file in Cloud Build trigger)
- Modify: all 21 `cloudbuild/scripts/deploy-<svc>.sh` (collapse to 3-line wrapper `exec bash cloudbuild/scripts/deploy-service.sh`)
- Modify: `apps/web/cloudbuild.yaml` line 83 (`npm install -g pnpm@9` → `corepack enable && corepack prepare --activate`)
- Modify: `docker/code-worker/Dockerfile`, `docker/code-worker/Dockerfile.test` (line 51 / 31: `pnpm@latest` → `corepack enable`)

**Steps:**
- [ ] Run `pnpm -v` at repo root — record exact version (e.g., `10.15.0`).
- [ ] Add `"packageManager": "pnpm@10.15.0"` to `package.json`.
- [ ] Create `docker/Dockerfile.service` using `apps/user-service/Dockerfile` as template; replace every `@intexuraos/user-service` with `@intexuraos/${SERVICE}` and every `apps/user-service/` path with `apps/${SERVICE}/`. Replace `corepack prepare pnpm@10 --activate` with `corepack enable` (Corepack reads `packageManager` from root `package.json`).
- [ ] Create `cloudbuild/scripts/deploy-service.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  : "${SERVICE:?SERVICE env var required}"
  source "$(dirname "$0")/lib.sh"
  deploy_cloud_run_service "$SERVICE"  # extract existing logic from deploy-user-service.sh into lib.sh
  ```
- [ ] Extract shared logic from 21 deploy scripts into `cloudbuild/scripts/lib.sh` as `deploy_cloud_run_service()`.
- [ ] Rewrite each `cloudbuild/scripts/deploy-<svc>.sh` to a 3-line wrapper: `#!/usr/bin/env bash\nSERVICE=<svc> exec "$(dirname "$0")/deploy-service.sh"`.
- [ ] For Dockerfiles: either (preferred) update Cloud Build triggers to use `docker/Dockerfile.service` with `--build-arg SERVICE=<svc>` and delete per-service Dockerfiles, OR (safer stage-1) rewrite each `apps/<svc>/Dockerfile` to a 2-line stub: `FROM docker/Dockerfile.service AS build\n# SERVICE=<svc> baked at build time`. Pick the safer stage-1 first; stage-2 deletion is a follow-up PR.
- [ ] Update `apps/web/cloudbuild.yaml` line 83 to `corepack enable && corepack prepare --activate`.
- [ ] Update `docker/code-worker/Dockerfile` line 51 and `Dockerfile.test` line 31 to `corepack enable`.
- [ ] Run `pnpm run ci:tracked` — expect PASS.
- [ ] Spot-check: `docker build --build-arg SERVICE=user-service -f docker/Dockerfile.service .` — expect successful build. Same for `research-agent`.
- [ ] Commit `refactor(docker): pin pnpm via packageManager, share Dockerfile and deploy script`.

**Acceptance:** Changing pnpm version requires editing exactly one line (`package.json` `packageManager`). Adding a new service requires zero new Dockerfiles or deploy scripts — only a Cloud Build trigger referencing `SERVICE=<new>`.

---

### Subtask E — Terraform dev Monolith Split
**Owner agent:** 1 agent, service boundary: `terraform/environments/dev/`
**Issue title:** `[INT-1536] Terraform — split dev/main.tf into focused files`
**Files:**
- Create: `terraform/environments/dev/locals.tf` (Contract 2 — `local.services` map)
- Create: `terraform/environments/dev/services.tf` (Cloud Run module instantiations via `for_each = local.services`)
- Create: `terraform/environments/dev/secrets.tf` (all `google_secret_manager_secret` + `_version` + `_iam_member`)
- Create: `terraform/environments/dev/iam.tf` (service accounts + role bindings)
- Create: `terraform/environments/dev/pubsub.tf` (topics + subscriptions; merge existing `pubsub_pr_triage.tf`)
- Modify: `terraform/environments/dev/main.tf` (shrink to provider + backend glue only)

**Steps:**
- [ ] Run `terraform init && terraform plan -out=/tmp/tf-before.plan` in `terraform/environments/dev/`. Save full output to `/tmp/tf-before.txt`.
- [ ] Enumerate every top-level block in `main.tf` and decide its destination file. Record mapping in a scratch note.
- [ ] Move blocks one file at a time: `secrets.tf` first (least-coupled), then `iam.tf`, then `pubsub.tf` (merge `pubsub_pr_triage.tf`), then `locals.tf` (build `local.services` map from the 21 existing `module "<svc>"` blocks), then `services.tf` (single `module "cloud_run_services" { for_each = local.services ... source = "../../modules/cloud-run-service" ... }`).
- [ ] After each move, run `terraform plan` — expect **zero resource changes**. Commit each file-move as its own commit (`refactor(tf): move secrets to secrets.tf — no plan changes`).
- [ ] After all moves, `main.tf` should contain only the `provider "google"`, `provider "google-beta"`, and backend config.
- [ ] Final `terraform plan` must show `No changes. Your infrastructure matches the configuration.`
- [ ] Run `pnpm run ci:tracked` — expect PASS (incl. Subtask B's `verify-terraform-env-consumers.mjs` which must now recognise the `for_each` shape — verify Subtask B's fixture test covers this, else file a follow-up ticket).
- [ ] Commit `refactor(tf): drive Cloud Run services from local.services map`.

**Acceptance:** `terraform plan` says "No changes". `wc -l terraform/environments/dev/main.tf` is under 100. Adding a new Cloud Run service is a 10-line entry in `locals.tf`.

---

### Subtask F — Orphan Resource Cleanup
**Owner agent:** 1 agent, service boundary: `terraform/environments/dev/` + `ecosystem.config.cjs`
**Issue title:** `[INT-1536] Remove orphan secrets + dead env vars`
**Files:**
- Modify: `terraform/environments/dev/main.tf` (or `secrets.tf` / `services.tf` after Subtask E lands — coordinate via rebase)
- Modify: `ecosystem.config.cjs` (remove dead `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` if present)

**Targets (from `docs/reviews/2026-04-24-refactoring-analysis.md` §8):**
1. 8 orphan `google_secret_manager_secret` resources (IDs listed at `main.tf:520-531` in current HEAD — re-locate by running Subtask B's `verify-terraform-secret-mounts.mjs`).
2. Dead `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` (grep Terraform for the assignment; confirm with `rg INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC apps/ workers/ packages/` — zero consumers expected).

**Steps:**
- [ ] Run `scripts/verify-terraform-secret-mounts.mjs` (from Subtask B) to produce the current list of orphans. If Subtask B hasn't merged yet, grep manually: every `google_secret_manager_secret.<id>` whose id is not referenced in any `secrets = { ... }` block.
- [ ] For each orphan: determine intent. Three possible resolutions:
  - (a) **Intended consumer missing** (e.g., `code-agent` mount forgotten) → wire it into the appropriate service `secrets = {...}` block. Prefer this when a consumer exists in code.
  - (b) **Genuinely dead** → delete the `google_secret_manager_secret`, `google_secret_manager_secret_version`, and any `_iam_member` resources referencing it. Document in commit body.
  - (c) **Bootstrap secret consumed outside Cloud Run** (e.g., by Cloud Build, GH Actions) → add `// verify-terraform-secret-mounts:ignore = consumed by GitHub Actions workflow X` comment.
- [ ] Remove `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` from Terraform + `ecosystem.config.cjs`.
- [ ] `terraform plan` — expect N resource destroys matching the removed secrets, ZERO additions/modifications for unrelated resources.
- [ ] Remove corresponding entries from Subtask B's `KNOWN_VIOLATIONS` allowlist (they're fixed now).
- [ ] Run `pnpm run ci:tracked` — expect PASS.
- [ ] Commit with full list of removed/wired secrets in body: `fix(tf): remove 8 orphan Secret Manager secrets, wire code-agent mounts`.

**Acceptance:** `verify-terraform-secret-mounts.mjs` passes with empty `KNOWN_VIOLATIONS`. No `terraform plan` diff after merge.

---

### Subtask G — Prod Environment Decision + Doc Reconciliation
**Owner agent:** 1 agent, service boundary: `terraform/environments/prod/` OR `docs/` + `.claude/reference/`
**Issue title:** `[INT-1536] Prod environment — decide + reconcile docs`
**Files (Option 1 — create prod):**
- Create: `terraform/environments/prod/main.tf`, `backend.tf`, `terraform.tfvars.example`, etc. — mirror dev after Subtask E.
**Files (Option 2 — document single-project reality):**
- Modify: `.claude/CLAUDE.md` (remove the "prod=Cloud Run" line — it currently claims a separate prod tier)
- Modify: `.claude/reference/infrastructure.md` (state `intexuraos-dev-pbuchman` is authoritative for both `dev.intexuraos.cloud` and `intexuraos.cloud`)
- Modify: `.claude/reference/environments.md` (same)

**Decision gate (ask user if unclear):** Is `intexuraos.cloud` actually a separate GCP project today? Check `gcloud run services list --project=intexuraos-pbuchman` vs `--project=intexuraos-dev-pbuchman`. If the latter serves both domains, pick **Option 2**. If there's a separate prod project, pick **Option 1**.

**Steps (Option 2 — documentation reconciliation; most likely path):**
- [ ] `gcloud run services list --project=intexuraos-dev-pbuchman --format='value(metadata.name,status.url)'` — capture the authoritative list.
- [ ] Confirm (with user or by DNS lookup) that `intexuraos.cloud` resolves to a service in the dev project.
- [ ] Update `.claude/CLAUDE.md` `Environments` section: `dev=dev.intexuraos.cloud` and `prod=intexuraos.cloud` both served from `intexuraos-dev-pbuchman`.
- [ ] Update `.claude/reference/environments.md` and `.claude/reference/infrastructure.md` consistently.
- [ ] Remove any references to a nonexistent `terraform/environments/prod/`.
- [ ] Commit `docs: reconcile prod environment references with single-project reality`.

**Steps (Option 1 — create prod):**
- [ ] Copy `terraform/environments/dev/` to `terraform/environments/prod/` AFTER Subtask E lands (cleaner base).
- [ ] Update `backend.tf` to point to a prod-specific GCS bucket / key prefix.
- [ ] Parameterise project ID in `variables.tf`.
- [ ] `terraform init && terraform plan` in prod dir against a real prod project — capture plan for user review. **Stop here — do not apply without user approval.**
- [ ] Commit `feat(tf): scaffold prod environment mirroring dev`.

**Acceptance:** `.claude/CLAUDE.md` and the filesystem agree. Either `terraform/environments/prod/` exists and plans cleanly, or the docs no longer claim it exists.

---

## Cross-Subtask Coordination (Rebase Order — Informational Only)

All 7 subtasks target `development` branch independently. If merged out-of-order, rebase conflicts are localised and trivial:
- **A, B, C, D, E, F, G merge in any order.** Only conflict surface is `scripts/ci-tracked.mjs` (A + B both add entries) and Subtask F's `KNOWN_VIOLATIONS` allowlist (B creates, F shrinks). Both are additive and rebase cleanly.
- **No runtime coupling:** no subtask imports code produced by another. Contracts (JSON files, Terraform locals, Dockerfile ARG) are the only interface.

## Acceptance Criteria (Entire INT-1536)

- [ ] `pnpm run ci:tracked` passes on the merged result.
- [ ] `scripts/verify-web-service-manifest.mjs` fails when a Cloud Run service is added to `cloudbuild.yaml` without manifest update.
- [ ] `scripts/verify-terraform-env-consumers.mjs` fails on unconsumed `INTEXURAOS_*` in Terraform `env_vars`.
- [ ] `scripts/verify-ecosystem-coverage.mjs` fails when an app lacks `validateRequiredEnv` or is missing from `ecosystem.config.cjs`.
- [ ] `scripts/verify-terraform-secret-mounts.mjs` fails on orphan `google_secret_manager_secret` resources.
- [ ] `apps/api-docs-hub/src/index.ts` calls `validateRequiredEnv`.
- [ ] `package.json` has `"packageManager": "pnpm@<version>"`; zero Dockerfiles pin `pnpm@<version>` explicitly.
- [ ] `docker/Dockerfile.service` + `cloudbuild/scripts/deploy-service.sh` exist and are used by at least 2 services (stage 1 — proof of concept); remaining 19 services tracked in a follow-up stage-2 issue.
- [ ] `terraform/environments/dev/main.tf` is under 100 lines; `services.tf`, `secrets.tf`, `iam.tf`, `pubsub.tf`, `locals.tf` contain the split.
- [ ] 8 orphan Secret Manager secrets either wired or removed; `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` removed.
- [ ] `.claude/CLAUDE.md` and filesystem agree on prod environment existence.

## Test Plan

- CI: `pnpm run ci:tracked` (all verify-* scripts + type + lint + tests).
- Terraform: `terraform plan` in `terraform/environments/dev/` shows **zero changes** after Subtask E.
- Docker: `docker build --build-arg SERVICE=user-service -f docker/Dockerfile.service .` succeeds.
- Docker: image size within ±5% of per-service Dockerfile baseline.
- Deploy smoke: run Cloud Build trigger for one service (e.g., user-service) against dev and confirm Cloud Run URL returns 200 on `/health`.
- Env validation: start `apps/api-docs-hub` with a required var removed → process exits non-zero with the var name in the error.

## References

- `docs/reviews/2026-04-24-refactoring-analysis.md` §8 — source evidence
- `.claude/CLAUDE.md` — Env Vars (services) three-location rule
- `.claude/reference/env-vars-patterns.md`
- Parent: INT-1473
