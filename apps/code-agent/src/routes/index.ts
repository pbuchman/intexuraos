import type { FastifyInstance } from 'fastify';
import { codeRoutes } from './codeRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(codeRoutes);
  await app.register(webhookRoutes);
}
