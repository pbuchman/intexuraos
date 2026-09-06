output "topic_id" {
  description = "Fully qualified topic ID"
  value       = google_pubsub_topic.this.id
}

output "topic_name" {
  description = "Topic name"
  value       = google_pubsub_topic.this.name
}
