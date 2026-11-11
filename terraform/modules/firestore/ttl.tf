# Firestore native TTL policies.
#
# Each `google_firestore_field` resource enables Firestore's built-in TTL on the
# `expireAt` field of a collection group. When a document's `expireAt` Timestamp
# is in the past, GCP deletes the document (and reclaims its index entries)
# within ~24 hours of expiry. Repositories that write to these collection groups
# populate `expireAt` at write time using the `computeExpireAt` helper from
# `@intexuraos/infra-firestore`.
#
# Retention policy (set at write time, not here):
# - GitHub event collections: 24 hours
# - code_tasks log subcollections: 7 days
# - Notification intents, provider receipts, and delivery markers: 7 days
# - Completed private WhatsApp erasure status records: 30 days
# - Uncommitted Conversation Assistant context updates and their chunks: 30 minutes
#   (committing an update removes expireAt atomically)

locals {
  ttl_collection_groups = [
    "github-webhook-audit-events",
    "github-pr-events",
    "github-event-log-entries",
    "code_review_events",
    "logs",
    "log_lines",
    "turn_metrics",
    "whatsapp_private_erasure_requests",
    "whatsapp_conversation_assistant_context_attachments",
    "whatsapp_conversation_assistant_context_chunks",
    "whatsapp_conversation_assistant_transcript_chunks",
  ]
}

resource "google_firestore_field" "ttl" {
  for_each = toset(local.ttl_collection_groups)

  project    = var.project_id
  database   = google_firestore_database.database.name
  collection = each.key
  field      = "expireAt"

  ttl_config {}

  # Use a no-op index_config to satisfy the resource schema; we are not
  # adding/removing custom indexes here, just enabling TTL.
  index_config {}
}

# Durable notification repositories keep numeric expiresAt for bounded lookups;
# this separate Date/Timestamp field is the native Firestore TTL field.
resource "google_firestore_field" "notification_ttl" {
  for_each = toset([
    "whatsapp_notification_intents",
    "whatsapp_transport_receipts",
    "whatsapp_notification_markers",
  ])

  project    = var.project_id
  database   = google_firestore_database.database.name
  collection = each.key
  field      = "ttlExpiresAt"

  ttl_config {}
  index_config {}
}
