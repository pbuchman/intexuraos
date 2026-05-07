# Artifact Registry Storage Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Artifact Registry storage safely and aggressively by deleting dead Docker image history, retaining only 3 recent versions per active package plus currently deployed digests, and preventing the buildup from returning.

**Architecture:** Execute in two phases. First, add repo-tracked inventory and prune tooling that produces a protected-digest allowlist and a reviewed deletion plan instead of deleting from ad hoc shell loops. Second, remove dead packages immediately, update any live workloads that still reference old digests, then enable Terraform-managed cleanup policies and stop unnecessary `code-worker` rebuilds in monolith deploys.

**Tech Stack:** Node.js 22, vitest, gcloud, Artifact Registry, Cloud Run, SSH/home-dev, Terraform, GitHub Actions, Cloud Build

**Endpoint Changes:** Unchanged.

---

## Safety Rules

- Never delete from `gcf-artifacts` in the first execution pass. It is only about `1.2 GB`; the problem repository is `intexuraos-dev`.
- Never delete a digest until it is present in neither:
  - current Cloud Run service images
  - `INTEXURAOS_CODE_WORKER_IMAGE` in `~/.code-orchestrator/env` on `home-dev`
- Keep `3` newest versions per active package, plus any extra currently deployed digest if it falls outside the newest `3`.
- Delete retired packages entirely only after verifying they are absent from code references and live runtime references.
- Run destructive deletions in bounded batches. Maximum `50` digests per execution batch.
- Do not switch Artifact Registry cleanup out of dry-run mode until all live runtimes point at digests that are inside the retained window.

## Current Evidence To Preserve In The Plan

- Artifact Registry storage is dominated by `intexuraos-dev` at `203.978 GB`; `gcf-artifacts` is only `1.216 GB`.
- `intexuraos-dev` contains `11,203` retained versions across `30` packages.
- If retention were actually “keep 3”, steady state would be roughly `90` versions plus any extra deployed digests, not `11,203`.
- Dead packages currently identified for likely full removal:
  - `claude-worker`
  - `commands-router`
  - `data-insights-service`
  - `llm-orchestrator`
  - `llm-orchestrator-service`
- `promptvault-service` looked retired during the initial billing investigation, but live inventory shows `intexuraos-promptvault-service` is still deployed, so it must follow active-package retention instead of full removal.
- `code-worker` is the largest active storage source and also has a daily rebuild schedule.

## File Map

### New Files

- `scripts/artifact-registry/lib.ts`
  - Shared typed logic for parsing live image references, registry versions, retention selection, and prune-plan generation.
- `scripts/artifact-registry/export-live-images.mjs`
  - CLI that exports current Cloud Run and orchestrator image references into JSON files.
- `scripts/artifact-registry/generate-prune-plan.mjs`
  - CLI that combines live references with Artifact Registry contents and emits a reviewed prune plan.
- `scripts/artifact-registry/apply-prune-plan.mjs`
  - CLI that prints or executes exact deletion commands from a previously generated plan.
- `scripts/__tests__/artifact-registry-lib.test.ts`
  - Unit tests for retention logic and protected-digest handling.
- `scripts/__tests__/artifact-registry-cli.test.ts`
  - Tests for CLI parsing, plan generation behavior, and delete safeguards.
- `docs/operations/artifact-registry-cleanup.md`
  - Durable runbook for future cleanups after this one-time remediation.

### Modified Files

- `.github/workflows/deploy.yml`
  - Remove `code-worker` from monolith local deploy builds.
- `cloudbuild/cloudbuild.yaml`
  - Remove the unconditional `build-push-code-worker` step from monolith Cloud Build.
- `terraform/modules/artifact-registry/main.tf`
  - Add delete cleanup policies and `cleanup_policy_dry_run`.
- `terraform/modules/artifact-registry/variables.tf`
  - Add configurable retention and dry-run variables.
- `terraform/environments/dev/main.tf`
  - Pass concrete cleanup variable values for this environment.
