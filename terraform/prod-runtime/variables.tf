variable "project_id" {
  description = "Retained shared GCP project ID for data-plane and async/control-plane resources."
  type        = string
  default     = "intexuraos-dev-pbuchman"

  validation {
    condition     = var.project_id == "intexuraos-dev-pbuchman"
    error_message = "Production runtime must reference the retained shared GCP project intexuraos-dev-pbuchman."
  }
}

variable "region" {
  description = "GCP region for retained resource references."
  type        = string
  default     = "europe-central2"
}

variable "environment" {
  description = "Environment label for production runtime resources."
  type        = string
  default     = "prod"

  validation {
    condition     = var.environment == "prod"
    error_message = "This root is only for the prod environment."
  }
}

variable "source_environment" {
  description = "Existing Terraform environment suffix for retained GCP topics, service accounts, and jobs."
  type        = string
  default     = "dev"

  validation {
    condition     = var.source_environment == "dev"
    error_message = "Production runtime targets retained resources owned by terraform/shared-gcp."
  }
}

variable "hetzner_origin" {
  description = "Historical compatibility input for the public production origin used by retained GCP delivery targets."
  type        = string
  default     = "https://intexuraos.cloud"

  validation {
    condition     = can(regex("^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.hetzner_origin))
    error_message = "hetzner_origin must be an HTTPS origin without a port, path, query string, or trailing slash."
  }

  validation {
    condition     = var.hetzner_origin == "https://intexuraos.cloud"
    error_message = "hetzner_origin is fixed to https://intexuraos.cloud for this production runtime root."
  }
}

variable "activate_hetzner_async_consumers" {
  description = "Deprecated compatibility pin that must remain true so existing Pub/Sub filters stay unchanged. Scheduler control is separate."
  type        = bool
  default     = true

  validation {
    condition     = var.activate_hetzner_async_consumers == true
    error_message = "activate_hetzner_async_consumers is a compatibility pin and must remain true."
  }
}

variable "production_scheduler_jobs_enabled" {
  description = "Master kill switch: a job runs only when true AND selected in production_scheduler_enabled_job_keys. Keep false until reviewed staged activation."
  type        = bool
  default     = false
}

variable "production_scheduler_enabled_job_keys" {
  description = "Independently selected Scheduler keys; all jobs remain paused unless the master switch is also true."
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([for key in var.production_scheduler_enabled_job_keys : contains([
      "message_digest_tick",
      "linear_sync_hourly",
      "linear_issues_prune_hourly",
      "retry_pending_whatsapp_webhooks",
      "calendar_schedule_tick",
      "drain_task_queue",
      "merge_conflict_reconcile",
      "merge_queue_tick",
      "code_tasks_zombie_sweep",
      "archive_stale_groups",
      "auto_archive_merged_tasks",
      "execution_memory_process",
      "execution_memory_sweep_errored",
      "execution_memory_prune_stale"
    ], key)])
    error_message = "Every enabled Scheduler key must exist in hetzner_scheduler_jobs."
  }
}

variable "production_pubsub_push_enabled_subscription_keys" {
  description = "Restore push delivery independently for the five held pull subscriptions. Existing seven push subscriptions remain unchanged."
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([for key in var.production_pubsub_push_enabled_subscription_keys : contains([
      "message_digest_runs", "research_process", "llm_analytics", "llm_call", "pr_triage"
    ], key)])
    error_message = "Only the five held pull subscription keys may be selected for restoration."
  }
}

variable "labels" {
  description = "Additional labels applied to retained async/control-plane resources."
  type        = map(string)
  default     = {}
}
