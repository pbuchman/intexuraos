/**
 * Configuration loader for code-agent service.
 */

export interface QueueConfig {
  /** Maximum number of tasks in queue (default 10) */
  maxSize: number;
  /** TTL for queued tasks in minutes (default 360) */
  ttlMinutes: number;
}

export interface RetryQueueConfig {
  /** Maximum retry attempts before giving up (default 3) */
  maxAttempts: number;
  /** TTL for retry entries in minutes (default 10) */
  ttlMinutes: number;
}

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
  userServiceUrl: string;
  // Auth0 JWT validation
  auth0Audience: string;
  auth0Issuer: string;
  auth0JwksUri: string;
  // Task queue configuration (INT-619)
  queue: QueueConfig;
  retryQueue: RetryQueueConfig;
  // GitHub Agent (INT-743)
  geminiAppApiKey: string;
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
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '';
  const geminiAppApiKey = process.env['INTEXURAOS_GEMINI_APP_API_KEY'] ?? '';

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
    userServiceUrl,
    auth0Audience,
    auth0Issuer,
    auth0JwksUri,
    queue: {
      maxSize: parseInt(process.env['INTEXURAOS_QUEUE_MAX_SIZE'] ?? '50', 10),
      ttlMinutes: parseInt(process.env['INTEXURAOS_QUEUE_TTL_MINUTES'] ?? '360', 10),
    },
    retryQueue: {
      maxAttempts: parseInt(process.env['INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS'] ?? '3', 10),
      ttlMinutes: parseInt(process.env['INTEXURAOS_RETRY_QUEUE_TTL_MINUTES'] ?? '10', 10),
    },
    geminiAppApiKey,
  };
}
