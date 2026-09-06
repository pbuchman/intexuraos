# Production Async Reliability Design

**Date:** 2026-07-13

**Status:** Approved direction — dedicated production DLQs

## Context

The production investigation covered Hetzner PM2/nginx logs and the retained GCP
Pub/Sub data plane. It established these facts:

- The 11 Hetzner production push subscriptions and the retained
  `intexuraos-audio-stored-dev-push` subscription have dead-letter policies, but
  none grants the Pub/Sub service agent `roles/pubsub.subscriber` on the source
  subscription.
- The Pub/Sub service agent can publish to the current dead-letter topics. During
  the WhatsApp incident, forwarding therefore published copies to the DLQ but
  failed to acknowledge the source message, producing 1,445
  `permission_denied` forwarding results and repeated deliveries.
- Production currently points at dead-letter topics named `*-dev-dlq`. This is a
  consequence of the retained single-project migration, but it makes production
  ownership and incident response ambiguous.
- The WhatsApp DLQ backlog fell from 1,446 to zero without pulls or ACKs. Its
  messages expired under the seven-day subscription retention policy; the last
  905 entries cannot be recovered.
- The Matrix outbound adapter environment propagation defect was fixed and
  deployed in PR #2318. The remaining deployment defect is that PM2 readiness
  checks cover only two of 18 services and can accept a process before it has
  remained healthy.
- Two hourly Linear sync executions exhausted the existing Linear API retries.
  `fullSyncAllUsers()` logged individual failures but returned success, so Cloud
  Scheduler did not perform its configured retry.
- One code-agent GitHub reconciliation timed out. The next one-minute scheduler
  tick succeeded, so this is a bounded transient rather than a change target.
- Production nginx emitted no 5xx responses in the current 72-hour window. The
  observed 4xx/444 traffic is rejected internet scanning and requires no change.
- Local PM2 logs occupy approximately 1.1 GB and no PM2 or system log rotation is
  configured. Grafana Alloy forwards them, but does not bound local disk usage.

Google Cloud requires the Pub/Sub service agent to have publisher permission on
the dead-letter topic and subscriber permission on the source subscription so it
can publish and acknowledge forwarded messages. Pub/Sub subscription retention
can be configured up to 31 days.

References:

- <https://docs.cloud.google.com/pubsub/docs/dead-letter-topics>
- <https://docs.cloud.google.com/pubsub/docs/subscription-properties>

## Goals

1. Make dead-letter forwarding correct for every active subscription with a
   dead-letter policy.
2. Separate production dead letters from retained development-named DLQs.
3. Preserve failed messages long enough for controlled incident response.
4. Alert on both DLQ backlog and failures in the forwarding mechanism itself.
5. Make scheduled Linear syncs retry when any connected user was not synced.
6. Prevent production deployment from succeeding while any PM2 service is
   unhealthy or immediately crash-looping.
7. Bound local PM2 log storage without interrupting Grafana Alloy collection.
8. Deliver the changes through a PR to `development`, then verify dev, apply the
   retained GCP infrastructure changes, and verify production.

## Non-Goals

- Recovering the expired 905 WhatsApp DLQ entries; GCP no longer retains them.
- Replacing Pub/Sub with a different broker.
- Adding a permanent BigQuery or Cloud Storage archive in this change. A 31-day
  inspection window plus an explicit runbook is sufficient for the observed
  traffic and avoids another data-retention surface.
- Changing the public API or any Pub/Sub push endpoint.
- Treating rejected scanner traffic or one self-healed GitHub timeout as product
  failures.
- Reworking WhatsApp delivery into exactly-once processing. Pub/Sub remains
  at-least-once and consumers must retain their existing idempotency guarantees.

## Chosen Approach

Create dedicated production DLQ topics and inspection subscriptions for all 11
Hetzner production push subscriptions. Fix the shared Terraform modules and the
retained audio transcription subscription so the missing subscriber grant cannot
recur elsewhere. Keep the existing development-named DLQs for their retained
topics, but production subscriptions stop forwarding to them.

This is preferred over repairing the current shared DLQs in place because it
gives alerts, retention, ownership, and runbooks unambiguous production resource
names. It is preferred over a permanent export archive because the current volume
does not justify the extra storage pipeline and data-governance burden.

## Architecture

### 1. Dedicated Hetzner production DLQs

For every entry in `local.hetzner_pubsub_push_subscriptions`, Terraform creates:

