import { describe, expect, it } from 'vitest';
import type { WorkerConfig, WorkerHealthState } from '../../../domain/models/workerSettings.js';
import {
  classifyCodeTaskDispatchability,
  healthDiagnostic,
  healthDiagnostics,
  type CodeTaskDispatchBlockerReason,
} from '../../../domain/services/codeTaskDispatchBlockers.js';

function worker(name: string, overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    name,
    url: `https://${name}.example.test`,
    cfAccessClientId: 'cf-id',
    cfAccessClientSecret: 'cf-secret',
    dispatchSigningSecret: 'dispatch-secret',
    enabled: true,
    ...overrides,
  };
}

function healthy(overrides: Partial<Extract<WorkerHealthState, { _tag: 'healthy' }>> = {}): WorkerHealthState {
  return {
    _tag: 'healthy',
    healthy: true,
    capacity: 2,
    running: 0,
    available: 1,
    responseTimeMs: 10,
    dockerHealthy: true,
    diskHealthy: true,
    workerAuths: {
      claude: { status: 'active', authMode: 'oauth', refreshSupported: true },
      codex: { status: 'active', authMode: 'chatgpt', refreshSupported: true },
    },
    providerApiKeys: {
      MINIMAX_API_KEY: { configured: true },
      MIMO_API_KEY: { configured: true },
      DASHSCOPE_API_KEY: { configured: true },
      KIMI_API_KEY: { configured: true },
      OPENROUTER_API_KEY: { configured: true },
    },
    ...overrides,
  };
}

function orchestratorUnreachable(reason: 'timeout' | 'http-error' = 'timeout'): WorkerHealthState {
  return { _tag: 'orchestrator-unreachable', healthy: false, reason };
}

function contractMismatch(missingFields: string[] = ['providerApiKeys']): WorkerHealthState {
  return {
    _tag: 'unknown',
    healthy: false,
    error: 'Health response missing worker capability details',
    contractMismatch: true,
    missingFields,
  };
}

interface BlockedDispatchCase {
  readonly name: string;
  readonly workerType: string;
  readonly workers: readonly WorkerConfig[];
  readonly health: Record<string, WorkerHealthState>;
  readonly reason: CodeTaskDispatchBlockerReason;
}

