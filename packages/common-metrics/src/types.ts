/**
 * Public types for `@intexuraos/common-metrics`.
 */

import type { Logger } from 'pino';

export type MetricLabel = Record<string, string>;

export type MetricKind = 'counter' | 'gauge' | 'distribution';

export interface CustomMetric<L extends MetricLabel = MetricLabel> {
  readonly name: string; // e.g. 'code_tasks_completed'
  readonly type: MetricKind;
  readonly unit: string; // '1', 'ms', 'By'
  readonly description: string;
  /**
   * Phantom marker so TypeScript can correlate label types with descriptors.
   * Never read at runtime.
   */
  readonly __labels?: L;
}

export interface MetricsClient {
  increment<L extends MetricLabel>(metric: CustomMetric<L>, labels: L, by?: number): void;
  record<L extends MetricLabel>(metric: CustomMetric<L>, labels: L, value: number): void;
  flush(): Promise<void>;
}

export interface MetricServiceClientLike {
  createTimeSeries(request: { name: string; timeSeries: unknown[] }): Promise<unknown>;
}

export interface MetricsClientConfig {
  projectId: string;
  serviceName: string;
  logger: Logger;
  /** Inject a fake for tests; defaults to a real MetricServiceClient. */
  metricServiceClient?: MetricServiceClientLike;
}

export const CODE_TASK_METRICS = {
  COMPLETED: {
    name: 'code_tasks_completed',
    type: 'counter',
    unit: '1',
    description: 'Number of code tasks that completed successfully',
  },
  FAILED: {
    name: 'code_tasks_failed',
    type: 'counter',
    unit: '1',
    description: 'Number of code tasks that ended in failure',
  },
  DURATION: {
    name: 'code_task_duration',
    type: 'distribution',
    unit: 'ms',
    description: 'Duration of code task lifecycle in milliseconds',
  },
} as const satisfies Record<string, CustomMetric>;
