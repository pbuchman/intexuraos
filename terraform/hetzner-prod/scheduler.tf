locals {
  hetzner_scheduler_jobs = {
    mobile_notifications_digest_yesterday = {
      job_name             = "mobile-notifications-digest-yesterday-prod-hetzner"
      description          = "Daily WhatsApp digest aggregation via Hetzner edge"
      schedule             = "0 1 * * *"
      time_zone            = "UTC"
      path                 = "/internal/notifications/digest/run-yesterday"
      body                 = null
      headers              = {}
      retry_count          = 3
      max_retry_duration   = null
      min_backoff_duration = "30s"
      max_backoff_duration = "300s"
    }
    linear_sync_hourly = {
      job_name             = "intexuraos-linear-sync-hourly-prod-hetzner"
      description          = "Sync all Linear issues for all connected users hourly via Hetzner edge"
      schedule             = "0 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/linear/sync-all"
      body                 = null
      headers              = {}
      retry_count          = 1
      max_retry_duration   = "60s"
      min_backoff_duration = "5s"
      max_backoff_duration = "30s"
    }
    linear_issues_prune_hourly = {
      job_name             = "intexuraos-linear-issues-prune-hourly-prod-hetzner"
      description          = "Prune redundant Linear issues when count exceeds threshold via Hetzner edge"
      schedule             = "30 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/linear/prune-issues"
      body                 = null
      headers              = {}
      retry_count          = 1
      max_retry_duration   = "120s"
      min_backoff_duration = "10s"
      max_backoff_duration = "60s"
    }
    retry_pending_whatsapp_webhooks = {
      job_name             = "intexuraos-retry-pending-whatsapp-webhooks-prod-hetzner"
      description          = "Retry persisted WhatsApp webhook events stuck before async processing via Hetzner edge"
      schedule             = "*/5 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/whatsapp/webhooks/retry-pending"
      body                 = null
      headers              = {}
      retry_count          = 1
      max_retry_duration   = "60s"
      min_backoff_duration = "5s"
      max_backoff_duration = "30s"
    }
    drain_task_queue = {
      job_name             = "intexuraos-drain-task-queue-prod-hetzner"
      description          = "Drain queued code tasks when workers become available via Hetzner edge"
      schedule             = "*/1 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/drain-queue"
      body                 = null
      headers              = {}
      retry_count          = 0
      max_retry_duration   = null
      min_backoff_duration = null
      max_backoff_duration = null
    }
    merge_conflict_reconcile = {
      job_name             = "intexuraos-merge-conflict-reconcile-prod-hetzner"
      description          = "Check mergeability and dispatch conflict resolution tasks via Hetzner edge"
      schedule             = "*/1 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/merge-conflicts/reconcile"
      body                 = null
      headers              = {}
      retry_count          = 0
      max_retry_duration   = null
      min_backoff_duration = null
      max_backoff_duration = null
    }
    merge_queue_tick = {
      job_name             = "intexuraos-merge-queue-tick-prod-hetzner"
      description          = "Process one merge cycle for active merge queue watches via Hetzner edge"
      schedule             = "*/1 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/merge-queue/tick"
      body                 = null
      headers              = {}
      retry_count          = 0
      max_retry_duration   = null
      min_backoff_duration = null
      max_backoff_duration = null
    }
    code_tasks_zombie_sweep = {
      job_name             = "intexuraos-code-tasks-zombie-sweep-prod-hetzner"
      description          = "Sweep stuck code tasks with stale heartbeats via Hetzner edge"
      schedule             = "*/5 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/code/detect-zombies"
      body                 = null
      headers              = {}
      retry_count          = 1
      max_retry_duration   = "60s"
      min_backoff_duration = "5s"
      max_backoff_duration = "30s"
    }
    archive_stale_groups = {
      job_name             = "intexuraos-archive-stale-groups-prod-hetzner"
      description          = "Archive issue groups with no activity for 7+ days via Hetzner edge"
      schedule             = "0 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/archive-stale-groups"
      body                 = null
      headers              = {}
      retry_count          = 1
      max_retry_duration   = "60s"
      min_backoff_duration = "5s"
      max_backoff_duration = "30s"
    }
    auto_archive_merged_tasks = {
      job_name             = "intexuraos-auto-archive-merged-tasks-prod-hetzner"
      description          = "Archive code tasks whose PRs were merged 7+ days ago via Hetzner edge"
      schedule             = "0 4 * * *"
      time_zone            = "UTC"
      path                 = "/internal/auto-archive-merged-tasks"
      body                 = null
      headers              = {}
      retry_count          = 1
      max_retry_duration   = "60s"
      min_backoff_duration = "5s"
      max_backoff_duration = "30s"
    }
    execution_memory_process = {
      job_name             = "intexuraos-execution-memory-process-prod-hetzner"
      description          = "Process pending execution memory evaluations via Hetzner edge"
      schedule             = "*/5 * * * *"
      time_zone            = "UTC"
      path                 = "/internal/execution-memory/process"
      body                 = null
      headers              = {}
      retry_count          = 1
      max_retry_duration   = "60s"
      min_backoff_duration = "5s"
      max_backoff_duration = "30s"
    }
    execution_memory_sweep_errored = {
      job_name             = "intexuraos-execution-memory-sweep-errored-prod-hetzner"
      description          = "Sweep errored execution memory post-run tasks via Hetzner edge"
      schedule             = "0 */6 * * *"
      time_zone            = "UTC"
      path                 = "/internal/execution-memory/sweep-errored"
      body                 = null
      headers              = {}
      retry_count          = 1
      max_retry_duration   = "60s"
      min_backoff_duration = "5s"
      max_backoff_duration = "30s"
    }
    execution_memory_prune_stale = {
      job_name             = "intexuraos-execution-memory-prune-stale-prod-hetzner"
      description          = "Archive aged zero-application execution memories via Hetzner edge"
      schedule             = "0 3 * * 0"
      time_zone            = "UTC"
      path                 = "/internal/execution-memory/prune-stale"
      body                 = base64encode("{\"maxAgeDays\":30}")
      headers              = { "Content-Type" = "application/json" }
      retry_count          = 1
      max_retry_duration   = "60s"
      min_backoff_duration = "5s"
      max_backoff_duration = "30s"
    }
  }
}

resource "google_cloud_scheduler_job" "hetzner_http" {
  for_each = local.hetzner_scheduler_jobs

  name        = each.value.job_name
  description = each.value.description
  schedule    = each.value.schedule
  time_zone   = each.value.time_zone
  region      = var.region
  paused      = !var.activate_hetzner_async_consumers

  http_target {
    http_method = "POST"
    uri         = "${var.hetzner_origin}${each.value.path}"
    body        = each.value.body
    headers     = each.value.headers

    oidc_token {
      service_account_email = data.google_service_account.cloud_scheduler.email
      audience              = local.hetzner_oidc_audience
    }
  }

  retry_config {
    retry_count          = each.value.retry_count
    max_retry_duration   = each.value.max_retry_duration
    min_backoff_duration = each.value.min_backoff_duration
    max_backoff_duration = each.value.max_backoff_duration
  }
}
