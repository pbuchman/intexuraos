/**
 * Configuration loader for linear-agent service.
 */

export interface Config {
  port: number;
  gcpProjectId: string;
  userServiceUrl: string;
  internalAuthToken: string;
}

export function loadConfig(): Config {
  const port = Number(process.env['PORT'] ?? 8080);
  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '';
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

  return {
    port,
    gcpProjectId,
    userServiceUrl,
    internalAuthToken,
  };
}
