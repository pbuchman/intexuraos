/**
 * Fastify auth plugin for JWT validation.
 * Reads configuration from environment variables.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { type JwtConfig, verifyJwt } from './jwt.js';

/**
 * User context attached to authenticated requests.
 */
export interface AuthUser {
  userId: string;
  claims: Record<string, unknown>;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }

  interface FastifyInstance {
    jwtConfig: JwtConfig | null;
  }
}

/**
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (authHeader === undefined || authHeader === '') {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = match?.[1];
  if (token === undefined || token === '') {
    return null;
  }

  return token;
}

/**
 * Require authentication on a route.
 * Returns the authenticated user or sends an error response and returns null.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthUser | null> {
  const jwtConfig = request.server.jwtConfig;

  if (jwtConfig === null) {
    void reply.fail(
      'MISCONFIGURED',
      'Authentication is not configured. Set INTEXURAOS_AUTH_JWKS_URL, INTEXURAOS_AUTH_ISSUER, INTEXURAOS_AUTH_AUDIENCE.'
    );
    return null;
  }

  const token = extractBearerToken(request.headers.authorization);
  if (token === null) {
    void reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
    return null;
  }

  try {
    const verified = await verifyJwt(token, jwtConfig);
    const user: AuthUser = {
      userId: verified.sub,
      claims: verified.claims,
    };
    request.user = user;
    return user;
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      void reply.fail('UNAUTHORIZED', error.message);
    } else {
      void reply.fail('UNAUTHORIZED', 'Authentication failed');
    }
    return null;
  }
}

/**
 * Try to authenticate a request without failing if authentication fails.
 * Returns the authenticated user if token is valid, or null if not.
 * Does not send any error response - useful for optional auth scenarios.
 */
export async function tryAuth(request: FastifyRequest): Promise<AuthUser | null> {
  const jwtConfig = request.server.jwtConfig;

  if (jwtConfig === null) {
    return null;
  }

  const token = extractBearerToken(request.headers.authorization);
  if (token === null) {
    return null;
  }

  try {
    const verified = await verifyJwt(token, jwtConfig);
    const user: AuthUser = {
      userId: verified.sub,
      claims: verified.claims,
    };
    request.user = user;
    return user;
  } catch {
    // Token validation failed, but we don't fail the request
    return null;
  }
}

/**
 * Auth plugin that configures JWT validation from environment.
 */
const authPlugin: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts: Record<string, unknown>,
  done: (err?: Error) => void
): void => {
  const jwksUrl = process.env['INTEXURAOS_AUTH_JWKS_URL'];
  const issuer = process.env['INTEXURAOS_AUTH_ISSUER'];
  const audience = process.env['INTEXURAOS_AUTH_AUDIENCE'];

  if (
    jwksUrl !== undefined &&
    jwksUrl !== '' &&
    issuer !== undefined &&
    issuer !== '' &&
    audience !== undefined &&
    audience !== ''
  ) {
    const config: JwtConfig = {
      jwksUrl,
      issuer,
      audience,
    };
    fastify.decorate('jwtConfig', config);
    fastify.log.info('JWT auth configured with JWKS URL: %s', jwksUrl);
  } else {
    fastify.decorate('jwtConfig', null);
    fastify.log.warn(
      'JWT auth not configured. Set INTEXURAOS_AUTH_JWKS_URL, INTEXURAOS_AUTH_ISSUER, INTEXURAOS_AUTH_AUDIENCE.'
    );
  }

  done();
};

export const fastifyAuthPlugin = fp(authPlugin, {
  name: 'intexura-auth-plugin',
  fastify: '5.x',
  dependencies: ['intexura-plugin'],
});
