/**
 * Configuration loader for code-agent service.
 */

export interface Config {
  port: number;
  gcpProjectId: string;
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  whatsappSendTopic: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  webhookVerifySecret: string;
  tokenEncryptionKey: string;
  orchestratorSecret: string;
  serviceUrl: string;
  githubWebhookSecret: string;
  // Auth0 JWT validation
  auth0Audience: string;
  auth0Issuer: string;
  auth0JwksUri: string;
}

export function loadConfig(): Config {
  const port = parseInt(process.env['PORT'] ?? '8128', 10);
  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  const firestoreProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '';
  const whatsappServiceUrl = process.env['INTEXURAOS_WHATSAPP_SERVICE_URL'] ?? '';
  const whatsappSendTopic = process.env['INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC'] ?? '';
  const linearAgentUrl = process.env['INTEXURAOS_LINEAR_AGENT_URL'] ?? '';
  const actionsAgentUrl = process.env['INTEXURAOS_ACTIONS_AGENT_URL'] ?? '';
  const webhookVerifySecret = process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'] ?? '';
  const orchestratorSecret = process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] ?? '';
  const serviceUrl = process.env['INTEXURAOS_SERVICE_URL'] ?? ''; // validated in REQUIRED_ENV
  const auth0Audience = process.env['INTEXURAOS_AUTH_AUDIENCE'] ?? '';
  const auth0Issuer = process.env['INTEXURAOS_AUTH_ISSUER'] ?? '';
  const auth0JwksUri = process.env['INTEXURAOS_AUTH_JWKS_URL'] ?? '';
  const tokenEncryptionKey = process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] ?? '';
  const githubWebhookSecret = process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'] ?? '';

  return {
    port,
    gcpProjectId,
    internalAuthToken,
    firestoreProjectId,
    whatsappServiceUrl,
    whatsappSendTopic,
    linearAgentUrl,
    actionsAgentUrl,
    webhookVerifySecret,
    orchestratorSecret,
    serviceUrl,
    tokenEncryptionKey,
    githubWebhookSecret,
    auth0Audience,
    auth0Issuer,
    auth0JwksUri,
  };
}
