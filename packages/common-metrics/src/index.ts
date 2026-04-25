/**
 * Public surface for `@intexuraos/common-metrics`.
 */

export type {
  CustomMetric,
  MetricKind,
  MetricLabel,
  MetricServiceClientLike,
  MetricsClient,
  MetricsClientConfig,
} from './types.js';

export { CODE_TASK_METRICS } from './types.js';
export { createMetricsClient } from './client.js';
