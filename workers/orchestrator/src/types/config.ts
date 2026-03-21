export interface OrchestratorConfig {
  port: number;
  capacity: number;
  taskTimeoutMs: number;
  stateFilePath: string;
  worktreeBasePath: string;
  logBasePath: string;
  codeAgentUrl: string;
  githubAppId: string;
  githubAppPrivateKeyPath: string;
  githubInstallationId: string;
  orchestratorSecret: string;
  secretsBasePath: string;
  internalAuthToken: string;
}
