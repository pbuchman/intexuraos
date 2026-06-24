output "environment" {
  description = "Hetzner migration environment label."
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
  description = "Retained Firestore database ID. The database remains owned by terraform/environments/dev."
  value       = local.retained_gcp.firestore_database_id
}

output "cloudflare_dns_api_token_secret_id" {
  description = "Retained GCP Secret Manager secret ID for the Cloudflare DNS API token."
  value       = local.retained_gcp.cloudflare_dns_api_token_secret_id
}

output "retained_gcp_inventory" {
  description = "Read-only inventory of retained GCP resources that remain owned by terraform/environments/dev."
  value       = local.retained_gcp_inventory
}

output "hetzner_server_id" {
  description = "Hetzner server ID for the production VM."
  value       = hcloud_server.prod.id
}

output "hetzner_server_name" {
  description = "Hetzner server name for runtime/deploy workers."
  value       = hcloud_server.prod.name
}

output "hetzner_server_ipv4" {
  description = "Stable primary IPv4 address assigned to the Hetzner production VM."
  value       = hcloud_primary_ip.prod_ipv4.ip_address
}

output "hetzner_primary_ipv4_id" {
  description = "Hetzner primary IPv4 resource ID."
  value       = hcloud_primary_ip.prod_ipv4.id
}

output "hetzner_location" {
  description = "Hetzner location used for both the server and primary IPv4."
  value       = var.hetzner_location
}

output "hetzner_firewall_id" {
  description = "Hetzner firewall ID attached to the production VM."
  value       = hcloud_firewall.prod.id
}

output "hetzner_dns_a_record_hint" {
  description = "DNS A record hint for production cutover."
  value       = "A ${var.domain} ${hcloud_primary_ip.prod_ipv4.ip_address}"
}

output "hetzner_ssh_command" {
  description = "SSH command for production VM operations."
  value       = "ssh root@${hcloud_primary_ip.prod_ipv4.ip_address}"
}

output "public_origin" {
  description = "Public production origin routed to the Hetzner VM."
  value       = var.hetzner_origin
}

output "hetzner_pubsub_subscriptions" {
  description = "Hetzner-targeted Pub/Sub subscriptions keyed by control-plane flow."
  value = {
    for key, subscription in google_pubsub_subscription.hetzner_push : key => {
      name          = subscription.name
      topic         = subscription.topic
      push_endpoint = subscription.push_config[0].push_endpoint
      audience      = subscription.push_config[0].oidc_token[0].audience
      filter        = subscription.filter == "" ? null : subscription.filter
    }
  }
}

output "hetzner_scheduler_jobs" {
  description = "Hetzner-targeted Cloud Scheduler jobs keyed by control-plane flow."
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
  description = "Expected Hetzner edge routing table for Pub/Sub and Scheduler /internal/* callbacks."
  value       = local.internal_route_owners
}

output "hetzner_edge_auth_contract" {
  description = "Auth contract that must hold at the Hetzner edge before activating the staged async/control-plane resources."
  value = {
    oidc_audience = local.hetzner_oidc_audience
    edge_behavior = "nginx verifies Google OIDC JWTs for /internal/*, including issuer, audience, and allowed email/sub principal, before proxying to the owning service"
    allowed_oidc_principals = {
      pubsub_push = {
        for key, config in local.hetzner_pubsub_push_subscriptions : key => data.google_service_account.service[config.service_account_key].email
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
  description = "Required activation order for the additive Hetzner-targeted async/control-plane resources."
  value = {
    step_name = "disable-old-cloud-run-async-consumers-before-hetzner-activation"
    order = [
      "apply this root with activate_hetzner_async_consumers=false to create staged Hetzner resources: Pub/Sub pushes use the staging filter and Scheduler jobs are paused",
      "verify the Hetzner edge auth/routing contract for every /internal/* path",
      "coordinate terraform/environments/dev ownership before changing the old Cloud Run consumers so later dev-root applies cannot recreate or unpause them",
      "quiesce async publishers/traffic, then clear push config, detach, delete, or gate the listed Cloud Run-targeted Pub/Sub subscriptions",
      "pause or remove the listed old app-targeted Cloud Scheduler jobs",
      "activate DNS / traffic cutover so https://intexuraos.cloud reaches the Hetzner edge while staged async consumers remain inactive",
      "apply this root with activate_hetzner_async_consumers=true; Pub/Sub subscriptions are replaced because filters are immutable, and Scheduler jobs are unpaused",
      "resume async publishers/traffic after the active apply completes",
    ]
  }
}

output "cutover_old_root_ownership_contract" {
  description = "State-ownership guard for legacy Cloud Run consumers managed outside this root."
  value = {
    old_root                   = "terraform/environments/dev"
    required_control           = "coordinate old-root ownership before clearing push config, detaching, deleting, or gating old Cloud Run-targeted Pub/Sub subscriptions, and before pausing or removing old app-targeted Scheduler jobs"
    reapply_risk               = "a later apply of terraform/environments/dev can recreate or unpause old Cloud Run async consumers unless that root is coordinated first"
    retained_gcp_transcription = "do not pause or remove the retained audio-stored -> transcription Cloud Function subscription as part of the Cloud Run consumer cleanup"
  }
}

output "hetzner_staging_controls" {
  description = "Inactive-by-default controls that prevent duplicate Cloud Run and Hetzner async consumers before cutover activation."
  value = {
    activate_hetzner_async_consumers = var.activate_hetzner_async_consumers
    pubsub_staging_filter            = local.pubsub_staging_filter
    pubsub_activation_replaces       = true
    pubsub_activation_note           = "Pub/Sub subscription filters are immutable, so active cutover replaces the staged filtered subscriptions."
    scheduler_jobs_paused            = !var.activate_hetzner_async_consumers
  }
}

output "cutover_cloud_run_subscriptions_to_pause_or_remove" {
  description = "Existing Cloud Run-targeted push subscriptions to clear push config, detach, delete, or gate during cutover to prevent duplicate processing. Pub/Sub subscriptions do not support pause."
  value = [
    "intexuraos-whatsapp-send-${var.source_environment}-push",
    "intexuraos-whatsapp-media-cleanup-${var.source_environment}-push",
    "intexuraos-whatsapp-webhook-process-${var.source_environment}-push",
    "intexuraos-srt-transcription-completed-${var.source_environment}-push",
    "intexuraos-transcription-completed-${var.source_environment}-push",
    "intexuraos-commands-ingest-${var.source_environment}-push",
    "intexuraos-actions-queue-${var.source_environment}-push",
    "intexuraos-research-process-${var.source_environment}-push",
    "intexuraos-llm-analytics-${var.source_environment}-push",
    "intexuraos-llm-call-${var.source_environment}-push",
    "intexuraos-calendar-preview-${var.source_environment}-push",
    "intexuraos-bookmark-enrich-${var.source_environment}-push",
    "intexuraos-bookmark-summarize-${var.source_environment}-push",
    "intexuraos-approval-reply-${var.source_environment}-push",
    "intexuraos-pr-triage-${var.source_environment}-push",
  ]
}

output "cutover_cloud_run_scheduler_jobs_to_pause_or_remove" {
  description = "Existing Cloud Run-targeted scheduler jobs to pause or remove during the named cutover step to prevent duplicate processing."
  value = [
    "mobile-notifications-digest-yesterday-${var.source_environment}",
    "intexuraos-linear-sync-hourly-${var.source_environment}",
    "intexuraos-linear-issues-prune-hourly-${var.source_environment}",
    "intexuraos-retry-pending-commands-${var.source_environment}",
    "intexuraos-retry-pending-actions-${var.source_environment}",
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
