/**
 * V1 routes for mobile-notifications-service.
 */
import type { FastifyPluginAsync } from 'fastify';
import { connectRoutes } from './connectRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { notificationRoutes } from './notificationRoutes.js';

/**
 * Register all v1 routes.
 */
export const v1Routes: FastifyPluginAsync = async (app) => {
  await app.register(connectRoutes);
  await app.register(webhookRoutes);
  await app.register(notificationRoutes);
};
