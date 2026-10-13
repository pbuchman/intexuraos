# One-cutoff scheduler reactivation

This is an operator procedure for the approved Home PROD restoration. The tool does not deploy services, enable Scheduler jobs, delete history, seek Pub/Sub subscriptions, or alter running code workers. Choose one project and one UTC cutoff T0 for the whole operation. Review the generated manifest before applying it.

## Preconditions

Deploy the new digest/code replay guards and receipt handling before applying the manifest. Keep the 14 Terraform-managed Scheduler jobs disabled and wait for scheduler HTTP requests and digest generation/delivery claims to drain. Keep worker callback and WhatsApp receipt processing available. Do not run a merge-queue tick or modify affected schedules concurrently. A manifest with any blocked item is rejected as a whole; wait for its valid claim to finish and make a new dry-run before any apply.

Dry-run needs Firestore read access to `calendar_schedules`, `whatsapp_notification_markers`, `message_digest_definitions`, `message_digest_states`, `message_digest_runs`, `message_digest_dispatch_outbox`, `code_tasks`, and `merge_queue_watches`. Apply needs transactional read/update on those collections and create/update on the code-agent-owned `home_prod_resume_policy` and `home_prod_resume_audit` collections. It also uses code-agent's existing repository to recompute affected `task_group_summaries` and `user_group_counts` from authoritative tasks, so these existing derived collections need read/write access. `roles/datastore.viewer` can provide read-only access; an approved operator identity with `roles/datastore.user` can perform apply. Provision persistent infrastructure and IAM through Terraform. The tool uses Application Default Credentials and an explicit project; it needs no Scheduler or Pub/Sub mutation permission.

Run from the repository with dependencies installed and no `FIRESTORE_EMULATOR_HOST` configured (the production CLI rejects it). Store the manifest in a private operator directory. The dry-run creates a new regular file with mode 0600 and refuses overwrite/symlinks. Apply opens with `O_NOFOLLOW` and checks the opened file's owner, regular-file type, and permissions.

## Commands

Set these values explicitly; the example cutoff is illustrative and must be replaced by the approved T0:

```sh
RESUME_PROJECT='approved-production-project'
RESUME_CUTOFF='2026-10-12T12:00:00.000Z'
RESUME_MANIFEST='/private/operator/path/resume-t0.json'
pnpm exec tsx scripts/home-prod/resume-schedules.mts dry-run "$RESUME_PROJECT" "$RESUME_CUTOFF" "$RESUME_MANIFEST"
```

Review the private manifest: project/cutoff, operation count, safe patches, expected document versions, skipped reasons, future cadence times, and an empty `blocked` array. Output contains only counts and the SHA-256 manifest hash. No message or task payload is included. Active digest definition/state checkpoint changes and retirement of their old generation/delivery/outbox work share one Firestore transaction. Paused/migrating definitions, silent/migration/audit history, previously accepted sends, running/dispatched code tasks and their user leases are preserved. Calendar daily local cadence is calculated by the same helper as calendar-agent, including `lastRunLocalDate`.

Each resumed active calendar schedule and digest definition receives `resumeCutoff=T0` so retained pre-T0 executions do not count as current backlog. Calendar operations atomically mark only their owner's exact older schedule-run correlation markers with `skippedBeforeResume=T0`, preserving all ingestion, receipt and transport evidence. Marker ownership/run/date/hash binding and document versions are rechecked before apply; a calendar operation over 450 documents blocks for separate review.

Copy the reviewed hash exactly:

```sh
RESUME_HASH='64-lowercase-hex-digits-from-dry-run'
pnpm exec tsx scripts/home-prod/resume-schedules.mts apply "$RESUME_PROJECT" "$RESUME_CUTOFF" "$RESUME_MANIFEST" "$RESUME_HASH"
```

Apply validates the full schema, operation IDs, allowed collections/fields and hash before reserving an immutable `{projectId, cutoff, manifestHash}` policy with status `preparing`. Each operation checks this fence, document update versions, and current domain eligibility, then writes its audit marker atomically with its patches. Replay guards enforce the cutoff in both `preparing` and `applied` states. After canonical cancellations, affected task-group summaries and counts are recomputed idempotently from source tasks; durable `task_group_summary` audit rows record `preparing`, `failed` or `applied` progress without notifications or worker cancellation. Only a completely applied manifest with successful derived recomputation changes policy status to `applied`.

## Interrupted apply and conflicts

For a transient failure, leave Scheduler jobs disabled and repeat the exact apply command using the same untouched file, hash, project and T0. Committed operation markers are checked before original expected versions, so already completed operations are never overwritten. Uncommitted operations still require their expected versions. A derived-recomputation failure leaves the policy `preparing` and its durable audit `failed`; repeating the exact command retries incomplete summaries without cancelling tasks again. An `applied` policy and exact audit binding make a repeat apply a no-op for service documents.

If `EXPECTED_VERSION_CONFLICT`, `RESUME_STATE_CONFLICT`, or any binding conflict occurs, stop reactivation. Keep the policy and audit records intact and keep affected jobs disabled. Inspect the conflicting document and its concurrent owner read-only. An uncommitted document changed after dry-run cannot be made eligible by blindly editing its expected version, altering the file/hash, deleting the policy, or generating a fresh manifest: the immutable binding deliberately rejects these shortcuts. If no apply has reserved a policy, a fresh dry-run is safe. After reservation, recovery requires a separately reviewed corrective operation that reconciles the specific concurrent change and preserves committed checkpoints, valid leases and worker/receipt evidence. This CLI intentionally supplies no automatic rebase or policy reset.

Never roll checkpoints backward or revive `SKIPPED_BEFORE_RESUME`/`OBSOLETE_SCHEDULE_WINDOW` runs or outboxes. The skip audit retains history, and future downtime uses current-only cadence windows with a separate content-free skip-range audit.

## Completion checks

Read the policy and audit markers and confirm status `applied`, matching cutoff/hash/project, one marker per manifest operation, and applied `task_group_summary` markers for affected groups. Confirm calendar/digest nextRunAt values are future cadence boundaries, digest checkpoints equal T0, retired old outboxes are terminal, and queued old tasks/watches are cancelled with updated group summaries/counts while running/dispatched task evidence and user lease documents remain unchanged.

The coordinator can then re-enable the 14 jobs through Terraform. Check internal-auth protected `/internal/monitoring/status` on code-agent and message-digest-service and the corresponding linear/calendar/WhatsApp endpoints. Code-agent must return all nine scheduler keys; digest returns `message_digest_tick` and only aggregate notification counts/timestamps. Empty ticks are persisted as successful; HTTP failures, partial logical failures and publisher retries are failed. `sent` remains transport acceptance; delivered/read confirmation establishes notification success. Missing confirmation alone must never cause a resend.

Digest provider-failed confirmations remain observable for seven days from immutable transport acceptance, allowing later delivered/read proof to heal the state without resending. Delivered/read or retention expiry stops receipt polling; unresolved accepted history before T0 stays intact and is excluded from current backlog by the definition cutoff.
