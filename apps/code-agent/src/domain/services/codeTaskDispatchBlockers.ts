import {
  CODE_TASK_WORKER_CAPABILITIES,
  isCodeTaskWorkerType,
  type CodeTaskAuthRequirement,
} from '@intexuraos/code-task-domain';
import type { WorkerConfig, WorkerHealthState } from '../models/workerSettings.js';
import type { WorkerHealthDiagnostic } from '../models/workerSettings.js';

export type CodeTaskDispatchBlockerReason =
  | 'no_enabled_workers'
  | 'workers_unreachable'
  | 'worker_health_contract_mismatch'
  | 'workers_at_capacity'
  | 'codex_auth_unavailable'
  | 'claude_auth_unavailable'
  | 'provider_auth_unavailable'
  | 'docker_unavailable'
  | 'disk_unavailable'
  | 'unknown_worker_type';

export type CodeTaskDispatchability =
  | { dispatchable: true; workerNames: string[] }
  | {
      dispatchable: false;
      reason: CodeTaskDispatchBlockerReason;
      severity: 'warning' | 'critical';
      message: string;
      remediation: string;
      workerNames: string[];
      workerHealthDetails?: WorkerHealthDiagnostic[];
    };

export interface ClassifyCodeTaskDispatchabilityInput {
  workerType: string;
  workers: readonly WorkerConfig[];
  healthByWorkerName: Record<string, WorkerHealthState>;
}

interface HealthyWorker {
  worker: WorkerConfig;
  health: Extract<WorkerHealthState, { _tag: 'healthy' }>;
}

function enabledWorkers(workers: readonly WorkerConfig[]): WorkerConfig[] {
  return workers.filter((worker) => worker.enabled);
}

function blocker(
  reason: CodeTaskDispatchBlockerReason,
  workerType: string,
  workerNames: string[],
  workerHealthDetails?: WorkerHealthDiagnostic[]
): CodeTaskDispatchability {
  const label = workerType;
  const severity = reason === 'workers_at_capacity' ? 'warning' : 'critical';
  const messages: Record<CodeTaskDispatchBlockerReason, { message: string; remediation: string }> = {
    no_enabled_workers: {
      message: `No enabled code-task workers are configured for ${label}.`,
      remediation: 'Enable or add a worker in worker settings, then retry dispatch.',
    },
    workers_unreachable: {
      message: `No configured workers are reachable for ${label}.`,
      remediation: 'Check worker host connectivity, tunnel routing, and orchestrator service health.',
    },
    worker_health_contract_mismatch: {
      message: `Configured workers for ${label} responded with an incompatible health contract.`,
      remediation: 'Deploy or restart the worker orchestrator so /health includes the required capability fields, then retry this task.',
    },
    workers_at_capacity: {
      message: `All capable workers for ${label} are currently at capacity.`,
      remediation: 'Wait for a running task to finish or add worker capacity.',
    },
    codex_auth_unavailable: {
      message: `No reachable worker has active Codex auth for ${label}.`,
      remediation: 'Refresh Codex/ChatGPT authentication on a worker that can run this task.',
    },
    claude_auth_unavailable: {
      message: `No reachable worker has active Claude auth for ${label}.`,
      remediation: 'Refresh Claude authentication on a worker that can run this task.',
    },
    provider_auth_unavailable: {
      message: `No reachable worker has the provider API key required for ${label}.`,
      remediation: 'Configure the required provider API key on a worker and restart/reload it.',
    },
    docker_unavailable: {
      message: `No reachable worker has healthy Docker for ${label}.`,
      remediation: 'Inspect Docker health on the worker and restore container execution.',
    },
    disk_unavailable: {
      message: `No reachable worker has healthy disk capacity for ${label}.`,
      remediation: 'Free disk space or repair disk health on the worker.',
    },
    unknown_worker_type: {
      message: `The requested worker type ${label} is not recognized.`,
      remediation: 'Select a supported worker type or update worker capability metadata.',
    },
  };
  const text = messages[reason];
  return {
    dispatchable: false,
    reason,
    severity,
    message: text.message,
    remediation: text.remediation,
    workerNames,
    ...(workerHealthDetails !== undefined && workerHealthDetails.length > 0 && { workerHealthDetails }),
  };
}

export function healthDiagnostic(
  worker: WorkerConfig,
  health: WorkerHealthState | undefined
): WorkerHealthDiagnostic | undefined {
  if (health === undefined) {
    return undefined;
  }

  const diagnostic: WorkerHealthDiagnostic = {
    workerName: worker.name,
    tag: health._tag,
    healthy: health.healthy,
  };

  if (health._tag === 'orchestrator-unreachable' || health._tag === 'tunnel-down') {
    diagnostic.reason = health.reason;
    if (health.code !== undefined) {
      diagnostic.code = health.code;
    }
  }

  if (health._tag === 'unknown') {
    diagnostic.error = health.error;
    if (health.missingFields !== undefined) {
      diagnostic.missingFields = health.missingFields;
    }
    if (health.contractMismatch !== undefined) {
      diagnostic.contractMismatch = health.contractMismatch;
    }
  }

  return diagnostic;
}

