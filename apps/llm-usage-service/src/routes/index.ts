import type { FastifyInstance } from 'fastify';
import { internalUsageRoutes } from './internalUsageRoutes.js';
import { publicUsageRoutes } from './publicUsageRoutes.js';
import { webhookUsageRoutes } from './webhookUsageRoutes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(internalUsageRoutes);
  await app.register(publicUsageRoutes);
  await app.register(webhookUsageRoutes);
}
