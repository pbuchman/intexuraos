output "function_origin" {
  description = "HTTPS Cloud Run origin for the agent share edge route."
  value       = google_cloudfunctions2_function.origin.service_config[0].uri
  depends_on  = [google_cloud_run_v2_service_iam_member.public_invoker]
}
