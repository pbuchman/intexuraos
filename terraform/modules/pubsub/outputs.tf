output "topic_name" {
  description = "Name of the main Pub/Sub topic"
  value       = google_pubsub_topic.main.name
}

output "topic_id" {
  description = "Full ID of the main Pub/Sub topic"
  value       = google_pubsub_topic.main.id
}

output "subscription_name" {
  description = "Name of the main subscription"
  value       = google_pubsub_subscription.main.name
}

output "subscription_id" {
  description = "Full ID of the main subscription"
  value       = google_pubsub_subscription.main.id
}

output "dlq_topic_name" {
  description = "Name of the dead-letter topic"
  value       = google_pubsub_topic.dlq.name
}

output "dlq_subscription_name" {
  description = "Name of the dead-letter subscription"
  value       = google_pubsub_subscription.dlq.name
}

