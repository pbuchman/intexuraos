/**
 * Configuration loader for code-agent service.
 */

export interface Config {
  port: number;
  gcpProjectId: string;
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  dispatchSigningSecret: string;
  webhookVerifySecret: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  orchestratorMacUrl: string;
  orchestratorVmUrl: string;
}

export function loadConfig(): Config {
  const port = parseInt(process.env['PORT'] ?? '8095', 10);
  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  const firestoreProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '';
  const whatsappServiceUrl = process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'] ?? '';
  const linearAgentUrl = process.env['INTEXURAOS_LINEAR_AGENT_URL'] ?? '';
  const actionsAgentUrl = process.env['INTEXURAOS_ACTIONS_AGENT_URL'] ?? '';
  const dispatchSigningSecret = process.env['INTEXURAOS_DISPATCH_SIGNING_SECRET'] ?? '';
  const webhookVerifySecret = process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'] ?? '';
  const cfAccessClientId = process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] ?? '';
  const cfAccessClientSecret = process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] ?? '';
  const orchestratorMacUrl = process.env['INTEXURAOS_ORCHESTRATOR_MAC_URL'] ?? '';
  const orchestratorVmUrl = process.env['INTEXURAOS_ORCHESTRATOR_VM_URL'] ?? '';

  return {
    port,
    gcpProjectId,
    internalAuthToken,
    firestoreProjectId,
    whatsappServiceUrl,
    linearAgentUrl,
    actionsAgentUrl,
    dispatchSigningSecret,
    webhookVerifySecret,
    cfAccessClientId,
    cfAccessClientSecret,
    orchestratorMacUrl,
    orchestratorVmUrl,
  };
}
