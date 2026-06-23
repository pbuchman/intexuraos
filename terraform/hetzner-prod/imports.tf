import {
  to = hcloud_ssh_key.deploy
  id = "110595122"
}

import {
  to = hcloud_primary_ip.prod_ipv4
  id = "125976522"
}

import {
  to = hcloud_firewall.prod
  id = "10824053"
}

import {
  to = google_pubsub_subscription.hetzner_push["whatsapp_media_cleanup"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-whatsapp-media-cleanup-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["whatsapp_webhook_process"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-whatsapp-webhook-process-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["whatsapp_srt_transcription"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-srt-transcription-completed-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["commands_ingest"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-commands-ingest-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["actions_queue"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-actions-queue-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["research_process"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-research-process-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["llm_analytics"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-llm-analytics-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["llm_call"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-llm-call-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["calendar_preview"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-calendar-preview-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["bookmark_enrich"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-bookmark-enrich-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["bookmark_summarize"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-bookmark-summarize-prod-hetzner"
}

import {
  to = google_pubsub_subscription.hetzner_push["approval_reply"]
  id = "projects/intexuraos-dev-pbuchman/subscriptions/intexuraos-approval-reply-prod-hetzner"
}
