# Alert policy: fires when the rate of `code_tasks_failed` over a
# 15-minute window exceeds the failure threshold.
#
# We aggregate the custom counter using ALIGN_RATE (events/sec) over a
# 5-minute window and reduce across series with REDUCE_SUM. The threshold
# is expressed as events-per-second; 5 failures over 15 minutes ≈
# 5 / (15 * 60) ≈ 0.0056 — we choose a round threshold of 0.005 to keep
# the math obvious while preserving the same alert sensitivity.

resource "google_monitoring_alert_policy" "code_tasks_failed_rate" {
  display_name = "code_tasks_failed_rate"
  combiner     = "OR"

  documentation {
    content   = "Code task failure rate exceeded threshold. Investigate orchestrator and code-agent logs."
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

  notification_channels = [
    google_monitoring_notification_channel.email.name,
    google_monitoring_notification_channel.slack.name,
  ]
}
