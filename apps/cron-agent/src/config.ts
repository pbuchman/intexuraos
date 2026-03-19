export interface ServiceDefinition {
  key: string;
  name: string;
  url: string;
  openapiUrl: string;
  allowedOperations?: string[] | undefined;
}

export interface CronAgentConfig {
  port: number;
  gcpProjectId: string;
  internalAuthToken: string;
  authAudience: string;
  authIssuer: string;
  authJwksUrl: string;
  sentryDsn: string;
  environment: string;
  allowedServices: ServiceDefinition[];
  geminiApiKey: string;
}

export function loadConfig(): CronAgentConfig {
  const codeAgentUrl = process.env['INTEXURAOS_CODE_AGENT_URL'] ?? '';

  const allowedServices: ServiceDefinition[] = [];

  if (codeAgentUrl !== '') {
    allowedServices.push({
      key: 'code-agent',
      name: 'Code Agent',
      url: codeAgentUrl,
      openapiUrl: `${codeAgentUrl}/openapi.json`,
    });
  }

  return {
    port: parseInt(process.env['PORT'] ?? '8080', 10),
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    authAudience: process.env['INTEXURAOS_AUTH_AUDIENCE'] ?? '',
    authIssuer: process.env['INTEXURAOS_AUTH_ISSUER'] ?? '',
    authJwksUrl: process.env['INTEXURAOS_AUTH_JWKS_URL'] ?? '',
    sentryDsn: process.env['INTEXURAOS_SENTRY_DSN'] ?? '',
    environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    allowedServices,
    geminiApiKey: process.env['INTEXURAOS_GEMINI_APP_API_KEY'] ?? '',
  };
}
