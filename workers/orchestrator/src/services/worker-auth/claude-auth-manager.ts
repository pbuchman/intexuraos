import type { CredentialMonitor } from '../isolation/credential-monitor.js';
import type { CredentialRefresher } from '../isolation/credential-refresher.js';
import type { WorkerAuthManager, WorkerAuthState } from './types.js';

export class ClaudeAuthManager implements WorkerAuthManager {
  readonly provider = 'claude' as const;

  constructor(
    private readonly monitor: CredentialMonitor,
    private readonly refresher: CredentialRefresher
  ) {}

  loadCredentials(): boolean {
    return this.monitor.loadCredentials();
  }

  startMonitoring(): void {
    this.monitor.startMonitoring();
  }

  stopMonitoring(): void {
    this.monitor.stopMonitoring();
  }

  getState(): WorkerAuthState {
    const state = this.monitor.getState();
    if (state.status === 'active') {
      return {
        status: 'active',
        authMode: 'oauth',
        refreshSupported: true,
        expiresAt: state.expiresAt,
        expiresInMinutes: state.expiresInMinutes,
        subscriptionType: state.subscriptionType,
      };
    }

    return {
      status: state.status,
      authMode: state.status === 'expired' ? 'oauth' : null,
      refreshSupported: state.status === 'expired',
      message: state.message,
    };
  }

  isExpiringSoon(bufferMs: number): boolean {
    return this.monitor.isExpiringSoon(bufferMs);
  }

  async refresh(): Promise<boolean> {
    return await this.refresher.refresh();
  }

  getCurrentAccessToken(): string | null {
    return this.monitor.getCurrentAccessToken();
  }
}
