/**
 * @intexuraos/common-worker
 *
 * Frozen API contract for IntexuraOS Cloud Functions / Pub/Sub workers.
 * See `docs/plans/2026-04-24-workers-layer-refactor.md` §3 — every other
 * subtask in INT-1530 codes against the symbols re-exported here.
 */

export { createWorkerLogger, type WorkerLogger, type CreateWorkerLoggerOptions } from './logger.js';

export { loadRequiredEnv, type EnvVarSpec, type EnvSpec, type LoadedEnv } from './env.js';

export { verifyInternalAuth } from './auth.js';

export {
  AckDecision,
  withObservability,
  type AckResult,
  type CloudEventHandler,
  type ObservabilityOptions,
} from './observability.js';