- `scripts/README.md`
  - Document the new Artifact Registry cleanup tooling.

---

## Chunk 1: Repo Tooling

### Task 1: Add retention decision engine

**Files:**
- Create: `scripts/artifact-registry/lib.ts`
- Test: `scripts/__tests__/artifact-registry-lib.test.ts`

- [ ] **Step 1: Write failing tests for retention selection**

Add test cases for:

```ts
import { describe, expect, it } from 'vitest';
import {
  classifyPackages,
  buildRetentionDecisions,
  type LiveImageRef,
  type RegistryVersion,
} from '../artifact-registry/lib.js';

describe('buildRetentionDecisions', () => {
  it('keeps the newest 3 versions for an active package', () => {});
  it('keeps a protected deployed digest even when it is older than the newest 3', () => {});
  it('marks all versions of retired packages for deletion', () => {});
  it('never returns a protected digest in deleteDigests', () => {});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test -- scripts/__tests__/artifact-registry-lib.test.ts
```

Expected: FAIL because `scripts/artifact-registry/lib.ts` does not exist yet.

- [ ] **Step 3: Implement minimal shared types and retention logic**

Implement these core interfaces and functions:

```ts
export interface LiveImageRef {
  source: 'cloud-run' | 'orchestrator';
  runtimeName: string;
  packageName: string;
  digest: string;
}

export interface RegistryVersion {
  packageName: string;
  digest: string;
  createTime: string;
  tags: string[];
  imageSizeBytes: number;
}

export interface PackageDecision {
  packageName: string;
  status: 'active' | 'retired';
  keepDigests: string[];
  deleteDigests: string[];
}
```

Rules:

- Sort versions newest-first by `createTime`.
- For active packages, retain the newest `keepCount` digests.
- Also retain any digest present in `LiveImageRef[]`.
- For retired packages, mark all digests for deletion.
- Throw if any protected digest would be deleted.

- [ ] **Step 4: Re-run tests**

Run:

```bash
pnpm test -- scripts/__tests__/artifact-registry-lib.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/artifact-registry/lib.ts scripts/__tests__/artifact-registry-lib.test.ts
git commit -m "feat: add artifact registry retention planner"
```

### Task 2: Add inventory and prune-plan CLIs

**Files:**
- Create: `scripts/artifact-registry/export-live-images.mjs`
- Create: `scripts/artifact-registry/generate-prune-plan.mjs`
- Create: `scripts/artifact-registry/apply-prune-plan.mjs`
- Test: `scripts/__tests__/artifact-registry-cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Test the following behaviors:

- `export-live-images` writes:
  - `cloud-run-images.json`
  - `orchestrator-image.json`
  - `protected-digests.json`
- `generate-prune-plan` emits:
  - `prune-plan.json`
  - `prune-summary.md`
- `apply-prune-plan` defaults to dry-run and refuses to execute without `--execute`.
- `apply-prune-plan` refuses to delete a digest marked `protected`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm test -- scripts/__tests__/artifact-registry-cli.test.ts
```

Expected: FAIL because the CLI files do not exist yet.

- [ ] **Step 3: Implement `export-live-images.mjs`**

Required flags and behavior:

```bash
node scripts/artifact-registry/export-live-images.mjs \
  --project=intexuraos-dev-pbuchman \
  --region=europe-central2 \
  --orchestrator-host=home-dev \
  --orchestrator-env-path='~/.code-orchestrator/env' \
  --out-dir=/tmp/artifact-registry/live
```

Implementation requirements:

- Query Cloud Run services with:

```bash
gcloud run services list --region=europe-central2 --project=intexuraos-dev-pbuchman --format=json
```

- For each service, capture the image string from `spec.template.spec.containers[0].image`.
- Read the orchestrator image reference from `~/.code-orchestrator/env`.
  - If running on `home-dev`, read directly.
  - If not on `home-dev`, use `ssh home-dev 'grep "^INTEXURAOS_CODE_WORKER_IMAGE=" ~/.code-orchestrator/env'`.
