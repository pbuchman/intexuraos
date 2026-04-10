# -----------------------------------------------------------------------------
# INT-750 Phase 8 — Prod Pub/Sub push subscriptions (Hetzner cutover target)
#
# Context:
#   - The GCP project `intexuraos-dev-pbuchman` is SHARED between the legacy
#     Cloud Run environment (environment="dev" in terraform) and the new
#     Hetzner prod VM. Per Decision 3 of the INT-750 migration plan.
#   - Pub/Sub TOPICS are owned by the dev environment (names hardcoded with
#     `-dev` suffix — see terraform/environments/dev/main.tf).
#   - This file creates additional push SUBSCRIPTIONS with name suffix
#     `-prod-hetzner`, pointing at `https://intexuraos.cloud/internal/*`.
#     The audience on each oidc_token matches what the Lua JWT verifier
#     in scripts/hetzner/nginx/jwt-verify.lua enforces (EXPECTED_AUD).
#
# Why this isn't destructive to existing dev subscriptions:
#   - Subscription names are unique (`-prod-hetzner` vs the dev subs which
#     have no suffix or different suffixes).
#   - Each subscription is an independent fan-out consumer of the same
#     topic. Both dev (Cloud Run) and prod-hetzner subscriptions get every
#     message until DNS cutover (Phase 11) switches traffic.
#   - Before DNS cutover: prod-hetzner subscriptions push to
#     https://intexuraos.cloud/internal/* which resolves to the old Cloud
#     Run load balancer (DNS unchanged), which 404s. Messages accumulate
#     in the -prod-hetzner DLQs after 5 failed delivery attempts. This
#     is cosmetic noise, not data loss (the dev sub still processes them).
#   - At DNS cutover: flip intexuraos.cloud → 162.55.210.48. Both sub
#     sets now deliver to Hetzner nginx → PM2 upstreams, causing brief
#     double-processing until Phase 12 deletes the dev subscriptions.
#     Double-processing risk is mitigated by idempotent handlers where
#     possible; the known non-idempotent cases (LLM billing, WhatsApp
#     outbound) are tracked in the Phase 11 cutover procedure as
#     "pause old dev subs before flipping DNS".
#
# Why ack_deadline_seconds varies per subscription:
#   - Research + LLM handlers can take up to 600s (they hit slow upstream
#     LLMs). ack_deadline must exceed the handler's worst case or the
#     message gets re-delivered mid-processing.
#   - WhatsApp / bookmark / calendar handlers are typically <60s.
#   - Actions queue can take 600s because some actions cascade to
#     multiple LLM calls.
#
# Before applying: verify the SA account_ids below match
# terraform/modules/iam/main.tf. Verified 2026-04-11 against:
#   - intexuraos-whatsapp-svc-dev  (iam line 20)
#   - intexuraos-commands-agents-dev (iam line 48 — note plural "agents")
#   - intexuraos-actions-dev       (iam line 55)
#   - intexuraos-research-agent-dev (iam line 41)
#   - intexuraos-calendar-dev      (iam line 111)
#   - intexuraos-bookmarks-dev     (iam line 97)
#   - intexuraos-todos-dev         (iam line 90)
# -----------------------------------------------------------------------------

locals {
  # Existing topics — hardcoded `-dev` suffix because the GCP project is
  # shared and the topic names reflect the (historically dev) environment.
  pubsub_topics = {
    whatsapp_media_cleanup     = "intexuraos-whatsapp-media-cleanup-dev"
    whatsapp_webhook_process   = "intexuraos-whatsapp-webhook-process-dev"
    whatsapp_srt_transcription = "intexuraos-srt-transcription-completed-dev"
    commands_ingest            = "intexuraos-commands-ingest-dev"
    actions_queue              = "intexuraos-actions-queue-dev"
    research_process           = "intexuraos-research-process-dev"
    llm_analytics              = "intexuraos-llm-analytics-dev"
    llm_call                   = "intexuraos-llm-call-dev"
    calendar_preview           = "intexuraos-calendar-preview-dev"
    bookmark_enrich            = "intexuraos-bookmark-enrich-dev"
    bookmark_summarize         = "intexuraos-bookmark-summarize-dev"
    todos_processing           = "intexuraos-todos-processing-dev"
    approval_reply             = "intexuraos-approval-reply-dev"
  }

  # Audience for all prod-hetzner OIDC tokens. Must match EXPECTED_AUD in
  # scripts/hetzner/nginx/jwt-verify.lua. Any mismatch causes a 401 at the
  # nginx edge with error "invalid_audience".
  prod_audience = "https://intexuraos.cloud"
}

# -----------------------------------------------------------------------------
# Service accounts (data sources — these are created by the dev env's
# iam module, we just reference them here for oidc_token.service_account_email).
# -----------------------------------------------------------------------------

data "google_service_account" "whatsapp_service" {
  account_id = "intexuraos-whatsapp-svc-dev"
  project    = var.project_id
}