- topic: `${subscription_name}-dlq`, for example
  `intexuraos-whatsapp-send-prod-hetzner-dlq`;
- inspection subscription: `${subscription_name}-dlq-sub`;
- `message_retention_duration = "2678400s"` (31 days);
- `expiration_policy { ttl = "" }`;
- `roles/pubsub.publisher` on the DLQ topic for
  `service-${project_number}@gcp-sa-pubsub.iam.gserviceaccount.com`;
- `roles/pubsub.subscriber` on the source production subscription for the same
  service agent.

The source subscription's `dead_letter_policy.dead_letter_topic` points to the
new production topic. The change is in place and does not replace the source
subscription or change its push endpoint, filter, OIDC identity, retry policy, or
delivery-attempt limit.

### 2. Retained subscription and module correctness

The explicit `google_pubsub_subscription.audio_stored_push` resource receives
the same Pub/Sub service-agent subscriber grant. Its DLQ inspection subscription
retention increases to 31 days.

Both `terraform/modules/pubsub-push` and `terraform/modules/pubsub` gain the
service-agent subscriber binding adjacent to their existing DLQ publisher
binding. Their DLQ inspection subscriptions use 31-day retention. The push
module's subscriber binding follows `enable_push_subscription`, so disabled
retired Cloud Run consumers do not reference a missing subscription.

The remaining retained development DLQ subscriptions also receive 31-day
retention through the shared module. No development topic or subscription is
renamed or removed.

### 3. DLQ monitoring and operations

Cloud Monitoring covers two distinct failure modes:

1. A DLQ inspection subscription has undelivered messages.
2. `pubsub.googleapis.com/subscription/dead_letter_message_count` records a
   response code other than `success`.

The backlog filter includes both `*-dlq-sub` and the retained
`*-dlq-*-inspect` naming form. Alert documentation identifies the source
subscription, states the 31-day deadline, and links to the operations runbook.
The existing configured notification channels remain the delivery mechanism.

The runbook defines a conservative workflow:

1. Record source subscription, publish time, delivery count, payload size, and a
   payload hash without printing private message content.
2. Classify the failure as permanent payload rejection, transient dependency
   failure, deployment outage, or forwarding/IAM failure.
3. Confirm the consumer fix and its idempotency behavior before replay.
4. Republish only selected messages with their original correlation metadata.
5. ACK a DLQ message only after the replay publish succeeds or an operator
   explicitly classifies it as non-replayable.
6. Verify the source backlog, DLQ backlog, forwarding metric, and consumer logs.

Blind bulk replay is forbidden because the expired incident contained repeated
copies of the same poison message.

### 4. Linear scheduled sync propagation

`fullSyncAllUsers()` continues processing every connected user, but records each
failed result. If any user fails, it returns an error after the loop instead of a
successful aggregate. `UPSTREAM_UNAVAILABLE` is preserved when any failure is
transient so the route returns `503` and Cloud Scheduler performs its configured
retry. Other failures preserve their existing domain error mapping.

A successful result still reports `userCount` and `totalIssues`. No partial
success is advertised as a completed sync.

### 5. Production deployment readiness

`scripts/hetzner/reload-pm2.sh` derives health URLs from every rendered PM2 app
with a numeric `PORT`, instead of defaulting to settings and user service only.
The deploy waits for all 18 `/health` endpoints and requires consecutive healthy
checks before saving the PM2 process list. A process that briefly reports
`online` and then exits therefore fails the deployment.

An explicit `PM2_HEALTH_URLS` override remains available for controlled tests.
Failure output lists only unhealthy service URLs and the PM2 status; it does not
print environment values.

The GitHub deployment workflow keeps its existing public-origin smoke tests.
Those checks run only after the all-service local readiness gate succeeds.

### 6. PM2 log rotation

A root-run installer provisions `/etc/logrotate.d/intexuraos-pm2` on every
production deployment and during host provisioning. The policy is:

- rotate daily;
- rotate early when an individual log exceeds 100 MB;
- retain 14 rotations;
- compress old logs with delayed compression;
- skip missing and empty files;
- create files for the `deploy` user;
- call `pm2 reloadLogs` after rotation so PM2 reopens file descriptors.

Grafana Alloy already excludes compressed/backup files and continues forwarding
the active logs. Installation is idempotent and validates the generated
logrotate policy before returning success.

## Error Handling

