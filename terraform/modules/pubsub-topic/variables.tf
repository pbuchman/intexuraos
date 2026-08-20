variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "topic_name" {
  description = "Name of the topic-only Pub/Sub resource"
  type        = string
}

variable "labels" {
  description = "Labels applied to the topic"
  type        = map(string)
  default     = {}
}
