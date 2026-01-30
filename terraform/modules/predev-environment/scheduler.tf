# Pre-Dev Environment - Scheduler Resources

# Cloud Scheduler - 5 min idle check
resource "google_cloud_scheduler_job" "idle_check" {
  name        = "predev-idle-check-${var.environment}"
  description = "Check pre-dev VM idle status every 5 minutes"
  schedule    = "*/5 * * * *"
  time_zone   = "UTC"
  region      = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.idle_check.id
    data       = base64encode(jsonencode({ trigger = "scheduled" }))
  }
}
