# Local-only mock-provider plans; never access GCP or persistent state.
mock_provider "google" {
  mock_data "google_project" {
    defaults = { project_id = "intexuraos-dev-pbuchman", number = "123456789012" }
  }
  mock_data "google_service_account" {
    defaults = { email = "intexuraos-scheduler-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com" }
  }
}

run "defaults_remain_paused" {
  command = plan
  assert {
    condition     = alltrue([for job in google_cloud_scheduler_job.hetzner_http : job.paused])
    error_message = "Default configuration must pause all fourteen jobs."
  }
  assert {
    condition     = length([for subscription in google_pubsub_subscription.hetzner_push : subscription if length(subscription.push_config) == 1]) == 7
    error_message = "Defaults must retain exactly the seven existing push subscriptions."
  }
}

run "master_kill_switch_overrides_selection" {
  command = plan
  variables {
    production_scheduler_jobs_enabled     = false
    production_scheduler_enabled_job_keys = ["calendar_schedule_tick"]
  }
  assert {
    condition     = alltrue([for job in google_cloud_scheduler_job.hetzner_http : job.paused])
    error_message = "The master kill switch must pause even selected jobs."
  }
}

run "independent_job_and_subscription_activation" {
  command = plan
  variables {
    production_scheduler_jobs_enabled                = true
    production_scheduler_enabled_job_keys            = ["calendar_schedule_tick"]
    production_pubsub_push_enabled_subscription_keys = ["message_digest_runs"]
  }
  assert {
    condition     = !google_cloud_scheduler_job.hetzner_http["calendar_schedule_tick"].paused && length([for job in google_cloud_scheduler_job.hetzner_http : job if !job.paused]) == 1
    error_message = "Exactly the selected job must become active."
  }
  assert {
    condition     = length(google_pubsub_subscription.hetzner_push["message_digest_runs"].push_config) == 1 && length(google_pubsub_subscription.hetzner_push["research_process"].push_config) == 0
    error_message = "Restoring digest push must keep research held as pull."
  }
}

run "unknown_job_is_rejected" {
  command = plan
  variables {
    production_scheduler_enabled_job_keys = ["unknown"]
  }
  expect_failures = [var.production_scheduler_enabled_job_keys]
}

run "existing_push_cannot_be_reselected" {
  command = plan
  variables {
    production_pubsub_push_enabled_subscription_keys = ["whatsapp_send"]
  }
  expect_failures = [var.production_pubsub_push_enabled_subscription_keys]
}
