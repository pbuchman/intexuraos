# Code Task Alert Policies
# Alert policies for code task system monitoring

# =============================================================================
# ALERT: High Failure Rate
# Triggers when code task failure rate exceeds 20% for 5 minutes
# =============================================================================
resource "google_monitoring_alert_policy" "code_task_high_failure_rate" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "Code Tasks High Failure Rate"

  combiner = "OR"
  conditions {
    display_name = "Failure rate > 20%"
    condition_threshold {
      filter          = "resource.type=\"global\" AND metric.type=\"custom.googleapis.com/intexuraos/code_tasks_completed\" AND metric.labels.status=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.2
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = var.alert_email != null ? [google_monitoring_notification_channel.email[0].name] : []

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = "Code task failure rate is elevated (>20%). Check code-agent logs for details."
    mime_type = "text/markdown"
  }
}

# =============================================================================
# ALERT: Worker Unhealthy
# Triggers when worker heartbeat is stale for more than 5 minutes
# This will be enabled when worker heartbeat metrics are implemented
# =============================================================================
# resource "google_monitoring_alert_policy" "code_worker_unhealthy" {
#   count        = var.alert_email != null ? 1 : 0
#   display_name = "Code Worker Unhealthy"
#
#   combiner = "OR"
#   conditions {
#     display_name = "Worker heartbeat stale > 5 min"
#     condition_threshold {
#       filter          = "metric.type=\"custom.googleapis.com/intexuraos/worker_heartbeat_age_seconds\""
#       comparison      = "COMPARISON_GT"
#       threshold_value = 300
#       duration        = "60s"
#
#       aggregations {
#         alignment_period     = "60s"
#         per_series_aligner   = "ALIGN_MAX"
#         cross_series_reducer = "REDUCE_MAX"
#       }
#
#       trigger {
#         count = 1
#       }
#     }
#   }
#
#   notification_channels = var.alert_email != null ? [google_monitoring_notification_channel.email[0].name] : []
#
#   alert_strategy {
#     auto_close = "1800s"
#   }
#
#   documentation {
#     content   = "Code worker heartbeat is stale (>5 min). Worker may be down or unresponsive."
#     mime_type = "text/markdown"
#   }
# }

# =============================================================================
# ALERT: code_tasks_failed_rate (INT-1538-S8)
# Fires when the rolling rate of `code_tasks_failed` events exceeds the
# tuned threshold (~5 failures per 15-minute window). Complements the
# `code_task_high_failure_rate` alert above which fires on the legacy
# `code_tasks_completed{status="failed"}` filter — this alert binds to
# the dedicated `code_tasks_failed` counter written by code-agent via
# `@intexuraos/common-metrics`.
#
# We aggregate the counter using ALIGN_RATE (events/sec) over a 5-minute
# alignment window and reduce across series with REDUCE_SUM. The threshold
# is expressed as events-per-second; 5 failures over 15 minutes ≈
# 5 / (15 * 60) ≈ 0.0056 — we choose 0.005 to keep the math obvious while
# preserving the same alert sensitivity.
# =============================================================================
resource "google_monitoring_alert_policy" "code_tasks_failed_rate" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "code_tasks_failed_rate"
  combiner     = "OR"

  documentation {
    content   = "Code task failure rate exceeded threshold (~5 failures / 15 min). Investigate orchestrator and code-agent logs."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "code_tasks_failed rate > 5 / 15min"
    condition_threshold {
      filter          = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_failed\" resource.type=\"global\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.005
      duration        = "900s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = concat(
    [google_monitoring_notification_channel.email[0].name],
    var.slack_auth_token != null ? [google_monitoring_notification_channel.slack[0].name] : [],
  )
}

# =============================================================================
# ALERT: High Daily Cost
# Triggers when daily code task cost exceeds $50
# =============================================================================
resource "google_monitoring_alert_policy" "code_task_high_daily_cost" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "Code Tasks High Daily Cost"

  combiner = "OR"
  conditions {
    display_name = "Daily cost > $50"
    condition_threshold {
      filter          = "resource.type=\"global\" AND metric.type=\"custom.googleapis.com/intexuraos/code_tasks_cost_dollars\""
      comparison      = "COMPARISON_GT"
      threshold_value = 50
      duration        = "0s"

      aggregations {
        alignment_period     = "86400s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = var.alert_email != null ? [google_monitoring_notification_channel.email[0].name] : []

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    content   = "Code task daily cost has exceeded $50. Review usage patterns."
    mime_type = "text/markdown"
  }
}

# =============================================================================
# ALERT: Capacity Exhausted
# Triggers when all workers are at capacity for 10+ minutes
# =============================================================================
resource "google_monitoring_alert_policy" "code_task_capacity_exhausted" {
  count        = var.alert_email != null ? 1 : 0
  display_name = "Code Workers at Capacity"

  combiner = "OR"
  conditions {
    display_name = "Active tasks near capacity for 10+ min"
    condition_threshold {
      filter          = "resource.type=\"global\" AND metric.type=\"custom.googleapis.com/intexuraos/code_tasks_active\""
      comparison      = "COMPARISON_GT"
      threshold_value = 9
      duration        = "600s"

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

  notification_channels = var.alert_email != null ? [google_monitoring_notification_channel.email[0].name] : []

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = "Code workers are at or near capacity (>9 active tasks) for 10+ minutes. Consider scaling workers."
    mime_type = "text/markdown"
  }
}
