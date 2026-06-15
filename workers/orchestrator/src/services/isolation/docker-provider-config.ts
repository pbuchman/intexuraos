export interface DockerProviderConfig {
  imageName: string;
  imagePullPolicy: 'always' | 'if-not-present';
  networkName: string;
  maxConcurrent: number;
  timeoutMs: number;
  secretsBasePath: string;
  gcpSaKeyPath: string;
  keepContainersAlive: boolean;
  managedAttemptsMode: boolean;
  workerReadyTimeoutMs?: number;
  sharedCredsPath?: string;
  sharedCodexAuthPath?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  forensicsMode: boolean;
  forensicsBasePath: string;
}

export const DEFAULT_DOCKER_PROVIDER_CONFIG: DockerProviderConfig = {
  imageName:
    'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest',
  imagePullPolicy: 'always',
  networkName: 'code-worker-net',
  maxConcurrent: 4,
  timeoutMs: 2 * 60 * 60 * 1000,
  secretsBasePath: '/tmp/claude-secrets',
  gcpSaKeyPath: '',
  keepContainersAlive: false,
  managedAttemptsMode: true,
  forensicsMode: false,
  forensicsBasePath: '/tmp/code-worker-forensics',
};

export const PERIODIC_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
export const HEALTH_CHECK_INTERVAL_MS = 30_000;
export const DOCKER_PING_TIMEOUT_MS = 5_000;
export const MIN_DISK_SPACE_BYTES = 5 * 1024 * 1024 * 1024;
export const PRESERVED_MAX_AGE_MS = 3 * 60 * 60 * 1000;
