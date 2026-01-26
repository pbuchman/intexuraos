import type { FastifyInstance } from 'fastify';
import type { JwtValidator } from './codeRoutes.js';
import { codeRoutes } from './codeRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';

export interface RoutesDeps {
  jwtValidator: JwtValidator;
}

export async function registerRoutes(app: FastifyInstance, deps: RoutesDeps): Promise<void> {
  await app.register(codeRoutes, deps);
  await app.register(webhookRoutes);
}