describe('classifyCodeTaskDispatchability', () => {
  const expectedBlockerText: Record<
    CodeTaskDispatchBlockerReason,
    { readonly message: string; readonly remediation: string }
  > = {
    no_enabled_workers: {
      message: 'No enabled code-task workers are configured',
      remediation: 'Enable or add a worker in worker settings',
    },
    workers_unreachable: {
      message: 'No configured workers are reachable',
      remediation: 'Check worker host connectivity',
    },
    workers_at_capacity: {
      message: 'All capable workers',
      remediation: 'Wait for a running task to finish',
    },
    codex_auth_unavailable: {
      message: 'No reachable worker has active Codex auth',
      remediation: 'Refresh Codex/ChatGPT authentication',
    },
    claude_auth_unavailable: {
      message: 'No reachable worker has active Claude auth',
      remediation: 'Refresh Claude authentication',
    },
    provider_auth_unavailable: {
      message: 'No reachable worker has the provider API key required',
      remediation: 'Configure the required provider API key',
    },
    docker_unavailable: {
      message: 'No reachable worker has healthy Docker',
      remediation: 'Inspect Docker health',
    },
    disk_unavailable: {
      message: 'No reachable worker has healthy disk capacity',
      remediation: 'Free disk space',
    },
    unknown_worker_type: {
      message: 'is not recognized',
      remediation: 'Select a supported worker type',
    },
    worker_health_contract_mismatch: {
      message: 'responded with an incompatible health contract',
      remediation: 'Deploy or restart the worker orchestrator',
    },
  };

  const blockedDispatchCases = [
    {
      name: 'no enabled workers',
      workerType: 'codex-xhigh',
      workers: [worker('disabled', { enabled: false })],
      health: {},
      reason: 'no_enabled_workers',
    },
    {
      name: 'workers unreachable',
      workerType: 'codex-xhigh',
      workers: [worker('home-dev')],
      health: {
        'home-dev': orchestratorUnreachable(),
      },
      reason: 'workers_unreachable',
    },
    {
      name: 'worker health contract mismatch',
      workerType: 'codex-xhigh',
      workers: [worker('home-dev')],
      health: {
        'home-dev': contractMismatch(['providerApiKeys']),
      },
      reason: 'worker_health_contract_mismatch',
    },
    {
      name: 'all healthy workers at capacity',
      workerType: 'sonnet',
      workers: [worker('home-dev')],
      health: { 'home-dev': healthy({ available: 0, running: 2, capacity: 2 }) },
      reason: 'workers_at_capacity',
    },
    {
      name: 'codex auth unavailable when expired auth is not refreshable',
      workerType: 'codex-xhigh',
      workers: [worker('home-dev')],
      health: {
        'home-dev': healthy({
          workerAuths: {
            claude: { status: 'active' },
            codex: { status: 'expired', refreshSupported: false, message: 'Codex token expired' },
          },
        }),
      },
      reason: 'codex_auth_unavailable',
    },
    {
      name: 'claude auth unavailable',
      workerType: 'sonnet',
      workers: [worker('home-dev')],
      health: {
        'home-dev': healthy({
          workerAuths: {
            claude: { status: 'not_configured', message: 'Claude credentials not found' },
            codex: { status: 'active' },
          },
        }),
      },
      reason: 'claude_auth_unavailable',
    },
    {
      name: 'provider auth unavailable',
      workerType: 'glm',
      workers: [worker('home-dev')],
      health: {
        'home-dev': healthy({
          providerApiKeys: {
            DASHSCOPE_API_KEY: { configured: false },
          },
        }),
      },
      reason: 'provider_auth_unavailable',
    },
    {
      name: 'docker unavailable',
      workerType: 'codex',
      workers: [worker('home-dev')],
      health: { 'home-dev': healthy({ dockerHealthy: false }) },
      reason: 'docker_unavailable',
    },
    {
      name: 'disk unavailable',
      workerType: 'codex',
      workers: [worker('home-dev')],
      health: { 'home-dev': healthy({ diskHealthy: false }) },
      reason: 'disk_unavailable',
    },
    {
      name: 'unknown worker type',
      workerType: 'made-up',
      workers: [worker('home-dev')],
      health: { 'home-dev': healthy() },
      reason: 'unknown_worker_type',
    },
  ] satisfies BlockedDispatchCase[];

  it.each(blockedDispatchCases)('$name -> $reason', ({ workerType, workers, health, reason }) => {
    const result = classifyCodeTaskDispatchability({
      workerType,
      workers,
      healthByWorkerName: health,
    });

    expect(result.dispatchable).toBe(false);
    if (result.dispatchable) throw new Error('expected blocker');
    expect(result.reason).toBe(reason);
    const expectedText = expectedBlockerText[reason];
    expect(result.message).toContain(expectedText.message);
    expect(result.remediation).toContain(expectedText.remediation);
  });

  it('is dispatchable when at least one enabled worker satisfies runtime, auth, capacity, Docker, and disk requirements', () => {
    const result = classifyCodeTaskDispatchability({
      workerType: 'codex-xhigh',
      workers: [worker('blocked'), worker('ready')],
      healthByWorkerName: {
        blocked: healthy({
          workerAuths: {
            claude: { status: 'active' },
            codex: { status: 'expired', message: 'expired' },
          },
        }),
        ready: healthy(),
      },
    });

    expect(result).toEqual({
      dispatchable: true,
      workerNames: ['ready'],
    });
  });

  it('keeps tunnel-down and timeout failures recoverable as workers_unreachable', () => {
    const tunnelResult = classifyCodeTaskDispatchability({
      workerType: 'codex-xhigh',
      workers: [worker('tunnel-worker')],
      healthByWorkerName: {
        'tunnel-worker': { _tag: 'tunnel-down', healthy: false, reason: 'dns-failed' },
      },
    });
    const timeoutResult = classifyCodeTaskDispatchability({
      workerType: 'codex-xhigh',
      workers: [worker('timeout-worker')],
      healthByWorkerName: {
        'timeout-worker': orchestratorUnreachable('timeout'),
      },
    });

    expect(tunnelResult).toEqual(expect.objectContaining({
      dispatchable: false,
      reason: 'workers_unreachable',
      severity: 'critical',
    }));
    expect(timeoutResult).toEqual(expect.objectContaining({
      dispatchable: false,
      reason: 'workers_unreachable',
      severity: 'critical',
    }));
  });

  it('is dispatchable when a healthy capable worker exists beside contract-mismatched workers', () => {
    const result = classifyCodeTaskDispatchability({
      workerType: 'codex-xhigh',
      workers: [worker('legacy'), worker('ready')],
      healthByWorkerName: {
        legacy: contractMismatch(),
        ready: healthy(),
      },
    });

    expect(result).toEqual({
      dispatchable: true,
      workerNames: ['ready'],
    });
  });

  it('returns terminal contract mismatch when every enabled worker has mismatched health', () => {
    const result = classifyCodeTaskDispatchability({
      workerType: 'codex-xhigh',
      workers: [worker('legacy-a'), worker('legacy-b')],
      healthByWorkerName: {
        'legacy-a': contractMismatch(['providerApiKeys']),
        'legacy-b': contractMismatch(['workerAuths', 'providerApiKeys']),
      },
    });

    expect(result).toEqual(expect.objectContaining({
      dispatchable: false,
      reason: 'worker_health_contract_mismatch',
      severity: 'critical',
      workerNames: ['legacy-a', 'legacy-b'],
    }));
  });

  it('includes safe worker health diagnostics for contract mismatches', () => {
    const result = classifyCodeTaskDispatchability({
      workerType: 'codex-xhigh',
      workers: [worker('legacy-a'), worker('legacy-b')],
      healthByWorkerName: {
        'legacy-a': contractMismatch(['providerApiKeys']),
        'legacy-b': contractMismatch(['workerAuths', 'providerApiKeys']),
      },
    });

    expect(result.dispatchable).toBe(false);
    if (result.dispatchable) throw new Error('expected blocker');
    expect(result.workerHealthDetails).toEqual([
      {
        workerName: 'legacy-a',
        tag: 'unknown',
        healthy: false,
        error: 'Health response missing worker capability details',
        contractMismatch: true,
        missingFields: ['providerApiKeys'],
      },
      {
        workerName: 'legacy-b',
        tag: 'unknown',
        healthy: false,
        error: 'Health response missing worker capability details',
        contractMismatch: true,
        missingFields: ['workerAuths', 'providerApiKeys'],
      },
    ]);
  });

  it('includes safe worker health diagnostics for unreachable workers and skips missing health', () => {
    const result = classifyCodeTaskDispatchability({
      workerType: 'codex-xhigh',
      workers: [worker('tunnel-worker'), worker('missing-health')],
      healthByWorkerName: {
        'tunnel-worker': {
          _tag: 'tunnel-down',
          healthy: false,
          reason: 'cf-error',
          code: 'CF_521',
        },
      },
    });

    expect(result.dispatchable).toBe(false);
    if (result.dispatchable) throw new Error('expected blocker');
    expect(result.reason).toBe('workers_unreachable');
    expect(result.workerHealthDetails).toEqual([
      {
        workerName: 'tunnel-worker',
        tag: 'tunnel-down',
        healthy: false,
        reason: 'cf-error',
        code: 'CF_521',
      },
    ]);
  });

  it('maps individual health diagnostics without leaking credentials', () => {
    expect(healthDiagnostic(worker('missing-health'), undefined)).toBeUndefined();
    expect(healthDiagnostic(worker('orchestrator-worker'), {
      _tag: 'orchestrator-unreachable',
      healthy: false,
      reason: 'http-error',
      code: '503',
    })).toEqual({
      workerName: 'orchestrator-worker',
      tag: 'orchestrator-unreachable',
      healthy: false,
      reason: 'http-error',
      code: '503',
    });
    expect(healthDiagnostic(worker('timeout-worker'), orchestratorUnreachable('timeout'))).toEqual({
      workerName: 'timeout-worker',
      tag: 'orchestrator-unreachable',
      healthy: false,
      reason: 'timeout',
    });
    expect(healthDiagnostic(worker('ready'), healthy())).toEqual({
      workerName: 'ready',
      tag: 'healthy',
      healthy: true,
    });
    expect(healthDiagnostic(worker('unknown-basic'), {
      _tag: 'unknown',
      healthy: false,
      error: 'unexpected shape',
    })).toEqual({
      workerName: 'unknown-basic',
      tag: 'unknown',
      healthy: false,
      error: 'unexpected shape',
    });
    expect(healthDiagnostics(
      [worker('missing-health'), worker('legacy')],
      { legacy: contractMismatch(['workerAuths']) }
    )).toEqual([
      {
        workerName: 'legacy',
        tag: 'unknown',
        healthy: false,
        error: 'Health response missing worker capability details',
        contractMismatch: true,
        missingFields: ['workerAuths'],
      },
    ]);
  });

  it('is dispatchable for Codex when expired auth can be refreshed by the worker', () => {
    const result = classifyCodeTaskDispatchability({
      workerType: 'codex-xhigh',
      workers: [worker('refreshable-codex')],
      healthByWorkerName: {
        'refreshable-codex': healthy({
          workerAuths: {
            claude: { status: 'active' },
            codex: { status: 'expired', refreshSupported: true, message: 'refresh available' },
          },
        }),
      },
    });

    expect(result).toEqual({
      dispatchable: true,
      workerNames: ['refreshable-codex'],
    });
  });

  it('is dispatchable for provider-backed workers when the required API key is configured', () => {
    const result = classifyCodeTaskDispatchability({
      workerType: 'openrouter-free',
      workers: [worker('provider-ready')],
      healthByWorkerName: {
        'provider-ready': healthy({
          providerApiKeys: {
            OPENROUTER_API_KEY: { configured: true },
          },
        }),
      },
    });

    expect(result).toEqual({
      dispatchable: true,
      workerNames: ['provider-ready'],
    });
  });

  it.each(['missing', 'unknown', 'invalid', 'degraded'] as const)(
    'blocks provider dispatch when the validation status is %s',
    (status) => {
      const result = classifyCodeTaskDispatchability({
        workerType: 'openrouter-free',
        workers: [worker('provider-not-ready')],
        healthByWorkerName: {
          'provider-not-ready': healthy({
            providerApiKeys: {
              OPENROUTER_API_KEY: { configured: true, status },
            },
          }),
        },
      });

      expect(result).toEqual(expect.objectContaining({
        dispatchable: false,
        reason: 'provider_auth_unavailable',
      }));
    }
  );

  it('allows provider dispatch only when a status-bearing entry is configured and valid', () => {
    const validResult = classifyCodeTaskDispatchability({
      workerType: 'openrouter-free',
      workers: [worker('provider-valid')],
      healthByWorkerName: {
        'provider-valid': healthy({
          providerApiKeys: {
            OPENROUTER_API_KEY: { configured: true, status: 'valid' },
          },
        }),
      },
    });
    const inconsistentResult = classifyCodeTaskDispatchability({
      workerType: 'openrouter-free',
      workers: [worker('provider-inconsistent')],
      healthByWorkerName: {
        'provider-inconsistent': healthy({
          providerApiKeys: {
            OPENROUTER_API_KEY: { configured: false, status: 'valid' },
          },
        }),
      },
    });

    expect(validResult).toEqual({ dispatchable: true, workerNames: ['provider-valid'] });
    expect(inconsistentResult).toEqual(expect.objectContaining({
      dispatchable: false,
      reason: 'provider_auth_unavailable',
    }));
  });
});
