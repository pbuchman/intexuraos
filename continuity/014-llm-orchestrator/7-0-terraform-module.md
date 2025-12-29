# Task 7-0: Create Terraform Module

**Tier:** 7 (Deployment — depends on backend complete)

---

## Context Snapshot

- LLM Orchestrator service implemented (Tier 5)
- Need Cloud Run deployment
- Following patterns from existing Terraform modules

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create Terraform module for llm-orchestrator-service:

1. Cloud Run service
2. Service account with Firestore access
3. Secret Manager references

---

## Scope

**In scope:**

- Cloud Run service module
- Service account creation
- IAM bindings for Firestore
- Secret references
- Environment variables

**Non-scope:**

- Cloud Build (task 7-1)
- API docs hub (task 7-2)

---

## Required Approach

### Step 1: Create module directory

```bash
mkdir -p terraform/modules/llm-orchestrator-service
```

### Step 2: Create main.tf

```hcl
# terraform/modules/llm-orchestrator-service/main.tf

resource "google_service_account" "llm_orchestrator" {
  account_id   = "llm-orchestrator-sa"
  display_name = "LLM Orchestrator Service Account"
  project      = var.project_id
}

resource "google_project_iam_member" "firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.llm_orchestrator.email}"
}

resource "google_project_iam_member" "secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.llm_orchestrator.email}"
}

resource "google_cloud_run_v2_service" "llm_orchestrator" {
  name     = "llm-orchestrator-service"
  location = var.region
  project  = var.project_id

  template {
    service_account = google_service_account.llm_orchestrator.email

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      env {
        name  = "PORT"
        value = "8080"
      }

      env {
        name  = "NODE_ENV"
        value = var.environment
      }

      env {
        name  = "USER_SERVICE_URL"
        value = var.user_service_url
      }

      env {
        name = "INTEXURAOS_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = "intexuraos-encryption-key"
            version = "latest"
          }
        }
      }

      env {
        name = "INTERNAL_AUTH_TOKEN"
        value_source {
          secret_key_ref {
            secret  = "internal-auth-token"
            version = "latest"
          }
        }
      }

      env {
        name = "WHATSAPP_ACCESS_TOKEN"
        value_source {
          secret_key_ref {
            secret  = "whatsapp-access-token"
            version = "latest"
          }
        }
      }

      env {
        name = "WHATSAPP_PHONE_NUMBER_ID"
        value_source {
          secret_key_ref {
            secret  = "whatsapp-phone-number-id"
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_access" {
  count    = var.allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.llm_orchestrator.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
```

### Step 3: Create variables.tf

```hcl
# terraform/modules/llm-orchestrator-service/variables.tf

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "image" {
  description = "Container image URL"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "user_service_url" {
  description = "URL of the user service"
  type        = string
}

variable "allow_unauthenticated" {
  description = "Allow unauthenticated access"
  type        = bool
  default     = false
}
```

### Step 4: Create outputs.tf

```hcl
# terraform/modules/llm-orchestrator-service/outputs.tf

output "service_url" {
  description = "URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.llm_orchestrator.uri
}

output "service_account_email" {
  description = "Service account email"
  value       = google_service_account.llm_orchestrator.email
}
```

### Step 5: Add to environment

Update `terraform/environments/dev/main.tf`:

```hcl
module "llm_orchestrator_service" {
  source = "../../modules/llm-orchestrator-service"

  project_id            = var.project_id
  region                = var.region
  image                 = "gcr.io/${var.project_id}/llm-orchestrator-service:latest"
  environment           = "dev"
  user_service_url      = module.user_service.service_url
  allow_unauthenticated = true
}
```

---

## Step Checklist

- [ ] Create module directory
- [ ] Create main.tf with Cloud Run + SA
- [ ] Create variables.tf
- [ ] Create outputs.tf
- [ ] Add module to dev environment
- [ ] Run `terraform fmt`
- [ ] Run `terraform validate`

---

## Definition of Done

1. Terraform module created
2. Service account with correct permissions
3. Secret Manager references configured
4. Module added to dev environment
5. `terraform validate` passes

---

## Verification Commands

```bash
cd terraform
terraform fmt -check -recursive
terraform validate
```

---

## Rollback Plan

If verification fails:

1. Remove module directory
2. Revert changes to environment main.tf

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
