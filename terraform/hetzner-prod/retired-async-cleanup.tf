locals {
  retired_prod_hetzner_scheduler_jobs = {
    retry_pending_actions = {
      job_name = "intexuraos-retry-pending-actions-prod-hetzner"
      path     = "/internal/actions/retry-pending"
    }
    cron_agent_tick = {
      job_name = "intexuraos-cron-agent-tick-prod-hetzner"
      path     = "/internal/cron/tick"
    }
    retry_pending_commands = {
      job_name = "intexuraos-retry-pending-commands-prod-hetzner"
      path     = "/internal/retry-pending"
    }
  }

  retired_prod_hetzner_pubsub_subscriptions = {
    todos_processing = {
      subscription_name = "intexuraos-todos-processing-prod-hetzner"
      push_path         = "/internal/todos/pubsub/todos-processing"
    }
    commands_ingest = {
      subscription_name = "intexuraos-commands-ingest-prod-hetzner"
      push_path         = "/internal/commands"
    }
    actions_queue = {
      subscription_name = "intexuraos-actions-queue-prod-hetzner"
      push_path         = "/internal/actions/process"
    }
    approval_reply = {
      subscription_name = "intexuraos-approval-reply-prod-hetzner"
      push_path         = "/internal/actions/approval-reply"
    }
  }
}

resource "terraform_data" "retired_async_consumer_cleanup" {
  count = var.enable_retired_async_consumer_cleanup ? 1 : 0

  input = {
    project_id           = var.project_id
    region               = var.region
    scheduler_jobs       = local.retired_prod_hetzner_scheduler_jobs
    pubsub_subscriptions = local.retired_prod_hetzner_pubsub_subscriptions
  }

  triggers_replace = {
    cleanup_contract = sha256(jsonencode({
      project_id           = var.project_id
      region               = var.region
      hetzner_origin       = var.hetzner_origin
      scheduler_jobs       = local.retired_prod_hetzner_scheduler_jobs
      pubsub_subscriptions = local.retired_prod_hetzner_pubsub_subscriptions
    }))
  }

  provisioner "local-exec" {
    interpreter = ["/usr/bin/env", "bash", "-lc"]
    command     = <<-EOT
      set -euo pipefail

      command -v gcloud >/dev/null

      project='${var.project_id}'
      region='${var.region}'

      describe_or_absent() {
        local err_file
        err_file="$(mktemp)"
        if "$@" 2>"$err_file"; then
          rm -f "$err_file"
          return 0
        fi

        if grep -Eiq 'NOT_FOUND|not found|does not exist' "$err_file"; then
          rm -f "$err_file"
          return 2
        fi

        cat "$err_file" >&2
        rm -f "$err_file"
        return 1
      }

      delete_scheduler_job() {
        local name="$1"
        local expected_uri="$2"
        local actual_uri

        if actual_uri="$(describe_or_absent gcloud scheduler jobs describe "$name" --project "$project" --location "$region" --format='value(httpTarget.uri)')"; then
          if [[ -z "$actual_uri" || "$actual_uri" != "$expected_uri" ]]; then
            printf 'Refusing to delete scheduler job %s: expected URI %s, got %s\n' "$name" "$expected_uri" "$actual_uri" >&2
            return 1
          fi
          gcloud scheduler jobs delete "$name" --project "$project" --location "$region" --quiet
          return
        fi

        case "$?" in
          2)
            printf 'Scheduler job %s is already absent\n' "$name"
            ;;
          *)
            return 1
            ;;
        esac
      }

      delete_pubsub_subscription() {
        local name="$1"
        local expected_endpoint="$2"
        local actual_endpoint

        if actual_endpoint="$(describe_or_absent gcloud pubsub subscriptions describe "$name" --project "$project" --format='value(pushConfig.pushEndpoint)')"; then
          if [[ -z "$actual_endpoint" || "$actual_endpoint" != "$expected_endpoint" ]]; then
            printf 'Refusing to delete Pub/Sub subscription %s: expected endpoint %s, got %s\n' "$name" "$expected_endpoint" "$actual_endpoint" >&2
            return 1
          fi
          gcloud pubsub subscriptions delete "$name" --project "$project" --quiet
          return
        fi

        case "$?" in
          2)
            printf 'Pub/Sub subscription %s is already absent\n' "$name"
            ;;
          *)
            return 1
            ;;
        esac
      }

      %{for _, job in local.retired_prod_hetzner_scheduler_jobs~}
      delete_scheduler_job '${job.job_name}' '${var.hetzner_origin}${job.path}'
      %{endfor~}

      %{for _, subscription in local.retired_prod_hetzner_pubsub_subscriptions~}
      delete_pubsub_subscription '${subscription.subscription_name}' '${var.hetzner_origin}${subscription.push_path}'
      %{endfor~}
    EOT
  }
}
