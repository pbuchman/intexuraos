import { describe, expect, it } from 'vitest';
import type { WorkerConfig, WorkerHealthState } from '../../../domain/models/workerSettings.js';
import {
  classifyCodeTaskDispatchability,
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
});
