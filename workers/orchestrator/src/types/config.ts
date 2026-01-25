export interface OrchestratorConfig {
  port: number;
  capacity: number;
  taskTimeoutMs: number;
  stateFilePath: string;
  worktreeBasePath: string;
  logBasePath: string;
  githubAppId: string;
  githubAppPrivateKeyPath: string;
  githubInstallationId: string;
  dispatchSecret: string;
}
