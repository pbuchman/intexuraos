# Monitoring Module
# Creates a unified dashboard with critical metrics and alert policies.

# =============================================================================
# LOG-BASED METRICS
# =============================================================================

resource "google_logging_metric" "llm_errors" {
  name        = "llm-provider-errors"
  description = "Errors from LLM provider calls"
  filter      = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="research-agent"
    severity>=ERROR
    (textPayload=~"LLM" OR textPayload=~"OpenAI" OR textPayload=~"Gemini" OR textPayload=~"Claude" OR textPayload=~"Perplexity" OR jsonPayload.message=~"LLM|OpenAI|Gemini|Claude|Perplexity")
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "service"
      value_type  = "STRING"
      description = "Cloud Run service name"
    }
  }

  label_extractors = {
    "service" = "EXTRACT(resource.labels.service_name)"
  }
}

resource "google_logging_metric" "whatsapp_webhook_errors" {
  name        = "whatsapp-webhook-errors"
  description = "WhatsApp webhook processing errors"
  filter      = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="whatsapp-service"
    severity>=ERROR
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

# =============================================================================
# CLOUD BUILD NETWORK TELEMETRY METRICS
# =============================================================================

resource "google_logging_metric" "cloudbuild_network_telemetry" {
  name        = "cloudbuild-network-telemetry"
  description = "Cloud Build network telemetry events by service (rx/tx Mbps in log payload)"
  filter      = <<-EOT
    resource.type="cloudbuild.googleapis.com/Build"
    jsonPayload.event="network_telemetry"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key         = "service"
      value_type  = "STRING"
      description = "Service being built"
    }
  }

  label_extractors = {
    "service" = "EXTRACT(jsonPayload.service)"
  }
}

# =============================================================================
# DASHBOARD
# =============================================================================

resource "google_monitoring_dashboard" "main" {
  dashboard_json = jsonencode({
    displayName = "IntexuraOS - Critical Metrics"
    labels = {
      environment = var.environment
    }
    mosaicLayout = {
      columns = 12
      tiles = [
        # Row 1: Errors & Warnings Log Panel (full width)
        {
          xPos   = 0
          yPos   = 0
          width  = 12
          height = 6
          widget = {
            title = "All Services - Errors & Warnings"
            logsPanel = {
              filter        = "resource.type=\"cloud_run_revision\" severity>=\"WARNING\""
              resourceNames = ["projects/${var.project_id}"]
            }
          }
        },

        # Row 2: LLM Metrics
        {
          xPos   = 0
          yPos   = 6
          width  = 6
          height = 4
          widget = {
            title = "1. LLM Provider Errors"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.llm_errors.name}\" resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                scale = "LINEAR"
              }
            }
          }
        },
        {
          xPos   = 6
          yPos   = 6
          width  = 6
          height = 4
          widget = {
            title = "1. LLM Request Latency (P95)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"research-agent\" metric.type=\"run.googleapis.com/request_latencies\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_MEAN"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                scale = "LINEAR"
                label = "ms"
              }
            }
          }
        },

        # Row 3: Cloud Run Error Rates
        {
          xPos   = 0
          yPos   = 10
          width  = 6
          height = 4
          widget = {
            title = "2. Cloud Run 5xx Error Rate by Service"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_count\" metric.labels.response_code_class=\"5xx\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.service_name"]
                    }
                  }
                }
                plotType = "STACKED_BAR"
              }]
              yAxis = {
                scale = "LINEAR"
                label = "errors/sec"
              }
            }
          }
        },
        {
          xPos   = 6
          yPos   = 10
          width  = 6
          height = 4
          widget = {
            title = "2. Cloud Run Request Count by Service"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_count\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.service_name"]
                    }
                  }
                }
                plotType = "STACKED_AREA"
              }]
              yAxis = {
                scale = "LINEAR"
                label = "req/sec"
              }
            }
          }
        },

        # Row 4: Pub/Sub & WhatsApp
        {
          xPos   = 0
          yPos   = 14
          width  = 3
          height = 4
          widget = {
            title = "3. Pub/Sub Unacked Messages"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                scale = "LINEAR"
              }
            }
          }
        },
        {
          xPos   = 3
          yPos   = 14
          width  = 3
          height = 4
          widget = {
            title = "4. WhatsApp Webhook Errors"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.whatsapp_webhook_errors.name}\" resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                scale = "LINEAR"
              }
            }
          }
        },
        {
          xPos   = 6
          yPos   = 14
          width  = 3
          height = 4
          widget = {
            title = "5. E2E Latency (All Services P95)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_latencies\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_MAX"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                scale = "LINEAR"
                label = "ms"
              }
            }
          }
        },
        {
          xPos   = 9
          yPos   = 14
          width  = 3
          height = 4
          widget = {
            title = "6. DLQ Messages (by subscription)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" resource.label.subscription_id=has_substring(\"-dlq-sub\")"
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.subscription_id"]
                    }
                  }
                }
                plotType = "STACKED_BAR"
              }]
              yAxis = {
                scale = "LINEAR"
              }
            }
          }
        },

        # Row 5: Scorecards for quick status
        {
          xPos   = 0
          yPos   = 18
          width  = 3
          height = 3
          widget = {
            title = "LLM Errors (1h)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.llm_errors.name}\" resource.type=\"cloud_run_revision\""
                  aggregation = {
                    alignmentPeriod    = "3600s"
                    perSeriesAligner   = "ALIGN_SUM"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              thresholds = [{
                value     = 10
                color     = "YELLOW"
                direction = "ABOVE"
                }, {
                value     = 50
                color     = "RED"
                direction = "ABOVE"
              }]
            }
          }
        },
        {
          xPos   = 3
          yPos   = 18
          width  = 3
          height = 3
          widget = {
            title = "5xx Errors (1h)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_count\" metric.labels.response_code_class=\"5xx\""
                  aggregation = {
                    alignmentPeriod    = "3600s"
                    perSeriesAligner   = "ALIGN_SUM"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              thresholds = [{
                value     = 10
                color     = "YELLOW"
                direction = "ABOVE"
                }, {
                value     = 100
                color     = "RED"
                direction = "ABOVE"
              }]
            }
          }
        },
        {
          xPos   = 6
          yPos   = 18
          width  = 3
          height = 3
          widget = {
            title = "DLQ Messages"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"pubsub_subscription\" metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" resource.label.subscription_id=has_substring(\"-dlq-sub\")"
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_MEAN"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              thresholds = [{
                value     = 0
                color     = "RED"
                direction = "ABOVE"
              }]
              gaugeView = {
                lowerBound = 0
                upperBound = 100
              }
            }
          }
        },
        {
          xPos   = 9
          yPos   = 18
          width  = 3
          height = 3
          widget = {
            title = "WhatsApp Errors (1h)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.whatsapp_webhook_errors.name}\" resource.type=\"cloud_run_revision\""
                  aggregation = {
                    alignmentPeriod    = "3600s"
                    perSeriesAligner   = "ALIGN_SUM"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              thresholds = [{
                value     = 1
                color     = "YELLOW"
                direction = "ABOVE"
                }, {
                value     = 10
                color     = "RED"
                direction = "ABOVE"
              }]
            }
          }
        },

        # Row 6: Cloud Build Network Telemetry
        {
          xPos   = 0
          yPos   = 21
          width  = 12
          height = 4
          widget = {
            title = "Cloud Build - Network Telemetry Events by Service"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.cloudbuild_network_telemetry.name}\" resource.type=\"cloudbuild.googleapis.com/Build\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.service"]
                    }
                  }
                }
                plotType = "STACKED_BAR"
              }]
              yAxis = {
                scale = "LINEAR"
                label = "events/sec"
              }
            }
          }
        }
      ]
    }
  })

  lifecycle {
    # GCP API re-serializes JSON with different formatting, causing perpetual drift
    ignore_changes = [dashboard_json]
  }
}

