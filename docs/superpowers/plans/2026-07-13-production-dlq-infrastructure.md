# Production DLQ Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every active dead-letter policy correct IAM, dedicated production DLQs, 31-day inspection retention, forwarding-failure alerts, and a safe replay runbook.

**Architecture:** Terraform owns every persistent Pub/Sub and Cloud Monitoring change. The Hetzner production root creates DLQs from the existing subscription map, shared modules enforce the service-agent IAM contract, and the retained dev root repairs the explicit transcription subscription and monitoring.

**Tech Stack:** Terraform, Google Pub/Sub, Google Cloud Monitoring, Vitest static infrastructure tests, Markdown runbook.

## Global Constraints

- Use project `intexuraos-dev-pbuchman`; the retained GCP project contains both dev and Hetzner production messaging resources.
- Every inspection subscription uses `message_retention_duration = "2678400s"` and never expires.
- Pub/Sub service agent is `service-${project_number}@gcp-sa-pubsub.iam.gserviceaccount.com`.
- Never create, update, or delete persistent infrastructure with `gcloud`; Terraform is the only write path.
- A production plan must not replace or delete any source subscription.
- Do not replay DLQ payloads in bulk; ACK only after successful selected replay or explicit non-replayable classification.
- Run `pnpm run ci:tracked` before every commit.

---

### Task 1: Dedicated Hetzner Production DLQs

**Files:**
- Modify: `scripts/__tests__/hetzner-runtime.test.ts`
- Modify: `terraform/hetzner-prod/pubsub.tf`

**Interfaces:**
- Consumes: `local.hetzner_pubsub_push_subscriptions` with `subscription_name` and delivery settings.
- Produces: `google_pubsub_topic.hetzner_push_dlq`, `google_pubsub_subscription.hetzner_push_dlq_inspect`, `google_pubsub_topic_iam_member.hetzner_push_dlq_publisher`, and `google_pubsub_subscription_iam_member.hetzner_push_dlq_subscriber`.

- [ ] **Step 1: Write the failing production DLQ contract test**

Add assertions to the existing `Hetzner async edge cutover` test:

```ts
expect(hetznerPubsub).toContain('resource "google_pubsub_topic" "hetzner_push_dlq"');
expect(hetznerPubsub).toMatch(/name\s+=\s+"\$\{each\.value\.subscription_name\}-dlq"/);
expect(hetznerPubsub).toContain('resource "google_pubsub_subscription" "hetzner_push_dlq_inspect"');
expect(hetznerPubsub).toMatch(/name\s+=\s+"\$\{each\.value\.subscription_name\}-dlq-sub"/);
expect(hetznerPubsub).toContain('message_retention_duration = "2678400s"');
expect(hetznerPubsub).toContain('resource "google_pubsub_topic_iam_member" "hetzner_push_dlq_publisher"');
expect(hetznerPubsub).toContain('resource "google_pubsub_subscription_iam_member" "hetzner_push_dlq_subscriber"');
expect(hetznerPubsub).toContain('role         = "roles/pubsub.subscriber"');
expect(hetznerPubsub).toContain('dead_letter_topic     = google_pubsub_topic.hetzner_push_dlq[each.key].id');
expect(hetznerPubsub).not.toContain('data.google_pubsub_topic.hetzner_push_dlq');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts`

Expected: FAIL because dedicated production DLQ resources and subscriber IAM do not exist.

- [ ] **Step 3: Create the production DLQ resources and repoint the source policy**

In `terraform/hetzner-prod/pubsub.tf`, replace the dev-named DLQ data lookup with resources shaped as follows:

```hcl
resource "google_pubsub_topic" "hetzner_push_dlq" {
  for_each = local.hetzner_pubsub_push_subscriptions

  name    = "${each.value.subscription_name}-dlq"
  project = var.project_id
  labels  = local.common_labels
}

resource "google_pubsub_subscription" "hetzner_push_dlq_inspect" {
  for_each = local.hetzner_pubsub_push_subscriptions

  name                       = "${each.value.subscription_name}-dlq-sub"
  topic                      = google_pubsub_topic.hetzner_push_dlq[each.key].id
  project                    = var.project_id
  labels                     = local.common_labels
  ack_deadline_seconds       = 600
  message_retention_duration = "2678400s"

  expiration_policy {
    ttl = ""
  }
}

resource "google_pubsub_topic_iam_member" "hetzner_push_dlq_publisher" {
  for_each = local.hetzner_pubsub_push_subscriptions

  project = var.project_id
  topic   = google_pubsub_topic.hetzner_push_dlq[each.key].name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.retained.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription_iam_member" "hetzner_push_dlq_subscriber" {
  for_each = local.hetzner_pubsub_push_subscriptions

  project      = var.project_id
  subscription = google_pubsub_subscription.hetzner_push[each.key].name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.retained.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
```