- Normalize every image reference into package name plus digest form.
- Fail hard if the orchestrator image is tag-only and not digest-pinned.

- [ ] **Step 4: Implement `generate-prune-plan.mjs`**

Required command:

```bash
node scripts/artifact-registry/generate-prune-plan.mjs \
  --project=intexuraos-dev-pbuchman \
  --location=europe-central2 \
  --repository=intexuraos-dev \
  --keep-count=3 \
  --protected=/tmp/artifact-registry/live/protected-digests.json \
  --retired-packages=claude-worker,commands-router,data-insights-service,llm-orchestrator,llm-orchestrator-service \
  --out-dir=/tmp/artifact-registry/plan
```

Implementation requirements:

- Pull full registry inventory with:

```bash
gcloud artifacts docker images list \
  europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev \
  --include-tags \
  --format=json
```

- Produce a stable plan JSON with:
  - `generatedAt`
  - `keepCount`
  - `protectedDigests`
  - `retiredPackages`
  - `packageDecisions[]`
  - `deleteDigestCount`
  - `deletePackageCount`
- Produce a human-readable markdown summary sorted by deletion count and estimated logical bytes.

- [ ] **Step 5: Implement `apply-prune-plan.mjs`**

Required dry-run command:

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan/prune-plan.json \
  --scope=retired-packages
```

Required execute command:

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan/prune-plan.json \
  --scope=retired-packages \
  --execute \
  --batch-size=50
```

Execution requirements:

