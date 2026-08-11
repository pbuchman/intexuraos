# Cloud Functions remain in GCP for the Hetzner cutover. This root records the
# continuity contract without re-owning function resources already managed by
# terraform/environments/dev/main.tf.

locals {
  retained_gcp_function_pubsub_topics = {
    audio_stored            = local.pubsub_topics.audio_stored
    transcription_completed = local.pubsub_topics.transcription_completed
    transcription_audio_dlq = local.pubsub_topics.transcription_audio_dlq
  }

  retained_gcp_cloud_functions = {
    transcription = {
      function_name      = "intexuraos-transcription-${var.source_environment}"
      source_object      = "transcription/function.zip"
      input_topic        = data.google_pubsub_topic.retained_gcp["audio_stored"].name
      input_subscription = "intexuraos-audio-stored-${var.source_environment}-push"
      input_dlq_topic    = data.google_pubsub_topic.retained_gcp["transcription_audio_dlq"].name
      output_topic       = data.google_pubsub_topic.retained_gcp["transcription_completed"].name
      disposition        = "retained-gcp-cloud-function"
    }
  }

  retained_gcp_scheduler_jobs = {
    code_worker_daily_rebuild = {
      job_name    = "code-worker-daily-rebuild-${var.source_environment}"
      target_type = "cloud-build-api"
      disposition = "keep-current-cloud-build-api-target"
    }
  }
}

data "google_pubsub_topic" "retained_gcp" {
  for_each = local.retained_gcp_function_pubsub_topics

  name    = each.value
  project = var.project_id
}
