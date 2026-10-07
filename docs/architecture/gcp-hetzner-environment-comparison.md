# GCP and Hetzner Environment Comparison (Historical)

The Hetzner host foundation described by the former version of this page is
retired. Persistent application data and the retained control plane remain in
the shared GCP project. Application services now run in the isolated Home PROD
runtime.

See the [Home PROD runbook](../operations/home-prod-runbook.md) and
[`terraform/README.md`](../../terraform/README.md). Historical Google names and
Terraform addresses containing `hetzner` remain unchanged for identity and
state continuity.
