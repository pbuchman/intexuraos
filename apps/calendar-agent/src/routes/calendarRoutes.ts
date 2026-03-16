/**
 * Calendar API routes — barrel that registers all sub-route plugins.
 */
import type { FastifyPluginCallback } from 'fastify';
import { eventQueryRoutes } from './eventQueryRoutes.js';
import { eventCreateRoutes } from './eventCreateRoutes.js';
import { eventUpdateRoutes } from './eventUpdateRoutes.js';
import { eventDeleteRoutes } from './eventDeleteRoutes.js';
import { freeBusyRoutes } from './freeBusyRoutes.js';
import { failedEventRoutes } from './failedEventRoutes.js';

export const calendarRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  void fastify.register(eventQueryRoutes);
  void fastify.register(eventCreateRoutes);
  void fastify.register(eventUpdateRoutes);
  void fastify.register(eventDeleteRoutes);
  void fastify.register(freeBusyRoutes);
  void fastify.register(failedEventRoutes);
  done();
};
