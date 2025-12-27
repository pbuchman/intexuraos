/**
 * Routes for mobile-notifications-service.
 */
import type { FastifyPluginAsync } from 'fastify';
import { connectRoutes } from './connectRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { notificationRoutes } from './notificationRoutes.js';

/**
 * Register all routes.
 */
export const mobileNotificationsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(connectRoutes);
  await app.register(webhookRoutes);
  await app.register(notificationRoutes);
};
