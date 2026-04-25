# IntexuraOS Prod Environment — Observability Surface (INT-1538-S8)
#
# This module provisions ONLY the prod observability resources required by
# INT-1538-S8: notification channels (email + Slack) and the
# `code_tasks_failed_rate` alert policy bound to the custom metric written
# by code-agent via `@intexuraos/common-metrics`.
#
# Full prod infrastructure (Cloud Run services, Firestore, Pub/Sub, etc.) is
# intentionally out of scope for S8.

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

data "google_project" "current" {}

# -----------------------------------------------------------------------------
# Notification channels
# -----------------------------------------------------------------------------

resource "google_monitoring_notification_channel" "email" {
  display_name = "Prod Alerts — Email"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_notification_channel" "slack" {
  display_name = "Prod Alerts — Slack"
  type         = "slack"
  labels = {
    channel_name = var.slack_channel_name
  }
  sensitive_labels {
    auth_token = var.slack_auth_token
  }
}
