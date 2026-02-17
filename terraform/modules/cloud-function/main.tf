# Cloud Function Module (Gen2)
# Deploys a Cloud Function with optional HTTP or Pub/Sub triggers.

resource "google_cloudfunctions2_function" "function" {
  name        = var.function_name
  location    = var.region
  description = var.description
  labels      = var.labels

  build_config {
    runtime     = var.runtime
    entry_point = var.entry_point

    source {
      storage_source {
        bucket = var.source_bucket
        object = var.source_object
      }
    }
  }

  service_config {
    max_instance_count    = var.max_instance_count
    min_instance_count    = var.min_instance_count
    available_memory      = var.available_memory
    timeout_seconds       = var.timeout_seconds
    service_account_email = var.service_account

    dynamic "secret_environment_variables" {
      for_each = var.secrets
      content {
        key        = secret_environment_variables.key
        project_id = var.project_id
        secret     = secret_environment_variables.value
        version    = "latest"
      }
    }

    environment_variables = var.env_vars
  }

  dynamic "event_trigger" {
    for_each = var.trigger_type == "pubsub" ? [1] : []
    content {
      trigger_region = var.region
      event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
      pubsub_topic   = var.pubsub_topic
      retry_policy   = "RETRY_POLICY_RETRY"
    }
  }

  lifecycle {
    ignore_changes = [
      build_config[0].source[0].storage_source[0].object,
    ]
  }
}

# IAM bindings for invokers (HTTP functions only)
resource "google_cloudfunctions2_function_iam_member" "invoker" {
  for_each = var.trigger_type == "http" ? toset(var.invoker_members) : toset([])

  project        = var.project_id
  location       = var.region
  cloud_function = google_cloudfunctions2_function.function.name
  role           = "roles/cloudfunctions.invoker"
  member         = each.value
}

# Cloud Run invoker for the underlying service (needed for HTTP functions)
resource "google_cloud_run_service_iam_member" "invoker" {
  for_each = var.trigger_type == "http" ? toset(var.invoker_members) : toset([])

  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.function.name
  role     = "roles/run.invoker"
  member   = each.value
}
