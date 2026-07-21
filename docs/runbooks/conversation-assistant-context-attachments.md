# Conversation Assistant Context Attachments Runbook

This runbook covers rollout, verification, recovery, and rollback for immutable Conversation Assistant context updates.

## Release Invariants

- Use one frozen, reviewed commit SHA for infrastructure, migrations, application deployment, and acceptance evidence.
- Apply Firestore TTL/index infrastructure and wait for every required index to become ready before deploying application code that depends on it.
- Do not merge a pull request implicitly as part of deployment.
- Pending updates may be retried on the same immutable cutoff. Never recreate them from a moving live query.
- Public account disconnect remains non-destructive. Physical erasure requires the explicit internal workflow.

## Pre-deployment

1. Run migration verification, collection ownership checks, Terraform format/validate, package tests, exports, typechecks, lint, and `pnpm run ci:tracked` from the frozen SHA.
2. Confirm migration 124 is registered without modification and migration 125 has the expected checksum.
3. Confirm native TTL targets only pending context attachment metadata/chunks through `expireAt`.
4. Confirm logs and Sentry use route templates and have no request bodies or dynamic identifiers.
5. In real Google Chrome with the WhatsApp test account, capture privacy-safe evidence for the happy path, zero update, correction, post-cutoff refresh, reload, answer retry, two-tab conflict, mobile layout, context history, and PDF.

## Rollout Order

1. From a clean checkout of the frozen SHA, create the Terraform plan from the
   retained GCP root, save it outside the repository, and inspect it before any
   apply:

   ```bash
   FROZEN_SHA='<reviewed-40-character-commit-sha>'
   TTL_PLAN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-ttl-plan.XXXXXX")"
   TTL_PLAN_PATH="${TTL_PLAN_DIR}/conversation-assistant.tfplan"
   export GOOGLE_APPLICATION_CREDENTIALS='/secrets/gcp-sa.json'
   export STORAGE_EMULATOR_HOST=
   export FIRESTORE_EMULATOR_HOST=
   export PUBSUB_EMULATOR_HOST=
   test "$(git rev-parse HEAD)" = "${FROZEN_SHA}"
   test -z "$(git status --porcelain=v1 --untracked-files=all)"
   terraform -chdir=terraform/environments/dev init
   terraform -chdir=terraform/environments/dev validate
   terraform -chdir=terraform/environments/dev plan -out="${TTL_PLAN_PATH}"
   terraform -chdir=terraform/environments/dev show "${TTL_PLAN_PATH}"
   shasum -a 256 "${TTL_PLAN_PATH}"
   ```

   `TTL_PLAN_PATH` must be an explicit absolute path in a newly created
   operator-controlled temporary directory. Stop if the plan contains anything
   beyond the reviewed TTL resources or if HEAD/worktree changes. Apply that
   exact saved plan with
   `GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform -chdir=terraform/environments/dev apply "${TTL_PLAN_PATH}"`, then
   re-check the frozen HEAD and record the plan hash.
2. Dispatch migrations 124/125 from the same ref and wait until all indexes report ready.
3. Trigger the supported Hetzner production deployment workflow for that exact SHA/ref.
   The emergency local fallback must use a clean checkout; the deploy script
   syncs a `git archive` of the resolved SHA and fails before remote mutation
   when tracked or untracked worktree changes exist.
   The script reloads and health-checks the backward-compatible backend before
   publishing the new Web bundle. Do not reverse this order: already-open old
   clients rely on the server accepting the legacy question-only turn body,
   while the new Web client requires the new public contract.
4. For every retained Cloud Build target, verify `sourceProvenance.resolvedGitSource.revision` (or the legacy `sourceProvenance.resolvedRepoSource.commitSha` fallback) exactly matches the reviewed SHA.
5. Verify PM2 processes are online, `nginx -t` succeeds, and `/api/whatsapp/health` succeeds through both direct-origin `--resolve` and public DNS.
6. Fetch `/deployment.json` through both direct-origin `--resolve` and public DNS. Require an uncached `application/json` response with exactly `commitSha`, `workflowRunId`, and canonical UTC `deployedAt`; both `commitSha` values must equal the reviewed SHA. Record the run id and timestamp. A missing marker is a failed or still-running deployment, never evidence for the previous release.
7. Repeat the critical Chrome happy path, recovery, context-history, and PDF checks at `https://intexuraos.cloud`.

Before step 3, list the native policies and wait until `expireAt` is `ACTIVE`
for all four feature groups (erasure status, attachment metadata, context
chunks, and transcript chunks):

```bash
gcloud firestore fields ttls list \
  --project=intexuraos-dev-pbuchman \
  --database='(default)' \
  --format='table(name,ttlConfig.state)'
```

Do not infer TTL deployment from the Firestore migration workflow: that
workflow deploys rules/indexes/migrations, while native TTL is owned by the
Terraform root above.

## Operational Signals

Monitor content-free counts and outcomes for preparation created/ready/failed/expired, size-limit rejection, replay/conflict, lease reclaim, SSE disconnect, answer retry, chain mismatch, PDF revision, session cleanup, and account-erasure batches. No identifier, label, question, message body, preview, hash, or source identity is an allowed dimension.

Investigate repeated preparation failures by request status and safe error code. An expired draft can be replaced. A failed fixed-boundary draft can be retried. A committed attachment cannot be removed or rebuilt independently.

## Rollback

1. Stop new application rollout if infrastructure cannot prove the same source SHA.
2. Roll the Hetzner application back to the previous known-good SHA without deleting new Firestore data or reversing additive indexes/TTL configuration.
3. Leave queued/preparing metadata and chunks intact. Older code may not process the new work item, but forward recovery must retain its frozen cutoff.
4. Re-deploy the compatible forward version and retry the original request id/cutoff.
5. Never manually mutate session watermarks, chain hashes, committed attachment status, or durable request fingerprints.

An already-open new Web client is not protocol-compatible with a backend from
before context attachments. During that emergency rollback it may receive a
fail-closed `400` until the user refreshes onto the rolled-back Web bundle or a
compatible forward version is restored. The unsent question and attachment id
remain in `sessionStorage`. Never retry by stripping `requestId`,
`contextAttachmentId`, `confirmationToken`, or `displayTimeZone`: doing so could
silently send a different request without the context the user selected. If a
pending attachment must survive, prefer compatible forward recovery and reuse
its original frozen cutoff.

## Privacy Recovery

An interrupted physical-erasure request is resumed with the same `sourceAccountId`, `userId`, and `erasureRequestId`. Its stored stage, attempt, generation fence, and counts are authoritative. Do not create a second erasure id for the same generation unless the first request has a terminal conflict that requires engineering review.
