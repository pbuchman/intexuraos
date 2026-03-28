import type { WorkerAuthManager, WorkerAuthProvider, WorkerAuthState } from './types.js';

const DEFAULT_STATE: WorkerAuthState = {
  status: 'not_configured',
  authMode: null,
  refreshSupported: false,
  message: 'Worker auth manager not configured',
};

export class WorkerAuthRegistry {
  private readonly managers: Map<WorkerAuthProvider, WorkerAuthManager>;

  constructor(managers: readonly WorkerAuthManager[]) {
    this.managers = new Map(managers.map((manager) => [manager.provider, manager]));
  }

  loadCredentials(): Record<WorkerAuthProvider, boolean> {
    return {
      claude: this.getManager('claude')?.loadCredentials() ?? false,
      codex: this.getManager('codex')?.loadCredentials() ?? false,
    };
  }

  startMonitoring(): void {
    this.managers.forEach((manager) => {
      manager.startMonitoring();
    });
  }

  stopMonitoring(): void {
    this.managers.forEach((manager) => {
      manager.stopMonitoring();
    });
  }

  getState(provider: WorkerAuthProvider): WorkerAuthState {
    return this.getManager(provider)?.getState() ?? DEFAULT_STATE;
  }

  getStates(): Record<WorkerAuthProvider, WorkerAuthState> {
    return {
      claude: this.getState('claude'),
      codex: this.getState('codex'),
    };
  }

  isExpiringSoon(provider: WorkerAuthProvider, bufferMs: number): boolean {
    return this.getManager(provider)?.isExpiringSoon(bufferMs) ?? false;
  }

  async refresh(provider: WorkerAuthProvider): Promise<boolean> {
    const manager = this.getManager(provider);
    if (manager === undefined) {
      return false;
    }

    return await manager.refresh();
  }

  getCurrentAccessToken(provider: WorkerAuthProvider): string | null {
    return this.getManager(provider)?.getCurrentAccessToken() ?? null;
  }

  private getManager(provider: WorkerAuthProvider): WorkerAuthManager | undefined {
    return this.managers.get(provider);
  }
}
