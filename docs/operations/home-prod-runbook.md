# Home PROD Runbook

Home PROD runs the application on the Home Dev machine under the dedicated
`intexuraos-prod` account. Deployments are manual, exact-SHA, and fix-forward.
The GitHub workflow admits only the current `development` SHA after its CI run
passes, reconciles the protected numeric secret-package version with the
repository manifest, and invokes the fixed privileged launcher.

## Safe Defaults and Full Restoration

The `basic` production profile runs 17 Fastify apps on loopback ports `181xx`.
Dedicated nginx listens only on `127.0.0.1:18080`; shared Caddy and the existing
Cloudflare Tunnel own public ingress. Research Agent and Message Digest Service
are unavailable in that profile and their public routes return `503`. The `full`
profile runs all 19 services and restores their public and authenticated internal
routes. This document describes capability and rollout gates, not evidence that
a deployment or Terraform apply has already occurred.

Five retained subscriptions stay present as pull subscriptions with no
consumer: `message_digest_runs`, `research_process`, `llm_call`,
`llm_analytics`, and `pr_triage`. The other seven subscriptions retain push
delivery by default. All 14 production Scheduler jobs are paused through
`production_scheduler_jobs_enabled=false`, with
`production_scheduler_enabled_job_keys=[]` and
`production_pubsub_push_enabled_subscription_keys=[]`. A job runs only when its
key is selected and the master switch is true. The historical
`activate_hetzner_async_consumers` input must remain `true`; it is a compatibility
pin that preserves the existing empty immutable filters.

The basic-stage checks prove release admission, edge delivery, OIDC validation,
and selected handler branches. They do not prove the unavailable research or
digest features, scheduled execution, or every user-facing integration.

## Fixed Runtime

| Boundary | Value |
| --- | --- |
| Runtime user/home | `intexuraos-prod` / `/home/intexuraos-prod` |
| Canonical clone | `/home/intexuraos-prod/deploy/intexuraos` |
| Code releases | `/home/intexuraos-prod/deploy/releases/<sha>.<attempt>` |
| Active code | `/home/intexuraos-prod/deploy/current` |
| Web releases | `/var/www/intexuraos-prod/web/releases/<sha>` |
| Active web | `/var/www/intexuraos-prod/web/current` |
| PM2 state | `/home/intexuraos-prod/.pm2-intexuraos-prod` |
| Runtime projection | `/home/intexuraos-prod/.config/intexuraos/prod` |
| PM2 unit | `intexuraos-home-prod-pm2.service` |
| Edge unit | `intexuraos-home-prod-nginx.service` |
| Log collector | `intexuraos-home-prod-alloy.service` |

Host bootstrap, edge installation, and observability installation are owned by
`pbuchman-dev/machine-setup/intexuraos-home-prod.md`. Application deployment
does not edit shared Caddy, restart shared Alloy, install system packages, or
change persistent infrastructure.

## Pre-deploy

1. Require a clean reviewed commit at the current `origin/development` SHA.
2. Require the CI workflow for that exact SHA to have concluded successfully.
3. Verify the protected `PROD_SECRET_PACKAGE_VERSION` is a positive integer and
   equals `packages.prod.stableVersion` in
   `config/environments/secret-packages.json`.
4. Verify the dedicated clone is clean and the root-owned provisioner key and
   candidate directory retain their documented ownership and modes.
5. Record only the SHA, numeric package version, workflow run ID, and PASS/FAIL
   evidence. Never print package payloads, `.env.prod`, service-account JSON,
   internal tokens, or private request bodies.

Dispatch `.github/workflows/deploy.yml` with target `home-prod`. The bounded
launcher fetches the exact package version into a root-owned temporary file.
The unprivileged driver then builds an isolated candidate, validates its exact
17-app `basic` or 19-app `full` loopback runtime from the package's validated
`INTEXURAOS_PROD_PROFILE`, builds the matching web candidate, and checks reserved-port
ownership before changing active links or stopping PM2.

Candidate rejection leaves the active runtime, links, and secret projection
unchanged. Once activation starts, the driver removes the saved PM2 dump before
publishing the new projection. A failure is repaired forward with the same
reviewed package or a new reviewed commit. Never restore an old package, key,
projection, or Terraform state. Firestore data remains persistent throughout;
do not clear collections, databases, or emulator data as part of recovery.

## Release verification

After deployment, require:

- the active code and web links resolve to the admitted SHA release;
- `intexuraos-home-prod-pm2.service`, `intexuraos-home-prod-nginx.service`, and
  `intexuraos-home-prod-alloy.service` are active;
