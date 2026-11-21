import {
  CODE_TASK_WORKER_CAPABILITIES,
  CODE_TASK_WORKER_TYPES,
  type CodeTaskWorkerType,
} from '@intexuraos/code-task-domain/worker-types';
import { Mutex } from 'async-mutex';
import type { WorkerAuthManager, WorkerAuthProvider, WorkerAuthState } from './types.js';

const AUTH_PROVIDERS = ['claude', 'codex'] as const;
const DEFAULT_STATE: WorkerAuthState = {
  status: 'not_configured',
  authMode: null,
  refreshSupported: false,
  message: 'Worker auth manager not configured',
};
const DISABLED_STATE: WorkerAuthState = {
  status: 'disabled',
  authMode: null,
  refreshSupported: false,
};

function getRequiredProviders(types: readonly CodeTaskWorkerType[]): ReadonlySet<string> {
  return new Set(types.map((type) => CODE_TASK_WORKER_CAPABILITIES[type].auth.kind));
}

interface AuthSession {
  controller: AbortController;
  dockerWork: Mutex;
}

export class WorkerAuthRegistry {
  private readonly managers: Map<WorkerAuthProvider, WorkerAuthManager>;
  private readonly enabledProviders = new Map<WorkerAuthProvider, AuthSession>();
  private monitoring = false;

  constructor(
    managers: readonly WorkerAuthManager[],
    enabledWorkerTypes: readonly CodeTaskWorkerType[] = CODE_TASK_WORKER_TYPES
  ) {
    this.managers = new Map(managers.map((manager) => [manager.provider, manager]));
    this.applyProviderDemand(getRequiredProviders(enabledWorkerTypes));
  }

  async setEnabledWorkerTypes(types: readonly CodeTaskWorkerType[]): Promise<void> {
    const required = getRequiredProviders(types);
    const settling: Promise<void>[] = [];
    for (const [provider, active] of this.enabledProviders) {
      if (!required.has(provider)) {
        active.controller.abort();
        // Image pulls are outside this barrier. An aborted pull may finish
        // later, but cannot create a refresh container after this change.
        settling.push(active.dockerWork.waitForUnlock());
      }
    }
    await Promise.all(settling);
    this.applyProviderDemand(required);
  }

  private applyProviderDemand(required: ReadonlySet<string>): void {
    for (const provider of AUTH_PROVIDERS) {
      const active = this.enabledProviders.get(provider);
      const manager = this.managers.get(provider);
      if (required.has(provider) && active === undefined) {
        this.enabledProviders.set(provider, {
          controller: new AbortController(),
          dockerWork: new Mutex(),
        });
        if (this.monitoring && manager !== undefined) {
          manager.loadCredentials();
          manager.startMonitoring();
        }
      } else if (!required.has(provider) && active !== undefined) {
        this.enabledProviders.delete(provider);
        manager?.stopMonitoring();
      }
    }
  }

  loadCredentials(): Record<WorkerAuthProvider, boolean> {
    return {
      claude: this.getManager('claude')?.loadCredentials() ?? false,
      codex: this.getManager('codex')?.loadCredentials() ?? false,
    };
  }

  startMonitoring(): void {
    if (!this.monitoring) {
      this.monitoring = true;
      for (const provider of this.enabledProviders.keys()) {
        this.managers.get(provider)?.startMonitoring();
      }
    }
  }

  stopMonitoring(): void {
    this.monitoring = false;
    for (const provider of this.enabledProviders.keys()) {
      this.managers.get(provider)?.stopMonitoring();
    }
  }

  getState(provider: WorkerAuthProvider): WorkerAuthState {
    if (!this.enabledProviders.has(provider)) {
      return DISABLED_STATE;
    }
    return this.getManager(provider)?.getState() ?? DEFAULT_STATE;
  }

  getStates(): Record<WorkerAuthProvider, WorkerAuthState> {
    return {
      claude: this.getState('claude'),
      codex: this.getState('codex'),
    };
  }

  isExpiringSoon(provider: WorkerAuthProvider, bufferMs: number): boolean {
    if (this.enabledProviders.get(provider)?.controller.signal.aborted === true) {
      return false;
    }
    return this.getManager(provider)?.isExpiringSoon(bufferMs) ?? false;
  }

  async refresh(provider: WorkerAuthProvider): Promise<boolean> {
    const manager = this.managers.get(provider);
    const active = this.enabledProviders.get(provider);
    if (manager === undefined || active === undefined || active.controller.signal.aborted) {
      return false;
    }

    return await manager.refresh({
      signal: active.controller.signal,
      runDockerWork: async (work) => await active.dockerWork.runExclusive(work),
    });
  }

  getCurrentAccessToken(provider: WorkerAuthProvider): string | null {
    return this.getManager(provider)?.getCurrentAccessToken() ?? null;
  }

  private getManager(provider: WorkerAuthProvider): WorkerAuthManager | undefined {
    return this.enabledProviders.has(provider) ? this.managers.get(provider) : undefined;
  }
}
