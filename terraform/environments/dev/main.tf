# IntexuraOS Dev Environment
# This is the main entry point for the dev environment.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-central2"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "legacy_secret_manager_enabled" {
  description = "Keep legacy individual secret containers and accessors during package cutover and rollback soak. Disable only after verified rollback and at least 72 hours of healthy observation."
  type        = bool
  default     = true
}

variable "github_owner" {
  description = "GitHub repository owner"
  type        = string
  default     = "pbuchman"

  validation {
    condition     = var.github_owner == "pbuchman"
    error_message = "github_owner must remain pinned to pbuchman."
  }
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "intexuraos"

  validation {
    condition     = var.github_repo == "intexuraos"
    error_message = "github_repo must remain pinned to intexuraos."
  }
}

variable "github_repository_owner_id" {
  description = "Immutable numeric GitHub repository owner ID accepted by Workload Identity Federation"
  type        = string
  default     = "368465"

  validation {
    condition     = var.github_repository_owner_id == "368465"
    error_message = "github_repository_owner_id must remain pinned to 368465."
  }
}

variable "github_repository_id" {
  description = "Immutable numeric GitHub repository ID accepted by Workload Identity Federation"
  type        = string
  default     = "1118959310"

  validation {
    condition     = var.github_repository_id == "1118959310"
    error_message = "github_repository_id must remain pinned to 1118959310."
  }
}

variable "github_ref" {
  description = "Exact Git ref accepted by Workload Identity Federation"
  type        = string
  default     = "refs/heads/development"

  validation {
    condition     = var.github_ref == "refs/heads/development"
    error_message = "github_ref must remain pinned to refs/heads/development."
  }
}

variable "github_branch" {
  description = "GitHub branch to trigger builds"
  type        = string
  default     = "development"
}

variable "github_connection_name" {
  description = "Name of the Cloud Build GitHub connection (created manually via GCP Console)"
  type        = string
}

variable "enable_legacy_cloud_run_async_consumers" {
  description = "Keep legacy Cloud Run-targeted Pub/Sub pushes and app Scheduler jobs active. Disable after Hetzner async cutover."
  type        = bool
  default     = false
}

variable "audit_llms" {
  description = "Enable LLM API call audit logging to Firestore"
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Email address for monitoring alerts. Set to null to disable alerts."
  type        = string
  default     = null
}

variable "slack_auth_token" {
  description = "Slack bot OAuth token (xoxb-...) for the monitoring Slack notification channel. Leave null to skip provisioning the Slack channel."
  type        = string
  default     = null
  sensitive   = true
}

variable "slack_channel_name" {
  description = "Slack channel for monitoring alerts (e.g. \"#alerts\")."
  type        = string
  default     = "#alerts"
}

variable "service_urls" {
  description = "Generated service URL map emitted from apps/web/service-manifest.json for drift visibility."
  type        = map(string)
  default     = {}
}

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------

