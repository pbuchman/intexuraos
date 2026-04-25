# Prod Observability (INT-1538-S8)

This directory provisions ONLY the prod observability surface required by
[INT-1538-S8](https://linear.app/intexuraos): monitoring notification
channels (email + Slack) and the `code_tasks_failed_rate` alert policy
bound to the custom metric written by `@intexuraos/common-metrics`.

Full prod infrastructure (Cloud Run services, Firestore, Pub/Sub topics,
load balancer, etc.) is intentionally out of scope for INT-1538-S8 and
will be added in a later slice.

## Pre-requisites

Before running `terraform init` for this environment:

1. **GCS state bucket** `intexuraos-prod-pbuchman-terraform-state` must
   already exist. It is provisioned out-of-band (the bucket cannot be
   managed by the same Terraform state it would store) and must be
   created before `terraform init` is run for the first time.
2. **Slack bot token** with the `chat:write` scope must be provisioned
   in the target Slack workspace and pasted into `terraform.tfvars` as
   `slack_auth_token` before `terraform apply`. Without `chat:write`,
   the Slack notification channel can be created but `chat.postMessage`
   calls from Cloud Monitoring will be rejected at delivery time.

## Usage

```bash
cd terraform/environments/prod
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars to set alert_email and slack_auth_token
terraform init
terraform plan
terraform apply
```

`alert_email` is REQUIRED — there is no default — so prod cannot be
applied without an on-call address. `slack_auth_token` is marked
sensitive in the variable definition.
