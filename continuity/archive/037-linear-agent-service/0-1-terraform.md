# Task 0-1: Add Terraform Configuration

## Tier

0 (Setup/Diagnostics)

## Context

The service scaffolding is created. Now we need to configure the infrastructure: Cloud Run service, IAM service account, and service URL in common env vars.

## Problem Statement

Need to add Terraform configuration for linear-agent to deploy it to GCP Cloud Run.

## Scope

### In Scope

- Add `linear_agent` to `local.services` map
- Add `linear_agent` to IAM service accounts
- Create Cloud Run service module
- Add service URL to `local.common_service_env_vars`
- Register Firestore collections in `firestore-collections.json`

### Out of Scope

- Pub/Sub topics (not needed for synchronous flow)
- Additional secrets beyond common_service_secrets

## Required Approach

1. **Read** `terraform/environments/dev/main.tf` for existing patterns
2. **Add** service to `local.services` map (around line 117-237)
3. **Add** service account to IAM module `service_accounts` array
4. **Add** service URL to `local.common_service_env_vars`
5. **Create** Cloud Run module following `calendar_agent` pattern
6. **Update** `firestore-collections.json` with new collections

## Step Checklist

- [ ] Add `linear_agent` to `local.services` map
- [ ] Add `"linear_agent"` to `module.iam.service_accounts` list
- [ ] Add `INTEXURAOS_LINEAR_AGENT_URL` to `local.common_service_env_vars`
- [ ] Create `module "linear_agent"` Cloud Run service block
- [ ] Update `firestore-collections.json` with `linear_connections` collection
- [ ] Update `firestore-collections.json` with `linear_failed_issues` collection
- [ ] Run `terraform fmt` to format
- [ ] Run `terraform validate` to verify

## Definition of Done

- Terraform validates without errors
- Terraform fmt shows no changes needed
- Firestore collections registered correctly

## Verification Commands

```bash
# Navigate to terraform directory
cd terraform/environments/dev

# Format terraform files
tf fmt -recursive

# Validate configuration
tf validate

# Check plan (optional - may require auth)
# tf plan

# Verify firestore collections
cat ../../../firestore-collections.json | jq '.collections | keys | map(select(startswith("linear")))'

# Return to root
cd ../../..
```

## Rollback Plan

```bash
git checkout terraform/environments/dev/main.tf
git checkout firestore-collections.json
```

## Reference Files

- `terraform/environments/dev/main.tf` - See `calendar_agent` module around line 1100+
- `firestore-collections.json`

## Terraform Additions

### local.services (add to map around line 223-237)

```hcl
linear_agent = {
  name      = "intexuraos-linear-agent"
  app_path  = "apps/linear-agent"
  port      = 8080
  min_scale = 0
  max_scale = 1
}
```

### local.common_service_env_vars (add URL)

```hcl
INTEXURAOS_LINEAR_AGENT_URL = "https://${local.services.linear_agent.name}-${local.cloud_run_url_suffix}"
```

### module.iam (add to service_accounts array)

```hcl
"linear_agent",
```

### module "linear_agent" (add after calendar_agent module)

```hcl
module "linear_agent" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.linear_agent.name
  service_account = module.iam.service_accounts["linear_agent"]
  port            = local.services.linear_agent.port
  min_scale       = local.services.linear_agent.min_scale
  max_scale       = local.services.linear_agent.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/linear-agent:latest"

  secrets  = local.common_service_secrets
  env_vars = local.common_service_env_vars

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
  ]
}
```

### firestore-collections.json additions

```json
"linear_connections": {
  "owner": "linear-agent",
  "description": "Linear API key connections and team configuration"
},
"linear_failed_issues": {
  "owner": "linear-agent",
  "description": "Failed Linear issue creations for manual review"
}
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