data "google_service_account" "commands_agent" {
  account_id = "intexuraos-commands-agents-dev"
  project    = var.project_id
}

data "google_service_account" "actions_agent" {
  account_id = "intexuraos-actions-dev"
  project    = var.project_id
}

data "google_service_account" "research_agent" {
  account_id = "intexuraos-research-agent-dev"
  project    = var.project_id
}

data "google_service_account" "calendar_agent" {
  account_id = "intexuraos-calendar-dev"
  project    = var.project_id
}

data "google_service_account" "bookmarks_agent" {
  account_id = "intexuraos-bookmarks-dev"
  project    = var.project_id
}

data "google_service_account" "todos_agent" {
  account_id = "intexuraos-todos-dev"
  project    = var.project_id
}

# -----------------------------------------------------------------------------
# WhatsApp subscriptions (3) — whatsapp-service handler
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_whatsapp_media_cleanup" {
  name    = "intexuraos-whatsapp-media-cleanup-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.whatsapp_media_cleanup}"
  labels  = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s" # 7 days

  push_config {
    push_endpoint = "${local.prod_audience}/internal/whatsapp/pubsub/media-cleanup"
    oidc_token {
      service_account_email = data.google_service_account.whatsapp_service.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.whatsapp_media_cleanup}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy {
    ttl = "" # never expire
  }
}

resource "google_pubsub_subscription" "prod_whatsapp_webhook_process" {
  name    = "intexuraos-whatsapp-webhook-process-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.whatsapp_webhook_process}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/whatsapp/pubsub/process-webhook"
    oidc_token {
      service_account_email = data.google_service_account.whatsapp_service.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.whatsapp_webhook_process}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_whatsapp_srt_transcription" {
  name    = "intexuraos-srt-transcription-completed-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.whatsapp_srt_transcription}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/whatsapp/pubsub/transcription-completed"
    oidc_token {
      service_account_email = data.google_service_account.whatsapp_service.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.whatsapp_srt_transcription}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

# -----------------------------------------------------------------------------
# Commands + actions subscriptions (2)
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_commands_ingest" {
  name    = "intexuraos-commands-ingest-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.commands_ingest}"
  labels  = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/commands"
    oidc_token {
      service_account_email = data.google_service_account.commands_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.commands_ingest}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_actions_queue" {
  name    = "intexuraos-actions-queue-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.actions_queue}"
  labels  = local.common_labels

  ack_deadline_seconds       = 600 # actions can cascade to multiple LLM calls
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/actions/process"
    oidc_token {
      service_account_email = data.google_service_account.actions_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.actions_queue}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

# -----------------------------------------------------------------------------
# Research + LLM subscriptions (3) — research-agent handler
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_research_process" {
  name    = "intexuraos-research-process-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.research_process}"
  labels  = local.common_labels

  ack_deadline_seconds       = 600 # research can hit slow upstream LLMs
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/llm/pubsub/process-research"
    oidc_token {
      service_account_email = data.google_service_account.research_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.research_process}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_llm_call" {
  name    = "intexuraos-llm-call-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.llm_call}"
  labels  = local.common_labels

  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/llm/pubsub/process-llm-call"
    oidc_token {
      service_account_email = data.google_service_account.research_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.llm_call}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_llm_analytics" {
  name    = "intexuraos-llm-analytics-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.llm_analytics}"
  labels  = local.common_labels

  ack_deadline_seconds       = 300
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/llm/pubsub/report-analytics"
    oidc_token {
      service_account_email = data.google_service_account.research_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.llm_analytics}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

# -----------------------------------------------------------------------------
# Calendar / bookmarks / todos subscriptions (4)
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_calendar_preview" {
  name    = "intexuraos-calendar-preview-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.calendar_preview}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/calendar/generate-preview"
    oidc_token {
      service_account_email = data.google_service_account.calendar_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.calendar_preview}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_bookmark_enrich" {
  name    = "intexuraos-bookmark-enrich-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.bookmark_enrich}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/bookmarks/pubsub/enrich"
    oidc_token {
      service_account_email = data.google_service_account.bookmarks_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.bookmark_enrich}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_bookmark_summarize" {
  name    = "intexuraos-bookmark-summarize-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.bookmark_summarize}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/bookmarks/pubsub/summarize"
    oidc_token {
      service_account_email = data.google_service_account.bookmarks_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.bookmark_summarize}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_todos_processing" {
  name    = "intexuraos-todos-processing-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.todos_processing}"
  labels  = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/todos/pubsub/todos-processing"
    oidc_token {
      service_account_email = data.google_service_account.todos_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.todos_processing}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

# -----------------------------------------------------------------------------
# Approval reply subscription (1) — whatsapp-service → actions-agent path
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_approval_reply" {
  name    = "intexuraos-approval-reply-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.pubsub_topics.approval_reply}"
  labels  = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/actions/approval-reply"
    oidc_token {
      service_account_email = data.google_service_account.actions_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.pubsub_topics.approval_reply}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}
