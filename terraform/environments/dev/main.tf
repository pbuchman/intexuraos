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

variable "github_owner" {
  description = "GitHub repository owner"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "intexuraos"
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
    INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL  = "${local.public_origin}/api/code"
    INTEXURAOS_CONVERSATION_ASSISTANT_MODEL = "or:minimax/minimax-m3"
    INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH = "development"
    INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY  = "pbuchman/intexuraos"
    INTEXURAOS_WEB_APP_URL                  = local.public_origin
  }

  hetzner_runtime_secret_names = toset([
    "INTEXURAOS_AUTH0_CLIENT_ID",
    "INTEXURAOS_AUTH0_DOMAIN",
    "INTEXURAOS_AUTH0_SPA_CLIENT_ID",
    "INTEXURAOS_AUTH_AUDIENCE",
    "INTEXURAOS_AUTH_ISSUER",
    "INTEXURAOS_AUTH_JWKS_URL",
    "INTEXURAOS_CLOUDFLARE_ACCOUNT_ID",
    "INTEXURAOS_CLOUDFLARE_API_TOKEN",
    "INTEXURAOS_ENCRYPTION_KEY",
    "INTEXURAOS_FIREBASE_API_KEY",
    "INTEXURAOS_FIREBASE_AUTH_DOMAIN",
    "INTEXURAOS_FIREBASE_PROJECT_ID",
    "INTEXURAOS_GEMINI_APP_API_KEY",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_URL",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME",
    "INTEXURAOS_GITHUB_OAUTH_CLIENT_ID",
    "INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET",
    "INTEXURAOS_GITHUB_WEBHOOK_SECRET",
    "INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID",
    "INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET",
    "INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI",
    "INTEXURAOS_INTERNAL_AUTH_TOKEN",
    "INTEXURAOS_OPENAI_APP_API_KEY",
    "INTEXURAOS_OPENROUTER_APP_API_KEY",
    "INTEXURAOS_ORCHESTRATOR_SECRET",
    "INTEXURAOS_SENTRY_DSN",
    "INTEXURAOS_SENTRY_DSN_WEB",
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
    "INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_URL",
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME",
    "INTEXURAOS_KIMI_APP_API_KEY",
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
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
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

# NOTE: Only app-level secrets are stored here.
# Per-user Notion integration tokens are stored in Firestore, not Secret Manager.
module "secret_manager" {
  source = "../../modules/secret-manager"

  project_id  = var.project_id
  environment = var.environment
  labels      = local.common_labels

  secrets = {
    # Auth0 secrets
    "INTEXURAOS_AUTH0_DOMAIN"        = "Auth0 tenant domain for Device Authorization Flow"
    "INTEXURAOS_AUTH0_CLIENT_ID"     = "Auth0 Native app client ID for Device Authorization Flow"
    "INTEXURAOS_AUTH0_SPA_CLIENT_ID" = "Auth0 SPA app client ID for web application"
    "INTEXURAOS_AUTH_JWKS_URL"       = "Auth0 JWKS URL for JWT verification"
    "INTEXURAOS_AUTH_ISSUER"         = "Auth0 issuer URL"
    "INTEXURAOS_AUTH_AUDIENCE"       = "Auth0 audience identifier"
    # Token encryption key
    "INTEXURAOS_TOKEN_ENCRYPTION_KEY" = "AES-256 encryption key for refresh tokens (base64-encoded 32-byte key)"
    # LLM API keys encryption
    "INTEXURAOS_ENCRYPTION_KEY" = "AES-256 encryption key for LLM API keys (base64-encoded 32-byte key)"
    # WhatsApp Business Cloud API secrets
    "INTEXURAOS_WHATSAPP_VERIFY_TOKEN"    = "WhatsApp webhook verify token"
    "INTEXURAOS_WHATSAPP_ACCESS_TOKEN"    = "WhatsApp Business API access token"
    "INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID" = "WhatsApp Business phone number ID"
    "INTEXURAOS_WHATSAPP_WABA_ID"         = "WhatsApp Business Account ID"
    "INTEXURAOS_WHATSAPP_APP_SECRET"      = "WhatsApp app secret for webhook signature validation"
    # Speechmatics API secrets (used by transcription Cloud Function)
    "INTEXURAOS_SPEECHMATICS_APP_API_KEY" = "Speechmatics API key for transcription Cloud Function"
    # Internal service-to-service auth token
    "INTEXURAOS_INTERNAL_AUTH_TOKEN" = "Internal auth token for service-to-service communication"
    # Firebase configuration for web app
    "INTEXURAOS_FIREBASE_PROJECT_ID"  = "Firebase project ID"
    "INTEXURAOS_FIREBASE_API_KEY"     = "Firebase API key (public, but managed as secret)"
    "INTEXURAOS_FIREBASE_AUTH_DOMAIN" = "Firebase Auth domain"
    # SSL certificate
    "INTEXURAOS_SSL_PRIVATE_KEY" = "SSL certificate private key for intexuraos.cloud"
    # Google OAuth secrets for calendar integration
    "INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID"     = "Google OAuth client ID for calendar integration"
    "INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET" = "Google OAuth client secret for calendar integration"
    "INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI"  = "Google OAuth redirect URI (full callback URL)"
    # GitHub OAuth secrets for GitHub integration
    "INTEXURAOS_GITHUB_OAUTH_CLIENT_ID"     = "GitHub OAuth App Client ID"
    "INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET" = "GitHub OAuth App Client Secret"
    # Sentry error monitoring
    "INTEXURAOS_SENTRY_DSN"                = "Sentry Data Source Name for error tracking (backend services)"
    "INTEXURAOS_SENTRY_DSN_WEB"            = "Sentry Data Source Name for error tracking (web app)"
    "INTEXURAOS_SENTRY_WEBHOOK_SECRET"     = "Sentry webhook secret for code-agent issue automation"
    "INTEXURAOS_SENTRY_AUTOMATION_USER_ID" = "Code-agent user ID that owns automatic Sentry code tasks"
    # Cloudflare Browser Rendering API
    "INTEXURAOS_CLOUDFLARE_ACCOUNT_ID" = "Cloudflare account ID for Browser Rendering API"
    "INTEXURAOS_CLOUDFLARE_API_TOKEN"  = "Cloudflare API token with Browser Rendering Edit permission"
    # LLM API keys
    "INTEXURAOS_OPENAI_APP_API_KEY"     = "OpenAI API key for services using OpenAI APIs"
    "INTEXURAOS_MINIMAX_APP_API_KEY"    = "MiniMax API key for orchestrator worker containers"
    "INTEXURAOS_MIMO_APP_API_KEY"       = "MiMo Pro 2.5 API key for orchestrator worker containers"
    "INTEXURAOS_GEMINI_APP_API_KEY"     = "Gemini API key for orchestrator completion verifier"
    "INTEXURAOS_DASHSCOPE_APP_API_KEY"  = "Dashscope API key for orchestrator glm and qwen worker containers"
    "INTEXURAOS_KIMI_APP_API_KEY"       = "Kimi Code API key for orchestrator kimi worker containers"
    "INTEXURAOS_OPENROUTER_APP_API_KEY" = "OpenRouter API key for agent compliance validator"
    # External service API keys for worker containers
    "INTEXURAOS_LINEAR_API_KEY"    = "Linear API key passed to code worker containers"
    "INTEXURAOS_SENTRY_AUTH_TOKEN" = "Sentry auth token passed to code worker containers"
    # Code worker secrets (INT-156)
    "INTEXURAOS_ORCHESTRATOR_SECRET"   = "HMAC signing secret for orchestrator communication"
    "INTEXURAOS_WEBHOOK_VERIFY_SECRET" = "HMAC signing secret for orchestrator webhook callbacks to code-agent"
    # GitHub App for code worker PRs (INT-156)
    "INTEXURAOS_GITHUB_APP_PRIVATE_KEY" = "GitHub App private key (PEM format) for code worker authentication"
    "INTEXURAOS_GITHUB_APP_ID"          = "GitHub App ID for code worker"
    "INTEXURAOS_GITHUB_INSTALLATION_ID" = "GitHub App installation ID for pbuchman/intexuraos"
    # Orchestrator repository management (INT-515)
    "INTEXURAOS_REPOSITORY_URL"        = "GitHub repository URL for orchestrator self-managed clone"
    "INTEXURAOS_GITHUB_WEBHOOK_SECRET" = "GitHub webhook secret for HMAC validation"
    # Grafana Cloud observability
    "INTEXURAOS_GRAFANA_CLOUD_GRAFANA_TOKEN" = "Grafana Cloud service account token for dashboard provisioning"
    "INTEXURAOS_GRAFANA_CLOUD_GRAFANA_URL"   = "Grafana Cloud stack URL for hosted dashboards"
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN"    = "Grafana Cloud Logs write token for Alloy collectors"
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_URL"      = "Grafana Cloud Loki push endpoint for Alloy collectors"
    "INTEXURAOS_GRAFANA_CLOUD_LOKI_USERNAME" = "Grafana Cloud Logs instance ID used as Loki basic auth username"
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "cloudflare_dns_api_token" {
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

resource "google_service_account" "whatsapp_private_sync" {
  account_id   = "intexuraos-wa-private-sync-${var.environment}"
  display_name = "IntexuraOS Private WhatsApp Sync (${var.environment})"
  description  = "External bridge caller identity for private WhatsApp sync ingestion"
}

resource "google_secret_manager_secret_iam_member" "hetzner_provisioner_runtime_secrets" {
  for_each = local.hetzner_runtime_secret_names

  secret_id = module.secret_manager.secret_ids[each.value]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_secret_manager_secret_iam_member" "hetzner_provisioner_cloudflare_dns" {
  secret_id = google_secret_manager_secret.cloudflare_dns_api_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_secret_manager_secret_iam_member" "hetzner_provisioner_ssl_private_key" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SSL_PRIVATE_KEY"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_secret_manager_secret_iam_member" "hetzner_runtime_secrets" {
  for_each = local.hetzner_runtime_secret_names

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

  secret_ids = {
    for name, secret_id in module.secret_manager.secret_ids : name => secret_id
    if !contains(local.cloud_run_secret_manager_excluded_names, name)
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

# -----------------------------------------------------------------------------
# Pub/Sub Topics
# -----------------------------------------------------------------------------


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

# DLQ inspection subscription — pull subscription with 7-day retention for
# manual / tooling-driven incident review. Per parent plan §5, this is the
# anchor for a future BigQuery log sink.
resource "google_pubsub_subscription" "transcription_dlq_inspect" {
  name    = "intexuraos-transcription-audio-stored-dlq-${var.environment}-inspect"
  topic   = google_pubsub_topic.transcription_dlq.id
  project = var.project_id
  labels  = local.common_labels

  ack_deadline_seconds       = 600
  message_retention_duration = "604800s" # 7 days

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

  project_id             = var.project_id
  region                 = var.region
  environment            = var.environment
  github_owner           = var.github_owner
  github_repo            = var.github_repo
  github_branch          = var.github_branch
  github_connection_name = var.github_connection_name

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

# Auto-populate Firebase secrets from Terraform
resource "google_secret_manager_secret_version" "firebase_api_key" {
  secret      = module.secret_manager.secret_names["INTEXURAOS_FIREBASE_API_KEY"]
  secret_data = data.google_firebase_web_app_config.web.api_key
}

resource "google_secret_manager_secret_version" "firebase_auth_domain" {
  secret      = module.secret_manager.secret_names["INTEXURAOS_FIREBASE_AUTH_DOMAIN"]
  secret_data = data.google_firebase_web_app_config.web.auth_domain
}

resource "google_secret_manager_secret_version" "firebase_project_id" {
  secret      = module.secret_manager.secret_names["INTEXURAOS_FIREBASE_PROJECT_ID"]
  secret_data = var.project_id
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
# Cloud Functions - Service Account
# -----------------------------------------------------------------------------

resource "google_service_account" "cloud_functions" {
  account_id   = "intexuraos-functions-${var.environment}"
  display_name = "Cloud Functions Service Account"
  description  = "Service account for Cloud Functions (vm-lifecycle)"

  depends_on = [google_project_service.apis]
}

# Grant Cloud Functions SA permission to read Firestore
resource "google_project_iam_member" "functions_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.cloud_functions.email}"
}

# Grant Cloud Functions SA permission to manage Compute Engine VMs
resource "google_project_iam_member" "functions_compute" {
  project = var.project_id
  role    = "roles/compute.instanceAdmin.v1"
  member  = "serviceAccount:${google_service_account.cloud_functions.email}"
}

# Grant Cloud Functions SA permission to receive Eventarc events
resource "google_project_iam_member" "functions_eventarc" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.cloud_functions.email}"
}

# Grant Cloud Functions SA permission to access secrets (for INTEXURAOS_INTERNAL_AUTH_TOKEN)
resource "google_secret_manager_secret_iam_member" "functions_internal_auth_token" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_functions.email}"
}

# -----------------------------------------------------------------------------
# Cloud Functions - VM Lifecycle (Start/Stop)
# -----------------------------------------------------------------------------

module "function_vm_start" {
  source = "../../modules/cloud-function"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  function_name = "intexuraos-vm-start-${var.environment}"
  description   = "Start a GCE VM instance"
  entry_point   = "startVm"
  runtime       = "nodejs22"

  source_bucket   = google_storage_bucket.cloud_functions_source.name
  source_object   = "vm-lifecycle/function.zip"
  service_account = google_service_account.cloud_functions.email

  trigger_type     = "http"
  invoker_members  = ["serviceAccount:${google_service_account.cloud_scheduler.email}"]
  timeout_seconds  = 120
  available_memory = "256M"

  env_vars = {
    INTEXURAOS_ENVIRONMENT    = var.environment
    INTEXURAOS_GCP_PROJECT_ID = var.project_id
  }

  secrets = {
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  labels = local.common_labels

  depends_on = [
    google_project_service.apis,
    google_storage_bucket_object.function_placeholder,
    google_service_account.cloud_functions,
  ]
}

module "function_vm_stop" {
  source = "../../modules/cloud-function"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  function_name = "intexuraos-vm-stop-${var.environment}"
  description   = "Stop a GCE VM instance"
  entry_point   = "stopVm"
  runtime       = "nodejs22"

  source_bucket   = google_storage_bucket.cloud_functions_source.name
  source_object   = "vm-lifecycle/function.zip"
  service_account = google_service_account.cloud_functions.email

  trigger_type     = "http"
  invoker_members  = ["serviceAccount:${google_service_account.cloud_scheduler.email}"]
  timeout_seconds  = 120
  available_memory = "256M"

  env_vars = {
    INTEXURAOS_ENVIRONMENT    = var.environment
    INTEXURAOS_GCP_PROJECT_ID = var.project_id
  }

  secrets = {
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  labels = local.common_labels

  depends_on = [
    google_project_service.apis,
    google_storage_bucket_object.function_placeholder,
    google_service_account.cloud_functions,
  ]
}

# Cloud Scheduler - Start VM at 7 AM Poland time (Mon-Fri)
resource "google_cloud_scheduler_job" "vm_start" {
  name        = "intexuraos-vm-start-${var.environment}"
  description = "Start VM instances at 7 AM Poland time on weekdays"
  schedule    = "0 7 * * 1-5"
  time_zone   = "Europe/Warsaw"
  region      = var.region

  http_target {
    uri         = module.function_vm_start.function_uri
    http_method = "POST"
    body        = base64encode(jsonencode({ trigger = "scheduled" }))

    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = module.function_vm_start.function_uri
    }
  }

  retry_config {
    retry_count          = 3
    max_retry_duration   = "60s"
    min_backoff_duration = "5s"
    max_backoff_duration = "30s"
  }

  depends_on = [
    google_project_service.apis,
    module.function_vm_start,
  ]
}

# Cloud Scheduler - Stop VM at 11 PM Poland time (daily)
resource "google_cloud_scheduler_job" "vm_stop" {
  name        = "intexuraos-vm-stop-${var.environment}"
  description = "Stop VM instances at 11 PM Poland time daily"
  schedule    = "0 23 * * *"
  time_zone   = "Europe/Warsaw"
  region      = var.region

  http_target {
    uri         = module.function_vm_stop.function_uri
    http_method = "POST"
    body        = base64encode(jsonencode({ trigger = "scheduled" }))

    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = module.function_vm_stop.function_uri
    }
  }

  retry_config {
    retry_count          = 3
    max_retry_duration   = "60s"
    min_backoff_duration = "5s"
    max_backoff_duration = "30s"
  }

  depends_on = [
    google_project_service.apis,
    module.function_vm_stop,
  ]
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

# Grant transcription SA permission to access Speechmatics secret
resource "google_secret_manager_secret_iam_member" "transcription_speechmatics" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SPEECHMATICS_APP_API_KEY"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.transcription_function.email}"
}

# Grant transcription SA permission to access internal auth token secret
resource "google_secret_manager_secret_iam_member" "transcription_internal_auth" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
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

# Grant transcription SA permission to access Sentry DSN secret
resource "google_secret_manager_secret_iam_member" "transcription_sentry_dsn" {
  secret_id = module.secret_manager.secret_ids["INTEXURAOS_SENTRY_DSN"]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.transcription_function.email}"
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
  message_retention_duration = "604800s"

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
    INTEXURAOS_USER_SERVICE_URL                     = "${local.public_origin}/api/user"
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET                = module.whatsapp_media_bucket.bucket_name
  }

  secrets = {
    INTEXURAOS_SPEECHMATICS_APP_API_KEY = module.secret_manager.secret_ids["INTEXURAOS_SPEECHMATICS_APP_API_KEY"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN      = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
    INTEXURAOS_SENTRY_DSN               = module.secret_manager.secret_ids["INTEXURAOS_SENTRY_DSN"]
  }

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
    google_secret_manager_secret_iam_member.transcription_sentry_dsn,
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

output "function_vm_start_uri" {
  description = "VM Start Cloud Function HTTP endpoint"
  value       = module.function_vm_start.function_uri
}

output "function_vm_stop_uri" {
  description = "VM Stop Cloud Function HTTP endpoint"
  value       = module.function_vm_stop.function_uri
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
