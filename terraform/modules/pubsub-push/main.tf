# Pub/Sub Push Module
# Creates a Pub/Sub topic with push subscription to a Cloud Run endpoint.
# Used for event-driven communication with push delivery.

# Main topic
resource "google_pubsub_topic" "main" {
  name    = var.topic_name
  project = var.project_id
  labels  = var.labels
}

# Dead-letter topic
resource "google_pubsub_topic" "dlq" {
  name    = "${var.topic_name}-dlq"
  project = var.project_id
  labels  = var.labels
}

# Push subscription
resource "google_pubsub_subscription" "push" {
  name    = "${var.topic_name}-push"
  topic   = google_pubsub_topic.main.id
  project = var.project_id
  labels  = var.labels

  # Acknowledge deadline - time subscriber has to ack before redelivery
  ack_deadline_seconds = var.ack_deadline_seconds

  # Message retention if not acked
  message_retention_duration = var.message_retention_duration

  # Push configuration
  push_config {
    push_endpoint = var.push_endpoint

    # Use OIDC token for authentication
    oidc_token {
      service_account_email = var.push_service_account_email
      audience              = var.push_audience
    }

    attributes = {
      x-goog-version = "v1"
    }
  }

  # Retry policy with exponential backoff
  retry_policy {
    minimum_backoff = var.retry_minimum_backoff
    maximum_backoff = var.retry_maximum_backoff
  }

  # Dead-letter policy - after max_delivery_attempts, send to DLQ
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq.id
    max_delivery_attempts = var.max_delivery_attempts
  }

  # Expiration policy - never expire
  expiration_policy {
    ttl = ""
  }
}

# DLQ subscription (for manual inspection)
resource "google_pubsub_subscription" "dlq" {
  name    = "${var.topic_name}-dlq-sub"
  topic   = google_pubsub_topic.dlq.id
  project = var.project_id
  labels  = var.labels

  # Longer ack deadline for manual processing
  ack_deadline_seconds = 600

  # Retain messages for 7 days
  message_retention_duration = "604800s"

  # No retry policy - manual handling
  expiration_policy {
    ttl = ""
  }
}

# Publisher IAM binding
resource "google_pubsub_topic_iam_member" "publisher" {
  for_each = var.publisher_service_accounts

  project = var.project_id
  topic   = google_pubsub_topic.main.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${each.value}"
}

# Grant Pub/Sub service account permission to publish to DLQ
# This is required for dead-lettering to work
resource "google_pubsub_topic_iam_member" "dlq_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.dlq.id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
