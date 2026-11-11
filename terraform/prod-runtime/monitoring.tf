# Keyless host monitoring: no private key material or metric writes.
resource "google_service_account" "home_monitor" {
  project      = var.project_id
  account_id   = "intexuraos-home-monitor-prod"
  display_name = "Home PROD scheduler and PubSub monitoring"
  description  = "Read-only Scheduler state and Cloud Monitoring time series for Home PROD Netdata"
}

resource "google_project_iam_custom_role" "home_monitor_read" {
  project     = var.project_id
  role_id     = "intexuraosHomeMonitorRead"
  title       = "Home PROD operational monitoring reads"
  description = "Only Scheduler job reads and PubSub metric time series reads"
  permissions = [
    "cloudscheduler.jobs.get",
    "cloudscheduler.jobs.list",
    "monitoring.timeSeries.list",
  ]
}

resource "google_project_iam_member" "home_monitor_read" {
  project = var.project_id
  role    = google_project_iam_custom_role.home_monitor_read.name
  member  = "serviceAccount:${google_service_account.home_monitor.email}"
}

resource "google_service_account_iam_member" "home_monitor_host_impersonation" {
  service_account_id = google_service_account.home_monitor.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:ixos-home-orchestrator-dev@${var.project_id}.iam.gserviceaccount.com"
}

output "home_monitor_service_account_email" {
  description = "Target identity for explicit host gcloud impersonation; no static key is created."
  value       = google_service_account.home_monitor.email
}
