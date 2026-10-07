output "environment" {
  description = "Production runtime environment label."
  value       = var.environment
}

output "retained_gcp_project_id" {
  description = "Shared GCP project retained for Firestore, Pub/Sub, Secret Manager, GCS, Cloud Functions, Artifact Registry, and Cloud Build."
  value       = local.retained_gcp.project_id
}

output "retained_gcp_project_number" {
  description = "Shared GCP project number for retained resource integrations."
  value       = local.retained_gcp.project_number
}

output "retained_firestore_database_id" {
  description = "Retained Firestore database ID. The database remains owned by terraform/shared-gcp."
  value       = local.retained_gcp.firestore_database_id
}

output "retained_gcp_inventory" {
  description = "Read-only inventory of retained GCP resources that remain owned by terraform/shared-gcp."
  value       = local.retained_gcp_inventory
}

output "public_origin" {
  description = "Public production origin used by retained GCP callback resources."
  value       = var.hetzner_origin
}

output "hetzner_pubsub_subscriptions" {
  description = "Production runtime Pub/Sub subscriptions keyed by control-plane flow. Historical Terraform addresses remain stable."
  value = {
    for key, subscription in google_pubsub_subscription.hetzner_push : key => {
      name          = subscription.name
      topic         = subscription.topic
      push_endpoint = try(subscription.push_config[0].push_endpoint, null)
      audience      = try(subscription.push_config[0].oidc_token[0].audience, null)
      filter        = subscription.filter == "" ? null : subscription.filter
    }
  }
}

output "hetzner_scheduler_jobs" {
  description = "Production runtime Cloud Scheduler jobs keyed by control-plane flow. Historical Terraform addresses remain stable."
  value = {
    for key, job in google_cloud_scheduler_job.hetzner_http : key => {
      name     = job.name
      schedule = job.schedule
      uri      = job.http_target[0].uri
      audience = job.http_target[0].oidc_token[0].audience
      paused   = job.paused
    }
  }
}

output "retained_gcp_cloud_functions" {
  description = "Cloud Functions deliberately retained on their current GCP targets for this cutover."
  value       = local.retained_gcp_cloud_functions
}

output "retained_gcp_scheduler_jobs" {
  description = "Scheduler jobs deliberately retained on non-Hetzner GCP targets."
  value       = local.retained_gcp_scheduler_jobs
}

output "hetzner_internal_route_owners" {
  description = "Expected production edge routing table for Pub/Sub and Scheduler /internal/* callbacks."
  value       = local.internal_route_owners
}

output "hetzner_edge_auth_contract" {
  description = "Auth contract that must hold at the production edge for active push subscriptions."
  value = {
    oidc_audience = local.hetzner_oidc_audience
    edge_behavior = "nginx verifies Google OIDC JWTs for /internal/*, including issuer, audience, and allowed email/sub principal, before proxying to the owning service"
    allowed_oidc_principals = {
      pubsub_push = {
        for key, config in local.hetzner_pubsub_push_subscriptions : key => data.google_service_account.service[config.service_account_key].email
        if config.delivery_mode == "push"
      }
      scheduler = data.google_service_account.cloud_scheduler.email
    }
    proxy_headers = {
      scheduler = "after OIDC verification, strip Authorization and inject x-internal-auth with the owning service's INTEXURAOS_INTERNAL_AUTH_TOKEN"
      pubsub    = "after OIDC verification, strip Authorization, preserve From: noreply@google.com and the Pub/Sub envelope, and inject x-internal-auth with the owning service's INTEXURAOS_INTERNAL_AUTH_TOKEN"
    }
    prohibited_forwarding = "do not forward unverified requests, route solely by bearer presence, or mint service-specific OIDC tokens in this Terraform root"
  }
}

output "cutover_activation_contract" {
  description = "Current production runtime activation constraints."
  value = {
    step_name = "home-prod-basic-runtime-safety"
    order = [
      "keep activate_hetzner_async_consumers=true so existing immutable subscription filters remain empty",
      "remove push delivery only from message_digest_runs, research_process, llm_call, llm_analytics, and pr_triage while their handlers are unavailable",
      "keep production_scheduler_jobs_enabled=false so all fourteen jobs remain paused during the basic Home PROD stage",
      "verify the production edge auth and routing contract before re-enabling any unavailable consumer",
    ]
  }
}

output "cutover_old_root_ownership_contract" {
  description = "State-ownership guard for legacy Cloud Run consumers managed outside this root."
  value = {
    old_root                   = "terraform/shared-gcp"
    required_control           = "coordinate old-root ownership before clearing push config, detaching, deleting, or gating old Cloud Run-targeted Pub/Sub subscriptions, and before pausing or removing old app-targeted Scheduler jobs"
    reapply_risk               = "a later apply of terraform/shared-gcp can recreate or unpause old Cloud Run async consumers unless that root is coordinated first"
    retained_gcp_transcription = "do not pause or remove the retained audio-stored -> transcription Cloud Function subscription as part of the Cloud Run consumer cleanup"
  }
}

output "hetzner_staging_controls" {
  description = "Compatibility and Scheduler controls for the basic Home PROD stage."
  value = {
    activate_hetzner_async_consumers = var.activate_hetzner_async_consumers
    pubsub_staging_filter            = local.pubsub_staging_filter
    pubsub_filter_compatibility_note = "The deprecated activation pin stays true so Terraform preserves the existing empty immutable filters."
    scheduler_jobs_paused            = !var.production_scheduler_jobs_enabled
  }
}

output "cutover_cloud_run_subscriptions_to_pause_or_remove" {
  description = "Existing Cloud Run-targeted push subscriptions to clear push config, detach, delete, or gate during cutover to prevent duplicate processing. Pub/Sub subscriptions do not support pause."
  value = [
    "intexuraos-whatsapp-send-${var.source_environment}-push",
    "intexuraos-whatsapp-media-cleanup-${var.source_environment}-push",
    "intexuraos-whatsapp-webhook-process-${var.source_environment}-push",
    "intexuraos-intex-message-ingest-${var.source_environment}-push",
    "intexuraos-research-process-${var.source_environment}-push",
    "intexuraos-llm-analytics-${var.source_environment}-push",
    "intexuraos-llm-call-${var.source_environment}-push",
    "intexuraos-bookmark-enrich-${var.source_environment}-push",
    "intexuraos-bookmark-summarize-${var.source_environment}-push",
    "intexuraos-pr-triage-${var.source_environment}-push",
  ]
}

output "cutover_cloud_run_scheduler_jobs_to_pause_or_remove" {
  description = "Existing Cloud Run-targeted scheduler jobs to pause or remove during the named cutover step to prevent duplicate processing."
  value = [
    "intexuraos-linear-sync-hourly-${var.source_environment}",
    "intexuraos-linear-issues-prune-hourly-${var.source_environment}",
    "intexuraos-drain-task-queue-${var.source_environment}",
    "intexuraos-merge-conflict-reconcile-${var.source_environment}",
    "intexuraos-merge-queue-tick-${var.source_environment}",
    "intexuraos-code-tasks-zombie-sweep-${var.source_environment}",
    "intexuraos-archive-stale-groups-${var.source_environment}",
    "intexuraos-auto-archive-merged-tasks-${var.source_environment}",
    "intexuraos-execution-memory-process-${var.source_environment}",
    "intexuraos-execution-memory-sweep-errored-${var.source_environment}",
    "intexuraos-execution-memory-prune-stale-${var.source_environment}",
  ]
}
