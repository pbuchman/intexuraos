locals {
  origin_name = "intexuraos-agent-shares-origin"
  origin_source = {
    for filename in ["index.js", "package.json"] :
    filename => file("${path.module}/origin/${filename}")
  }
}

resource "google_storage_bucket" "shares" {
  name     = "intexuraos-agent-shares-dev-pbuchman"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = false
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle_rule {
    condition {
      days_since_custom_time              = 0
      send_age_if_zero                    = false
      send_days_since_custom_time_if_zero = true
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_service_account" "origin" {
  account_id   = local.origin_name
  display_name = "IntexuraOS agent shares origin"
  project      = var.project_id
}

resource "google_project_iam_custom_role" "share_object_getter" {
  project     = var.project_id
  role_id     = "agentSharesObjectGetter"
  title       = "Agent share object getter"
  permissions = ["storage.objects.get"]
}

resource "google_storage_bucket_iam_member" "origin_read" {
  bucket = google_storage_bucket.shares.name
  role   = google_project_iam_custom_role.share_object_getter.name
  member = "serviceAccount:${google_service_account.origin.email}"
}

resource "google_storage_bucket" "function_source" {
  name     = "intexuraos-agent-shares-src-dev-pbuchman"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  soft_delete_policy {
    retention_duration_seconds = 0
  }
}

data "archive_file" "origin" {
  type        = "zip"
  output_path = "${path.root}/.terraform/agent-shares-origin-${sha256(jsonencode(local.origin_source))}.zip"

  dynamic "source" {
    for_each = local.origin_source
    content {
      filename = source.key
      content  = source.value
    }
  }
}

resource "google_storage_bucket_object" "origin_source" {
  bucket       = google_storage_bucket.function_source.name
  name         = "origin-${data.archive_file.origin.output_sha256}.zip"
  source       = data.archive_file.origin.output_path
  content_type = "application/zip"

  # A source change gets a new object name, so the existing revision's archive survives a failed deployment.
  lifecycle {
    create_before_destroy = true
  }
}

resource "google_cloudfunctions2_function" "origin" {
  name     = local.origin_name
  location = var.region
  project  = var.project_id

  build_config {
    runtime     = "nodejs24"
    entry_point = "serveShare"

    source {
      storage_source {
        bucket     = google_storage_bucket_object.origin_source.bucket
        object     = google_storage_bucket_object.origin_source.name
        generation = google_storage_bucket_object.origin_source.generation
      }
    }
  }

  service_config {
    available_memory                 = "256M"
    max_instance_count               = 3
    max_instance_request_concurrency = 1
    timeout_seconds                  = 30
    ingress_settings                 = "ALLOW_ALL"
    service_account_email            = google_service_account.origin.email

    environment_variables = {
      SHARE_BUCKET = google_storage_bucket.shares.name
    }
  }

  depends_on = [google_storage_bucket_iam_member.origin_read]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = google_cloudfunctions2_function.origin.project
  location = google_cloudfunctions2_function.origin.location
  name     = basename(google_cloudfunctions2_function.origin.service_config[0].service)
  role     = "roles/run.invoker"
  member   = "allUsers"
}
