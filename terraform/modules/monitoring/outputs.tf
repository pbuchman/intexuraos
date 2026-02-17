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

output "code_task_metrics" {
  description = "Code task custom metric descriptors"
  value = {
    submitted = google_monitoring_metric_descriptor.code_tasks_submitted.type
    completed = google_monitoring_metric_descriptor.code_tasks_completed.type
    duration  = google_monitoring_metric_descriptor.code_tasks_duration_seconds.type
    active    = google_monitoring_metric_descriptor.code_tasks_active.type
    cost      = google_monitoring_metric_descriptor.code_tasks_cost_dollars.type
  }
}

output "code_task_dashboard_id" {
  description = "The ID of the code tasks dashboard"
  value       = google_monitoring_dashboard.code_tasks.id
}

output "code_task_alert_policies" {
  description = "Code task alert policies"
  value = {
    high_failure_rate  = var.alert_email != null ? try(google_monitoring_alert_policy.code_task_high_failure_rate[0].name, null) : null
    high_daily_cost    = var.alert_email != null ? try(google_monitoring_alert_policy.code_task_high_daily_cost[0].name, null) : null
    capacity_exhausted = var.alert_email != null ? try(google_monitoring_alert_policy.code_task_capacity_exhausted[0].name, null) : null
  }
}