export function healthDiagnostics(
  workers: readonly WorkerConfig[],
  healthByWorkerName: Record<string, WorkerHealthState>
): WorkerHealthDiagnostic[] {
  return workers.flatMap((worker) => {
    const diagnostic = healthDiagnostic(worker, healthByWorkerName[worker.name]);
    if (diagnostic === undefined) {
      return [];
    }
    return [diagnostic];
  });
}

function hasRequiredAuth(auth: CodeTaskAuthRequirement, health: HealthyWorker['health']): boolean {
  if (auth.kind === 'codex') {
    const codexAuth = health.workerAuths.codex;
    return codexAuth.status === 'active'
      || (codexAuth.status === 'expired' && codexAuth.refreshSupported === true);
  }
  if (auth.kind === 'claude') return health.workerAuths.claude.status === 'active';
  return health.providerApiKeys[auth.envVar]?.configured === true;
}

function authBlockerReason(auth: CodeTaskAuthRequirement): CodeTaskDispatchBlockerReason {
  if (auth.kind === 'codex') return 'codex_auth_unavailable';
  if (auth.kind === 'claude') return 'claude_auth_unavailable';
  return 'provider_auth_unavailable';
}

export function classifyCodeTaskDispatchability(
  input: ClassifyCodeTaskDispatchabilityInput
): CodeTaskDispatchability {
  const { workerType, healthByWorkerName } = input;
  if (!isCodeTaskWorkerType(workerType)) {
    return blocker('unknown_worker_type', workerType, []);
  }

  const capability = CODE_TASK_WORKER_CAPABILITIES[workerType];
  const enabled = enabledWorkers(input.workers);
  if (enabled.length === 0) {
    return blocker('no_enabled_workers', workerType, []);
  }

  const healthyWorkers = enabled.flatMap((worker): HealthyWorker[] => {
    const health = healthByWorkerName[worker.name];
    if (health?._tag !== 'healthy') return [];
    return [{ worker, health }];
  });

  if (healthyWorkers.length === 0) {
    const enabledHealthStates = enabled.map((worker) => healthByWorkerName[worker.name]);
    const hasHealthContractMismatch = enabledHealthStates.length > 0
      && enabledHealthStates.every((health) => health?._tag === 'unknown' && health.contractMismatch === true);
    if (hasHealthContractMismatch) {
      return blocker(
        'worker_health_contract_mismatch',
        workerType,
        enabled.map((worker) => worker.name),
        healthDiagnostics(enabled, healthByWorkerName)
      );
    }
    return blocker(
      'workers_unreachable',
      workerType,
      enabled.map((worker) => worker.name),
      healthDiagnostics(enabled, healthByWorkerName)
    );
  }

  /* v8 ignore start -- ts-type: every current code-task worker capability requires Docker, so the ternary false branch cannot execute until future non-Docker workers exist @preserve */
  const dockerReady = capability.requiresDocker
    ? healthyWorkers.filter(({ health }) => health.dockerHealthy)
    : healthyWorkers;
  /* v8 ignore stop @preserve */
  if (dockerReady.length === 0) {
    return blocker(
      'docker_unavailable',
      workerType,
      healthyWorkers.map(({ worker }) => worker.name)
    );
  }

  /* v8 ignore start -- ts-type: every current code-task worker capability requires Docker, so the ternary false branch cannot execute until future non-Docker workers exist @preserve */
  const diskReady = capability.requiresDocker
    ? dockerReady.filter(({ health }) => health.diskHealthy)
    : dockerReady;
  /* v8 ignore stop @preserve */
  if (diskReady.length === 0) {
    return blocker(
      'disk_unavailable',
      workerType,
      dockerReady.map(({ worker }) => worker.name)
    );
  }

  const authReady = diskReady.filter(({ health }) => hasRequiredAuth(capability.auth, health));
  if (authReady.length === 0) {
    return blocker(
      authBlockerReason(capability.auth),
      workerType,
      diskReady.map(({ worker }) => worker.name)
    );
  }

  const capacityReady = authReady.filter(({ health }) => health.available > 0);
  if (capacityReady.length === 0) {
    return blocker(
      'workers_at_capacity',
      workerType,
      authReady.map(({ worker }) => worker.name)
    );
  }

  return {
    dispatchable: true,
    workerNames: capacityReady.map(({ worker }) => worker.name),
  };
}
