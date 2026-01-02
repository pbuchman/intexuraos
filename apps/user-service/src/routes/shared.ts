/**
 * Auth0 configuration from environment.
 */
export interface Auth0Config {
  domain: string;
  clientId: string;
  audience: string;
  jwksUrl: string;
  issuer: string;
}

/**
 * Load Auth0 config from environment.
 * Returns null if required vars are missing.
 */
export function loadAuth0Config(): Auth0Config | null {
  const domain = process.env['INTEXURAOS_AUTH0_DOMAIN'];
  const clientId = process.env['INTEXURAOS_AUTH0_CLIENT_ID'];
  const audience = process.env['INTEXURAOS_AUTH_AUDIENCE'];

  if (
    domain === undefined ||
    domain === '' ||
    clientId === undefined ||
    clientId === '' ||
    audience === undefined ||
    audience === ''
  ) {
    return null;
  }

  return {
    domain,
    clientId,
    audience,
    jwksUrl: `https://${domain}/.well-known/jwks.json`,
    issuer: `https://${domain}/`,
  };
}
