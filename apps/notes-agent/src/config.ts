export interface Config {
  port: number;
  gcpProjectId: string;
  auth: {
    jwksUrl: string;
    issuer: string;
    audience: string;
  };
  internalAuthKey: string;
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
    internalAuthKey: process.env['INTEXURAOS_INTERNAL_AUTH_KEY'] ?? '',
  };
}