- Default mode prints exact `gcloud artifacts docker images delete ...@sha256:... --delete-tags` commands.
- `--execute` runs them serially and stops on the first failure.
- Support `--scope=retired-packages`, `--scope=package:<name>`, and `--scope=all`.
- Before each delete, assert the digest is not in `protectedDigests`.

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm test -- scripts/__tests__/artifact-registry-cli.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/artifact-registry scripts/__tests__/artifact-registry-cli.test.ts
git commit -m "feat: add artifact registry cleanup tooling"
```

### Task 3: Document the runbook

**Files:**
- Create: `docs/operations/artifact-registry-cleanup.md`
- Modify: `scripts/README.md`

- [ ] **Step 1: Write the runbook**

Document:

- preflight inventory
- protected-digest export
- prune plan generation
- retired package deletion
- live-digest reconciliation
- cleanup-policy activation
- verification commands

- [ ] **Step 2: Add script discovery to `scripts/README.md`**

Add one short section pointing to `scripts/artifact-registry/*.mjs`.

- [ ] **Step 3: Verify docs formatting**

Run:

```bash
pnpm format:check
```

Expected: PASS, or format only the touched markdown files if needed.

- [ ] **Step 4: Commit**

```bash
git add docs/operations/artifact-registry-cleanup.md scripts/README.md
git commit -m "docs: add artifact registry cleanup runbook"
```

---

## Chunk 2: Stop New Unnecessary Growth

### Task 4: Remove `code-worker` from monolith builds

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `cloudbuild/cloudbuild.yaml`

- [ ] **Step 1: Write a failing regression test**

Add a small text-based test in `scripts/__tests__/artifact-registry-cli.test.ts` or a dedicated new test file that asserts:

- monolith local deploy does not invoke `build-push-monitored.sh code-worker`
- monolith Cloud Build does not include `build-push-code-worker`
- the dedicated `code-worker` trigger still exists untouched

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
pnpm test -- scripts/__tests__/artifact-registry-cli.test.ts
```

Expected: FAIL because the monolith configs still build `code-worker`.

- [ ] **Step 3: Update workflow and Cloud Build**

Required edits:

- Remove this line from monolith local deploy:

```bash
bash cloudbuild/scripts/build-push-monitored.sh code-worker docker/code-worker/Dockerfile &
```

- Remove the unconditional `build-push-code-worker` step from `cloudbuild/cloudbuild.yaml`.
- Keep the dedicated `code-worker` Cloud Build trigger and the daily scheduler intact.

- [ ] **Step 4: Re-run the test**

Run:

```bash
pnpm test -- scripts/__tests__/artifact-registry-cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml cloudbuild/cloudbuild.yaml scripts/__tests__/artifact-registry-cli.test.ts
git commit -m "fix: stop monolith deploys from rebuilding code-worker"
```

### Task 5: Add Terraform cleanup policies in dry-run mode

**Files:**
- Modify: `terraform/modules/artifact-registry/main.tf`
- Modify: `terraform/modules/artifact-registry/variables.tf`
- Modify: `terraform/environments/dev/main.tf`

- [ ] **Step 1: Add failing config test or validation guard**

Add a text-level test or validation script assertion that the repository module includes:

- `cleanup_policy_dry_run`
- one general `DELETE` policy
- one `KEEP` policy with `keep_count = 3`
- one `code-worker`-specific `DELETE` policy

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test -- scripts/__tests__/artifact-registry-cli.test.ts
```

Expected: FAIL because only a keep policy exists today.

- [ ] **Step 3: Modify the Terraform module**

Add variables:

```hcl
variable "cleanup_policy_dry_run" {
  type = bool
}

variable "cleanup_keep_count" {
  type = number
}

variable "cleanup_delete_older_than" {
  type = string
}

variable "code_worker_cleanup_delete_older_than" {
  type = string
}
```

Update the repository resource to include:

```hcl
cleanup_policy_dry_run = var.cleanup_policy_dry_run

cleanup_policies {
  id     = "delete-stale-images"
  action = "DELETE"
  condition {
    tag_state  = "any"
    older_than = var.cleanup_delete_older_than
  }
}

cleanup_policies {
  id     = "keep-recent"
  action = "KEEP"
  most_recent_versions {
    keep_count = var.cleanup_keep_count
  }
}

cleanup_policies {
  id     = "delete-stale-code-worker"
  action = "DELETE"
  condition {
    tag_state             = "any"
    package_name_prefixes = ["code-worker"]
    older_than            = var.code_worker_cleanup_delete_older_than
  }
}
```

Set environment values in `terraform/environments/dev/main.tf`:

```hcl
cleanup_policy_dry_run                = false
cleanup_keep_count                    = 3
cleanup_delete_older_than             = "86400s"
code_worker_cleanup_delete_older_than = "86400s"
```

- [ ] **Step 4: Re-run the test**

Run:

```bash
pnpm test -- scripts/__tests__/artifact-registry-cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify Terraform syntax**

Run:

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform init

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform plan
```

Expected: plan shows Artifact Registry cleanup policy changes only. If the exported prune plan shows no package retaining more than 3 digests, apply with dry-run disabled.

- [ ] **Step 6: Commit**

```bash
git add terraform/modules/artifact-registry/main.tf terraform/modules/artifact-registry/variables.tf terraform/environments/dev/main.tf scripts/__tests__/artifact-registry-cli.test.ts
git commit -m "feat: add dry-run artifact registry cleanup policies"
```

---

## Chunk 3: Post-Merge Operational Cleanup

### Task 6: Generate immutable live-runtime inventory

**Files:**
- None. Uses the new scripts only.

- [ ] **Step 1: Run inventory export**

```bash
node scripts/artifact-registry/export-live-images.mjs \
  --project=intexuraos-dev-pbuchman \
  --region=europe-central2 \
  --orchestrator-host=home-dev \
  --orchestrator-env-path='~/.code-orchestrator/env' \
  --out-dir=/tmp/artifact-registry/live-$(date +%F)
```

- [ ] **Step 2: Verify outputs**

Confirm the following files exist:

- `/tmp/artifact-registry/live-YYYY-MM-DD/cloud-run-images.json`
- `/tmp/artifact-registry/live-YYYY-MM-DD/orchestrator-image.json`
- `/tmp/artifact-registry/live-YYYY-MM-DD/protected-digests.json`

- [ ] **Step 3: Manually inspect the protected list**

Reject the run if:

- any Cloud Run service image is tag-only instead of digest-qualified
- `INTEXURAOS_CODE_WORKER_IMAGE` is tag-only instead of digest-qualified
- any duplicate package name has conflicting protected digests without explanation

### Task 7: Generate and review the prune plan

**Files:**
- None. Uses the new scripts only.

- [ ] **Step 1: Generate the plan**

```bash
node scripts/artifact-registry/generate-prune-plan.mjs \
  --project=intexuraos-dev-pbuchman \
  --location=europe-central2 \
  --repository=intexuraos-dev \
  --keep-count=3 \
  --protected=/tmp/artifact-registry/live-$(date +%F)/protected-digests.json \
  --retired-packages=claude-worker,commands-router,data-insights-service,llm-orchestrator,llm-orchestrator-service \
  --out-dir=/tmp/artifact-registry/plan-$(date +%F)
```

- [ ] **Step 2: Review summary before any delete**

Check `/tmp/artifact-registry/plan-YYYY-MM-DD/prune-summary.md` and confirm:

- all `retiredPackages` have `status: retired`
- no protected digest appears in a delete set
- active packages retain `3` newest digests
- `code-worker` retain set contains the orchestrator digest

- [ ] **Step 3: Save the reviewed plan artifact**

Copy the plan JSON to a dated backup path before executing:

```bash
mkdir -p ~/artifact-registry-cleanup-archive
cp /tmp/artifact-registry/plan-$(date +%F)/prune-plan.json ~/artifact-registry-cleanup-archive/prune-plan-$(date +%F).json
```

### Task 8: Delete retired packages immediately

**Files:**
- None. Uses the new scripts only.

- [ ] **Step 1: Dry-run retired package deletion**

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan-$(date +%F)/prune-plan.json \
  --scope=retired-packages
```

- [ ] **Step 2: Execute retired package deletion**

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan-$(date +%F)/prune-plan.json \
  --scope=retired-packages \
  --execute \
  --batch-size=50
```

- [ ] **Step 3: Verify retired packages are gone**

Run:

```bash
gcloud artifacts packages list \
  --repository=intexuraos-dev \
  --location=europe-central2 \
  --project=intexuraos-dev-pbuchman \
  --format='value(name.basename())'
```

Expected: the retired package names are absent.

### Task 9: Reconcile live runtimes into the retained window

**Files:**
- None, unless runtime configuration needs an image bump.

- [ ] **Step 1: Detect protected digests outside newest-3**

Use the prune plan summary. If any protected digest is only retained because of runtime protection and not because it is in the newest `3`, record it as a reconciliation target.

- [ ] **Step 2: Update the orchestrator first if needed**

If `code-worker` is pinned to an older digest:

- choose a retained newest digest from the plan
- update `INTEXURAOS_CODE_WORKER_IMAGE` in `~/.code-orchestrator/env`
- restart the orchestrator service on `home-dev`

Suggested commands on `home-dev`:

```bash
grep '^INTEXURAOS_CODE_WORKER_IMAGE=' ~/.code-orchestrator/env
sed -i 's#^INTEXURAOS_CODE_WORKER_IMAGE=.*#INTEXURAOS_CODE_WORKER_IMAGE=europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker@sha256:RETAINED_DIGEST#' ~/.code-orchestrator/env
sudo systemctl restart intexuraos-orchestrator@pbuchman
```

- [ ] **Step 3: Redeploy any Cloud Run service still using an old protected digest**

Use the existing individual deploy path after the prevention changes are merged. Only redeploy services identified by the prune plan as outside newest-3.

Verification command:

```bash
gcloud run services describe intexuraos-SERVICE_NAME \
  --region=europe-central2 \
  --project=intexuraos-dev-pbuchman \
  --format='value(spec.template.spec.containers[0].image)'
```

Expected: the live digest is one of the retained newest `3`.

---

## Chunk 4: Activate Policy And Final Prune

### Task 10: Apply Terraform dry-run policy and inspect the resulting config

**Files:**
- None beyond merged Terraform changes.

- [ ] **Step 1: Apply Terraform with dry-run still enabled**

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform apply
```

- [ ] **Step 2: Verify repository settings**

```bash
gcloud artifacts repositories describe intexuraos-dev \
  --location=europe-central2 \
  --project=intexuraos-dev-pbuchman \
  --format=json
```

Expected:

- `cleanupPolicyDryRun` is enabled
- keep policy count is `3`
- delete policies exist for general images and `code-worker`

### Task 11: Manually prune `code-worker` to accelerate savings

**Files:**
- None. Uses the new scripts only.

- [ ] **Step 1: Dry-run `code-worker` only**

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan-$(date +%F)/prune-plan.json \
  --scope=package:code-worker
```

- [ ] **Step 2: Execute `code-worker` prune**

```bash
node scripts/artifact-registry/apply-prune-plan.mjs \
  --plan=/tmp/artifact-registry/plan-$(date +%F)/prune-plan.json \
  --scope=package:code-worker \
  --execute \
  --batch-size=50
```

- [ ] **Step 3: Re-export live inventory**

Run `export-live-images.mjs` again and confirm the orchestrator digest is still present and protected.

### Task 12: Flip cleanup policy from dry-run to active deletion

**Files:**
- Modify: `terraform/environments/dev/main.tf`

- [ ] **Step 1: Change the single environment value**

```hcl
cleanup_policy_dry_run = false
```

- [ ] **Step 2: Run verification before apply**

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform plan
```

Expected: only the dry-run flag flips from `true` to `false`.

- [ ] **Step 3: Apply**

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform apply
```

- [ ] **Step 4: Commit**

```bash
git add terraform/environments/dev/main.tf
git commit -m "chore: enable artifact registry cleanup policy"
```

---

## Chunk 5: Verification

### Task 13: Verify storage and CI state before closing

**Files:**
- None.

- [ ] **Step 1: Run targeted tests**

```bash
pnpm test -- scripts/__tests__/artifact-registry-lib.test.ts scripts/__tests__/artifact-registry-cli.test.ts
```

- [ ] **Step 2: Run tracked workspace verification**

```bash
pnpm run verify:workspace:tracked -- scripts
```

- [ ] **Step 3: Run full tracked CI**

```bash
pnpm run ci:tracked
```

- [ ] **Step 4: Verify repository size after deletes**

```bash
gcloud artifacts repositories list \
  --location=europe-central2 \
  --project=intexuraos-dev-pbuchman \
  --format='table(name.basename(),sizeBytes,updateTime)'
```

Expected:

- `intexuraos-dev` size is materially lower than the current `203978038140` bytes
- `gcf-artifacts` is unchanged unless intentionally touched later

- [ ] **Step 5: Re-check the next day**

Google documents that cleanup-policy background processing can take about a day to take effect. Re-run the repository size command on the next calendar day and compare.

## Expected End State

- Dead packages are fully removed.
- Active packages retain only `3` recent digests plus any temporarily necessary deployed digest.
- `code-worker` is no longer rebuilt by every monolith deploy.
- Artifact Registry cleanup is codified in Terraform.
- Cleanup runs safely because active runtimes have been reconciled into the retained window before active deletion is enabled.

## Execution Notes For This Harness

- GCP read/write access is available through the configured service account.
- Terraform verification requires `terraform init` inside `terraform/environments/dev` before planning if modules are not installed locally.
- If SSH to `home-dev` is unavailable from the current machine, run the orchestrator-inventory step directly on `home-dev` and copy the resulting JSON artifact back into `/tmp/artifact-registry/...`.
- Do not rely on the Google Cloud Console for safety checks that can be performed from the generated JSON artifacts; the JSON artifacts are the durable audit trail for the deletion run.
