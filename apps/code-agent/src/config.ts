/**
 * Configuration loader for code-agent service.
 */

export interface WorkerConfig {
  url: string;
  priority: number;
}

export interface CodeWorkersConfig {
  mac?: WorkerConfig;
  vm?: WorkerConfig;
}

export interface Config {
  port: number;
  gcpProjectId: string;
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  dispatchSecret: string;
  webhookVerifySecret: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  codeWorkers: CodeWorkersConfig;
}

export function loadConfig(): Config {
  const port = parseInt(process.env['PORT'] ?? '8095', 10);
  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_SECRET'] ?? '';
  const firestoreProjectId = process.env['INTEXURAOS_FIRESTORE_PROJECT_ID'] ?? '';
  const whatsappServiceUrl = process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'] ?? '';
  const linearAgentUrl = process.env['INTEXURAOS_LINEAR_AGENT_URL'] ?? '';
  const actionsAgentUrl = process.env['INTEXURAOS_ACTIONS_AGENT_URL'] ?? '';
  const dispatchSecret = process.env['INTEXURAOS_DISPATCH_SECRET'] ?? '';
  const webhookVerifySecret = process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'] ?? '';
  const cfAccessClientId = process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] ?? '';
  const cfAccessClientSecret = process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] ?? '';
  const codeWorkersJson = process.env['INTEXURAOS_CODE_WORKERS'] ?? '{}';

  const codeWorkers: CodeWorkersConfig = JSON.parse(codeWorkersJson) as CodeWorkersConfig;

  return {
    port,
    gcpProjectId,
    internalAuthToken,
    firestoreProjectId,
    whatsappServiceUrl,
    linearAgentUrl,
    actionsAgentUrl,
    dispatchSecret,
    webhookVerifySecret,
    cfAccessClientId,
    cfAccessClientSecret,
    codeWorkers,
  };
}
