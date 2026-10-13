# WhatsApp Message Digests

The historical migration is complete. The former one-shot Hetzner cutover
orchestrator and its candidate/compensation procedures are retired and must not
be executed.

Message Digest Service remains the canonical owner of definitions, schedules,
runs, history, and delivery decisions. WhatsApp Service remains the owner of
private message evidence and outbound delivery. The service documentation under
`docs/services/message-digest-service/` describes those contracts.

During the current Home PROD `basic` stage, Message Digest Service is not
running. Public `/api/message-digests` routes return `503`, the retained
`message_digest_runs` subscription is a pull subscription with no consumer, and
all Scheduler jobs stay paused through
`production_scheduler_jobs_enabled=false`. Do not publish digest runs or attempt
manual delivery while this limitation is active.

Restoring the feature requires a separately reviewed change that adds Message
Digest Service to the production profile, restores authenticated edge routing,
re-enables its delivery consumer and Scheduler job through Terraform, and
proves the service health, private evidence boundary, and outbound delivery
contract. Follow the [Home PROD runbook](../operations/home-prod-runbook.md) for
the current deployment and verification boundary.
