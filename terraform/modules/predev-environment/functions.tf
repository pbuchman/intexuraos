# Pre-Dev Environment - Cloud Functions

# Gateway Function
resource "google_cloudfunctions2_function" "gateway" {
  name        = "intexuraos-predev-gateway-${var.environment}"
  location    = var.region
  description = "Pre-dev gateway: proxy requests or show Starting page"

  build_config {
    runtime     = "nodejs22"
    entry_point = "gateway"
    source {
      storage_source {
        bucket = var.functions_source_bucket
        object = "predev-lifecycle/function.zip"
      }
    }
  }

  service_config {
    available_memory      = "512M"
    timeout_seconds       = 3600
    service_account_email = google_service_account.predev_functions.email
    max_instance_count    = 10
    min_instance_count    = 0

    environment_variables = {
      INTEXURAOS_ENVIRONMENT    = var.environment
      INTEXURAOS_GCP_PROJECT_ID = var.project_id
      INTEXURAOS_GCP_ZONE       = var.zone
      INTEXURAOS_MIG_NAME       = local.mig_name
    }

    secret_environment_variables {
      key        = "INTEXURAOS_INTERNAL_AUTH_TOKEN"
      project_id = var.project_id
      secret     = var.internal_auth_token_secret_id
      version    = "latest"
    }
  }
}

resource "google_cloudfunctions2_function_iam_member" "gateway_public" {
  project        = var.project_id
  location       = var.region
  cloud_function = google_cloudfunctions2_function.gateway.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"
}

resource "google_cloud_run_service_iam_member" "gateway_public_run" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.gateway.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Webhook Function
resource "google_cloudfunctions2_function" "webhook" {
  name        = "intexuraos-predev-webhook-${var.environment}"
  location    = var.region
  description = "Pre-dev webhook: GitHub push handler"

  build_config {
    runtime     = "nodejs22"
    entry_point = "webhook"
    source {
      storage_source {
        bucket = var.functions_source_bucket
        object = "predev-lifecycle/function.zip"
      }
    }
  }

  service_config {
    available_memory      = "512M"
    timeout_seconds       = 120
    service_account_email = google_service_account.predev_functions.email
    max_instance_count    = 1
    min_instance_count    = 0

    environment_variables = {
      INTEXURAOS_ENVIRONMENT    = var.environment
      INTEXURAOS_GCP_PROJECT_ID = var.project_id
    }

    secret_environment_variables {
      key        = "INTEXURAOS_GITHUB_WEBHOOK_SECRET"
      project_id = var.project_id
      secret     = var.github_webhook_secret_id
      version    = "latest"
    }
  }
}

resource "google_cloudfunctions2_function_iam_member" "webhook_public" {
  project        = var.project_id
  location       = var.region
  cloud_function = google_cloudfunctions2_function.webhook.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"
}

resource "google_cloud_run_service_iam_member" "webhook_public_run" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.webhook.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Pub/Sub topic for idle check
resource "google_pubsub_topic" "idle_check" {
  name    = "predev-idle-check-${var.environment}"
  project = var.project_id
}

# Idle-Check Function (Pub/Sub triggered)
resource "google_cloudfunctions2_function" "idle_check" {
  name        = "intexuraos-predev-idle-check-${var.environment}"
  location    = var.region
  description = "Pre-dev idle check: shutdown after 30min inactive"

  build_config {
    runtime     = "nodejs22"
    entry_point = "idleCheck"
    source {
      storage_source {
        bucket = var.functions_source_bucket
        object = "predev-lifecycle/function.zip"
      }
    }
  }

  service_config {
    available_memory      = "512M"
    timeout_seconds       = 120
    service_account_email = google_service_account.predev_functions.email
    max_instance_count    = 1
    min_instance_count    = 0

    environment_variables = {
      INTEXURAOS_ENVIRONMENT    = var.environment
      INTEXURAOS_GCP_PROJECT_ID = var.project_id
      INTEXURAOS_GCP_ZONE       = var.zone
      INTEXURAOS_MIG_NAME       = local.mig_name
      IDLE_TIMEOUT_MINUTES      = "30"
    }
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.idle_check.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }
}

# Report-Ready Function
resource "google_cloudfunctions2_function" "report_ready" {
  name        = "intexuraos-predev-report-ready-${var.environment}"
  location    = var.region
  description = "Pre-dev report ready: VM callback with ephemeral IP"

  build_config {
    runtime     = "nodejs22"
    entry_point = "reportReady"
    source {
      storage_source {
        bucket = var.functions_source_bucket
        object = "predev-lifecycle/function.zip"
      }
    }
  }

  service_config {
    available_memory      = "512M"
    timeout_seconds       = 30
    service_account_email = google_service_account.predev_functions.email
    max_instance_count    = 1
    min_instance_count    = 0

    environment_variables = {
      INTEXURAOS_ENVIRONMENT    = var.environment
      INTEXURAOS_GCP_PROJECT_ID = var.project_id
    }
  }
}
