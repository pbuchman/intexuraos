export interface Config {
  port: number;
  gcpProjectId: string;
  authJwksUrl: string;
  authIssuer: string;
  authAudience: string;
  internalAuthToken: string;
  userServiceUrl: string;
  messageDigestServiceUrl: string;
  whatsappServiceUrl: string;
  llmUsageServiceUrl: string;
  openRouterAppApiKey: string;
  sentryDsn?: string;
  environment: string;
}

function readEnv(key: string): string {
  return process.env[key] ?? '';
}

export function loadConfig(): Config {
  const baseConfig: Config = {
    port: parseInt(process.env['PORT'] ?? '8080', 10),
    gcpProjectId: readEnv('INTEXURAOS_GCP_PROJECT_ID'),
    authJwksUrl: readEnv('INTEXURAOS_AUTH_JWKS_URL'),
    authIssuer: readEnv('INTEXURAOS_AUTH_ISSUER'),
    authAudience: readEnv('INTEXURAOS_AUTH_AUDIENCE'),
    internalAuthToken: readEnv('INTEXURAOS_INTERNAL_AUTH_TOKEN'),
    userServiceUrl: readEnv('INTEXURAOS_USER_SERVICE_URL'),
    messageDigestServiceUrl: readEnv('INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL'),
    whatsappServiceUrl: readEnv('INTEXURAOS_WHATSAPP_SERVICE_URL'),
    llmUsageServiceUrl: readEnv('INTEXURAOS_LLM_USAGE_SERVICE_URL'),
    openRouterAppApiKey: readEnv('INTEXURAOS_OPENROUTER_APP_API_KEY'),
    environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  };

  const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
  if (sentryDsn !== undefined && sentryDsn !== '') {
    return { ...baseConfig, sentryDsn };
  }

  return baseConfig;
}