Set `dead_letter_topic` to `google_pubsub_topic.hetzner_push_dlq[each.key].id` and make the source subscription depend on the DLQ publisher grant. The subscriber grant already depends on the source subscription through its `subscription` reference; do not add a reverse dependency that would create a Terraform cycle.

- [ ] **Step 4: Format and rerun the contract test**

Run: `terraform fmt terraform/hetzner-prod/pubsub.tf && PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts`

Expected: PASS.

### Task 2: Shared Module and Retained Transcription Correctness

**Files:**
- Modify: `scripts/__tests__/hetzner-runtime.test.ts`
- Modify: `terraform/modules/pubsub-push/main.tf`
- Modify: `terraform/modules/pubsub/main.tf`
- Modify: `terraform/environments/dev/main.tf`

**Interfaces:**
- Consumes: module variables `project_id`, `project_number`, and `enable_push_subscription`.
- Produces: service-agent subscriber IAM adjacent to every module dead-letter policy and the explicit `audio_stored_push` policy.

- [ ] **Step 1: Add failing module and transcription assertions**

Declare paths for `terraform/modules/pubsub/main.tf` and `terraform/modules/monitoring/main.tf`, then assert:

```ts
for (const terraform of [
  readRequired(terraformPubsubPushModuleMainPath),
  readRequired(terraformPubsubModuleMainPath),
]) {
  expect(terraform).toContain('resource "google_pubsub_subscription_iam_member" "dlq_subscriber"');
  expect(terraform).toContain('role         = "roles/pubsub.subscriber"');
  expect(terraform).toContain('message_retention_duration = "2678400s"');
}
expect(devTerraform).toContain('resource "google_pubsub_subscription_iam_member" "pubsub_subscribes_audio_stored_push"');
expect(devTerraform).toContain('subscription = google_pubsub_subscription.audio_stored_push.name');
expect(devTerraform).toContain('message_retention_duration = "2678400s" # 31 days');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts`

Expected: FAIL on missing subscriber resources and seven-day retention.

- [ ] **Step 3: Repair both shared modules**

Add this resource to the push module, preserving the source subscription count:

```hcl
resource "google_pubsub_subscription_iam_member" "dlq_subscriber" {
  count = var.enable_push_subscription ? 1 : 0

  project      = var.project_id
  subscription = google_pubsub_subscription.push[0].name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
```

Add the equivalent resource to the pull module using `google_pubsub_subscription.main.name` without `count`. Change both DLQ inspection subscriptions to `2678400s`.

- [ ] **Step 4: Repair explicit transcription resources**

Change `google_pubsub_subscription.transcription_dlq_inspect` retention to `2678400s` and add:

```hcl
resource "google_pubsub_subscription_iam_member" "pubsub_subscribes_audio_stored_push" {
  project      = var.project_id
  subscription = google_pubsub_subscription.audio_stored_push.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${local.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
```

- [ ] **Step 5: Format and rerun the contract test**

Run: `terraform fmt terraform/modules/pubsub-push/main.tf terraform/modules/pubsub/main.tf terraform/environments/dev/main.tf && PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts`

Expected: PASS.

### Task 3: Monitoring and DLQ Runbook

**Files:**
- Modify: `scripts/__tests__/hetzner-runtime.test.ts`
- Modify: `terraform/modules/monitoring/main.tf`
- Create: `docs/operations/pubsub-dlq-runbook.md`
- Modify: `docs/operations/hetzner-prod-runbook.md`

**Interfaces:**
- Consumes: Pub/Sub backlog and `dead_letter_message_count` metrics, existing email notification channel.
- Produces: alerts for retained and production DLQ names plus unsuccessful forwarding, and an operator-safe replay procedure.

- [ ] **Step 1: Add failing alert and documentation assertions**

