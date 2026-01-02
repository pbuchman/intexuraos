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
    llm_orchestrator = {
      name      = "intexuraos-llm-orchestrator"
      app_path  = "apps/llm-orchestrator"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    commands_router = {
      name      = "intexuraos-commands-router"
      app_path  = "apps/commands-router"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    actions_agent = {
      name      = "intexuraos-actions-agent"
      app_path  = "apps/actions-agent"
      port      = 8080
      min_scale = 0
      max_scale = 1
    }
    data_insights_service = {
      name      = "intexuraos-data-insights-service"
      app_path  = "apps/data-insights-service"
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
    "cloudscheduler.googleapis.com",
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
    "INTEXURAOS_LLM_ORCHESTRATOR_URL"             = "LLM Orchestrator Cloud Run URL for web frontend"
    "INTEXURAOS_COMMANDS_ROUTER_SERVICE_URL"      = "Commands Router service Cloud Run URL for web frontend"
    "INTEXURAOS_ACTIONS_AGENT_URL"                = "Actions Agent Cloud Run URL for commands-router"
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

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-whatsapp-media-cleanup-${var.environment}"
  labels         = local.common_labels

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

# Topic for WhatsApp webhook async processing (fast operations)
module "pubsub_whatsapp_webhook_process" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-whatsapp-webhook-process-${var.environment}"
  labels         = local.common_labels

  push_endpoint              = "${module.whatsapp_service.service_url}/internal/whatsapp/pubsub/process-webhook"
  push_service_account_email = module.iam.service_accounts["whatsapp_service"]
  push_audience              = module.whatsapp_service.service_url
  ack_deadline_seconds       = 120

  publisher_service_accounts = {
    whatsapp_service = module.iam.service_accounts["whatsapp_service"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Topic for WhatsApp audio transcription (long-running operations up to 15 min)
module "pubsub_whatsapp_transcription" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-whatsapp-transcription-${var.environment}"
  labels         = local.common_labels

  push_endpoint              = "${module.whatsapp_service.service_url}/internal/whatsapp/pubsub/transcribe-audio"
  push_service_account_email = module.iam.service_accounts["whatsapp_service"]
  push_audience              = module.whatsapp_service.service_url
  ack_deadline_seconds       = 600 # Max allowed by GCP (transcription can take up to 5 min)

  publisher_service_accounts = {
    whatsapp_service = module.iam.service_accounts["whatsapp_service"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
  ]
}

# Topic for commands ingest (whatsapp -> commands-router)
module "pubsub_commands_ingest" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-commands-ingest-${var.environment}"
  labels         = local.common_labels

  push_endpoint              = "${module.commands_router.service_url}/internal/router/commands"
  push_service_account_email = module.iam.service_accounts["commands_router"]
  push_audience              = module.commands_router.service_url

  publisher_service_accounts = {
    whatsapp_service = module.iam.service_accounts["whatsapp_service"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
    module.commands_router,
  ]
}

# Topic for research action events (commands-router -> actions-agent)
module "pubsub_actions_research" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-actions-research-${var.environment}"
  labels         = local.common_labels

  push_endpoint              = "${module.actions_agent.service_url}/internal/actions/research"
  push_service_account_email = module.iam.service_accounts["actions_agent"]
  push_audience              = module.actions_agent.service_url

  publisher_service_accounts = {
    commands_router = module.iam.service_accounts["commands_router"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
    module.actions_agent,
  ]
}

# Topic for research processing (llm-orchestrator async research)
module "pubsub_research_process" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-research-process-${var.environment}"
  labels         = local.common_labels

  push_endpoint              = "${module.llm_orchestrator.service_url}/internal/llm/pubsub/process-research"
  push_service_account_email = module.iam.service_accounts["llm_orchestrator"]
  push_audience              = module.llm_orchestrator.service_url
  ack_deadline_seconds       = 600 # Max allowed by GCP (research processing can take several minutes)

  publisher_service_accounts = {
    llm_orchestrator = module.iam.service_accounts["llm_orchestrator"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
    module.llm_orchestrator,
  ]
}

# Topic for LLM analytics reporting (llm-orchestrator -> user-service)
module "pubsub_llm_analytics" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-llm-analytics-${var.environment}"
  labels         = local.common_labels

  push_endpoint              = "${module.llm_orchestrator.service_url}/internal/llm/pubsub/report-analytics"
  push_service_account_email = module.iam.service_accounts["llm_orchestrator"]
  push_audience              = module.llm_orchestrator.service_url
  ack_deadline_seconds       = 300

  publisher_service_accounts = {
    llm_orchestrator = module.iam.service_accounts["llm_orchestrator"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
    module.llm_orchestrator,
  ]
}

# Topic for sending WhatsApp messages (actions-agent, llm-orchestrator -> whatsapp-service)
module "pubsub_whatsapp_send" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-whatsapp-send-${var.environment}"
  labels         = local.common_labels

  push_endpoint              = "${module.whatsapp_service.service_url}/internal/whatsapp/pubsub/send-message"
  push_service_account_email = module.iam.service_accounts["whatsapp_service"]
  push_audience              = module.whatsapp_service.service_url

  publisher_service_accounts = {
    actions_agent    = module.iam.service_accounts["actions_agent"]
    llm_orchestrator = module.iam.service_accounts["llm_orchestrator"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
    module.whatsapp_service,
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
    INTEXURAOS_AUTH0_DOMAIN         = module.secret_manager.secret_ids["INTEXURAOS_AUTH0_DOMAIN"]
    INTEXURAOS_AUTH0_CLIENT_ID      = module.secret_manager.secret_ids["INTEXURAOS_AUTH0_CLIENT_ID"]
    INTEXURAOS_AUTH_JWKS_URL        = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER          = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE        = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_TOKEN_ENCRYPTION_KEY = module.secret_manager.secret_ids["INTEXURAOS_TOKEN_ENCRYPTION_KEY"]
    INTEXURAOS_ENCRYPTION_KEY       = module.secret_manager.secret_ids["INTEXURAOS_ENCRYPTION_KEY"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN  = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID = var.project_id
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
    INTEXURAOS_AUTH_JWKS_URL       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID     = var.project_id
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
    INTEXURAOS_AUTH_JWKS_URL       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID = var.project_id
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
  timeout         = "900s"

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/whatsapp-service:latest"

  secrets = {
    INTEXURAOS_AUTH_JWKS_URL            = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER              = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE            = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_WHATSAPP_VERIFY_TOKEN    = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_VERIFY_TOKEN"]
    INTEXURAOS_WHATSAPP_APP_SECRET      = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_APP_SECRET"]
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN    = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_ACCESS_TOKEN"]
    INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID"]
    INTEXURAOS_WHATSAPP_WABA_ID         = module.secret_manager.secret_ids["INTEXURAOS_WHATSAPP_WABA_ID"]
    INTEXURAOS_SPEECHMATICS_API_KEY     = module.secret_manager.secret_ids["INTEXURAOS_SPEECHMATICS_API_KEY"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID                    = var.project_id
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET             = module.whatsapp_media_bucket.bucket_name
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC        = module.pubsub_media_cleanup.topic_name
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION = module.pubsub_media_cleanup.subscription_name
    INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC      = module.pubsub_commands_ingest.topic_name
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC      = module.pubsub_whatsapp_webhook_process.topic_name
    INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC        = module.pubsub_whatsapp_transcription.topic_name
    INTEXURAOS_GCP_PROJECT_ID                    = var.project_id
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
    module.whatsapp_media_bucket,
    module.pubsub_media_cleanup,
    module.pubsub_commands_ingest,
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
    INTEXURAOS_AUTH_JWKS_URL = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER   = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID = var.project_id
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
    INTEXURAOS_USER_SERVICE_OPENAPI_URL                 = "${module.user_service.service_url}/openapi.json"
    INTEXURAOS_PROMPTVAULT_SERVICE_OPENAPI_URL          = "${module.promptvault_service.service_url}/openapi.json"
    INTEXURAOS_NOTION_SERVICE_OPENAPI_URL               = "${module.notion_service.service_url}/openapi.json"
    INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL             = "${module.whatsapp_service.service_url}/openapi.json"
    INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL = "${module.mobile_notifications_service.service_url}/openapi.json"
    INTEXURAOS_LLM_ORCHESTRATOR_OPENAPI_URL             = "${module.llm_orchestrator.service_url}/openapi.json"
    INTEXURAOS_COMMANDS_ROUTER_OPENAPI_URL              = "${module.commands_router.service_url}/openapi.json"
    INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL                = "${module.actions_agent.service_url}/openapi.json"
    INTEXURAOS_DATA_INSIGHTS_SERVICE_OPENAPI_URL        = "${module.data_insights_service.service_url}/openapi.json"
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.user_service,
    module.promptvault_service,
    module.notion_service,
    module.whatsapp_service,
    module.mobile_notifications_service,
    module.llm_orchestrator,
    module.commands_router,
    module.actions_agent,
    module.data_insights_service,
  ]
}

# LLM Orchestrator - Multi-LLM research with synthesis
module "llm_orchestrator" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.llm_orchestrator.name
  service_account = module.iam.service_accounts["llm_orchestrator"]
  port            = local.services.llm_orchestrator.port
  min_scale       = local.services.llm_orchestrator.min_scale
  max_scale       = local.services.llm_orchestrator.max_scale
  labels          = local.common_labels
  timeout         = "900s"

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/llm-orchestrator:latest"

  secrets = {
    INTEXURAOS_AUTH_JWKS_URL       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_USER_SERVICE_URL    = module.secret_manager.secret_ids["INTEXURAOS_USER_SERVICE_URL"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID                = var.project_id
    INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC = "intexuraos-research-process-${var.environment}"
    INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC    = "intexuraos-llm-analytics-${var.environment}"
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC    = "intexuraos-whatsapp-send-${var.environment}"
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
  ]
}

# Commands Router - Command ingestion and classification
module "commands_router" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.commands_router.name
  service_account = module.iam.service_accounts["commands_router"]
  port            = local.services.commands_router.port
  min_scale       = local.services.commands_router.min_scale
  max_scale       = local.services.commands_router.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/commands-router:latest"

  secrets = {
    INTEXURAOS_AUTH_JWKS_URL       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
    INTEXURAOS_ACTIONS_AGENT_URL   = module.secret_manager.secret_ids["INTEXURAOS_ACTIONS_AGENT_URL"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID   = var.project_id
    INTEXURAOS_USER_SERVICE_URL = module.user_service.service_url
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
    module.user_service,
  ]
}

# Actions Agent - Processes action events (research, todo, etc.)
module "actions_agent" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.actions_agent.name
  service_account = module.iam.service_accounts["actions_agent"]
  port            = local.services.actions_agent.port
  min_scale       = local.services.actions_agent.min_scale
  max_scale       = local.services.actions_agent.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/actions-agent:latest"

  secrets = {
    INTEXURAOS_AUTH_JWKS_URL       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID                = var.project_id
    INTEXURAOS_COMMANDS_ROUTER_SERVICE_URL   = module.commands_router.service_url
    INTEXURAOS_LLM_ORCHESTRATOR_URL          = module.llm_orchestrator.service_url
    INTEXURAOS_USER_SERVICE_URL              = module.user_service.service_url
    INTEXURAOS_PUBSUB_ACTIONS_RESEARCH_TOPIC = "intexuraos-actions-research-${var.environment}"
    INTEXURAOS_WHATSAPP_SEND_TOPIC           = "intexuraos-whatsapp-send-${var.environment}"
    INTEXURAOS_WEB_APP_URL                   = "https://${var.web_app_domain}"
  }

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
    module.commands_router,
    module.llm_orchestrator,
    module.user_service,
  ]
}

# Data Insights Service - Analytics aggregation from other services
module "data_insights_service" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.data_insights_service.name
  service_account = module.iam.service_accounts["data_insights_service"]
  port            = local.services.data_insights_service.port
  min_scale       = local.services.data_insights_service.min_scale
  max_scale       = local.services.data_insights_service.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/data-insights-service:latest"

  secrets = {
    INTEXURAOS_AUTH_JWKS_URL       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
    INTEXURAOS_AUTH_ISSUER         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_ISSUER"]
    INTEXURAOS_AUTH_AUDIENCE       = module.secret_manager.secret_ids["INTEXURAOS_AUTH_AUDIENCE"]
    INTEXURAOS_INTERNAL_AUTH_TOKEN = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
  }

  env_vars = {
    INTEXURAOS_GCP_PROJECT_ID = var.project_id
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
# Cloud Scheduler - Retry Pending Commands
# -----------------------------------------------------------------------------

resource "google_service_account" "cloud_scheduler" {
  account_id   = "intexuraos-scheduler-${var.environment}"
  display_name = "Cloud Scheduler Service Account"
  description  = "Service account for Cloud Scheduler to invoke Cloud Run endpoints"
}

resource "google_cloud_run_service_iam_member" "scheduler_invokes_commands_router" {
  project  = var.project_id
  location = var.region
  service  = local.services.commands_router.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_scheduler.email}"

  depends_on = [module.commands_router]
}

resource "google_cloud_scheduler_job" "retry_pending_commands" {
  name        = "intexuraos-retry-pending-commands-${var.environment}"
  description = "Retry classification for commands stuck in pending_classification status"
  schedule    = "*/5 * * * *"
  time_zone   = "UTC"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "${module.commands_router.service_url}/internal/router/retry-pending"

    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = module.commands_router.service_url
    }
  }

  retry_config {
    retry_count          = 1
    max_retry_duration   = "60s"
    min_backoff_duration = "5s"
    max_backoff_duration = "30s"
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_service_iam_member.scheduler_invokes_commands_router,
    module.commands_router,
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

output "llm_orchestrator_url" {
  description = "LLM Orchestrator URL"
  value       = module.llm_orchestrator.service_url
}

output "commands_router_url" {
  description = "Commands Router Service URL"
  value       = module.commands_router.service_url
}

output "actions_agent_url" {
  description = "Actions Agent Service URL"
  value       = module.actions_agent.service_url
}

output "data_insights_service_url" {
  description = "Data Insights Service URL"
  value       = module.data_insights_service.service_url
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

output "pubsub_commands_ingest_topic" {
  description = "Pub/Sub topic for commands ingest events"
  value       = module.pubsub_commands_ingest.topic_name
}

output "pubsub_actions_research_topic" {
  description = "Pub/Sub topic for research action events"
  value       = module.pubsub_actions_research.topic_name
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

