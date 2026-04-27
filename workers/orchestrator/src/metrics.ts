/**
 * Orchestrator metrics emission (INT-1565 / S5).
 *
 * Emits the `code_tasks_*` custom-metric family on every task transition.
 * Until `@intexuraos/common-metrics` (S8) lands, this module declares a local
 * shim matching plan §1 + §7 contract signatures so the orchestrator can wire
 * metrics emission today. The shim publishes via `logger.info({ metric: ... })`
 * — the parent plan's reconciliation commit replaces it with the real
 * MetricsClient by swapping `createMetricsClient` for the package import.
 *
 * The contract surface (`CustomMetric`, `MetricsClient`, `MetricLabel`) is
 * frozen by the parent plan; do not change shapes here without updating the
 * plan doc.
 */

import type { Logger } from '@intexuraos/common-core';

/** Label set for a custom metric. Mirrors `@intexuraos/common-metrics`. */
export type MetricLabel = Record<string, string>;

/**
 * Descriptor for a custom metric. Mirrors `@intexuraos/common-metrics`.
 *
 * IMPORTANT: every field on this type — including `__label` — is part of
 * the parent plan §7 frozen contract. The S8 reconciliation commit replaces
 * this shim with a `from '@intexuraos/common-metrics'` import; structural
 * compatibility is required for that swap to be a no-op.
 */
export interface CustomMetric<L extends MetricLabel = MetricLabel> {
  readonly name: string;
  readonly type: 'counter' | 'gauge' | 'distribution';
  readonly unit: string;
  readonly description: string;
  /**
   * Phantom property: keeps the label type bound to the descriptor so that
   * `client.increment(METRIC, labels)` type-checks the labels argument.
   * Never read at runtime — the field exists only to anchor `L` in the
   * structural type. Do not strip; required for symmetry with the future
   * `@intexuraos/common-metrics` package.
   */
  readonly __label?: L;
}

/** Minimal client surface used by the orchestrator. Mirrors `@intexuraos/common-metrics`. */
export interface MetricsClient {
  increment<L extends MetricLabel>(metric: CustomMetric<L>, labels: L, by?: number): void;
  record<L extends MetricLabel>(metric: CustomMetric<L>, labels: L, value: number): void;
  flush(): Promise<void>;
}

/**
 * Status label values for `CODE_TASK_METRICS.COMPLETED`.
 *
 * Per INT-1565 acceptance: emit `code_tasks_completed{status="success"|"failed"}`
 * on every task transition. Other terminal statuses (`interrupted`, `cancelled`)
 * map to one of the two allowed values via `mapTerminalStatusToMetricStatus`.
 */
export type CodeTaskMetricStatus = 'success' | 'failed';

/** Label shape for `CODE_TASK_METRICS.COMPLETED`. */
export interface CodeTaskCompletedLabels extends MetricLabel {
  status: CodeTaskMetricStatus;
}

/**
 * Label shape for `CODE_TASK_METRICS.FAILED`.
 *
 * `reason` is intentionally typed as a free-form `string` to mirror the
 * underlying `MetricLabel` contract, but the dispatcher only ever sets it
 * to one of the closed enum values `'failed' | 'interrupted' | 'cancelled'`
 * (mapped from the four-arm `TaskStatus` discriminated union by
 * {@link mapTerminalStatusToMetricStatus}'s caller). DO NOT widen this to
 * carry free-form strings (e.g. `error.code`) — Cloud Monitoring custom
 * metrics enforce a low cardinality budget on label values, and
 * `code_tasks_failed` would explode if every distinct error code became a
 * separate time series.
 */
export interface CodeTaskFailedLabels extends MetricLabel {
  reason: string;
}

/** Label shape for `CODE_TASK_METRICS.DURATION`. */
export interface CodeTaskDurationLabels extends MetricLabel {
  status: CodeTaskMetricStatus;
}

/**
 * Registry of code-task metric descriptors. Names MUST match
 * `cloud-monitoring-metrics.tf` (added in S8) so dashboards / alert policies
 * resolve correctly.
 */