```ts
const monitoring = readRequired(terraformMonitoringMainPath);
const dlqRunbook = readRequired(pubsubDlqRunbookPath);
expect(monitoring).toContain('resource.label.subscription_id=has_substring("-dlq-")');
expect(monitoring).toContain('pubsub.googleapis.com/subscription/dead_letter_message_count');
expect(monitoring).toContain('metric.label.response_code!="success"');
expect(monitoring).toContain('docs/operations/pubsub-dlq-runbook.md');
expect(dlqRunbook).toContain('31 days');
expect(dlqRunbook).toContain('payload hash');
expect(dlqRunbook).toContain('Do not bulk replay');
expect(dlqRunbook).toContain('ACK');
expect(dlqRunbook).toContain('correlation');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts`

Expected: FAIL because the alert misses `-inspect`, forwarding failures are unmonitored, and the runbook is absent.

- [ ] **Step 3: Expand backlog coverage and add forwarding failure alert**

Change all dashboard and alert filters from `has_substring("-dlq-sub")` to `has_substring("-dlq-")`. Add an alert policy using:

```hcl
filter = <<-EOT
  resource.type="pubsub_subscription"
  metric.type="pubsub.googleapis.com/subscription/dead_letter_message_count"
  metric.label.response_code!="success"
EOT
```

Use `ALIGN_SUM`, `REDUCE_SUM`, threshold `0`, duration `60s`, the existing email channel, and documentation linking `docs/operations/pubsub-dlq-runbook.md`.

- [ ] **Step 4: Write the operational runbook**

Document exact read-only discovery, lease-safe pull, metadata capture, SHA-256 payload hashing without content output, failure classification, selected republish with original correlation attributes, ACK-after-publish semantics, duplicate detection, 31-day deadline, synthetic-test cleanup, and post-operation backlog/metric/log checks. Add the runbook link to `docs/operations/hetzner-prod-runbook.md`.

- [ ] **Step 5: Format, test, and commit the infrastructure slice**

Run:

```bash
terraform fmt terraform/modules/monitoring/main.tf
PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts
PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm run ci:tracked
git add scripts/__tests__/hetzner-runtime.test.ts terraform/hetzner-prod/pubsub.tf terraform/modules/pubsub-push/main.tf terraform/modules/pubsub/main.tf terraform/environments/dev/main.tf terraform/modules/monitoring/main.tf docs/operations/pubsub-dlq-runbook.md docs/operations/hetzner-prod-runbook.md
git commit -m "fix: harden production dead letter queues"
```

Expected: all commands pass; the commit contains only DLQ infrastructure, monitoring, tests, and operations documentation.

### Task 4: Terraform Plans and Post-Merge Apply

**Files:**
- Verify: `terraform/environments/dev`
- Verify: `terraform/hetzner-prod`

**Interfaces:**
- Consumes: service-account key `$HOME/.config/gcloud/sa-key.json` and committed Terraform configuration.
- Produces: reviewed plans, applied IAM/DLQ/monitoring resources, and zero remaining source/DLQ backlog after the synthetic test.

- [ ] **Step 1: Initialize and validate both roots**

Run with `GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json"`, `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE` set to the same path, and all Firestore/Pub/Sub emulator variables unset:

```bash
terraform -chdir=terraform/environments/dev init -upgrade
terraform -chdir=terraform/environments/dev validate
terraform -chdir=terraform/hetzner-prod init -upgrade
terraform -chdir=terraform/hetzner-prod validate
```

Expected: both roots initialize and validate successfully.

- [ ] **Step 2: Review plans before merge**

Run `terraform plan` for each root with its existing checked-in/default variable inputs. Expected: additions and in-place updates only; no source subscription replacement or deletion. Save no plan file containing sensitive values in the repository.

- [ ] **Step 3: Apply after PR merge**

Re-run both plans against the merged `development` commit, then apply the reviewed plans. Stop if drift changes the resource actions or any source subscription would be replaced.

- [ ] **Step 4: Verify IAM and synthetic dead lettering**

Confirm all 11 `*-prod-hetzner` source subscriptions plus `intexuraos-audio-stored-dev-push` grant the Pub/Sub service agent `roles/pubsub.subscriber`. Publish one invalid WhatsApp event with a unique correlation ID, observe successful dead-letter forwarding to its dedicated production DLQ, inspect only that entry, and ACK only that synthetic entry.

- [ ] **Step 5: Verify clean steady state**

Expected: forwarding metric reports `response_code="success"`; all source and production DLQ backlogs are zero after cleanup; no synthetic payload reached a valid WhatsApp recipient.
