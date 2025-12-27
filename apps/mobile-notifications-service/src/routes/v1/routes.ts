/**
 * V1 routes for mobile-notifications-service.
 */
import type { FastifyPluginCallback } from 'fastify';
import { connectRoutes } from './connectRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { notificationRoutes } from './notificationRoutes.js';

/**
 * Register all v1 routes.
 */
export const v1Routes: FastifyPluginCallback = (fastify, _opts, done) => {
  connectRoutes(fastify, {}, (err) => {
    if (err !== undefined) {
      done(err);
      return;
    }
    webhookRoutes(fastify, {}, (err2) => {
      if (err2 !== undefined) {
        done(err2);
        return;
      }
      notificationRoutes(fastify, {}, done);
    });
  });
};
