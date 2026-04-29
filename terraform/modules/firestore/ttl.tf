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

locals {
  ttl_collection_groups = [
    "github-webhook-audit-events",
    "github-pr-events",
    "github-event-log-entries",
    "logs",
    "log_lines",
    "turn_metrics",
    "log_entries",
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