- Terraform creates IAM bindings before production dead-letter behavior is
  verified. A targeted plan must contain no source-subscription replacement or
  deletion.
- A failed Terraform apply stops delivery work; no direct `gcloud` resource
  creation is used as a substitute.
- A failed Linear user sync makes the scheduler request non-2xx only after the
  remaining users have been attempted.
- Any unhealthy PM2 service fails the production deployment before `pm2 save`.
- Logrotate installation or validation failure fails the deployment rather than
  leaving local retention unbounded.
- Synthetic DLQ verification uses an invalid WhatsApp event with no valid
  recipient and a unique test correlation ID. It cannot send a WhatsApp message.

## Testing and Verification

Implementation follows test-first development:

- Static Terraform regression tests assert the production DLQ resource names,
  publisher and subscriber IAM bindings, 31-day retention, and absence of
  source-subscription replacement constructs.
- Shared-module tests assert that every dead-letter policy has both required
  service-agent roles.
- Linear domain tests first demonstrate that an individual sync failure is
  currently swallowed, then require an error after all users were attempted.
- Linear route tests require `503` for a transient partial failure and `200` only
  when every user succeeds.
- Hetzner runtime tests require health discovery for all rendered PM2 apps and a
  stability window.
- Logrotate installer tests cover prod guard, generated policy, validation,
  idempotent installation, and deployment/provision integration.

Repository gates:

1. Relevant workspace verification for `linear-agent` and scripts.
2. Terraform formatting and validation after provider/module initialization.
3. Targeted Terraform plans using the explicit service-account credential and
   cleared emulator variables.
4. `pnpm run ci:tracked` before every commit and again after rebasing onto the
   latest `origin/development`.

Post-merge delivery verification:

1. Confirm the home-dev checkout reaches the merged commit and all dev PM2
   services are online and healthy.
2. Confirm the GitHub Hetzner production deployment succeeds and all 18 local
   health endpoints plus public smoke checks pass.
3. Apply the retained dev Terraform root for module, monitoring, and audio
   subscription changes using the service-account key.
4. Apply the Hetzner production Terraform root for dedicated production DLQs and
   source-subscription IAM.
5. Verify all 12 source subscriptions grant the service agent subscriber role.
6. Publish one uniquely marked invalid WhatsApp event, wait for successful
   forwarding, inspect only that DLQ entry, and ACK only that synthetic entry.
7. Verify `dead_letter_message_count{response_code="success"}`, zero source
   backlog, zero production DLQ backlog after cleanup, no production 5xx, active
   Alloy and logrotate configuration, and bounded PM2 log files.

## Endpoint Changes

### Modified

- `POST /internal/linear/sync-all`: returns the existing mapped non-2xx error
  response when at least one connected user fails to sync; returns `200` only
  when all connected users complete.

### Created

- None.

### Removed

- None.

### Unchanged

- All public API endpoints.
- All Pub/Sub push endpoint paths and payload formats.
- All Scheduler endpoint paths other than the error propagation behavior stated
  above.

## Delivery and Rollback

The change is delivered from a feature branch in a PR targeting `development`.
After required checks pass, the PR is merged and both deployment paths are
monitored to completion.

Infrastructure is applied only after merge. Rollback does not delete DLQ data:

- application/script rollback uses the previous `development` commit through
  the normal deployment workflow;
- Terraform rollback may point source subscriptions back to the retained DLQ
  topics, but dedicated production DLQ topics and subscriptions remain until
  their retention window is empty and an explicit later cleanup is approved;
- IAM subscriber grants are safe to retain and are not removed during an
  incident rollback.

## Acceptance Criteria

1. Every active source subscription with a dead-letter policy has the service
   agent publisher role on its DLQ topic and subscriber role on the source.
2. All 11 Hetzner production subscriptions use dedicated `prod-hetzner` DLQs.
3. Every inspection DLQ retains unacknowledged messages for 31 days.
4. Monitoring alerts on DLQ backlog and unsuccessful forwarding responses.
5. A transient per-user Linear sync failure produces a scheduler-retryable
   response after all users have been attempted.
6. Production deployment fails if any rendered PM2 service cannot remain
   healthy.
7. Production PM2 logs rotate under the documented bounded policy while Alloy
   remains active.
8. CI, Terraform plans, dev verification, production deployment, Terraform
   applies, and the synthetic DLQ test all pass with no source or DLQ backlog
   remaining.
