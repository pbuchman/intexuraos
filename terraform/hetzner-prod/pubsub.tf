locals {
  hetzner_pubsub_push_subscriptions = {
    whatsapp_send = {
      subscription_name     = "intexuraos-whatsapp-send-prod-hetzner"
      topic_name            = local.pubsub_topics.whatsapp_send
      push_path             = "/internal/whatsapp/pubsub/send-message"
      service_account_key   = "whatsapp_service"
      ack_deadline_seconds  = 60
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    whatsapp_media_cleanup = {
      subscription_name     = "intexuraos-whatsapp-media-cleanup-prod-hetzner"
      topic_name            = local.pubsub_topics.whatsapp_media_cleanup
      push_path             = "/internal/whatsapp/pubsub/media-cleanup"
      service_account_key   = "whatsapp_service"
      ack_deadline_seconds  = 60
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    whatsapp_webhook_process = {
      subscription_name     = "intexuraos-whatsapp-webhook-process-prod-hetzner"
      topic_name            = local.pubsub_topics.whatsapp_webhook_process
      push_path             = "/internal/whatsapp/pubsub/process-webhook"
      service_account_key   = "whatsapp_service"
      ack_deadline_seconds  = 120
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    whatsapp_srt_transcription = {
      subscription_name     = "intexuraos-srt-transcription-completed-prod-hetzner"
      topic_name            = local.pubsub_topics.whatsapp_srt_transcription
      push_path             = "/internal/whatsapp/pubsub/transcription-completed"
      service_account_key   = "whatsapp_service"
      ack_deadline_seconds  = 120
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    transcription_completed = {
      subscription_name     = "intexuraos-transcription-completed-prod-hetzner"
      topic_name            = local.pubsub_topics.transcription_completed
      push_path             = "/internal/whatsapp/pubsub/transcription-completed"
      service_account_key   = "whatsapp_service"
      ack_deadline_seconds  = 60
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    commands_ingest = {
      subscription_name     = "intexuraos-commands-ingest-prod-hetzner"
      topic_name            = local.pubsub_topics.commands_ingest
      push_path             = "/internal/commands"
      service_account_key   = "commands_agent"
      ack_deadline_seconds  = 60
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    actions_queue = {
      subscription_name     = "intexuraos-actions-queue-prod-hetzner"
      topic_name            = local.pubsub_topics.actions_queue
      push_path             = "/internal/actions/process"
      service_account_key   = "actions_agent"
      ack_deadline_seconds  = 60
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    research_process = {
      subscription_name     = "intexuraos-research-process-prod-hetzner"
      topic_name            = local.pubsub_topics.research_process
      push_path             = "/internal/llm/pubsub/process-research"
      service_account_key   = "research_agent"
      ack_deadline_seconds  = 600
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    llm_analytics = {
      subscription_name     = "intexuraos-llm-analytics-prod-hetzner"
      topic_name            = local.pubsub_topics.llm_analytics
      push_path             = "/internal/llm/pubsub/report-analytics"
      service_account_key   = "research_agent"
      ack_deadline_seconds  = 300
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    llm_call = {
      subscription_name     = "intexuraos-llm-call-prod-hetzner"
      topic_name            = local.pubsub_topics.llm_call
      push_path             = "/internal/llm/pubsub/process-llm-call"
      service_account_key   = "research_agent"
      ack_deadline_seconds  = 600
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    calendar_preview = {
      subscription_name     = "intexuraos-calendar-preview-prod-hetzner"
      topic_name            = local.pubsub_topics.calendar_preview
      push_path             = "/internal/calendar/generate-preview"
      service_account_key   = "calendar_agent"
      ack_deadline_seconds  = 120
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    bookmark_enrich = {
      subscription_name     = "intexuraos-bookmark-enrich-prod-hetzner"
      topic_name            = local.pubsub_topics.bookmark_enrich
      push_path             = "/internal/bookmarks/pubsub/enrich"
      service_account_key   = "bookmarks_agent"
      ack_deadline_seconds  = 60
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    bookmark_summarize = {
      subscription_name     = "intexuraos-bookmark-summarize-prod-hetzner"
      topic_name            = local.pubsub_topics.bookmark_summarize
      push_path             = "/internal/bookmarks/pubsub/summarize"
      service_account_key   = "bookmarks_agent"
      ack_deadline_seconds  = 120
      retry_minimum_backoff = "30s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 50
    }
    todos_processing = {
      subscription_name     = "intexuraos-todos-processing-prod-hetzner"
      topic_name            = local.pubsub_topics.todos_processing
      push_path             = "/internal/todos/pubsub/todos-processing"
      service_account_key   = "todos_agent"
      ack_deadline_seconds  = 60
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    approval_reply = {
      subscription_name     = "intexuraos-approval-reply-prod-hetzner"
      topic_name            = local.pubsub_topics.approval_reply
      push_path             = "/internal/actions/approval-reply"
      service_account_key   = "actions_agent"
      ack_deadline_seconds  = 60
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
    pr_triage = {
      subscription_name     = "intexuraos-pr-triage-prod-hetzner"
      topic_name            = local.pubsub_topics.pr_triage
      push_path             = "/internal/code/pubsub/pr-triage"
      service_account_key   = "code_agent"
      ack_deadline_seconds  = 300
      retry_minimum_backoff = "10s"
      retry_maximum_backoff = "600s"
      max_delivery_attempts = 5
    }
  }
}

resource "google_pubsub_subscription" "hetzner_push" {
  for_each = local.hetzner_pubsub_push_subscriptions

  name    = each.value.subscription_name
  topic   = data.google_pubsub_topic.hetzner_push[each.key].id
  project = var.project_id
  labels  = local.common_labels
  filter  = var.activate_hetzner_async_consumers ? null : local.pubsub_staging_filter

  ack_deadline_seconds       = each.value.ack_deadline_seconds
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${var.hetzner_origin}${each.value.push_path}"

    oidc_token {
      service_account_email = data.google_service_account.service[each.value.service_account_key].email
      audience              = local.hetzner_oidc_audience
    }

    attributes = {
      x-goog-version = "v1"
    }
  }

  retry_policy {
    minimum_backoff = each.value.retry_minimum_backoff
    maximum_backoff = each.value.retry_maximum_backoff
  }

  dead_letter_policy {
    dead_letter_topic     = data.google_pubsub_topic.hetzner_push_dlq[each.key].id
    max_delivery_attempts = each.value.max_delivery_attempts
  }

  expiration_policy {
    ttl = ""
  }
}

data "google_pubsub_topic" "hetzner_push" {
  for_each = local.hetzner_pubsub_push_subscriptions

  name    = each.value.topic_name
  project = var.project_id
}

data "google_pubsub_topic" "hetzner_push_dlq" {
  for_each = local.hetzner_pubsub_push_subscriptions

  name    = "${each.value.topic_name}-dlq"
  project = var.project_id
}
