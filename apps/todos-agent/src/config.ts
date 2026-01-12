export interface Config {
  port: number;
  gcpProjectId: string;
  auth: {
    jwksUrl: string;
    issuer: string;
    audience: string;
  };
  internalAuthKey: string;
  userServiceUrl: string;
  appSettingsServiceUrl: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] ?? '8080', 10),
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    auth: {
      jwksUrl: process.env['INTEXURAOS_AUTH_JWKS_URL'] ?? '',
      issuer: process.env['INTEXURAOS_AUTH_ISSUER'] ?? '',
      audience: process.env['INTEXURAOS_AUTH_AUDIENCE'] ?? '',
    },
    internalAuthKey: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    userServiceUrl: process.env['INTEXURAOS_USER_SERVICE_URL'] ?? 'http://localhost:8110',
    appSettingsServiceUrl: process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? 'http://localhost:8113',
  };
}
