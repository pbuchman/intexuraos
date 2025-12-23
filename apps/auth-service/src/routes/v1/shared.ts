import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

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
  const domain = process.env['AUTH0_DOMAIN'];
  const clientId = process.env['AUTH0_CLIENT_ID'];
  const audience = process.env['AUTH_AUDIENCE'];

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

/**
 * Handle Zod validation errors.
 * Converts Zod errors to standard API error response.
 */
export function handleValidationError(error: ZodError, reply: FastifyReply): FastifyReply {
  const details = error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));
  return reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
    errors: details,
  });
}
