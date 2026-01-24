import type { FastifyInstance } from 'fastify';

export async function registerRoutes(_app: FastifyInstance): Promise<void> {
  // Routes will be registered here as the service grows
  // Infrastructure routes (/health, /openapi.json, /docs) are in server.ts
}
