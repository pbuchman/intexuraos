/**
 * Closed bootstrap boundary for the legacy physical-host identity label.
 *
 * The value is deliberately absent from `BootstrapEnvConfig`: routing and
 * service wiring must never receive it. This module reads it into a private
 * branded type and immediately forwards it to the reviewed `initWorker()`
 * observability sink.
 */

import { initWorker, type WorkerBootstrap } from '@intexuraos/infra-sentry';

import { getOptionalEnv, type EnvReader } from './env-config.js';

type ObservabilityEnvironment = string & {
  readonly __observabilityEnvironment: unique symbol;
};

export interface OrchestratorObservabilityConfig {
  sentryDsn?: string;
  release?: string;
}

function readObservabilityEnvironment(env: EnvReader): ObservabilityEnvironment {
  return getOptionalEnv(
    'INTEXURAOS_ENVIRONMENT',
    getOptionalEnv('NODE_ENV', 'development', env),
    env
  ) as ObservabilityEnvironment;
}

export function initOrchestratorObservability(
  config: OrchestratorObservabilityConfig,
  env: EnvReader = process.env
): WorkerBootstrap {
  const observabilityEnvironment = readObservabilityEnvironment(env);

  return initWorker({
    serviceName: 'orchestrator',
    environment: observabilityEnvironment,
    ...(config.sentryDsn !== undefined ? { sentryDsn: config.sentryDsn } : {}),
    ...(config.release !== undefined ? { release: config.release } : {}),
  });
}
