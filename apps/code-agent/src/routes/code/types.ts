/**
 * Shared Fastify plugin option types for code-agent routes.
 *
 * Extracted from `codeRoutes.ts` as part of INT-1430.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

export type JwtValidator = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}
