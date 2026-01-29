/**
 * Cloud Monitoring Metrics Client for Code Tasks
 *
 * Writes custom metrics to Google Cloud Monitoring for operational visibility.
 * Metrics include: tasks submitted/completed, duration, active tasks, and cost.
 */

import { MetricServiceClient } from '@google-cloud/monitoring';
import type { MetricsClient } from '../domain/services/metrics.js';

// Re-export the interface for convenience
export type { MetricsClient } from '../domain/services/metrics.js';

// Lazy initialization to avoid creating client during module import in E2E mode
let monitoringClient: MetricServiceClient | null = null;

function getMonitoringClient(): MetricServiceClient {
  monitoringClient ??= new MetricServiceClient();
  return monitoringClient;
}

const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? 'intexuraos';

/**
 * Create a metrics client that writes to Google Cloud Monitoring.
 */
export function createMetricsClient(): MetricsClient {
  const monitoring = getMonitoringClient();
  const projectPath = monitoring.projectPath(projectId);

  async function writeTimeSeries(
    metricType: string,
    value: number,
    labels: Record<string, string>,
    valueType: 'INT64' | 'DOUBLE' = 'INT64'
  ): Promise<void> {
    const dataPoint = {
      interval: {
        endTime: { seconds: Math.floor(Date.now() / 1000) },
      },
      value: valueType === 'INT64'
        ? { int64Value: value }
        : { doubleValue: value },
    };

    const timeSeries = {
      metric: {
        type: `custom.googleapis.com/intexuraos/${metricType}`,
        labels,
      },
      resource: {
        type: 'global',
        labels: { project_id: projectId },
      },
      points: [dataPoint],
    };

    await monitoring.createTimeSeries({
      name: projectPath,
      timeSeries: [timeSeries],
    });
  }

  return {
    async incrementTasksSubmitted(workerType: string, source: string): Promise<void> {
      await writeTimeSeries('code_tasks_submitted', 1, { worker_type: workerType, source });
    },

    async incrementTasksCompleted(workerType: string, status: string): Promise<void> {
      await writeTimeSeries('code_tasks_completed', 1, { worker_type: workerType, status });
    },

    async recordTaskDuration(workerType: string, durationSeconds: number): Promise<void> {
      await writeTimeSeries('code_tasks_duration_seconds', durationSeconds,
        { worker_type: workerType }, 'DOUBLE');
    },

    async setActiveTasks(workerLocation: string, count: number): Promise<void> {
      await writeTimeSeries('code_tasks_active', count, { worker_location: workerLocation });
    },

    async recordCost(workerType: string, userId: string, dollars: number): Promise<void> {
      await writeTimeSeries('code_tasks_cost_dollars', dollars,
        { worker_type: workerType, user_id: userId }, 'DOUBLE');
    },
  };
}

/**
 * Create a no-op metrics client for testing or when monitoring is disabled.
 */
export function createNoOpMetricsClient(): MetricsClient {
  return {
    async incrementTasksSubmitted(): Promise<void> {
      // No-op
    },
    async incrementTasksCompleted(): Promise<void> {
      // No-op
    },
    async recordTaskDuration(): Promise<void> {
      // No-op
    },
    async setActiveTasks(): Promise<void> {
      // No-op
    },
    async recordCost(): Promise<void> {
      // No-op
    },
  };
}
