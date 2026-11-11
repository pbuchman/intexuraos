# Security monitoring for the separate project that previously hosted Gemini API keys.

variable "gemini_security_project_id" {
  description = "Project that previously hosted the compromised Gemini API key"
  type        = string
  default     = "gen-lang-client-0280571524"
}

provider "google" {
  alias                 = "gemini_security"
  project               = var.gemini_security_project_id
  billing_project       = var.project_id
  region                = var.region
  user_project_override = true
}

resource "google_project_service" "affected_gemini_security_apis" {
  provider = google.gemini_security
  for_each = toset([
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ])

  project            = var.gemini_security_project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_logging_metric" "affected_gemini_security_changes" {
  provider = google.gemini_security
  project  = var.gemini_security_project_id

  name        = "gemini-security-changes"
  description = "Generative Language API enablement or API-key lifecycle changes"
  filter      = <<-EOT
    log_id("cloudaudit.googleapis.com/activity")
    (
      (
        protoPayload.serviceName="serviceusage.googleapis.com"
        protoPayload.methodName=~"ServiceUsage.EnableService$"
        protoPayload.request.name:"services/generativelanguage.googleapis.com"
      )
      OR
      (
        protoPayload.serviceName="apikeys.googleapis.com"
        protoPayload.methodName=~"(CreateKey|UndeleteKey|UpdateKey)$"
      )
    )
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.affected_gemini_security_apis]
}

resource "google_monitoring_notification_channel" "affected_gemini_security_email" {
  provider = google.gemini_security
  project  = var.gemini_security_project_id

  display_name = "Gemini Security Alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.affected_gemini_security_apis]
}

resource "google_monitoring_alert_policy" "affected_gemini_security_changes" {
  provider = google.gemini_security
  project  = var.gemini_security_project_id

  display_name = "Gemini API Or API Key Security Change"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Generative Language API or API key changed"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.affected_gemini_security_changes.name}\" resource.type=\"audited_resource\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.affected_gemini_security_email.name]

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    content   = "Security-sensitive Gemini/API-key configuration changed in the former Gemini project. Keep generativelanguage.googleapis.com disabled and investigate the matching Admin Activity entry."
    mime_type = "text/markdown"
  }
}
