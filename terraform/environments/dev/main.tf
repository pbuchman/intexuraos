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
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
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

variable "enable_load_balancer" {
  description = "Enable Cloud Load Balancer with CDN for web app SPA hosting"
  type        = bool
  default     = true
}

variable "web_app_domain" {
  description = "Domain name for the web app"
  type        = string
  default     = "intexuraos.pbuchman.com"
}

variable "audit_llms" {
  description = "Enable LLM API call audit logging to Firestore"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  services = {
    user_service = {
      name      = "intexuraos-user-service"
      app_path  = "apps/user-service"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    promptvault_service = {
      name      = "intexuraos-promptvault-service"
      app_path  = "apps/promptvault-service"
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
    api_docs_hub = {
      name      = "intexuraos-api-docs-hub"
      app_path  = "apps/api-docs-hub"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    llm_orchestrator_service = {
      name      = "intexuraos-llm-orchestrator-service"
      app_path  = "apps/llm-orchestrator-service"
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

  project_id  = var.project_id
  region      = var.region
  environment = var.environment
  labels      = local.common_labels

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
# Web App Bucket (SPA hosting with Load Balancer)
# -----------------------------------------------------------------------------

module "web_app" {
  source = "../../modules/web-app"

  project_id           = var.project_id
  region               = var.region
  environment          = var.environment
  labels               = local.common_labels
  enable_load_balancer = var.enable_load_balancer
  domain               = var.web_app_domain

  depends_on = [google_project_service.apis]
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
    # Speechmatics API secrets
    "INTEXURAOS_SPEECHMATICS_API_KEY" = "Speechmatics Batch API key for speech transcription"
    # Internal service-to-service auth token
    "INTEXURAOS_INTERNAL_AUTH_TOKEN" = "Internal auth token for service-to-service communication"
    # Web frontend service URLs (public, non-sensitive)
    "INTEXURAOS_USER_SERVICE_URL"                 = "User service Cloud Run URL for web frontend"
    "INTEXURAOS_PROMPTVAULT_SERVICE_URL"          = "PromptVault service Cloud Run URL for web frontend"
    "INTEXURAOS_WHATSAPP_SERVICE_URL"             = "WhatsApp service Cloud Run URL for web frontend"
    "INTEXURAOS_NOTION_SERVICE_URL"               = "Notion service Cloud Run URL for web frontend"
    "INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL" = "Mobile notifications service Cloud Run URL for web frontend"
    "INTEXURAOS_LLM_ORCHESTRATOR_SERVICE_URL"     = "LLM Orchestrator service Cloud Run URL for web frontend"
  }

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# IAM - Service Accounts
# -----------------------------------------------------------------------------

module "iam" {
  source = "../../modules/iam"

  project_id  = var.project_id
  environment = var.environment
  services    = local.services

  secret_ids = module.secret_manager.secret_ids

  depends_on = [
    google_project_service.apis,
    module.secret_manager,
  ]
}

# -----------------------------------------------------------------------------
# Pub/Sub Topics
# -----------------------------------------------------------------------------


# Topic for media cleanup events (whatsapp message deletion)
module "pubsub_media_cleanup" {
  source = "../../modules/pubsub"

  project_id = var.project_id
  topic_name = "intexuraos-whatsapp-media-cleanup-${var.environment}"
  labels     = local.common_labels

  publisher_service_accounts = {
    whatsapp_service = module.iam.service_accounts["whatsapp_service"]
  }
  subscriber_service_accounts = {
    whatsapp_service = module.iam.service_accounts["whatsapp_service"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}


# -----------------------------------------------------------------------------
# Cloud Run Services
# -----------------------------------------------------------------------------

module "user_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.user_service.name
  service_account = module.iam.service_accounts["user_service"]
  port            = local.services.user_service.port
  min_scale       = local.services.user_service.min_scale
  max_scale       = local.services.user_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/user-service:latest"

  secrets = {
    AUTH0_DOMAIN                    = module.secret_manager.secret_ids["INTEXURAOS_AUTH0_DOMAIN"]
    AUTH0_CLIENT_ID                 = module.secret_manager.secret_ids["INTEXURAOS_AUTH0_CLIENT_ID"]
    AUTH_JWKS_URL                   = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    AUTH_ISSUER                     = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    AUTH_AUDIENCE                   = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_TOKEN_ENCRYPTION_KEY = module.secret_manager.secret_ids["INTEXURAOS_TOKEN_ENCRYPTION_KEY"]
    INTEXURAOS_ENCRYPTION_KEY       = module.secret_manager.secret_ids["INTEXURAOS_ENCRYPTION_KEY"]
    INTERNAL_AUTH_TOKEN             = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
  ]
}

module "promptvault_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.promptvault_service.name
  service_account = module.iam.service_accounts["promptvault_service"]
  port            = local.services.promptvault_service.port
  min_scale       = local.services.promptvault_service.min_scale
  max_scale       = local.services.promptvault_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/promptvault-service:latest"

  secrets = {
    AUTH_JWKS_URL                  = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    AUTH_ISSUER                    = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    AUTH_AUDIENCE                  = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  env_vars = {
    INTEXURAOS_NOTION_SERVICE_URL = module.notion_service.service_url
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
    module.notion_service,
  ]
}

# Notion Service - Notion integration management and webhooks
module "notion_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.notion_service.name
  service_account = module.iam.service_accounts["notion_service"]
  port            = local.services.notion_service.port
  min_scale       = local.services.notion_service.min_scale
  max_scale       = local.services.notion_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/notion-service:latest"

  secrets = {
    AUTH_JWKS_URL                  = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    AUTH_ISSUER                    = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    AUTH_AUDIENCE                  = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
  ]
}

# WhatsApp Service - WhatsApp Business Cloud API webhooks
module "whatsapp_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.whatsapp_service.name
  service_account = module.iam.service_accounts["whatsapp_service"]
  port            = local.services.whatsapp_service.port
  min_scale       = local.services.whatsapp_service.min_scale
  max_scale       = local.services.whatsapp_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/whatsapp-service:latest"

  secrets = {
    AUTH_JWKS_URL                       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    AUTH_ISSUER                         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    AUTH_AUDIENCE                       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_WHATSAPP_VERIFY_TOKEN    = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_VERIFY_TOKEN"]
    INTEXURAOS_WHATSAPP_APP_SECRET      = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_APP_SECRET"]
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN    = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_ACCESS_TOKEN"]
    INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID"]
    INTEXURAOS_WHATSAPP_WABA_ID         = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_WABA_ID"]
    INTEXURAOS_SPEECHMATICS_API_KEY     = module.secret_manager.secret_ids["INTEXURAOS_SPEECHMATICS_API_KEY"]
  }

  env_vars = {
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET             = module.whatsapp_media_bucket.bucket_name
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC        = module.pubsub_media_cleanup.topic_name
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION = module.pubsub_media_cleanup.subscription_name
    INTEXURAOS_GCP_PROJECT_ID                    = var.project_id
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
    module.whatsapp_media_bucket,
    module.pubsub_media_cleanup,
  ]
}

# Mobile Notifications Service - Mobile device notification capture
module "mobile_notifications_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.mobile_notifications_service.name
  service_account = module.iam.service_accounts["mobile_notifications_service"]
  port            = local.services.mobile_notifications_service.port
  min_scale       = local.services.mobile_notifications_service.min_scale
  max_scale       = local.services.mobile_notifications_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/mobile-notifications-service:latest"

  secrets = {
    AUTH_JWKS_URL = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    AUTH_ISSUER   = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    AUTH_AUDIENCE = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
  ]
}

# API Docs Hub - Aggregated OpenAPI documentation
module "api_docs_hub" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.api_docs_hub.name
  service_account = module.iam.service_accounts["api_docs_hub"]
  port            = local.services.api_docs_hub.port
  min_scale       = local.services.api_docs_hub.min_scale
  max_scale       = local.services.api_docs_hub.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/api-docs-hub:latest"

  # Plain env vars for OpenAPI URLs (not secrets)
  env_vars = {
    USER_SERVICE_OPENAPI_URL                 = "${module.user_service.service_url}/openapi.json"
    PROMPTVAULT_SERVICE_OPENAPI_URL          = "${module.promptvault_service.service_url}/openapi.json"
    NOTION_SERVICE_OPENAPI_URL               = "${module.notion_service.service_url}/openapi.json"
    WHATSAPP_SERVICE_OPENAPI_URL             = "${module.whatsapp_service.service_url}/openapi.json"
    MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL = "${module.mobile_notifications_service.service_url}/openapi.json"
    LLM_ORCHESTRATOR_SERVICE_OPENAPI_URL     = "${module.llm_orchestrator_service.service_url}/openapi.json"
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.user_service,
    module.promptvault_service,
    module.notion_service,
    module.whatsapp_service,
    module.mobile_notifications_service,
    module.llm_orchestrator_service,
  ]
}

# LLM Orchestrator Service - Multi-LLM research with synthesis
module "llm_orchestrator_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.llm_orchestrator_service.name
  service_account = module.iam.service_accounts["llm_orchestrator_service"]
  port            = local.services.llm_orchestrator_service.port
  min_scale       = local.services.llm_orchestrator_service.min_scale
  max_scale       = local.services.llm_orchestrator_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/llm-orchestrator-service:latest"

  secrets = {
    AUTH_JWKS_URL                   = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    AUTH_ISSUER                     = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    AUTH_AUDIENCE                   = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_TOKEN_ENCRYPTION_KEY = module.secret_manager.secret_ids["INTEXURAOS_TOKEN_ENCRYPTION_KEY"]
    USER_SERVICE_URL                = module.secret_manager.secret_ids["INTEXURAOS_USER_SERVICE_URL"]
    INTERNAL_AUTH_TOKEN             = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
    WHATSAPP_ACCESS_TOKEN           = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_ACCESS_TOKEN"]
    WHATSAPP_PHONE_NUMBER_ID        = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID"]
  }

  env_vars = {
    INTEXURAOS_AUDIT_LLMS = var.audit_llms ? "true" : "false"
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
  ]
}

# -----------------------------------------------------------------------------
# Cloud Build Trigger
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

  artifact_registry_url = module.artifact_registry.repository_url
  static_assets_bucket  = module.static_assets.bucket_name
  web_app_bucket        = module.web_app.bucket_name

  depends_on = [
    google_project_service.apis,
    module.artifact_registry,
    module.static_assets,
    module.web_app,
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
# Outputs
# -----------------------------------------------------------------------------

output "artifact_registry_url" {
  description = "Artifact Registry URL"
  value       = module.artifact_registry.repository_url
}

output "user_service_url" {
  description = "User Service URL"
  value       = module.user_service.service_url
}

output "promptvault_service_url" {
  description = "PromptVault Service URL"
  value       = module.promptvault_service.service_url
}

output "notion_service_url" {
  description = "Notion Service URL"
  value       = module.notion_service.service_url
}

output "whatsapp_service_url" {
  description = "WhatsApp Service URL"
  value       = module.whatsapp_service.service_url
}

output "mobile_notifications_service_url" {
  description = "Mobile Notifications Service URL"
  value       = module.mobile_notifications_service.service_url
}

output "api_docs_hub_url" {
  description = "API Docs Hub URL"
  value       = module.api_docs_hub.service_url
}

output "llm_orchestrator_service_url" {
  description = "LLM Orchestrator Service URL"
  value       = module.llm_orchestrator_service.service_url
}


output "firestore_database" {
  description = "Firestore database name"
  value       = module.firestore.database_name
}

output "service_accounts" {
  description = "Service account emails"
  value       = module.iam.service_accounts
}

output "static_assets_bucket_name" {
  description = "Static assets bucket name"
  value       = module.static_assets.bucket_name
}

output "static_assets_public_url" {
  description = "Static assets public base URL"
  value       = module.static_assets.public_base_url
}

output "web_app_bucket_name" {
  description = "Web app bucket name"
  value       = module.web_app.bucket_name
}

output "web_app_url" {
  description = "Web app public URL"
  value       = module.web_app.website_url
}

output "web_app_load_balancer_ip" {
  description = "Web app load balancer IP (configure DNS A record to point to this)"
  value       = module.web_app.load_balancer_ip
}

output "web_app_dns_a_record_hint" {
  description = "DNS A record hint for web app"
  value       = module.web_app.web_app_dns_a_record_hint
}

output "web_app_cert_name" {
  description = "Managed SSL certificate name for web app"
  value       = module.web_app.web_app_cert_name
}

output "whatsapp_media_bucket_name" {
  description = "WhatsApp media bucket name (private, signed URL access only)"
  value       = module.whatsapp_media_bucket.bucket_name
}


output "pubsub_media_cleanup_topic" {
  description = "Pub/Sub topic for media cleanup events"
  value       = module.pubsub_media_cleanup.topic_name
}

output "github_wif_provider" {
  description = "Workload Identity Provider for GitHub Actions authentication"
  value       = module.github_wif.workload_identity_provider
}

