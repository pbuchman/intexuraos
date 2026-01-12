output "dashboard_id" {
  description = "The ID of the monitoring dashboard"
  value       = google_monitoring_dashboard.main.id
}

output "dashboard_name" {
  description = "The display name of the monitoring dashboard"
  value       = jsondecode(google_monitoring_dashboard.main.dashboard_json).displayName
}

output "log_metrics" {
  description = "Created log-based metrics"
  value = {
    llm_errors              = google_logging_metric.llm_errors.name
    whatsapp_webhook_errors = google_logging_metric.whatsapp_webhook_errors.name
  }
}

output "alert_policies" {
  description = "Created alert policies"
  value = {
    dlq_messages = var.alert_email != null ? try(google_monitoring_alert_policy.dlq_messages[0].name, null) : null
  }
}
