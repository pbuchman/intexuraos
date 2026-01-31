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
  dispatchSigningSecret: string;
  webhookVerifySecret: string;
  tokenEncryptionKey: string;
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
  const dispatchSigningSecret = process.env['INTEXURAOS_DISPATCH_SIGNING_SECRET'] ?? '';
  const webhookVerifySecret = process.env['INTEXURAOS_WEBHOOK_VERIFY_SECRET'] ?? '';
  const auth0Audience = process.env['INTEXURAOS_AUTH_AUDIENCE'] ?? '';
  const auth0Issuer = process.env['INTEXURAOS_AUTH_ISSUER'] ?? '';
  const auth0JwksUri = process.env['INTEXURAOS_AUTH_JWKS_URL'] ?? '';
  const tokenEncryptionKey = process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] ?? '';

  return {
    port,
    gcpProjectId,
    internalAuthToken,
    firestoreProjectId,
    whatsappServiceUrl,
    whatsappSendTopic,
    linearAgentUrl,
    actionsAgentUrl,
    dispatchSigningSecret,
    webhookVerifySecret,
    tokenEncryptionKey,
    auth0Audience,
    auth0Issuer,
    auth0JwksUri,
  };
}