- the release's `.intexuraos-prod-profile` marker agrees with the pinned runtime
  projection, rendered edge, boot validator and public build capability;
- PM2 contains exactly the selected profile's 17 or 19 apps, all online, bound to
  `127.0.0.1`, and using the `181xx` ports rendered into nginx;
- public `/healthz` and every available public service health route return the
  expected semantic health document;
- in `basic`, research and message-digest aliases return the documented `503`;
  in `full`, their semantic public health routes and authenticated internal
  delivery routes reach the corresponding loopback service;
- static artifacts contain only the public build allowlist and report the
  selected deployment capability;
- the dedicated Alloy endpoint is ready and PM2 log rotation remains bounded.

Preserve retained Pub/Sub backlog. Do not seek subscriptions, acknowledge or
discard messages to manufacture readiness. Historical cutover seek guidance is
superseded by the approved restoration policy. Before enabling each held
consumer, review its backlog age/count, dead-letter/retry behavior and terminal
handler outcomes; stop on unexpected side effects or a retry loop. Record only
aggregate and redacted operational evidence.

Use the checked-in helpers from the active release for diagnosis:

```bash
sudo -u intexuraos-prod env \
  HOME=/home/intexuraos-prod \
  PM2_HOME=/home/intexuraos-prod/.pm2-intexuraos-prod \
  /usr/local/lib/intexuraos-home-prod/bin/pm2 list

sudo systemctl status \
  intexuraos-home-prod-pm2.service \
  intexuraos-home-prod-nginx.service \
  intexuraos-home-prod-alloy.service
```

## Seven bounded new-event delivery proofs

Run these only with a newly generated synthetic user ID that has no WhatsApp
mapping or Intex session, and newly generated message, bookmark, job, and
correlation IDs that are absent before publication. Use the existing `-dev`
topics. Do not use `scripts/pubsub-publish-test.mjs`; it can create topics and
its fixtures are not safe for production proof.

For each event, record the Pub/Sub message ID, the matching nginx access-log
`2xx` acknowledgement, and the matching terminal handler log branch. Then
repeat the exact absence queries for the synthetic IDs. A publish receipt alone
is not acceptance.

| Topic | Safe payload shape | Required terminal result |
| --- | --- | --- |
| `intexuraos-whatsapp-send-dev` | `{"type":"whatsapp.message.send","userId":"<synthetic-user>","message":"home-prod smoke","correlationId":"<correlation-id>","timestamp":"<RFC3339>"}`; omit `idempotencyKey` | handler acknowledges `200` and skips the unmapped user; no outbound message |
| `intexuraos-whatsapp-media-cleanup-dev` | `{"type":"whatsapp.media.cleanup","userId":"<synthetic-user>","messageId":"<message-id>","gcsPaths":[],"timestamp":"<RFC3339>"}` | `200` with `deletedCount=0`; no object or record change |
| `intexuraos-whatsapp-webhook-process-dev` | `{"type":"whatsapp.linkpreview.extract","userId":"<synthetic-user>","messageId":"<message-id>","text":"home prod smoke without a URL"}` | `200` skip branch; no preview or message write |
| `intexuraos-transcription-completed-dev` | `{"type":"srt.transcription.completed","messageSource":"public_whatsapp","mediaKind":"audio","userId":"<synthetic-user>","messageId":"<message-id>","jobId":"<job-id>","status":"completed","transcript":"home prod smoke","timestamp":"<RFC3339>"}` | missing-message branch acknowledges `200`; no message write |
| `intexuraos-bookmark-enrich-dev` | `{"type":"bookmarks.enrich","bookmarkId":"<bookmark-id>","userId":"<synthetic-user>","url":"https://example.invalid/smoke"}` | `NOT_FOUND` terminal branch acknowledges `200`; no bookmark write |
| `intexuraos-bookmark-summarize-dev` | `{"type":"bookmarks.summarize","bookmarkId":"<bookmark-id>","userId":"<synthetic-user>"}` | `NOT_FOUND` terminal branch acknowledges `200`; no bookmark write |
| `intexuraos-intex-message-ingest-dev` | `{"type":"intex.message.ingest","userId":"<synthetic-user>","messageId":"<message-id>","text":"","sourceType":"whatsapp_button","timestamp":"<RFC3339>","buttonResponse":{"buttonId":"intex_confirm:smoke:no","buttonTitle":"No","replyToWamid":"<message-id>"}}` | stale-session branch acknowledges `202`, emits one reply event, and the send consumer drops that reply for the unmapped user; no outbound message |

The preflight and postflight evidence must show no WhatsApp mapping or Intex
session for the synthetic user and no persisted records for the synthetic
message/bookmark IDs. Stop on any unexpected write, retry loop, nonterminal
branch, or outbound provider call.

