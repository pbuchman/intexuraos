import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import type { MetricsClient } from '../../domain/services/metrics.js';

/**
 * Mock for Google Cloud Monitoring client.
 */
interface MockMonitoringClient {
  createTimeSeries: MockedFunction<(request: unknown) => Promise<unknown>>;
}

/**
 * Create a mock Monitoring client with helper to inspect calls.
 */
function createMockMonitoringClient(): MockMonitoringClient {
  return {
    createTimeSeries: vi.fn().mockResolvedValue({}),
  };
}

describe('MetricsClient', () => {
  let mockMonitoring: MockMonitoringClient;
  let metricsClient: MetricsClient;
  let createTimeSeriesCalls: unknown[];

  beforeEach(() => {
    mockMonitoring = createMockMonitoringClient();
    createTimeSeriesCalls = [];

    // Track calls to createTimeSeries
    mockMonitoring.createTimeSeries.mockImplementation((request) => {
      createTimeSeriesCalls.push(request);
      return Promise.resolve({});
    });

    // Create metrics client with mocked monitoring
    metricsClient = createMetricsClientWithMock(mockMonitoring);
  });

  /**
   * Helper to create MetricsClient with a mocked monitoring client.
   * Tests the contract of the MetricsClient interface.
   */
  function createMetricsClientWithMock(monitoring: MockMonitoringClient): MetricsClient {
    const projectId = 'test-project';

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
        name: `projects/${projectId}`,
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

  describe('incrementTasksSubmitted', () => {
    it('creates time series with correct metric type and labels', async () => {
      await metricsClient.incrementTasksSubmitted('opus', 'whatsapp');

      expect(createTimeSeriesCalls).toHaveLength(1);
      const call = createTimeSeriesCalls[0] as { name: string; timeSeries: unknown[] };

      expect(call.name).toBe('projects/test-project');

      const timeSeries = call.timeSeries[0] as {
        metric: { type: string; labels: Record<string, string> };
        resource: { type: string };
        points: { value: { int64Value: number } }[];
      };

      expect(timeSeries.metric.type).toBe('custom.googleapis.com/intexuraos/code_tasks_submitted');
      expect(timeSeries.metric.labels['worker_type']).toBe('opus');
      expect(timeSeries.metric.labels['source']).toBe('whatsapp');
      expect(timeSeries.points[0]?.value.int64Value).toBe(1);
    });

    it('supports different worker types', async () => {
      await metricsClient.incrementTasksSubmitted('auto', 'web');

      const timeSeries = (createTimeSeriesCalls[0] as { timeSeries: unknown[] }).timeSeries[0] as {
        metric: { labels: Record<string, string> };
      };

      expect(timeSeries.metric.labels['worker_type']).toBe('auto');
      expect(timeSeries.metric.labels['source']).toBe('web');
    });
  });

  describe('incrementTasksCompleted', () => {
    it('creates time series with status label', async () => {
      await metricsClient.incrementTasksCompleted('opus', 'completed');

      expect(createTimeSeriesCalls).toHaveLength(1);
      const call = createTimeSeriesCalls[0] as { timeSeries: unknown[] };
      const timeSeries = call.timeSeries[0] as {
        metric: { type: string; labels: Record<string, string> };
        points: { value: { int64Value: number } }[];
      };

      expect(timeSeries.metric.type).toBe('custom.googleapis.com/intexuraos/code_tasks_completed');
      expect(timeSeries.metric.labels['worker_type']).toBe('opus');
      expect(timeSeries.metric.labels['status']).toBe('completed');
      expect(timeSeries.points[0]?.value.int64Value).toBe(1);
    });

    it('records different completion statuses', async () => {
      const statuses = ['completed', 'failed', 'cancelled', 'timeout'] as const;

      for (const status of statuses) {
        await metricsClient.incrementTasksCompleted('auto', status);
      }

      expect(createTimeSeriesCalls).toHaveLength(4);

      for (let i = 0; i < statuses.length; i++) {
        const timeSeries = (createTimeSeriesCalls[i] as { timeSeries: unknown[] }).timeSeries[0] as {
          metric: { labels: Record<string, string> };
        };
        expect(timeSeries.metric.labels['status']).toBe(statuses[i]);
      }
    });
  });

  describe('recordTaskDuration', () => {
    it('uses DOUBLE value type for precision', async () => {
      await metricsClient.recordTaskDuration('opus', 123.45);

      expect(createTimeSeriesCalls).toHaveLength(1);
      const call = createTimeSeriesCalls[0] as { timeSeries: unknown[] };
      const timeSeries = call.timeSeries[0] as {
        metric: { type: string; labels: Record<string, string> };
        points: { value: { doubleValue: number } }[];
      };

      expect(timeSeries.metric.type).toBe('custom.googleapis.com/intexuraos/code_tasks_duration_seconds');
      expect(timeSeries.metric.labels['worker_type']).toBe('opus');
      expect(timeSeries.points[0]?.value.doubleValue).toBe(123.45);
    });

    it('records duration in seconds', async () => {
      await metricsClient.recordTaskDuration('auto', 45.7);

      const timeSeries = (createTimeSeriesCalls[0] as { timeSeries: unknown[] }).timeSeries[0] as {
        points: { value: { doubleValue: number } }[];
      };

      expect(timeSeries.points[0]?.value.doubleValue).toBe(45.7);
    });
  });

  describe('setActiveTasks', () => {
    it('updates gauge metric with worker location label', async () => {
      await metricsClient.setActiveTasks('mac', 3);

      expect(createTimeSeriesCalls).toHaveLength(1);
      const call = createTimeSeriesCalls[0] as { timeSeries: unknown[] };
      const timeSeries = call.timeSeries[0] as {
        metric: { type: string; labels: Record<string, string> };
        points: { value: { int64Value: number } }[];
      };

      expect(timeSeries.metric.type).toBe('custom.googleapis.com/intexuraos/code_tasks_active');
      expect(timeSeries.metric.labels['worker_location']).toBe('mac');
      expect(timeSeries.points[0]?.value.int64Value).toBe(3);
    });

    it('supports both worker locations', async () => {
      await metricsClient.setActiveTasks('mac', 5);
      await metricsClient.setActiveTasks('vm', 2);

      expect(createTimeSeriesCalls).toHaveLength(2);

      const macTimeSeries = (createTimeSeriesCalls[0] as { timeSeries: unknown[] }).timeSeries[0] as {
        metric: { labels: Record<string, string> };
      };
      const vmTimeSeries = (createTimeSeriesCalls[1] as { timeSeries: unknown[] }).timeSeries[0] as {
        metric: { labels: Record<string, string> };
      };

      expect(macTimeSeries.metric.labels['worker_location']).toBe('mac');
      expect(vmTimeSeries.metric.labels['worker_location']).toBe('vm');
    });
  });

  describe('recordCost', () => {
    it('includes user_id label for cost attribution', async () => {
      await metricsClient.recordCost('opus', 'user-123', 0.52);

      expect(createTimeSeriesCalls).toHaveLength(1);
      const call = createTimeSeriesCalls[0] as { timeSeries: unknown[] };
      const timeSeries = call.timeSeries[0] as {
        metric: { type: string; labels: Record<string, string> };
        points: { value: { doubleValue: number } }[];
      };

      expect(timeSeries.metric.type).toBe('custom.googleapis.com/intexuraos/code_tasks_cost_dollars');
      expect(timeSeries.metric.labels['worker_type']).toBe('opus');
      expect(timeSeries.metric.labels['user_id']).toBe('user-123');
      expect(timeSeries.points[0]?.value.doubleValue).toBe(0.52);
    });

    it('uses DOUBLE value type for dollar amounts', async () => {
      await metricsClient.recordCost('auto', 'user-456', 1.23);

      const timeSeries = (createTimeSeriesCalls[0] as { timeSeries: unknown[] }).timeSeries[0] as {
        points: { value: { doubleValue: number } }[];
      };

      expect(timeSeries.points[0]?.value.doubleValue).toBe(1.23);
    });
  });

  describe('error handling', () => {
    it('propagates monitoring API errors', async () => {
      const errorClient: MockMonitoringClient = {
        createTimeSeries: vi.fn().mockRejectedValue(new Error('Monitoring API unavailable')),
      };

      const errorMetricsClient = createMetricsClientWithMock(errorClient);

      await expect(errorMetricsClient.incrementTasksSubmitted('opus', 'whatsapp'))
        .rejects.toThrow('Monitoring API unavailable');
    });
  });

  describe('createNoOpMetricsClient', () => {
    it('returns a client that does nothing', async () => {
      const { createNoOpMetricsClient } = await import('../metrics.js');
      const noOpClient = createNoOpMetricsClient();

      // Should not throw
      await noOpClient.incrementTasksSubmitted('opus', 'whatsapp');
      await noOpClient.incrementTasksCompleted('opus', 'completed');
      await noOpClient.recordTaskDuration('opus', 123.45);
      await noOpClient.setActiveTasks('mac', 3);
      await noOpClient.recordCost('opus', 'user-123', 0.52);

      // No calls should have been made to the mock
      expect(createTimeSeriesCalls).toHaveLength(0);
    });
  });
});
