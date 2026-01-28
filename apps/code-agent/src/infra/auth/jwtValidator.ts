/**
 * Auth0 JWT validation middleware for code-agent public routes.
 *
 * Based on design doc: docs/designs/INT-156-code-action-type.md (lines 2611-2622)
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import type { Logger } from 'pino';

export interface JwtValidatorConfig {
  audience: string;
  issuer: string;
  jwksUri: string;
}

/**
 * Create a mock JWT validator for E2E testing.
 * Accepts any Bearer token and extracts user ID from E2E_TEST_USER_ID env var.
 */
export function createE2eJwtValidator(
  logger: Logger
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const authHeader = request.headers.authorization;

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
      logger.warn({ url: request.url }, '[E2E] Missing or invalid Authorization header');
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      });
      return;
    }

    const userId = process.env['E2E_TEST_USER_ID'] ?? 'e2e-test-user';

    // Attach user info to request via module augmentation
    (request as unknown as { user?: { userId: string; email: string | undefined } }).user = {
      userId,
      email: undefined,
    };

    logger.debug({ userId, url: request.url }, '[E2E] Mock JWT validation passed');
  };
}

export function createJwtValidator(
  config: JwtValidatorConfig,
  logger: Logger
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  // In E2E mode, use mock validator that accepts any token
  if (process.env['E2E_MODE'] === 'true') {
    logger.info('E2E_MODE enabled - using mock JWT validator');
    return createE2eJwtValidator(logger);
  }

  const jwks = jose.createRemoteJWKSet(new URL(config.jwksUri));

  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const authHeader = request.headers.authorization;

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
      logger.warn({ url: request.url }, 'Missing or invalid Authorization header');
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      });
      return;
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    try {
      const { payload } = await jose.jwtVerify(token, jwks, {
        audience: config.audience,
        issuer: config.issuer,
      });

      const userId = payload.sub;
      if (userId === undefined) {
        logger.warn({ url: request.url }, 'JWT missing sub claim');
        reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid token: missing user identifier',
          },
        });
        return;
      }

      // Attach user info to request via module augmentation
      (request as unknown as { user?: { userId: string; email: string | undefined } }).user = {
        userId,
        email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
      };

      logger.debug({ userId, url: request.url }, 'JWT validated successfully');
    } catch (error) {
      logger.warn({ url: request.url, error }, 'JWT validation failed');
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        },
      });
    }
  };
}
