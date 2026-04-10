import type { FastifyInstance } from 'fastify';
import { internalUsageRoutes } from './internalUsageRoutes.js';
import { webhookUsageRoutes } from './webhookUsageRoutes.js';
import { pricingRoutes } from './pricingRoutes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(internalUsageRoutes);
  await app.register(webhookUsageRoutes);
  await app.register(pricingRoutes);
}
