export interface Config {
  port: number;
  gcpProjectId: string;
  auth: {
    jwksUrl: string;
    issuer: string;
    audience: string;
  };
  internalAuthToken: string;
  userServiceUrl: string;
  llmUsageServiceUrl: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] ?? '8131', 10),
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    auth: {
      jwksUrl: process.env['INTEXURAOS_AUTH_JWKS_URL'] ?? '',
      issuer: process.env['INTEXURAOS_AUTH_ISSUER'] ?? '',
      audience: process.env['INTEXURAOS_AUTH_AUDIENCE'] ?? '',
    },
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    userServiceUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '',
    llmUsageServiceUrl: process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '',
  };
}
