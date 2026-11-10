# Compact monitoring queries are bounded by delivery cursors or unresolved work.
# Terraform owns creation. Firebase's generated catalog retains these same indexes.
locals {
  digest_monitoring_indexes = jsondecode(file("${path.module}/../../../firestore.monitoring-indexes.json")).indexes
}

resource "google_firestore_index" "digest_monitoring" {
  for_each = local.digest_monitoring_indexes

  project     = var.project_id
  database    = google_firestore_database.database.name
  collection  = each.value.collectionGroup
  query_scope = each.value.queryScope

  dynamic "fields" {
    for_each = each.value.fields
    content {
      field_path = fields.value.fieldPath
      order      = fields.value.order
    }
  }
}
