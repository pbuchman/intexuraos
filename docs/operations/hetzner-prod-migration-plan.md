# Hetzner Production Migration Plan (Retired)

The Hetzner VM, SSH deployment, certbot, Terraform bootstrap, and message-digest
cutover procedures are retired and must not be executed. Production now runs as
the isolated Home PROD runtime described in the
[Home PROD runbook](./home-prod-runbook.md).

Historical Google resource addresses, service-account IDs, subscription names,
Scheduler names, the `hetzner-prod` runtime audience, and the Terraform backend
prefix remain unchanged for compatibility and state safety.