export const CODE_TASK_METRICS = {
  COMPLETED: {
    name: 'code_tasks_completed',
    type: 'counter',
    unit: '1',
    description: 'Count of code tasks that reached a terminal state, labeled by status.',
  } satisfies CustomMetric<CodeTaskCompletedLabels>,
  FAILED: {
    name: 'code_tasks_failed',
    type: 'counter',
    unit: '1',
    description: 'Count of code tasks that finished in a non-success terminal state.',
  } satisfies CustomMetric<CodeTaskFailedLabels>,
  DURATION: {
    name: 'code_tasks_duration',
    type: 'distribution',
    unit: 'ms',
    description: 'Wall-clock duration of a code task from start to terminal state.',
  } satisfies CustomMetric<CodeTaskDurationLabels>,
} as const;

/**
 * Map an internal terminal task status onto the binary
 * `success | failed` label used by `code_tasks_completed`.
 *
 * The orchestrator carries four terminal statuses — `completed`, `failed`,
 * `interrupted`, `cancelled` — but the metric only tracks the binary
 * "did the task succeed" outcome so dashboards stay legible. `interrupted`
 * and `cancelled` are treated as `failed` for metric purposes (they did not
 * reach a successful PR).
 */
export function mapTerminalStatusToMetricStatus(
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled'
): CodeTaskMetricStatus {
  return status === 'completed' ? 'success' : 'failed';
}

/**
 * Configuration for {@link createMetricsClient}.
 */
export interface CreateMetricsClientConfig {
  /** GCP project ID — recorded on every emitted log line for downstream parsing. */
  projectId: string;
  /** Service name — typically `'orchestrator'`. */
  serviceName: string;
  /** Logger used to emit `metric=` lines. */
  logger: Logger;
}

/**
 * Build a `MetricsClient` that writes a structured log line per emit.
 *
 * The line shape (`metric=<name> labels=<json> value=<number>`) is the contract
 * understood by Cloud Monitoring's log-based metrics; the real
 * `@intexuraos/common-metrics` package (S8) will replace this with a
 * `@google-cloud/monitoring` direct-write implementation. Both implementations
 * MUST share the {@link MetricsClient} surface so this swap is a no-op for
 * callers.
 *
 * Errors are swallowed (logged at `debug`) so a metrics outage cannot crash
 * the orchestrator's task-finalize hot path.
 */
export function createMetricsClient(cfg: CreateMetricsClientConfig): MetricsClient {
  const { projectId, serviceName, logger } = cfg;

  const emit = (
    metric: CustomMetric,
    labels: MetricLabel,
    value: number,
    op: 'increment' | 'record'
  ): void => {
    try {
      logger.info(
        {
          metric: metric.name,
          metricType: metric.type,
          metricUnit: metric.unit,
          op,
          value,
          labels,
          projectId,
          service: serviceName,
        },
        `metric ${metric.name} ${op}=${String(value)}`
      );
    } catch (err) {
      // Metrics emission must NEVER crash the caller. Swallow + debug-log so
      // a logger outage doesn't take the orchestrator down on every finalize.
      try {
        logger.debug({ err, metric: metric.name }, 'metrics emit failed');
      } catch {
        // Last-resort: even debug failed; nothing safe to do.
      }
    }
  };

  return {
    increment(metric, labels, by = 1): void {
      emit(metric, labels, by, 'increment');
    },
    record(metric, labels, value): void {
      emit(metric, labels, value, 'record');
    },
    async flush(): Promise<void> {
      // No-op for the log-based shim; real common-metrics flushes a buffered
      // `MetricServiceClient` here.
      return;
    },
  };
}

/**
 * No-op {@link MetricsClient} — useful default for tests that don't care
 * about metrics. Callers can also pass `undefined` and the dispatcher will
 * fall back to this internally.
 *
 * Method bodies are intentionally empty: this is the contract for "metric
 * emission is silently dropped." The eslint rule that flags empty functions
 * does not apply to a documented sentinel implementation, so we annotate
 * each method with a brief why-comment to keep the intent inline.
 */
export function noopMetricsClient(): MetricsClient {
  return {
    increment(): void {
      // intentionally no-op: counter increments are silently dropped
    },
    record(): void {
      // intentionally no-op: distribution samples are silently dropped
    },
    async flush(): Promise<void> {
      // intentionally no-op: nothing buffered to drain
    },
  };
}