# =============================================================================
# ALERT POLICIES (Optional - uncomment to enable)
# =============================================================================

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "IntexuraOS Alert Email"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_alert_policy" "llm_errors" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "LLM Provider Error Rate High"

  combiner = "OR"
  conditions {
    display_name = "LLM errors > 5/min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.llm_errors.name}\" resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "60s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].name]

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = "LLM provider errors are elevated. Check research-agent logs for details."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "Cloud Run 5xx Error Rate High"

  combiner = "OR"
  conditions {
    display_name = "5xx errors > 1%"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_count\" metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].name]

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = "Cloud Run services are returning elevated 5xx errors. Check service logs."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "whatsapp_errors" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "WhatsApp Webhook Errors"

  combiner = "OR"
  conditions {
    display_name = "WhatsApp errors > 0"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.whatsapp_webhook_errors.name}\" resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].name]

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = "WhatsApp webhook is failing. User messages may be lost. Check whatsapp-service logs immediately."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "pubsub_backlog" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "Pub/Sub Message Backlog High"

  combiner = "OR"
  conditions {
    display_name = "Unacked messages > 1000"
    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1000
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].name]

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = "Pub/Sub message backlog is growing. Subscribers may be failing or slow."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "dlq_messages" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "Dead Letter Queue Has Messages"

  combiner = "OR"
  conditions {
    display_name = "DLQ contains failed messages"
    condition_threshold {
      filter          = <<-EOT
        resource.type="pubsub_subscription"
        metric.type="pubsub.googleapis.com/subscription/num_undelivered_messages"
        resource.label.subscription_id=has_substring("-dlq-sub")
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].name]

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    content   = "Messages have failed processing and moved to DLQ. Investigate immediately - messages will expire after 7 days."
    mime_type = "text/markdown"
  }
}
