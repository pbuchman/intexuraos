export interface Config {
  port: number;
  gcpProjectId: string;
  auth: {
    jwksUrl: string;
    issuer: string;
    audience: string;
  };
  internalAuthKey: string;
  webAgentUrl: string;
  bookmarkEnrichTopic: string | null;
}

export function loadConfig(): Config {
  const enrichTopic = process.env['INTEXURAOS_PUBSUB_BOOKMARK_ENRICH'];

  return {
    port: parseInt(process.env['PORT'] ?? '8080', 10),
    gcpProjectId: process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '',
    auth: {
      jwksUrl: process.env['INTEXURAOS_AUTH_JWKS_URL'] ?? '',
      issuer: process.env['INTEXURAOS_AUTH_ISSUER'] ?? '',
      audience: process.env['INTEXURAOS_AUTH_AUDIENCE'] ?? '',
    },
    internalAuthKey: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    webAgentUrl: process.env['INTEXURAOS_WEB_AGENT_URL'] ?? '',
    bookmarkEnrichTopic: enrichTopic !== undefined && enrichTopic !== '' ? enrichTopic : null,
  };
}
