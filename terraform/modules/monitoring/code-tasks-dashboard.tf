# Code Tasks Dashboard
# Custom dashboard for code task system monitoring

resource "google_monitoring_dashboard" "code_tasks" {
  dashboard_json = jsonencode({
    displayName = "Code Tasks Dashboard"
    labels = {
      environment = var.environment
    }
    mosaicLayout = {
      columns = 12
      tiles = [
        # Row 1: Tasks by Status (wide)
        {
          xPos   = 0
          yPos   = 0
          width  = 6
          height = 4
          widget = {
            title = "Tasks by Status"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_completed\""
                      aggregation = {
                        alignmentPeriod    = "300s"
                        perSeriesAligner   = "ALIGN_RATE"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["metric.labels.status"]
                      }
                    }
                  }
                  plotType = "STACKED_BAR"
                }
              ]
              yAxis = {
                scale = "LINEAR"
              }
            }
          }
        },
        # Row 1: Active Tasks by Location
        {
          xPos   = 6
          yPos   = 0
          width  = 6
          height = 4
          widget = {
            title = "Active Tasks by Location"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_active\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_MEAN"
                        crossSeriesReducer = "REDUCE_NONE"
                        groupByFields      = ["metric.labels.worker_location"]
                      }
                    }
                  }
                  plotType = "STACKED_AREA"
                }
              ]
              yAxis = {
                scale = "LINEAR"
              }
            }
          }
        },
        # Row 2: Task Duration (P95)
        {
          xPos   = 0
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Task Duration (P95)"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_duration_seconds\""
                      aggregation = {
                        alignmentPeriod    = "3600s"
                        perSeriesAligner   = "ALIGN_PERCENTILE_95"
                        crossSeriesReducer = "REDUCE_MEAN"
                        groupByFields      = ["metric.labels.worker_type"]
                      }
                    }
                  }
                  plotType = "LINE"
                }
              ]
              yAxis = {
                scale = "LINEAR"
                label = "seconds"
              }
            }
          }
        },
        # Row 2: Daily Cost
        {
          xPos   = 6
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Daily Cost"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_cost_dollars\""
                      aggregation = {
                        alignmentPeriod    = "86400s"
                        perSeriesAligner   = "ALIGN_SUM"
                        crossSeriesReducer = "REDUCE_SUM"
                      }
                    }
                  }
                  plotType = "LINE"
                }
              ]
              yAxis = {
                scale = "LINEAR"
                label = "dollars"
              }
            }
          }
        },
        # Row 3: Tasks Submitted by Worker Type
        {
          xPos   = 0
          yPos   = 8
          width  = 6
          height = 4
          widget = {
            title = "Tasks Submitted by Worker Type"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_submitted\""
                      aggregation = {
                        alignmentPeriod    = "3600s"
                        perSeriesAligner   = "ALIGN_RATE"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["metric.labels.worker_type"]
                      }
                    }
                  }
                  plotType = "STACKED_BAR"
                }
              ]
              yAxis = {
                scale = "LINEAR"
              }
            }
          }
        },
        # Row 3: Tasks by Source
        {
          xPos   = 6
          yPos   = 8
          width  = 6
          height = 4
          widget = {
            title = "Tasks by Source"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_submitted\""
                      aggregation = {
                        alignmentPeriod    = "3600s"
                        perSeriesAligner   = "ALIGN_RATE"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["metric.labels.source"]
                      }
                    }
                  }
                  plotType = "STACKED_BAR"
                }
              ]
              yAxis = {
                scale = "LINEAR"
              }
            }
          }
        },
        # Row 4: Scorecards
        {
          xPos   = 0
          yPos   = 12
          width  = 3
          height = 3
          widget = {
            title = "Failed Tasks (1h)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_completed\" AND metric.labels.status=\"failed\""
                  aggregation = {
                    alignmentPeriod    = "3600s"
                    perSeriesAligner   = "ALIGN_SUM"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              thresholds = [{
                value     = 5
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
        {
          xPos   = 3
          yPos   = 12
          width  = 3
          height = 3
          widget = {
            title = "Active Tasks"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_active\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_SUM"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              thresholds = [{
                value     = 7
                color     = "YELLOW"
                direction = "ABOVE"
                }, {
                value     = 9
                color     = "RED"
                direction = "ABOVE"
              }]
              gaugeView = {
                lowerBound = 0
                upperBound = 10
              }
            }
          }
        },
        {
          xPos   = 6
          yPos   = 12
          width  = 3
          height = 3
          widget = {
            title = "Cost Today ($)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_cost_dollars\""
                  aggregation = {
                    alignmentPeriod    = "86400s"
                    perSeriesAligner   = "ALIGN_SUM"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              thresholds = [{
                value     = 25
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
          xPos   = 9
          yPos   = 12
          width  = 3
          height = 3
          widget = {
            title = "Avg Duration (min)"
            scorecard = {
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "metric.type=\"custom.googleapis.com/intexuraos/code_tasks_duration_seconds\""
                  aggregation = {
                    alignmentPeriod    = "3600s"
                    perSeriesAligner   = "ALIGN_MEAN"
                    crossSeriesReducer = "REDUCE_MEAN"
                  }
                }
              }
              thresholds = [{
                value     = 180
                color     = "YELLOW"
                direction = "ABOVE"
                }, {
                value     = 300
                color     = "RED"
                direction = "ABOVE"
              }]
            }
          }
        },
      ]
    }
  })

  lifecycle {
    # GCP API re-serializes JSON with different formatting, causing perpetual drift
    ignore_changes = [dashboard_json]
  }
}
