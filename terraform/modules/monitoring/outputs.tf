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
    llm_errors             = google_logging_metric.llm_errors.name
    pubsub_dlq             = google_logging_metric.pubsub_dlq_messages.name
    whatsapp_webhook_errors = google_logging_metric.whatsapp_webhook_errors.name
  }
}