## Terraform handoff

`terraform/prod-runtime` keeps the historical backend prefix
`terraform/state/prod-hetzner` and historical Google resource addresses. Only
the authorized operator may detach retired hcloud/bootstrap addresses from
remote state and apply. Subagents must not run remote state commands or apply;
the coordinating agent or operator performs only the explicitly authorized,
allowlisted detach and apply after a fresh backup and reviewed plan.

Before any reviewed apply, use a fresh private state backup and review the saved
plan. Restoration may change only the selected Scheduler pause flags, selected
five subscription push configurations, dedicated monitor IAM, and explicitly
reviewed notification TTL fields in the shared-GCP root. Any filter, name,
delivery identity, topic, dead-letter, retry, label, description or unrelated
resource change is a stop condition. Keep the seven existing push consumers and
all historical resource addresses intact.

## Staged Restoration Gates

1. Publish a complete, validated new PROD package version with
   `INTEXURAOS_PROD_PROFILE=full`. The checked-in stable pin remains `4` until a
   real version exists; old version 4 lacks the new required member and cannot
   pass the new loader schema. Build its successor through the canonical tool:

   ```bash
   node scripts/build-secret-package.mjs --environment prod \
     --project-id intexuraos-dev-pbuchman --base-version 4 \
     --override-env INTEXURAOS_PROD_PROFILE=/private/profile-value \
     --output /private/prod-candidate.json
   ```

   The override file must contain `full`, be private, and pass the existing
   unsafe-file checks. This migration admits only explicitly supplied missing
   members; all other members and types remain exact. Use the established
   one-shot publish/verification workflow in
   [Secret Packages Operations](secret-packages.md), then promote the actual
   numeric version in both the manifest and protected deployment input.
2. Install the reviewed host runtime changes before admitting the release. The
   fixed root-owned unprivileged deployment driver is not replaced by a code
   release. Its launcher must retain exactly two arguments: full SHA and positive
   numeric package version. Host edge installation must render
   `render-edge.mjs nginx full` from the admitted release; boot validation must
   derive the exact app set from its immutable profile marker.
3. Deploy and verify the full 19-service release while all schedules and five
   held consumers remain disabled. Prove the rendered edge accepts only POST
   from each intended Scheduler/restored-consumer identity and rejects another
   otherwise allowlisted identity. Service-owned internal-auth monitoring
   endpoints must report persisted job timestamps, including no-work successes
   and failures, without user identifiers or payloads.
4. Apply the reviewed dedicated monitor IAM before installing its executable
   host collector. The existing
   `ixos-home-orchestrator-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`
   host identity impersonates
   `intexuraos-home-monitor-prod@intexuraos-dev-pbuchman.iam.gserviceaccount.com`.
   Token Creator is scoped only to that monitor account. Its custom project
   role permits only `cloudscheduler.jobs.get`, `cloudscheduler.jobs.list` and
   `monitoring.timeSeries.list`; no new key or metrics-write role is created.
   Host commands must explicitly select both identities and use bounded deadlines.
5. Review the resume policy and audit produced by the separate resume operator;
   preserve real workers, leases and persisted data. Inspect retained backlog
   before selecting a consumer. Start with one reviewed job/consumer key and
   require fresh successful execution and expected delivery evidence before
   expanding the selection. Keep `production_scheduler_jobs_enabled=false` as
   the immediate master pause.

Use an explicit private variable file, never an automatically loaded restoration
file. The checked-in `terraform/prod-runtime/restoration.tfvars.example` lists
all 14 jobs and five held consumers as a final selection template; trim it for
each staged plan. Planning commands do not apply infrastructure:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
  terraform -chdir=terraform/prod-runtime plan \
  -var-file=/private/reviewed-restoration.tfvars -out=/private/restoration.tfplan
```

Only the authorized coordinating operator applies a reviewed plan and records
fresh live evidence. Do not infer operational restoration from source tests.

## Failure handling

- Before activation: correct the candidate failure; the live runtime remains
  unchanged.
- After PM2 stop or link activation: the reload helper removes only the new
  candidate apps, the driver restores the previous code and web links, and the
  saved PM2 dump remains absent. Reboot therefore starts an empty dedicated PM2
  namespace. Correct the cause and run the fixed launcher for the next admitted
  deployment, using the same reviewed package or a new reviewed commit. The
  operator must not run `pm2 resurrect` manually.
- After partial projection publication: rerun the complete loader with the same
  reviewed numeric version; never repair individual fields.
- Never prune release artifacts during deployment. Storage cleanup is a
  separate reviewed operation.
