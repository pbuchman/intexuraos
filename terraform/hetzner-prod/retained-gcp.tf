locals {
  retained_gcp_environment = var.source_environment

  retained_gcp_buckets = {
    static_assets          = "intexuraos-static-assets-${local.retained_gcp_environment}"
    shared_content         = "intexuraos-shared-content-${local.retained_gcp_environment}"
    web_app                = "intexuraos-web-${local.retained_gcp_environment}"
    whatsapp_media         = "intexuraos-whatsapp-media-${local.retained_gcp_environment}"
    generated_images       = "intexuraos-images-${local.retained_gcp_environment}"
    cloud_functions_source = "intexuraos-functions-source-${local.retained_gcp_environment}"
  }

  retained_gcp_pubsub_topics = {
    message_digest_runs      = "intexuraos-message-digest-runs-${local.retained_gcp_environment}"
    whatsapp_media_cleanup   = "intexuraos-whatsapp-media-cleanup-${local.retained_gcp_environment}"
    whatsapp_webhook_process = "intexuraos-whatsapp-webhook-process-${local.retained_gcp_environment}"
    audio_stored             = "intexuraos-audio-stored-${local.retained_gcp_environment}"
    transcription_audio_dlq  = "intexuraos-transcription-audio-stored-dlq-${local.retained_gcp_environment}"
    intex_message_ingest     = "intexuraos-intex-message-ingest-${local.retained_gcp_environment}"
    research_process         = "intexuraos-research-process-${local.retained_gcp_environment}"
    llm_analytics            = "intexuraos-llm-analytics-${local.retained_gcp_environment}"
    llm_call                 = "intexuraos-llm-call-${local.retained_gcp_environment}"
    whatsapp_send            = "intexuraos-whatsapp-send-${local.retained_gcp_environment}"
    bookmark_enrich          = "intexuraos-bookmark-enrich-${local.retained_gcp_environment}"
    bookmark_summarize       = "intexuraos-bookmark-summarize-${local.retained_gcp_environment}"
    pr_triage                = "intexuraos-pr-triage-${local.retained_gcp_environment}"
    transcription_completed  = "intexuraos-transcription-completed-${local.retained_gcp_environment}"
  }

  retained_gcp_cloud_function_names = {
    transcription = "intexuraos-transcription-${local.retained_gcp_environment}"
  }

  retained_gcp_artifact_registry = {
    repository_id  = "intexuraos-${local.retained_gcp_environment}"
    repository_url = "${var.region}-docker.pkg.dev/${var.project_id}/intexuraos-${local.retained_gcp_environment}"
    code_worker    = "${var.region}-docker.pkg.dev/${var.project_id}/intexuraos-${local.retained_gcp_environment}/code-worker"
  }

  retained_gcp_cloud_build_triggers = {
    monolith      = "intexuraos-${local.retained_gcp_environment}-deploy"
    web           = "web"
    firestore     = "firestore"
    code_worker   = "code-worker"
    transcription = "transcription"
  }

  retained_gcp_service_accounts = {
    cloud_scheduler              = "intexuraos-scheduler-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    message_digest_service       = "intexuraos-message-digest-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    cloud_functions              = "intexuraos-functions-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    transcription_function       = "ixos-transcription-fn-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    user_service                 = "intexuraos-user-svc-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    notion_service               = "intexuraos-notion-svc-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    whatsapp_service             = "intexuraos-whatsapp-svc-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    mobile_notifications_service = "intexuraos-mobile-svc-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    fishing_assistant_service    = "intexuraos-fishing-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    research_agent               = "intexuraos-research-agent-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    intex_agent                  = "intexuraos-intex-agent-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    image_service                = "intexuraos-image-svc-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    notes_agent                  = "intexuraos-notes-svc-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    app_settings_service         = "intexuraos-settings-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    bookmarks_agent              = "intexuraos-bookmarks-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    code_agent                   = "intexuraos-code-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    calendar_agent               = "intexuraos-calendar-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    web_agent                    = "intexuraos-web-agent-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    linear_agent                 = "intexuraos-linear-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    api_docs_hub                 = "intexuraos-docs-hub-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    hellscript_agent             = "intexuraos-hellscript-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
    llm_usage_service            = "intexuraos-llm-usage-${local.retained_gcp_environment}@${var.project_id}.iam.gserviceaccount.com"
  }

  retained_gcp_secret_ids = toset([
    "INTEXURAOS_TOKEN_ENCRYPTION_KEY",
    "INTEXURAOS_ENCRYPTION_KEY",
    "INTEXURAOS_WHATSAPP_VERIFY_TOKEN",
    "INTEXURAOS_WHATSAPP_ACCESS_TOKEN",
    "INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID",
    "INTEXURAOS_WHATSAPP_WABA_ID",
    "INTEXURAOS_WHATSAPP_APP_SECRET",
    "INTEXURAOS_SPEECHMATICS_APP_API_KEY",
    "INTEXURAOS_INTERNAL_AUTH_TOKEN",
    "INTEXURAOS_SSL_PRIVATE_KEY",
    "INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET",
    "INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET",
    "INTEXURAOS_SENTRY_WEBHOOK_SECRET",
    "INTEXURAOS_SENTRY_AUTOMATION_USER_ID",
    "INTEXURAOS_CLOUDFLARE_API_TOKEN",
    var.cloudflare_dns_api_token_secret_id,
    "INTEXURAOS_OPENAI_APP_API_KEY",
    "INTEXURAOS_MINIMAX_APP_API_KEY",
    "INTEXURAOS_MIMO_APP_API_KEY",
    "INTEXURAOS_DASHSCOPE_APP_API_KEY",
    "INTEXURAOS_KIMI_APP_API_KEY",
    "INTEXURAOS_OPENROUTER_APP_API_KEY",
    "INTEXURAOS_LINEAR_API_KEY",
    "INTEXURAOS_ORCHESTRATOR_SECRET",
    "INTEXURAOS_WEBHOOK_VERIFY_SECRET",
    "INTEXURAOS_GITHUB_APP_PRIVATE_KEY",
    "INTEXURAOS_GITHUB_WEBHOOK_SECRET",
  ])

  retained_gcp_inventory = {
    project_id                    = local.retained_gcp.project_id
    project_number                = local.retained_gcp.project_number
    source_environment            = local.retained_gcp_environment
    firestore_database_id         = local.retained_gcp.firestore_database_id
    buckets                       = local.retained_gcp_buckets
    pubsub_topics                 = local.retained_gcp_pubsub_topics
    cloud_functions               = local.retained_gcp_cloud_function_names
    artifact_registry             = local.retained_gcp_artifact_registry
    cloud_build_triggers          = local.retained_gcp_cloud_build_triggers
    service_accounts              = local.retained_gcp_service_accounts
    secret_ids                    = local.retained_gcp_secret_ids
    cloudflare_dns_api_token_name = local.retained_gcp.cloudflare_dns_api_token_secret_id
  }
}
