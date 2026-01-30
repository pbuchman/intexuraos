# Pre-Dev Environment - IAM Resources

# Service account for pre-dev VM
resource "google_service_account" "predev_vm" {
  account_id   = "predev-vm-${var.environment}"
  display_name = "Pre-Dev VM Service Account (${var.environment})"
}

# Service account for pre-dev Cloud Functions
resource "google_service_account" "predev_functions" {
  account_id   = "predev-functions-${var.environment}"
  display_name = "Pre-Dev Functions Service Account (${var.environment})"
}

# Functions can manage Compute instances
resource "google_project_iam_member" "functions_compute_admin" {
  project = var.project_id
  role    = "roles/compute.instanceAdmin.v1"
  member  = "serviceAccount:${google_service_account.predev_functions.email}"
}

# Functions can read/write Firestore (for state tracking)
resource "google_project_iam_member" "functions_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.predev_functions.email}"
}

# Functions can access secrets
resource "google_project_iam_member" "functions_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.predev_functions.email}"
}

# VM can access secrets (for .envrc.local generation)
resource "google_project_iam_member" "vm_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.predev_vm.email}"
}

# VM can invoke report-ready function
resource "google_cloudfunctions2_function_iam_member" "vm_invokes_report_ready" {
  project        = var.project_id
  location       = var.region
  cloud_function = google_cloudfunctions2_function.report_ready.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.predev_vm.email}"
}

# Cloud Run invoker for report-ready (underlying service)
resource "google_cloud_run_service_iam_member" "vm_invokes_report_ready_run" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.report_ready.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.predev_vm.email}"
}
