# Topic + push subscription that decouples GitHub webhook ingestion from
# unifiedEvaluator triage. The webhook publishes to this topic; the push
# subscription invokes /internal/code/pubsub/pr-triage on code-agent so
# evaluation runs inside its own request lifetime (Cloud Run CPU
# throttling and revision rollovers can no longer drop triage work).

module "pubsub_pr_triage" {
  source = "../../modules/pubsub-push"

  project_id     = var.project_id
  project_number = local.project_number
  topic_name     = "intexuraos-pr-triage-${var.environment}"
  labels         = local.common_labels

  enable_push_subscription = var.enable_legacy_cloud_run_async_consumers

  push_endpoint              = "${module.code_agent.service_url}/internal/code/pubsub/pr-triage"
  push_service_account_email = module.iam.service_accounts["code_agent"]
  push_audience              = module.code_agent.service_url

  # Triage runs an LLM + Linear API + Firestore writes; budget room above default 60s.
  ack_deadline_seconds = 300

  publisher_service_accounts = {
    code_agent = module.iam.service_accounts["code_agent"]
  }

  depends_on = [
    google_project_service.apis,
    module.iam,
    module.code_agent,
  ]
}
