export type WorkerAuthProvider = 'claude' | 'codex';

export type WorkerAuthMode = 'oauth' | 'chatgpt';

export type WorkerAuthStatus =
  | 'active'
  | 'expired'
  | 'not_configured'
  | 'invalid'
  | 'refresh_failed';

export interface WorkerAuthState {
  status: WorkerAuthStatus;
  authMode: WorkerAuthMode | null;
  refreshSupported: boolean;
  message?: string;
  expiresAt?: string;
  expiresInMinutes?: number;
  lastRefreshAt?: string;
  subscriptionType?: string;
}

export interface WorkerAuthManager {
  provider: WorkerAuthProvider;
  loadCredentials(): boolean;
  startMonitoring(): void;
  stopMonitoring(): void;
  getState(): WorkerAuthState;
  isExpiringSoon(bufferMs: number): boolean;
  refresh(): Promise<boolean>;
  getCurrentAccessToken(): string | null;
}
