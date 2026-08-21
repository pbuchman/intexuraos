data "google_project" "retained" {
  project_id = var.project_id
}

locals {
  common_labels = merge(
    {
      component   = "prod-hetzner"
      environment = var.environment
      managed_by  = "terraform"
    },
    var.labels
  )

  retained_gcp = {
    project_id            = data.google_project.retained.project_id
    project_number        = data.google_project.retained.number
    firestore_database_id = "(default)"
  }

  service_account_ids = {
    whatsapp_service       = "intexuraos-whatsapp-svc-${var.source_environment}"
    message_digest_service = "intexuraos-message-digest-${var.source_environment}"
    intex_agent            = "intexuraos-intex-agent-${var.source_environment}"
    research_agent         = "intexuraos-research-agent-${var.source_environment}"
    code_agent             = "intexuraos-code-${var.source_environment}"
    calendar_agent         = "intexuraos-calendar-${var.source_environment}"
    bookmarks_agent        = "intexuraos-bookmarks-${var.source_environment}"
  }

  cloud_scheduler_service_account_id = "intexuraos-scheduler-${var.source_environment}"
  # activate_hetzner_async_consumers is the explicit cutover gate for staged
  # Pub/Sub push subscriptions and Scheduler jobs in this root.
  hetzner_oidc_audience = var.hetzner_origin
  pubsub_staging_filter = "attributes.intexuraos_hetzner_cutover = \"active\""

  pubsub_topics = {
    message_digest_runs      = "intexuraos-message-digest-runs-${var.source_environment}"
    whatsapp_send            = "intexuraos-whatsapp-send-${var.source_environment}"
    whatsapp_media_cleanup   = "intexuraos-whatsapp-media-cleanup-${var.source_environment}"
    whatsapp_webhook_process = "intexuraos-whatsapp-webhook-process-${var.source_environment}"
    transcription_completed  = "intexuraos-transcription-completed-${var.source_environment}"
    audio_stored             = "intexuraos-audio-stored-${var.source_environment}"
    intex_message_ingest     = "intexuraos-intex-message-ingest-${var.source_environment}"
    research_process         = "intexuraos-research-process-${var.source_environment}"
    llm_analytics            = "intexuraos-llm-analytics-${var.source_environment}"
    llm_call                 = "intexuraos-llm-call-${var.source_environment}"
    bookmark_enrich          = "intexuraos-bookmark-enrich-${var.source_environment}"
    bookmark_summarize       = "intexuraos-bookmark-summarize-${var.source_environment}"
    pr_triage                = "intexuraos-pr-triage-${var.source_environment}"
    transcription_audio_dlq  = "intexuraos-transcription-audio-stored-dlq-${var.source_environment}"
  }

  internal_route_owners = {
    "/internal/archive-stale-groups"                                                 = "code-agent"
    "/internal/auto-archive-merged-tasks"                                            = "code-agent"
    "/internal/bookmarks/pubsub/enrich"                                              = "bookmarks-agent"
    "/internal/bookmarks/pubsub/summarize"                                           = "bookmarks-agent"
    "/internal/calendar/schedules/tick"                                              = "calendar-agent"
    "/internal/code/detect-zombies"                                                  = "code-agent"
    "/internal/code/pubsub/pr-triage"                                                = "code-agent"
    "/internal/drain-queue"                                                          = "code-agent"
    "/internal/execution-memory/process"                                             = "code-agent"
    "/internal/execution-memory/prune-stale"                                         = "code-agent"
    "/internal/execution-memory/sweep-errored"                                       = "code-agent"
    "/internal/intex-agent/messages"                                                 = "intex-agent"
    "/internal/linear/prune-issues"                                                  = "linear-agent"
    "/internal/linear/sync-all"                                                      = "linear-agent"
    "/internal/llm/pubsub/process-llm-call"                                          = "research-agent"
    "/internal/llm/pubsub/process-research"                                          = "research-agent"
    "/internal/llm/pubsub/report-analytics"                                          = "research-agent"
    "/internal/merge-conflicts/reconcile"                                            = "code-agent"
    "/internal/merge-queue/tick"                                                     = "code-agent"
    "/internal/message-digests/pubsub/run"                                           = "message-digest-service"
    "/internal/message-digests/scheduler/tick"                                       = "message-digest-service"
    "/internal/users/"                                                               = "user-service"
    "/internal/whatsapp/private/accounts/:sourceAccountId/erasure"                   = "whatsapp-service"
    "/internal/whatsapp/private/accounts/:sourceAccountId/erasure/:erasureRequestId" = "whatsapp-service"
    "/internal/whatsapp/private/events"                                              = "whatsapp-service"
    "/internal/whatsapp/private/media"                                               = "whatsapp-service"
    "/internal/whatsapp/private/media/backfill"                                      = "whatsapp-service"
    "/internal/whatsapp/pubsub/media-cleanup"                                        = "whatsapp-service"
    "/internal/whatsapp/pubsub/process-webhook"                                      = "whatsapp-service"
    "/internal/whatsapp/pubsub/send-message"                                         = "whatsapp-service"
    "/internal/whatsapp/pubsub/transcription-completed"                              = "whatsapp-service"
    "/internal/whatsapp/webhooks/retry-pending"                                      = "whatsapp-service"
  }
}

data "google_service_account" "service" {
  for_each = local.service_account_ids

  account_id = each.value
  project    = var.project_id
}

data "google_service_account" "cloud_scheduler" {
  account_id = local.cloud_scheduler_service_account_id
  project    = var.project_id
}