data "google_project" "current" {
  project_id = var.project_id
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  project_number = data.google_project.current.number

  versioned_runtime_config = {
    common = jsondecode(file("${path.module}/../../../config/environments/common.json"))
    dev    = jsondecode(file("${path.module}/../../../config/environments/dev.json"))
  }

  services = {
    user_service = {
      name      = "intexuraos-user-service"
      app_path  = "apps/user-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    notion_service = {
      name      = "intexuraos-notion-service"
      app_path  = "apps/notion-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    whatsapp_service = {
      name      = "intexuraos-whatsapp-service"
      app_path  = "apps/whatsapp-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    mobile_notifications_service = {
      name      = "intexuraos-mobile-notifications-service"
      app_path  = "apps/mobile-notifications-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    fishing_assistant_service = {
      name      = "intexuraos-fishing-assistant-service"
      app_path  = "apps/fishing-assistant-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    api_docs_hub = {
      name      = "intexuraos-api-docs-hub"
      app_path  = "apps/api-docs-hub"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    research_agent = {
      name      = "intexuraos-research-agent"
      app_path  = "apps/research-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    image_service = {
      name      = "intexuraos-image-service"
      app_path  = "apps/image-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    notes_agent = {
      name      = "intexuraos-notes-agent"
      app_path  = "apps/notes-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    bookmarks_agent = {
      name      = "intexuraos-bookmarks-agent"
      app_path  = "apps/bookmarks-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    code_agent = {
      name      = "intexuraos-code-agent"
      app_path  = "apps/code-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    app_settings_service = {
      name      = "intexuraos-app-settings-service"
      app_path  = "apps/app-settings-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    calendar_agent = {
      name      = "intexuraos-calendar-agent"
      app_path  = "apps/calendar-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    web_agent = {
      name      = "intexuraos-web-agent"
      app_path  = "apps/web-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    linear_agent = {
      name      = "intexuraos-linear-agent"
      app_path  = "apps/linear-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    hellscript_agent = {
      name      = "intexuraos-hellscript-agent"
      app_path  = "apps/hellscript-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    llm_usage_service = {
      name      = "intexuraos-llm-usage-service"
      app_path  = "apps/llm-usage-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    intex_agent = {
      name      = "intexuraos-intex-agent"
      app_path  = "apps/intex-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
  }

  common_labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "intexuraos"
  }

  public_origin                   = "https://intexuraos.cloud"
  retired_cloud_run_push_endpoint = "https://retired-cloud-run.invalid"
  retired_cloud_run_push_audience = local.retired_cloud_run_push_endpoint

  hetzner_runtime_env_vars = {
    INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL        = "${local.public_origin}/api/code"
    INTEXURAOS_CONVERSATION_ASSISTANT_MODEL       = "or:minimax/minimax-m3"
    INTEXURAOS_INTEX_AGENT_MODEL_SELECTOR_USER_ID = "disabled"
    INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED = "false"
    INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH       = "development"
    INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY        = "pbuchman/intexuraos"
    INTEXURAOS_WEB_APP_URL                        = local.public_origin
  }

  target_secret_containers = {
    "INTEXURAOS_SECRET_PACKAGE_DEV"       = "Atomic application secret package for local and dev runtimes"
    "INTEXURAOS_SECRET_PACKAGE_PROD"      = "Atomic application secret package for the production runtime"
    "INTEXURAOS_INTERNAL_AUTH_TOKEN"      = "Native internal auth token injected into the transcription Cloud Function"
    "INTEXURAOS_SPEECHMATICS_APP_API_KEY" = "Speechmatics API key for transcription Cloud Function"
  }

  legacy_secret_container_names = toset([
    "INTEXURAOS_CLOUDFLARE_API_TOKEN",
    "INTEXURAOS_DASHSCOPE_APP_API_KEY",
    "INTEXURAOS_ENCRYPTION_KEY",
    "INTEXURAOS_GITHUB_APP_PRIVATE_KEY",
    "INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET",
    "INTEXURAOS_GITHUB_WEBHOOK_SECRET",
    "INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET",
    "INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN",
    "INTEXURAOS_KIMI_APP_API_KEY",
    "INTEXURAOS_LINEAR_API_KEY",
    "INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY",
    "INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY",
    "INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID",
    "INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING",
    "INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY",
    "INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING",
    "INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING",
    "INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN",
    "INTEXURAOS_MIMO_APP_API_KEY",
    "INTEXURAOS_MINIMAX_APP_API_KEY",
    "INTEXURAOS_OPENAI_APP_API_KEY",
    "INTEXURAOS_OPENROUTER_APP_API_KEY",
    "INTEXURAOS_ORCHESTRATOR_SECRET",
    "INTEXURAOS_SENTRY_AUTOMATION_USER_ID",
    "INTEXURAOS_SENTRY_WEBHOOK_SECRET",
    "INTEXURAOS_SSL_PRIVATE_KEY",
    "INTEXURAOS_TOKEN_ENCRYPTION_KEY",
    "INTEXURAOS_WEBHOOK_VERIFY_SECRET",
    "INTEXURAOS_WHATSAPP_ACCESS_TOKEN",
    "INTEXURAOS_WHATSAPP_APP_SECRET",
    "INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID",
    "INTEXURAOS_WHATSAPP_VERIFY_TOKEN",
    "INTEXURAOS_WHATSAPP_WABA_ID",
  ])

  legacy_secret_containers = {
    for name in local.legacy_secret_container_names :
    name => "Legacy individual application secret retained during package migration"
  }

  # Preserve the exact pre-migration Cloud Run IAM address set during the
  # additive stage. The two native exceptions are target containers, but their
  # legacy broad bindings are removed only when the migration flag is disabled.
  legacy_cloud_run_secret_names = setunion(
    local.legacy_secret_container_names,
    toset([
      "INTEXURAOS_INTERNAL_AUTH_TOKEN",
      "INTEXURAOS_SPEECHMATICS_APP_API_KEY",
    ])
  )

  # The tracked source manifest is the single inventory for package builds.
  # Only legacyEnvNames and legacyFiles are Secret Manager containers; all
  # external file inputs are supplied out-of-band and receive no IAM binding.
  secret_package_source_manifest = jsondecode(file("${path.module}/../../../config/environments/secret-package-sources.json"))
  secret_package_dev_legacy_source_names = setunion(
    toset(local.secret_package_source_manifest.packages.dev.legacyEnvNames),
    toset(values(local.secret_package_source_manifest.packages.dev.legacyFiles))
  )
  secret_package_prod_legacy_source_names = setunion(
    toset(local.secret_package_source_manifest.packages.prod.legacyEnvNames),
    toset(values(local.secret_package_source_manifest.packages.prod.legacyFiles))
  )
  secret_package_native_source_names = toset([
    "INTEXURAOS_INTERNAL_AUTH_TOKEN",
    "INTEXURAOS_SPEECHMATICS_APP_API_KEY",
  ])
  secret_package_dev_active_source_names = setunion(
    setintersection(
      local.secret_package_dev_legacy_source_names,
      local.secret_package_native_source_names
    ),
    var.legacy_secret_manager_enabled ? local.secret_package_dev_legacy_source_names : toset([])
  )
  secret_package_prod_active_source_names = setunion(
    setintersection(
      local.secret_package_prod_legacy_source_names,
      local.secret_package_native_source_names
    ),
    var.legacy_secret_manager_enabled ? local.secret_package_prod_legacy_source_names : toset([])
  )

  hetzner_runtime_secret_names = toset([
    "INTEXURAOS_CLOUDFLARE_API_TOKEN",
    "INTEXURAOS_ENCRYPTION_KEY",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN",
    "INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET",
    "INTEXURAOS_GITHUB_WEBHOOK_SECRET",
    "INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET",
    "INTEXURAOS_INTERNAL_AUTH_TOKEN",
    "INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY",
    "INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY",
    "INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID",
    "INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING",
    "INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY",
    "INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING",
    "INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING",
    "INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN",
    "INTEXURAOS_OPENAI_APP_API_KEY",
    "INTEXURAOS_OPENROUTER_APP_API_KEY",
    "INTEXURAOS_ORCHESTRATOR_SECRET",
    "INTEXURAOS_SENTRY_WEBHOOK_SECRET",
    "INTEXURAOS_SENTRY_AUTOMATION_USER_ID",
    "INTEXURAOS_TOKEN_ENCRYPTION_KEY",
    "INTEXURAOS_WEBHOOK_VERIFY_SECRET",
    "INTEXURAOS_WHATSAPP_ACCESS_TOKEN",
    "INTEXURAOS_WHATSAPP_APP_SECRET",
    "INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID",
    "INTEXURAOS_WHATSAPP_VERIFY_TOKEN",
    "INTEXURAOS_WHATSAPP_WABA_ID",
  ])

  cloud_run_secret_manager_excluded_names = toset([
    "INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN",
    "INTEXURAOS_KIMI_APP_API_KEY",
    "INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY",
    "INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY",
    "INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID",
    "INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING",
    "INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY",
    "INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING",
    "INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING",
    "INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN",
  ])
}

# -----------------------------------------------------------------------------
# Enable required APIs
# -----------------------------------------------------------------------------

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "storage.googleapis.com",
    "compute.googleapis.com",
    "cloudscheduler.googleapis.com",
    "calendar-json.googleapis.com",
    "cloudfunctions.googleapis.com",
    "eventarc.googleapis.com",
    "apikeys.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_project_iam_audit_config" "secret_manager_data_read" {
  project = var.project_id
  service = "secretmanager.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }

  depends_on = [google_project_service.apis]
}

resource "google_apikeys_key" "firebase_browser" {
  name         = "d8251549-1bde-49c0-82a7-b0525a2fe688"
  project      = var.project_id
  display_name = "Browser key (auto created by Firebase)"

  restrictions {
    browser_key_restrictions {
      allowed_referrers = [
        "https://intexuraos.cloud/*",
        "https://dev.intexuraos.cloud/*",
        "http://localhost:3000/*",
      ]
    }

    api_targets {
      service = "firestore.googleapis.com"
    }

    api_targets {
      service = "identitytoolkit.googleapis.com"
    }

    api_targets {
      service = "securetoken.googleapis.com"
    }

    api_targets {
      service = "firebaseinstallations.googleapis.com"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.apis]
}

import {
  to = google_apikeys_key.firebase_browser
  id = "projects/intexuraos-dev-pbuchman/locations/global/keys/d8251549-1bde-49c0-82a7-b0525a2fe688"
}

# Additive rotation target for the browser API key exposed in Firebase web
# configuration. The imported key remains active until dev and prod verification.
resource "google_apikeys_key" "firebase_browser_replacement" {
  name         = "intexuraos-firebase-browser-2026"
  project      = var.project_id
  display_name = "IntexuraOS Firebase browser key (rotated 2026)"

  restrictions {
    browser_key_restrictions {
      allowed_referrers = [
        "https://intexuraos.cloud/*",
        "https://dev.intexuraos.cloud/*",
        "http://localhost:3000/*",
      ]
    }

    api_targets {
      service = "firestore.googleapis.com"
    }

    api_targets {
      service = "identitytoolkit.googleapis.com"
    }

    api_targets {
      service = "securetoken.googleapis.com"
    }

    api_targets {
      service = "firebaseinstallations.googleapis.com"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Artifact Registry
# -----------------------------------------------------------------------------

module "artifact_registry" {
  source = "../../modules/artifact-registry"

  project_id                            = var.project_id
  region                                = var.region
  environment                           = var.environment
  labels                                = local.common_labels
  cleanup_policy_dry_run                = false
  cleanup_keep_count                    = 1
  cleanup_delete_older_than             = "259200s"
  code_worker_cleanup_delete_older_than = "86400s"

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Static Assets Bucket
# -----------------------------------------------------------------------------

module "static_assets" {
  source = "../../modules/static-assets"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment
  labels      = local.common_labels

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Shared Content Bucket (publicly shared research HTML files)
# -----------------------------------------------------------------------------

module "shared_content" {
  source = "../../modules/shared-content"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment
  labels      = local.common_labels

  enable_research_agent_access   = true
  research_agent_service_account = module.iam.service_accounts["research_agent"]

  depends_on = [google_project_service.apis, module.iam]
}

# -----------------------------------------------------------------------------
# WhatsApp Media Bucket (private, no public access)
# -----------------------------------------------------------------------------

module "whatsapp_media_bucket" {
  source = "../../modules/whatsapp-media-bucket"

  project_id               = var.project_id
  region                   = var.region
  environment              = var.environment
  whatsapp_service_account = module.iam.service_accounts["whatsapp_service"]
  labels                   = local.common_labels

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# -----------------------------------------------------------------------------
# Generated Images Bucket (public, for AI-generated images)
# -----------------------------------------------------------------------------

module "generated_images_bucket" {
  source = "../../modules/generated-images-bucket"

  project_id                    = var.project_id
  region                        = var.region
  environment                   = var.environment
  enable_image_service_access   = true
  image_service_service_account = module.iam.service_accounts["image_service"]
  labels                        = local.common_labels

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# -----------------------------------------------------------------------------
# Firestore
# -----------------------------------------------------------------------------

module "firestore" {
  source = "../../modules/firestore"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Secret Manager
# -----------------------------------------------------------------------------

# Terraform owns containers and IAM only. Package/native values and versions are
# published outside Terraform so secret material never enters Terraform state.
module "secret_manager" {
  source = "../../modules/secret-manager"

  project_id  = var.project_id
  environment = var.environment
  labels      = local.common_labels

  secrets = merge(
    local.target_secret_containers,
    var.legacy_secret_manager_enabled ? local.legacy_secret_containers : {}
  )

  depends_on = [google_project_service.apis]
}

moved {
  from = google_secret_manager_secret.cloudflare_dns_api_token
  to   = google_secret_manager_secret.cloudflare_dns_api_token[0]
}

resource "google_secret_manager_secret" "cloudflare_dns_api_token" {
  count = var.legacy_secret_manager_enabled ? 1 : 0

  secret_id = "INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN"
  labels    = local.common_labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "hetzner_provisioner" {
  account_id   = "ixos-hetzner-provisioner-${var.environment}"
  display_name = "IntexuraOS Hetzner Provisioner (${var.environment})"
  description  = "Service account used by the Hetzner VM to load runtime secrets and certbot DNS credentials"
}

resource "google_service_account" "hetzner_runtime" {
  account_id   = "ixos-hetzner-runtime-${var.environment}"
  display_name = "IntexuraOS Hetzner Runtime (${var.environment})"
  description  = "Union runtime service account for PM2 services on the Hetzner VM"
}

resource "google_service_account" "home_dev_secret_renderer" {
  account_id   = "ixos-home-secret-renderer-${var.environment}"
  display_name = "IntexuraOS home-dev Secret Renderer (${var.environment})"
  description  = "Bootstrap identity that can read only the dev secret package"
}

resource "google_service_account" "home_dev_runtime" {
  account_id   = "ixos-home-runtime-${var.environment}"
  display_name = "IntexuraOS home-dev Runtime (${var.environment})"
  description  = "Least-privilege data-plane identity for local and home-dev PM2 services"
}

resource "google_service_account" "home_dev_orchestrator" {
  account_id   = "ixos-home-orchestrator-${var.environment}"
  display_name = "IntexuraOS home-dev Orchestrator (${var.environment})"
  description  = "Least-privilege host identity used only to pull code-worker images"
}

resource "google_service_account" "secret_package_dev_publisher" {
  account_id   = "ixos-secret-publisher-dev"
  display_name = "IntexuraOS DEV Secret Package Publisher"
  description  = "Migration identity that reads the exact DEV source inventory and adds DEV package versions"
}

resource "google_service_account" "secret_package_prod_publisher" {
  account_id   = "ixos-secret-publisher-prod"
  display_name = "IntexuraOS PROD Secret Package Publisher"
  description  = "Migration identity that reads the exact PROD source inventory and adds PROD package versions"
}

resource "google_service_account" "whatsapp_private_sync" {
  account_id   = "intexuraos-wa-private-sync-${var.environment}"
  display_name = "IntexuraOS Private WhatsApp Sync (${var.environment})"
  description  = "External bridge caller identity for private WhatsApp sync ingestion"
}

resource "google_secret_manager_secret_iam_member" "hetzner_provisioner_prod_package" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_PROD"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_secret_manager_secret_iam_member" "home_dev_secret_renderer_dev_package" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_DEV"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.home_dev_secret_renderer.email}"
}

resource "google_secret_manager_secret_iam_member" "secret_package_dev_publisher_version_adder" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_DEV"]
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${google_service_account.secret_package_dev_publisher.email}"
}

resource "google_secret_manager_secret_iam_member" "secret_package_prod_publisher_version_adder" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_PROD"]
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${google_service_account.secret_package_prod_publisher.email}"
}

resource "google_secret_manager_secret_iam_member" "secret_package_dev_publisher_target_accessor" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_DEV"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.secret_package_dev_publisher.email}"
}

resource "google_secret_manager_secret_iam_member" "secret_package_prod_publisher_target_accessor" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_PROD"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.secret_package_prod_publisher.email}"
}

resource "google_secret_manager_secret_iam_member" "secret_package_dev_publisher_target_metadata_viewer" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_DEV"]
  role      = "roles/secretmanager.viewer"
  member    = "serviceAccount:${google_service_account.secret_package_dev_publisher.email}"
}

resource "google_secret_manager_secret_iam_member" "secret_package_prod_publisher_target_metadata_viewer" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SECRET_PACKAGE_PROD"]
  role      = "roles/secretmanager.viewer"
  member    = "serviceAccount:${google_service_account.secret_package_prod_publisher.email}"
}

resource "google_secret_manager_secret_iam_member" "secret_package_dev_publisher_source_accessor" {
  for_each = local.secret_package_dev_active_source_names

  secret_id = module.secret_manager.secret_ids[each.value]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.secret_package_dev_publisher.email}"
}

resource "google_secret_manager_secret_iam_member" "secret_package_prod_publisher_source_accessor" {
  for_each = local.secret_package_prod_active_source_names

  secret_id = module.secret_manager.secret_ids[each.value]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.secret_package_prod_publisher.email}"
}

resource "google_artifact_registry_repository_iam_member" "home_dev_orchestrator_reader" {
  project    = var.project_id
  location   = var.region
  repository = module.artifact_registry.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.home_dev_orchestrator.email}"
}

resource "google_project_iam_member" "home_dev_runtime_project_roles" {
  for_each = toset([
    "roles/datastore.user",
    "roles/firebaseauth.admin",
    "roles/logging.logWriter",
    "roles/pubsub.publisher",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.home_dev_runtime.email}"
}

resource "google_storage_bucket_iam_member" "home_dev_runtime_bucket_object_admin" {
  for_each = {
    generated_images = module.generated_images_bucket.bucket_name
    shared_content   = module.shared_content.bucket_name
    whatsapp_media   = module.whatsapp_media_bucket.bucket_name
  }

  bucket = each.value
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.home_dev_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "hetzner_provisioner_runtime_secrets" {
  for_each = var.legacy_secret_manager_enabled ? local.hetzner_runtime_secret_names : toset([])

  secret_id = module.secret_manager.secret_ids[each.value]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

moved {
  from = google_secret_manager_secret_iam_member.hetzner_provisioner_cloudflare_dns
  to   = google_secret_manager_secret_iam_member.hetzner_provisioner_cloudflare_dns[0]
}

resource "google_secret_manager_secret_iam_member" "hetzner_provisioner_cloudflare_dns" {
  count = var.legacy_secret_manager_enabled ? 1 : 0

  secret_id = google_secret_manager_secret.cloudflare_dns_api_token[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

moved {
  from = google_secret_manager_secret_iam_member.hetzner_provisioner_ssl_private_key
  to   = google_secret_manager_secret_iam_member.hetzner_provisioner_ssl_private_key[0]
}

resource "google_secret_manager_secret_iam_member" "hetzner_provisioner_ssl_private_key" {
  count = var.legacy_secret_manager_enabled ? 1 : 0

  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SSL_PRIVATE_KEY"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_storage_bucket_iam_member" "hetzner_provisioner_terraform_state" {
  bucket = "${var.project_id}-terraform-state"
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_project_iam_member" "hetzner_provisioner_deployment_roles" {
  for_each = toset([
    "roles/cloudscheduler.admin",
    "roles/iam.serviceAccountViewer",
    "roles/pubsub.admin",
    "roles/serviceusage.serviceUsageConsumer",
    "roles/serviceusage.serviceUsageViewer",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_service_account_iam_member" "hetzner_provisioner_message_digest_user" {
  service_account_id = google_service_account.message_digest_service.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_service_account_iam_member" "hetzner_provisioner_scheduler_user" {
  service_account_id = google_service_account.cloud_scheduler.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_secret_manager_secret_iam_member" "hetzner_runtime_secrets" {
  for_each = var.legacy_secret_manager_enabled ? local.hetzner_runtime_secret_names : toset([])

  secret_id = module.secret_manager.secret_ids[each.value]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_runtime.email}"
}

resource "google_project_iam_member" "hetzner_runtime_project_roles" {
  for_each = toset([
    "roles/datastore.user",
    "roles/firebaseauth.admin",
    "roles/logging.logWriter",
    "roles/pubsub.publisher",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"
}

resource "google_service_account_iam_member" "hetzner_runtime_token_creator" {
  service_account_id = google_service_account.hetzner_runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.hetzner_runtime.email}"
}

resource "google_service_account_iam_member" "whatsapp_private_sync_token_creator" {
  service_account_id = google_service_account.whatsapp_private_sync.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.whatsapp_private_sync.email}"
}

resource "google_storage_bucket_iam_member" "hetzner_runtime_bucket_object_admin" {
  for_each = {
    generated_images = module.generated_images_bucket.bucket_name
    shared_content   = module.shared_content.bucket_name
    whatsapp_media   = module.whatsapp_media_bucket.bucket_name
  }

  bucket = each.value
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.hetzner_runtime.email}"
}

# -----------------------------------------------------------------------------
# IAM - Service Accounts
# -----------------------------------------------------------------------------

module "iam" {
  source = "../../modules/iam"

  project_id  = var.project_id
  environment = var.environment
  services    = local.services

  legacy_secret_manager_enabled = var.legacy_secret_manager_enabled
  secret_ids = {
    for name, secret_id in module.secret_manager.secret_ids : name => secret_id
    if contains(local.legacy_cloud_run_secret_names, name) &&
    !contains(local.cloud_run_secret_manager_excluded_names, name)
  }

  depends_on = [
    google_project_service.apis,
    module.secret_manager,
  ]
}

# -----------------------------------------------------------------------------
# Claude Code Dev Service Account (local development)
# -----------------------------------------------------------------------------

module "claude_code_dev" {
  source = "../../modules/claude-code-dev"

  project_id = var.project_id

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "claude_code_dev_secret_metadata_viewer" {
  project = var.project_id
  role    = "roles/secretmanager.viewer"
  member  = "serviceAccount:${module.claude_code_dev.service_account_email}"

  condition {
    title       = "intexuraos-secret-metadata-only"
    description = "Allow Terraform refresh of IntexuraOS secret metadata without payload access"
    expression  = "resource.type == \"secretmanager.googleapis.com/Secret\" && resource.name.startsWith(\"projects/${data.google_project.current.number}/secrets/INTEXURAOS_\")"
  }
}

# The current migration operator can create/list replacement keys only for the
# identities that must be rotated/bootstrap-rendered. This is intentionally
# resource-level; do not grant serviceAccountKeyAdmin at project scope.
resource "google_service_account_iam_member" "secret_migration_runtime_key_admin" {
  service_account_id = google_service_account.hetzner_runtime.name
  role               = "roles/iam.serviceAccountKeyAdmin"
  member             = "serviceAccount:${module.claude_code_dev.service_account_email}"
}

resource "google_service_account_iam_member" "secret_migration_renderer_key_admin" {
  service_account_id = google_service_account.home_dev_secret_renderer.name
  role               = "roles/iam.serviceAccountKeyAdmin"
  member             = "serviceAccount:${module.claude_code_dev.service_account_email}"
}

resource "google_service_account_iam_member" "secret_migration_home_runtime_key_admin" {
  service_account_id = google_service_account.home_dev_runtime.name
  role               = "roles/iam.serviceAccountKeyAdmin"
  member             = "serviceAccount:${module.claude_code_dev.service_account_email}"
}

resource "google_service_account_iam_member" "secret_migration_home_orchestrator_key_admin" {
  service_account_id = google_service_account.home_dev_orchestrator.name
  role               = "roles/iam.serviceAccountKeyAdmin"
  member             = "serviceAccount:${module.claude_code_dev.service_account_email}"
}

resource "google_service_account_iam_member" "secret_migration_dev_publisher_token_creator" {
  service_account_id = google_service_account.secret_package_dev_publisher.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${module.claude_code_dev.service_account_email}"
}

resource "google_service_account_iam_member" "secret_migration_prod_publisher_token_creator" {
  service_account_id = google_service_account.secret_package_prod_publisher.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${module.claude_code_dev.service_account_email}"
}

# -----------------------------------------------------------------------------
# Pub/Sub Topics
# -----------------------------------------------------------------------------

# Dedicated OIDC and publishing identity for message-digest-service. It is kept
# at the root so the one-shot cutover and its inverse plan have a closed graph.
resource "google_service_account" "message_digest_service" {
  account_id   = "intexuraos-message-digest-${var.environment}"
  display_name = "IntexuraOS Message Digest Service (${var.environment})"
  description  = "Service account for Message Digest Pub/Sub delivery and publishing"
}

# Message Digest run requests are retained in the dev-owned GCP control plane.
# The Hetzner root owns the push consumer and its dead-letter resources.
resource "google_pubsub_topic" "message_digest_runs" {
  name    = "intexuraos-message-digest-runs-${var.environment}"
  project = var.project_id
  labels  = local.common_labels

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic_iam_member" "message_digest_publishes_runs" {
  project = var.project_id
  topic   = google_pubsub_topic.message_digest_runs.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.message_digest_service.email}"
}

# Deliberately has no subscription: one redacted message proves that a staged
# runtime credential can publish without invoking a production consumer.
module "pubsub_runtime_credential_canary" {
  source = "../../modules/pubsub-topic"

  project_id = var.project_id
  topic_name = "intexuraos-runtime-credential-canary-${var.environment}"
  labels     = local.common_labels

  depends_on = [google_project_service.apis]
}

# Topic for media cleanup events (whatsapp message deletion)
module "pubsub_media_cleanup" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-whatsapp-media-cleanup-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/whatsapp/pubsub/media-cleanup"
  push_service_account_email = module.iam.service_accounts["whatsapp_service"]
  push_audience              = local.retired_cloud_run_push_audience
  ack_deadline_seconds       = 60

  publisher_service_accounts = {
    whatsapp_service = module.iam.service_accounts["whatsapp_service"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Topic for WhatsApp webhook async processing (fast operations)
module "pubsub_whatsapp_webhook_process" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-whatsapp-webhook-process-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/whatsapp/pubsub/process-webhook"
  push_service_account_email = module.iam.service_accounts["whatsapp_service"]
  push_audience              = local.retired_cloud_run_push_audience
  ack_deadline_seconds       = 120

  publisher_service_accounts = {
    whatsapp_service = module.iam.service_accounts["whatsapp_service"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Topic for audio stored events (whatsapp-service → transcription Cloud Function)
# Delivery is via an explicit push subscription (defined below) so we can attach
# a dead_letter_policy. Cloud Functions Gen2 event triggers create their own
# Eventarc-managed subscription that cannot have a dead_letter_policy attached
# via Terraform — hence the function is HTTP-triggered and we wire the push
# subscription manually.
resource "google_pubsub_topic" "audio_stored" {
  name    = "intexuraos-audio-stored-${var.environment}"
  project = var.project_id
  labels  = local.common_labels

  depends_on = [google_project_service.apis]
}

# Grant whatsapp-service permission to publish to audio-stored topic
resource "google_pubsub_topic_iam_member" "whatsapp_publishes_audio_stored" {
  project = var.project_id
  topic   = google_pubsub_topic.audio_stored.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${module.iam.service_accounts["whatsapp_service"]}"
}

# Dead-letter topic for transcription audio-stored consumer (Subtask G of
# docs/plans/2026-04-24-workers-layer-refactor.md). Messages land here when
# Pub/Sub gives up redelivering after max_delivery_attempts on the push
# subscription, OR when the transcription worker explicitly publishes a parse
# failure via INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC (Subtask C).
resource "google_pubsub_topic" "transcription_dlq" {
  name    = "intexuraos-transcription-audio-stored-dlq-${var.environment}"
  project = var.project_id
  labels  = local.common_labels

  depends_on = [google_project_service.apis]
}

# Pub/Sub service agent must be able to publish to the DLQ topic for the
# subscription-level dead_letter_policy to function.
resource "google_pubsub_topic_iam_member" "pubsub_publishes_transcription_dlq" {
  project = var.project_id
  topic   = google_pubsub_topic.transcription_dlq.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${local.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# Grant the transcription Cloud Function SA permission to publish to its DLQ
# topic. This supports the application-level DLQ publisher implemented in
# Subtask C (workers/transcription/src/dlq-publisher.ts).
resource "google_pubsub_topic_iam_member" "transcription_publishes_dlq" {
  project = var.project_id
  topic   = google_pubsub_topic.transcription_dlq.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.transcription_function.email}"
}

# DLQ inspection subscription — pull subscription with 31-day retention for
# manual / tooling-driven incident review. Per parent plan §5, this is the
# anchor for a future BigQuery log sink.
resource "google_pubsub_subscription" "transcription_dlq_inspect" {
  name    = "intexuraos-transcription-audio-stored-dlq-${var.environment}-inspect"
  topic   = google_pubsub_topic.transcription_dlq.id
  project = var.project_id
  labels  = local.common_labels

  ack_deadline_seconds       = 600
  message_retention_duration = "2678400s" # 31 days

  expiration_policy {
    ttl = ""
  }

  depends_on = [google_pubsub_topic.transcription_dlq]
}

# Topic for intex-agent WhatsApp Assistant message ingest (whatsapp -> intex-agent)
module "pubsub_intex_message_ingest" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-intex-message-ingest-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/intex-agent/messages"
  push_service_account_email = module.iam.service_accounts["intex_agent"]
  push_audience              = local.retired_cloud_run_push_audience
  ack_deadline_seconds       = 120

  publisher_service_accounts = {
    whatsapp_service = module.iam.service_accounts["whatsapp_service"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Topic for research processing (research-agent async research)
module "pubsub_research_process" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-research-process-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/llm/pubsub/process-research"
  push_service_account_email = module.iam.service_accounts["research_agent"]
  push_audience              = local.retired_cloud_run_push_audience
  ack_deadline_seconds       = 600 # Max allowed by GCP (research processing can take several minutes)

  publisher_service_accounts = {
    research_agent = module.iam.service_accounts["research_agent"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Topic for LLM analytics reporting (research-agent -> user-service)
module "pubsub_llm_analytics" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-llm-analytics-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/llm/pubsub/report-analytics"
  push_service_account_email = module.iam.service_accounts["research_agent"]
  push_audience              = local.retired_cloud_run_push_audience
  ack_deadline_seconds       = 300

  publisher_service_accounts = {
    research_agent = module.iam.service_accounts["research_agent"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Topic for individual LLM research calls (research-agent -> research-agent)
module "pubsub_llm_call" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-llm-call-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/llm/pubsub/process-llm-call"
  push_service_account_email = module.iam.service_accounts["research_agent"]
  push_audience              = local.retired_cloud_run_push_audience
  ack_deadline_seconds       = 600

  publisher_service_accounts = {
    research_agent = module.iam.service_accounts["research_agent"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Topic for sending WhatsApp messages (research-agent, code-agent, intex-agent -> whatsapp-service)
module "pubsub_whatsapp_send" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-whatsapp-send-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/whatsapp/pubsub/send-message"
  push_service_account_email = module.iam.service_accounts["whatsapp_service"]
  push_audience              = local.retired_cloud_run_push_audience

  publisher_service_accounts = {
    research_agent  = module.iam.service_accounts["research_agent"]
    bookmarks_agent = module.iam.service_accounts["bookmarks_agent"]
    code_agent      = module.iam.service_accounts["code_agent"]
    intex_agent     = module.iam.service_accounts["intex_agent"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# The WhatsApp topic is retained and already exists before this one-shot cutover.
# Keep this binding free of module references so the previous immutable root can
# produce an exact inverse plan without traversing unrelated module-wide IAM.
resource "google_pubsub_topic_iam_member" "message_digest_publishes_whatsapp" {
  project = var.project_id
  topic   = "intexuraos-whatsapp-send-${var.environment}"
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.message_digest_service.email}"
}

# -----------------------------------------------------------------------------
# Additional Retained Pub/Sub Topics
# -----------------------------------------------------------------------------

# Pub/Sub for bookmark enrichment (link preview fetching)
module "pubsub_bookmark_enrich" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-bookmark-enrich-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/bookmarks/pubsub/enrich"
  push_service_account_email = module.iam.service_accounts["bookmarks_agent"]
  push_audience              = local.retired_cloud_run_push_audience
  ack_deadline_seconds       = 60

  publisher_service_accounts = {
    bookmarks_agent = module.iam.service_accounts["bookmarks_agent"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Pub/Sub for bookmark summarization (AI summary generation)
module "pubsub_bookmark_summarize" {
  source = "../../modules/pubsub-push"

  project_id               = var.project_id
  project_number           = local.project_number
  topic_name               = "intexuraos-bookmark-summarize-${var.environment}"
  labels                   = local.common_labels
  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${local.retired_cloud_run_push_endpoint}/internal/bookmarks/pubsub/summarize"
  push_service_account_email = module.iam.service_accounts["bookmarks_agent"]
  push_audience              = local.retired_cloud_run_push_audience
  ack_deadline_seconds       = 120

  # 6-hour retry window for transient Crawl4AI errors
  retry_minimum_backoff = "30s"
  retry_maximum_backoff = "600s"
  max_delivery_attempts = 50

  publisher_service_accounts = {
    bookmarks_agent = module.iam.service_accounts["bookmarks_agent"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# -----------------------------------------------------------------------------
# Retained Cloud Build Triggers
# -----------------------------------------------------------------------------

module "cloud_build" {
  source = "../../modules/cloud-build"

  project_id                 = var.project_id
  region                     = var.region
  environment                = var.environment
  github_owner               = var.github_owner
  github_repo                = var.github_repo
  github_repository_owner_id = var.github_repository_owner_id
  github_repository_id       = var.github_repository_id
  github_ref                 = var.github_ref
  github_branch              = var.github_branch
  github_connection_name     = var.github_connection_name

  legacy_secret_manager_enabled = var.legacy_secret_manager_enabled

  artifact_registry_url   = module.artifact_registry.repository_url
  functions_source_bucket = google_storage_bucket.cloud_functions_source.name

  depends_on = [
    google_project_service.apis,
    module.artifact_registry,
    module.static_assets,
    google_storage_bucket.cloud_functions_source,
  ]
}

# -----------------------------------------------------------------------------
# GitHub Workload Identity Federation (for GitHub Actions -> Cloud Build)
# -----------------------------------------------------------------------------

module "github_wif" {
  source = "../../modules/github-wif"

  project_id                       = var.project_id
  github_owner                     = var.github_owner
  github_repo                      = var.github_repo
  github_repository_owner_id       = var.github_repository_owner_id
  github_repository_id             = var.github_repository_id
  github_ref                       = var.github_ref
  cloud_build_service_account_name = module.cloud_build.cloud_build_service_account_name

  depends_on = [
    google_project_service.apis,
    module.cloud_build,
  ]
}

# -----------------------------------------------------------------------------
# Monitoring Dashboard & Alerts
# -----------------------------------------------------------------------------

module "monitoring" {
  source = "../../modules/monitoring"

  project_id         = var.project_id
  environment        = var.environment
  alert_email        = var.alert_email
  slack_auth_token   = var.slack_auth_token
  slack_channel_name = var.slack_channel_name

  depends_on = [
    google_project_service.apis,
  ]
}

resource "google_service_account" "cloud_scheduler" {
  account_id   = "intexuraos-scheduler-${var.environment}"
  display_name = "Cloud Scheduler Service Account"
  description  = "Service account for retained Cloud Scheduler jobs and Cloud Function invocations"
}

# -----------------------------------------------------------------------------
# Firebase Authentication (Identity Platform)
# -----------------------------------------------------------------------------

resource "google_identity_platform_config" "default" {
  provider = google-beta
  project  = var.project_id

  sign_in {
    allow_duplicate_emails = false

    anonymous {
      enabled = false
    }
  }

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Firebase Web App
# -----------------------------------------------------------------------------

resource "google_firebase_web_app" "web" {
  provider     = google-beta
  project      = var.project_id
  display_name = "IntexuraOS Web (${var.environment})"

  depends_on = [google_identity_platform_config.default]
}

data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.web.app_id
}

# -----------------------------------------------------------------------------
# Cloud Functions - Source Bucket
# -----------------------------------------------------------------------------

resource "google_storage_bucket" "cloud_functions_source" {
  name          = "intexuraos-functions-source-${var.environment}"
  project       = var.project_id
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true

  labels = local.common_labels

  depends_on = [google_project_service.apis]
}

# Placeholder source for initial deployment (will be replaced by Cloud Build)
resource "google_storage_bucket_object" "function_placeholder" {
  name    = "placeholder/function.zip"
  bucket  = google_storage_bucket.cloud_functions_source.name
  content = "placeholder"
}

# -----------------------------------------------------------------------------
# Cloud Functions - Transcription Worker
# -----------------------------------------------------------------------------
# (Log-cleanup function and its Pub/Sub topic, DLQ, push subscription, and
# Cloud Scheduler job were removed when retention moved to native Firestore TTL.
# See terraform/modules/firestore/ttl.tf for the replacement.)


resource "google_service_account" "transcription_function" {
  account_id   = "ixos-transcription-fn-${var.environment}"
  display_name = "Transcription Cloud Function Service Account"
  description  = "Service account for transcription Cloud Function (audio-stored -> transcription-completed)"

  depends_on = [google_project_service.apis]
}

# Grant transcription SA permission to read from whatsapp media bucket
resource "google_storage_bucket_iam_member" "transcription_media_reader" {
  bucket = module.whatsapp_media_bucket.bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.transcription_function.email}"
}

locals {
  transcription_native_secrets = {
    INTEXURAOS_INTERNAL_AUTH_TOKEN = {
      secret_id = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
      version   = 2
    }
    INTEXURAOS_SPEECHMATICS_APP_API_KEY = {
      secret_id = module.secret_manager.secret_ids["INTEXURAOS_SPEECHMATICS_APP_API_KEY"]
      version   = 1
    }
  }
}

# The retained transcription function is the only runtime with native
# Secret Manager injection. These address-stable bindings grant exactly the two
# native exceptions used by the function.
resource "google_secret_manager_secret_iam_member" "transcription_speechmatics" {
  secret_id = local.transcription_native_secrets.INTEXURAOS_SPEECHMATICS_APP_API_KEY.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.transcription_function.email}"
}

resource "google_secret_manager_secret_iam_member" "transcription_internal_auth" {
  secret_id = local.transcription_native_secrets.INTEXURAOS_INTERNAL_AUTH_TOKEN.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.transcription_function.email}"
}

# Grant transcription SA permission to sign blobs (required for GCS signed URLs)
resource "google_service_account_iam_member" "transcription_self_token_creator" {
  service_account_id = google_service_account.transcription_function.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.transcription_function.email}"
}

# Grant transcription SA permission to receive Eventarc events
resource "google_project_iam_member" "transcription_eventarc" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.transcription_function.email}"
}

# Topic for transcription completed events retained for the transcription worker.
resource "google_pubsub_topic" "transcription_completed" {
  name    = "intexuraos-transcription-completed-${var.environment}"
  project = var.project_id
  labels  = local.common_labels

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "transcription_completed_dlq" {
  name    = "intexuraos-transcription-completed-${var.environment}-dlq"
  project = var.project_id
  labels  = local.common_labels

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic_iam_member" "pubsub_publishes_transcription_completed_dlq" {
  project = var.project_id
  topic   = google_pubsub_topic.transcription_completed_dlq.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${local.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription" "transcription_completed_dlq" {
  name    = "intexuraos-transcription-completed-${var.environment}-dlq-sub"
  topic   = google_pubsub_topic.transcription_completed_dlq.id
  project = var.project_id
  labels  = local.common_labels

  ack_deadline_seconds       = 600
  message_retention_duration = "2678400s"

  expiration_policy {
    ttl = ""
  }
}

resource "google_pubsub_topic_iam_member" "transcription_publishes_completed" {
  project = var.project_id
  topic   = google_pubsub_topic.transcription_completed.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.transcription_function.email}"
}

module "function_transcription" {
  source = "../../modules/cloud-function"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  function_name = "intexuraos-transcription-${var.environment}"
  description   = "Transcribe audio files from WhatsApp using Speechmatics API"
  entry_point   = "transcribeAudio"
  runtime       = "nodejs22"

  source_bucket   = google_storage_bucket.cloud_functions_source.name
  source_object   = "transcription/function.zip"
  service_account = google_service_account.transcription_function.email

  # HTTP trigger + Pub/Sub push subscription (see audio_stored_push below).
  # We do NOT use the cloud-function module's pubsub event trigger here because
  # Cloud Functions Gen2 auto-creates the underlying Eventarc subscription and
  # Terraform cannot attach a dead_letter_policy to it. Routing via an
  # explicitly-managed push subscription is the only way to satisfy Subtask G's
  # acceptance criterion that "the target subscription has a dead_letter_policy
  # block".
  trigger_type    = "http"
  invoker_members = ["serviceAccount:${google_service_account.transcription_function.email}"]

  timeout_seconds    = 540 # 9 minutes - max for Gen2 Cloud Functions
  available_memory   = "512M"
  max_instance_count = 10

  env_vars = {
    INTEXURAOS_ENVIRONMENT                          = var.environment
    INTEXURAOS_GCP_PROJECT_ID                       = var.project_id
    INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC = google_pubsub_topic.transcription_completed.name
    INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC       = google_pubsub_topic.transcription_dlq.name
    INTEXURAOS_SENTRY_DSN                           = local.versioned_runtime_config.dev["INTEXURAOS_SENTRY_DSN_DEV"]
    INTEXURAOS_USER_SERVICE_URL                     = "${local.public_origin}/api/user"
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET                = module.whatsapp_media_bucket.bucket_name
  }

  secrets = local.transcription_native_secrets

  labels = local.common_labels

  depends_on = [
    google_project_service.apis,
    google_storage_bucket_object.function_placeholder,
    google_service_account.transcription_function,
    google_pubsub_topic.audio_stored,
    google_pubsub_topic.transcription_dlq,
    google_pubsub_topic.transcription_completed,
    google_secret_manager_secret_iam_member.transcription_speechmatics,
    google_secret_manager_secret_iam_member.transcription_internal_auth,
    google_storage_bucket_iam_member.transcription_media_reader,
    google_project_iam_member.transcription_eventarc,
  ]
}

# Push subscription that delivers audio-stored events to the transcription
# Cloud Function with a dead_letter_policy. After 5 failed delivery attempts
# Pub/Sub forwards the message to transcription_dlq for incident review.
resource "google_pubsub_subscription" "audio_stored_push" {
  name    = "intexuraos-audio-stored-${var.environment}-push"
  topic   = google_pubsub_topic.audio_stored.id
  project = var.project_id
  labels  = local.common_labels

  ack_deadline_seconds       = 600 # 10 minutes — matches transcription timeout
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = module.function_transcription.function_uri

    oidc_token {
      service_account_email = google_service_account.transcription_function.email
      audience              = module.function_transcription.function_uri
    }

    attributes = {
      x-goog-version = "v1"
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.transcription_dlq.id
    max_delivery_attempts = 5
  }

  expiration_policy {
    ttl = ""
  }

  depends_on = [
    module.function_transcription,
    google_pubsub_topic.transcription_dlq,
    google_pubsub_topic_iam_member.pubsub_publishes_transcription_dlq,
  ]
}

# Pub/Sub must be able to ACK the source message after forwarding it to the
# transcription DLQ.
resource "google_pubsub_subscription_iam_member" "pubsub_subscribes_audio_stored_push" {
  project      = var.project_id
  subscription = google_pubsub_subscription.audio_stored_push.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${local.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "firebase_api_key" {
  description = "Firebase API key for web app"
  value       = data.google_firebase_web_app_config.web.api_key
  sensitive   = true
}

output "firebase_auth_domain" {
  description = "Firebase Auth domain for web app"
  value       = data.google_firebase_web_app_config.web.auth_domain
}

output "artifact_registry_url" {
  description = "Artifact Registry URL"
  value       = module.artifact_registry.repository_url
}

output "firestore_database" {
  description = "Firestore database name"
  value       = module.firestore.database_name
}

output "service_accounts" {
  description = "Service account emails"
  value       = module.iam.service_accounts
}

output "home_dev_secret_renderer_service_account_email" {
  description = "Expected client_email for the least-privilege home-dev package renderer bootstrap identity"
  value       = google_service_account.home_dev_secret_renderer.email
}

output "home_dev_runtime_service_account_email" {
  description = "Expected client_email for the least-privilege local and home-dev PM2 runtime identity"
  value       = google_service_account.home_dev_runtime.email
}

output "home_dev_orchestrator_service_account_email" {
  description = "Expected client_email for the least-privilege home-dev orchestrator Artifact Registry reader"
  value       = google_service_account.home_dev_orchestrator.email
}

output "secret_package_dev_publisher_service_account_email" {
  description = "DEV package publisher service account impersonated by the migration operator"
  value       = google_service_account.secret_package_dev_publisher.email
}

output "secret_package_prod_publisher_service_account_email" {
  description = "PROD package publisher service account impersonated by the migration operator"
  value       = google_service_account.secret_package_prod_publisher.email
}

output "whatsapp_private_sync_service_account" {
  description = "Service account email allowed to call production private WhatsApp sync ingest"
  value       = google_service_account.whatsapp_private_sync.email
}

output "static_assets_bucket_name" {
  description = "Static assets bucket name"
  value       = module.static_assets.bucket_name
}

output "static_assets_public_url" {
  description = "Static assets public base URL"
  value       = module.static_assets.public_base_url
}

output "whatsapp_media_bucket_name" {
  description = "WhatsApp media bucket name (private, signed URL access only)"
  value       = module.whatsapp_media_bucket.bucket_name
}


output "pubsub_media_cleanup_topic" {
  description = "Pub/Sub topic for media cleanup events"
  value       = module.pubsub_media_cleanup.topic_name
}

output "pubsub_intex_message_ingest_topic" {
  description = "Pub/Sub topic for intex-agent WhatsApp Assistant message ingest events"
  value       = module.pubsub_intex_message_ingest.topic_name
}

output "pubsub_research_process_topic" {
  description = "Pub/Sub topic for research processing events"
  value       = module.pubsub_research_process.topic_name
}

output "pubsub_llm_analytics_topic" {
  description = "Pub/Sub topic for LLM analytics reporting"
  value       = module.pubsub_llm_analytics.topic_name
}

output "github_wif_provider" {
  description = "Workload Identity Provider for GitHub Actions authentication"
  value       = module.github_wif.workload_identity_provider
}

output "monitoring_dashboard_id" {
  description = "Monitoring dashboard ID"
  value       = module.monitoring.dashboard_id
}

output "claude_code_dev_service_account" {
  description = "Claude Code dev service account email for local development"
  value       = module.claude_code_dev.service_account_email
}

output "cloud_functions_source_bucket" {
  description = "GCS bucket for Cloud Functions source code"
  value       = google_storage_bucket.cloud_functions_source.name
}

output "function_transcription_name" {
  description = "Transcription Cloud Function name"
  value       = module.function_transcription.function_name
}

output "pubsub_audio_stored_topic" {
  description = "Pub/Sub topic for audio stored events"
  value       = google_pubsub_topic.audio_stored.name
}

output "pubsub_transcription_completed_topic" {
  description = "Pub/Sub topic for transcription completed events"
  value       = google_pubsub_topic.transcription_completed.name
}

output "pubsub_message_digest_runs_topic" {
  description = "Pub/Sub topic for Message Digest run requests"
  value       = google_pubsub_topic.message_digest_runs.name
}
