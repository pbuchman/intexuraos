resource "google_pubsub_topic" "this" {
  name    = var.topic_name
  project = var.project_id
  labels  = var.labels
}
