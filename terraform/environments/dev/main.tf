# PraxOS Dev Environment
# This is the main entry point for the dev environment.

# Include root-level configurations
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

# Variables
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
  default     = "praxos"
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

locals {
  services = {
    auth_service = {
      name      = "praxos-auth-service"
      app_path  = "apps/auth-service"
      port      = 8080
      min_scale = 0
      max_scale = 2
    }
    notion_gpt_service = {
      name      = "praxos-notion-gpt-service"
      app_path  = "apps/notion-gpt-service"
      port      = 8080
      min_scale = 0
      max_scale = 2
    }
    whatsapp_service = {
      name      = "praxos-whatsapp-service"
      app_path  = "apps/whatsapp-service"
      port      = 8080
      min_scale = 0
      max_scale = 2
    }
    api_docs_hub = {
      name      = "praxos-api-docs-hub"
      app_path  = "apps/api-docs-hub"
      port      = 8080
      min_scale = 0
      max_scale = 2
    }
  }

  common_labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "praxos"
  }
}

# Enable required APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "storage.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Artifact Registry
module "artifact_registry" {
  source = "../../modules/artifact-registry"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment
  labels      = local.common_labels

  depends_on = [google_project_service.apis]
}

# Static Assets Bucket
module "static_assets" {
  source = "../../modules/static-assets"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment
  labels      = local.common_labels

  depends_on = [google_project_service.apis]
}

# Firestore
module "firestore" {
  source = "../../modules/firestore"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment

  depends_on = [google_project_service.apis]
}

# Secret Manager
# NOTE: Only app-level secrets are stored here.
# Per-user Notion integration tokens are stored in Firestore, not Secret Manager.
module "secret_manager" {
  source = "../../modules/secret-manager"

  project_id  = var.project_id
  environment = var.environment
  labels      = local.common_labels

  secrets = {
    # Auth0 secrets
    "PRAXOS_AUTH0_DOMAIN"    = "Auth0 tenant domain for Device Authorization Flow"
    "PRAXOS_AUTH0_CLIENT_ID" = "Auth0 Native app client ID for Device Authorization Flow"
    "PRAXOS_AUTH_JWKS_URL"   = "Auth0 JWKS URL for JWT verification"
    "PRAXOS_AUTH_ISSUER"     = "Auth0 issuer URL"
    "PRAXOS_AUTH_AUDIENCE"   = "Auth0 audience identifier"
    # Token encryption key
    "PRAXOS_TOKEN_ENCRYPTION_KEY" = "AES-256 encryption key for refresh tokens (base64-encoded 32-byte key)"
    # WhatsApp Business Cloud API secrets
    "PRAXOS_WHATSAPP_VERIFY_TOKEN"    = "WhatsApp webhook verify token"
    "PRAXOS_WHATSAPP_ACCESS_TOKEN"    = "WhatsApp Business API access token"
    "PRAXOS_WHATSAPP_PHONE_NUMBER_ID" = "WhatsApp Business phone number ID"
    "PRAXOS_WHATSAPP_WABA_ID"         = "WhatsApp Business Account ID"
    "PRAXOS_WHATSAPP_APP_SECRET"      = "WhatsApp app secret for webhook signature validation"
  }

  depends_on = [google_project_service.apis]
}

# IAM - Service Accounts
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

# Cloud Run Services
module "auth_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.auth_service.name
  service_account = module.iam.service_accounts["auth_service"]
  port            = local.services.auth_service.port
  min_scale       = local.services.auth_service.min_scale
  max_scale       = local.services.auth_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/auth-service:latest"

  secrets = {
    AUTH0_DOMAIN                = module.secret_manager.secret_ids["PRAXOS_AUTH0_DOMAIN"]
    AUTH0_CLIENT_ID             = module.secret_manager.secret_ids["PRAXOS_AUTH0_CLIENT_ID"]
    AUTH_JWKS_URL               = module.secret_manager.secret_ids["PRAXOS_AUTH_JWKS_URL"]
    AUTH_ISSUER                 = module.secret_manager.secret_ids["PRAXOS_AUTH_ISSUER"]
    AUTH_AUDIENCE               = module.secret_manager.secret_ids["PRAXOS_AUTH_AUDIENCE"]
    PRAXOS_TOKEN_ENCRYPTION_KEY = module.secret_manager.secret_ids["PRAXOS_TOKEN_ENCRYPTION_KEY"]
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
  ]
}

module "notion_gpt_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.notion_gpt_service.name
  service_account = module.iam.service_accounts["notion_gpt_service"]
  port            = local.services.notion_gpt_service.port
  min_scale       = local.services.notion_gpt_service.min_scale
  max_scale       = local.services.notion_gpt_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/notion-gpt-service:latest"

  secrets = {
    AUTH_JWKS_URL = module.secret_manager.secret_ids["PRAXOS_AUTH_JWKS_URL"]
    AUTH_ISSUER   = module.secret_manager.secret_ids["PRAXOS_AUTH_ISSUER"]
    AUTH_AUDIENCE = module.secret_manager.secret_ids["PRAXOS_AUTH_AUDIENCE"]
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
    PRAXOS_WHATSAPP_VERIFY_TOKEN = module.secret_manager.secret_ids["PRAXOS_WHATSAPP_VERIFY_TOKEN"]
    PRAXOS_WHATSAPP_APP_SECRET   = module.secret_manager.secret_ids["PRAXOS_WHATSAPP_APP_SECRET"]
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
    AUTH_SERVICE_OPENAPI_URL       = "${module.auth_service.service_url}/openapi.json"
    NOTION_GPT_SERVICE_OPENAPI_URL = "${module.notion_gpt_service.service_url}/openapi.json"
    WHATSAPP_SERVICE_OPENAPI_URL   = "${module.whatsapp_service.service_url}/openapi.json"
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.auth_service,
    module.notion_gpt_service,
    module.whatsapp_service,
  ]
}

# Cloud Build Trigger
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

  depends_on = [
    google_project_service.apis,
    module.artifact_registry,
    module.static_assets,
  ]
}

# Outputs
output "artifact_registry_url" {
  description = "Artifact Registry URL"
  value       = module.artifact_registry.repository_url
}

output "auth_service_url" {
  description = "Auth Service URL"
  value       = module.auth_service.service_url
}

output "notion_gpt_service_url" {
  description = "Notion GPT Service URL"
  value       = module.notion_gpt_service.service_url
}

output "whatsapp_service_url" {
  description = "WhatsApp Service URL"
  value       = module.whatsapp_service.service_url
}

output "api_docs_hub_url" {
  description = "API Docs Hub URL"
  value       = module.api_docs_hub.service_url
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

